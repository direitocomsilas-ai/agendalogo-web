-- ============================================================
-- Migration 38: Sistema de Embaixadores e Comissões Multi-nível
-- - Comissão gerada automaticamente quando um pagamento é aprovado
--   (trigger na tabela payments — funciona com mp_confirm_payment,
--   confirm_payment e qualquer outro caminho que marque 'aprovado').
-- - Estorno automático quando o pagamento vira 'reembolsado'.
-- - Idempotência: unique (payment_id, beneficiary) — o mesmo pagamento
--   nunca gera comissão duplicada.
-- - Carteira: saldo pendente / disponível / pago / estornado derivados.
-- - Saques com fluxo solicitado → em_analise → aprovado → pago / recusado.
-- - Configuração 100% pelo painel master (app_settings).
-- ============================================================

-- ---------- CONFIGURAÇÕES (master) ----------
alter table public.app_settings
  add column if not exists amb_enabled boolean not null default true,
  add column if not exists amb_company_pct numeric not null default 40,
  add column if not exists amb_level_pcts jsonb not null default '[30,20,10]'::jsonb,
  add column if not exists amb_safety_days int not null default 30,
  add column if not exists amb_min_withdrawal numeric not null default 50,
  add column if not exists amb_levels jsonb not null default
    '[{"min":0,"label":"Novo Embaixador"},{"min":5,"label":"Embaixador"},{"min":10,"label":"Embaixador PRO"},{"min":25,"label":"Embaixador ELITE"},{"min":50,"label":"Embaixador MASTER"}]'::jsonb;

-- ---------- EMBAIXADORES ----------
create table if not exists public.ambassadors (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'ativo' check (status in ('ativo','suspenso','bloqueado')),
  flag text not null default 'normal' check (flag in ('normal','atencao','bloqueado')),
  accepted_terms_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- COMISSÕES ----------
create table if not exists public.amb_commissions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  beneficiary uuid not null references public.profiles(id) on delete cascade,
  source_user uuid not null references public.profiles(id) on delete cascade,
  level int not null check (level between 1 and 3),
  amount numeric not null check (amount > 0),
  status text not null default 'pendente' check (status in ('pendente','disponivel','estornada')),
  available_at timestamptz,
  mp_payment_id text,
  created_at timestamptz not null default now(),
  unique (payment_id, beneficiary)
);
create index if not exists amb_commissions_beneficiary on public.amb_commissions (beneficiary, status);
create index if not exists amb_commissions_due on public.amb_commissions (status, available_at) where status = 'pendente';

-- ---------- SAQUES ----------
create table if not exists public.amb_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null check (amount > 0),
  status text not null default 'solicitado' check (status in ('solicitado','em_analise','aprovado','pago','recusado')),
  note text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists amb_withdrawals_user on public.amb_withdrawals (user_id, status);

-- ---------- MOVIMENTAÇÕES DA CARTEIRA (saques e ajustes — negativos) ----------
create table if not exists public.amb_wallet_tx (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('saque','ajuste')),
  amount numeric not null,
  withdrawal_id uuid references public.amb_withdrawals(id) on delete set null,
  commission_id uuid references public.amb_commissions(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists amb_wallet_tx_user on public.amb_wallet_tx (user_id);

-- ---------- METAS / RECOMPENSAS ----------
create table if not exists public.amb_rewards (
  id uuid primary key default gen_random_uuid(),
  min_paying_clients int not null,
  label text not null,
  active boolean not null default true
);
create table if not exists public.amb_reward_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_id uuid not null references public.amb_rewards(id) on delete cascade,
  achieved_at timestamptz not null default now(),
  primary key (user_id, reward_id)
);

-- ---------- AUDITORIA ----------
create table if not exists public.amb_audit_log (
  id bigserial primary key,
  actor uuid references public.profiles(id) on delete set null,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table public.ambassadors enable row level security;
create policy amb_read_own on public.ambassadors for select to authenticated using (user_id = auth.uid() or public.is_master());
create policy amb_insert_own on public.ambassadors for insert to authenticated with check (user_id = auth.uid());

alter table public.amb_commissions enable row level security;
create policy amb_com_own on public.amb_commissions for select to authenticated using (beneficiary = auth.uid() or public.is_master());

alter table public.amb_withdrawals enable row level security;
create policy amb_wd_own on public.amb_withdrawals for select to authenticated using (user_id = auth.uid() or public.is_master());
create policy amb_wd_insert_own on public.amb_withdrawals for insert to authenticated with check (user_id = auth.uid());

alter table public.amb_wallet_tx enable row level security;
create policy amb_tx_own on public.amb_wallet_tx for select to authenticated using (user_id = auth.uid() or public.is_master());

alter table public.amb_rewards enable row level security;
create policy amb_rewards_read on public.amb_rewards for select to authenticated using (active or public.is_master());

alter table public.amb_reward_claims enable row level security;
create policy amb_claims_own on public.amb_reward_claims for select to authenticated using (user_id = auth.uid() or public.is_master());

alter table public.amb_audit_log enable row level security;
create policy amb_audit_master on public.amb_audit_log for select to authenticated using (public.is_master());

-- ============================================================
-- MOTOR: geração/estorno de comissões (disparado pela tabela payments)
-- ============================================================
create or replace function public.amb_on_payment_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_uid uuid;
  v_lvl int;
  v_pcts jsonb;
  v_amt numeric;
  v_cfg record;
  v_paid_count int;
  v_c record;
begin
  if TG_OP = 'UPDATE' and OLD.status IS NOT DISTINCT FROM NEW.status then
    return NEW;
  end if;

  -- ---- APROVADO: gera comissões por nível (árvore referred_by) ----
  if NEW.status = 'aprovado' then
    select c.owner_id into v_owner from public.companies c where c.id = NEW.company_id;
    if v_owner is null then return NEW; end if;

    select * into v_cfg from public.app_settings where id = 1;
    if not coalesce(v_cfg.amb_enabled, true) then return NEW; end if;
    v_pcts := coalesce(v_cfg.amb_level_pcts, '[30,20,10]'::jsonb);

    select count(*) into v_paid_count
      from public.payments where company_id = NEW.company_id and status = 'aprovado';

    v_uid := v_owner;
    for v_lvl in 1..3 loop
      select p.referred_by into v_uid from public.profiles p where p.id = v_uid;
      exit when v_uid is null;
      exit when v_uid = v_owner; -- proteção contra autoindicação / ciclos

      if exists (
        select 1 from public.ambassadors a
        where a.user_id = v_uid and a.status = 'ativo' and a.flag <> 'bloqueado'
      ) then
        v_amt := round(NEW.amount * coalesce((v_pcts ->> (v_lvl - 1))::numeric, 0) / 100.0, 2);
        if v_amt > 0 then
          insert into public.amb_commissions
            (payment_id, beneficiary, source_user, level, amount, status, available_at, mp_payment_id)
          values
            (NEW.id, v_uid, v_owner, v_lvl, v_amt, 'pendente',
             now() + make_interval(days => greatest(v_cfg.amb_safety_days, 0)), NEW.mp_payment_id)
          on conflict (payment_id, beneficiary) do nothing;

          if found then
            insert into public.notifications (user_id, type, title, body)
            values (v_uid, 'embaixador',
              case when v_paid_count <= 1 then '🎉 Você ganhou uma nova comissão!' else '💰 Comissão recorrente gerada' end,
              case when v_paid_count <= 1
                then 'Seu indicado assinou um plano. Comissão de R$ ' || v_amt::text || ' registrada — fica pendente por ' || v_cfg.amb_safety_days::text || ' dias (período de segurança).'
                else 'Seu indicado renovou o plano. Comissão de R$ ' || v_amt::text || ' registrada.' end);
          end if;
        end if;
      end if;
    end loop;

    -- ---- Metas / recompensas ----
    insert into public.amb_reward_claims (user_id, reward_id)
    select v_owner, r.id from public.amb_rewards r
    where r.active
      and r.min_paying_clients <= (
        select count(distinct ac.source_user) from public.amb_commissions ac
        where ac.beneficiary = v_owner and ac.level = 1)
      and not exists (select 1 from public.amb_reward_claims c where c.user_id = v_owner and c.reward_id = r.id)
    on conflict do nothing;
    if found then
      insert into public.notifications (user_id, type, title, body)
      values (v_owner, 'embaixador', '🏆 Você atingiu uma nova meta!',
        'Você alcançou uma meta do programa de embaixadores. Confira seus benefícios na Central do Embaixador.');
    end if;
    return NEW;
  end if;

  -- ---- REEMBOLSADO: estorna comissões daquele pagamento ----
  if NEW.status = 'reembolsado' then
    for v_c in
      select * from public.amb_commissions
      where payment_id = NEW.id and status in ('pendente','disponivel')
      for update
    loop
      update public.amb_commissions set status = 'estornada' where id = v_c.id;
      insert into public.amb_wallet_tx (user_id, kind, amount, commission_id, payment_id, detail)
      values (v_c.beneficiary, 'ajuste', -v_c.amount, v_c.id, NEW.id,
        'Estorno: pagamento reembolsado/cancelado (comissão ' || v_c.status || ')');
      insert into public.notifications (user_id, type, title, body)
      values (v_c.beneficiary, 'embaixador', 'Comissão estornada',
        'Um pagamento que gerou sua comissão de R$ ' || v_c.amount::text || ' foi reembolsado. O valor foi revertido do saldo.');
    end loop;
    return NEW;
  end if;

  return NEW;
end $$;

drop trigger if exists amb_payments_trig on public.payments;
create trigger amb_payments_trig
  after update of status on public.payments
  for each row execute function public.amb_on_payment_change();

-- Notifica indicador quando um convite é utilizado (novo cadastro pelo link)
create or replace function public.amb_on_new_referral()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.referred_by is not null then
    insert into public.notifications (user_id, type, title, body)
    values (NEW.referred_by, 'embaixador', 'Seu convite foi utilizado!',
      'Alguém se cadastrou no Agenda Logo usando seu link. A comissão é gerada quando o convite assinar um plano.');
  end if;
  return NEW;
end $$;

drop trigger if exists amb_new_referral_trig on public.profiles;
create trigger amb_new_referral_trig
  after insert on public.profiles
  for each row execute function public.amb_on_new_referral();

-- ============================================================
-- FUNÇÕES DO EMBAIXADOR (usuário comum)
-- ============================================================

-- Entrar no programa de embaixadores
create or replace function public.amb_join_program()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  insert into public.ambassadors (user_id, accepted_terms_at)
  values (v_uid, now())
  on conflict (user_id) do update set status = 'ativo';
  insert into public.amb_audit_log (actor, action, detail)
  values (v_uid, 'amb_join', jsonb_build_object('user', v_uid));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.amb_join_program to authenticated;

-- Saldo disponível (comissões disponíveis − saques retidos/pagos − ajustes)
create or replace function public.amb_available_balance(p_uid uuid)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount) from public.amb_commissions
    where beneficiary = p_uid and status = 'disponivel'), 0)
  + coalesce((select sum(amount) from public.amb_wallet_tx where user_id = p_uid), 0)
  - coalesce((select sum(amount) from public.amb_withdrawals
    where user_id = p_uid and status in ('solicitado','em_analise','aprovado','pago')), 0);
$$;

-- Painel completo do embaixador
create or replace function public.amb_me()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cfg record;
  v_amb record;
  v_direct int;
  v_paying int;
  v_active_clients int;
  v_lbl text;
  v_next record;
  v_tree jsonb;
  v_lvl_nodes jsonb;
  v_lvl int;
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  select * into v_cfg from public.app_settings where id = 1;
  select * into v_amb from public.ambassadors where user_id = v_uid;

  v_direct := (select count(*) from public.profiles where referred_by = v_uid);
  v_paying := (select count(distinct source_user) from public.amb_commissions where beneficiary = v_uid and level = 1);
  v_active_clients := (select count(distinct ac.source_user)
    from public.amb_commissions ac
    join public.companies c on c.owner_id = ac.source_user
    join public.subscriptions s on s.company_id = c.id and s.status = 'ativo'
    where ac.beneficiary = v_uid and ac.level = 1);

  -- nível de gamificação
  v_lbl := 'Novo Embaixador';
  select j->>'label' into v_lbl
    from jsonb_array_elements(coalesce(v_cfg.amb_levels, '[{"min":0,"label":"Novo Embaixador"}]'::jsonb)) j
    where (j->>'min')::int <= v_paying
    order by (j->>'min')::int desc limit 1;
  select * into v_next from (
    select j->>'label' as label, (j->>'min')::int as min
    from jsonb_array_elements(coalesce(v_cfg.amb_levels, '[{"min":0,"label":"Novo Embaixador"}]'::jsonb)) j
    where (j->>'min')::int > v_paying
    order by (j->>'min')::int asc limit 1
  ) n;

  -- árvore de indicação (3 níveis, dados mínimos)
  v_tree := '[]'::jsonb;
  for v_lvl in 1..3 loop
    if v_lvl = 1 then
      select coalesce(json_agg(json_build_object('id', q.id, 'name', q.name, 'paying', exists (
        select 1 from public.amb_commissions ac
        where ac.beneficiary = v_uid and ac.level = 1 and ac.source_user = q.id))), '[]'::jsonb)
      into v_lvl_nodes
      from public.profiles q
      where q.referred_by = v_uid;
    elsif v_lvl = 2 then
      select coalesce(json_agg(json_build_object('id', q.id, 'name', q.name, 'paying', exists (
        select 1 from public.amb_commissions ac
        where ac.beneficiary = v_uid and ac.level = 2 and ac.source_user = q.id))), '[]'::jsonb)
      into v_lvl_nodes
      from public.profiles q
      where q.referred_by in (select id from public.profiles where referred_by = v_uid);
    else
      select coalesce(json_agg(json_build_object('id', q.id, 'name', q.name, 'paying', false)), '[]'::jsonb)
      into v_lvl_nodes
      from public.profiles q
      where q.referred_by in (
        select id from public.profiles
        where referred_by in (select id from public.profiles where referred_by = v_uid));
    end if;
    v_tree := v_tree || jsonb_build_array(json_build_object('level', v_lvl, 'nodes', v_lvl_nodes));
  end loop;

  return jsonb_build_object(
    'is_ambassador', v_amb is not null,
    'status', v_amb.status,
    'flag', v_amb.flag,
    'config', jsonb_build_object(
      'enabled', v_cfg.amb_enabled,
      'company_pct', v_cfg.amb_company_pct,
      'level_pcts', v_cfg.amb_level_pcts,
      'safety_days', v_cfg.amb_safety_days,
      'min_withdrawal', v_cfg.amb_min_withdrawal),
    'stats', jsonb_build_object(
      'direct_referrals', v_direct,
      'paying_clients', v_paying,
      'active_clients', v_active_clients),
    'level', jsonb_build_object('label', v_lbl, 'next', v_next),
    'wallet', jsonb_build_object(
      'pendente', coalesce((select sum(amount) from public.amb_commissions where beneficiary = v_uid and status = 'pendente'), 0),
      'disponivel', public.amb_available_balance(v_uid),
      'pago_total', coalesce((select -sum(amount) from public.amb_wallet_tx where user_id = v_uid and kind = 'saque'), 0),
      'estornado_total', coalesce((select sum(amount) from public.amb_commissions where beneficiary = v_uid and status = 'estornada'), 0)),
    'commissions', coalesce((
      select json_agg(json_build_object('id', c.id, 'amount', c.amount, 'level', c.level, 'status', c.status,
        'created_at', c.created_at, 'available_at', c.available_at) order by c.created_at desc)
      from (select * from public.amb_commissions where beneficiary = v_uid order by created_at desc limit 50) c), '[]'::jsonb),
    'wallet_tx', coalesce((
      select json_agg(json_build_object('id', t.id, 'kind', t.kind, 'amount', t.amount, 'detail', t.detail, 'created_at', t.created_at) order by t.created_at desc)
      from (select * from public.amb_wallet_tx where user_id = v_uid order by created_at desc limit 50) t), '[]'::jsonb),
    'withdrawals', coalesce((
      select json_agg(json_build_object('id', w.id, 'amount', w.amount, 'status', w.status, 'note', w.note, 'created_at', w.created_at, 'decided_at', w.decided_at) order by w.created_at desc)
      from (select * from public.amb_withdrawals where user_id = v_uid order by created_at desc limit 30) w), '[]'::jsonb),
    'tree', v_tree,
    'rewards', coalesce((
      select json_agg(json_build_object('id', r.id, 'min', r.min_paying_clients, 'label', r.label, 'achieved',
        exists(select 1 from public.amb_reward_claims rc where rc.user_id = v_uid and rc.reward_id = r.id)) order by r.min_paying_clients)
      from public.amb_rewards r where r.active), '[]'::jsonb)
  );
end $$;
grant execute on function public.amb_me to authenticated;

-- Solicitar saque
create or replace function public.amb_withdraw(p_amount numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cfg record;
  v_avail numeric;
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  if not exists (select 1 from public.ambassadors where user_id = v_uid and status = 'ativo') then
    raise exception 'Somente embaixadores podem solicitar saque';
  end if;
  select * into v_cfg from public.app_settings where id = 1;
  if p_amount is null or p_amount <= 0 then raise exception 'Valor inválido'; end if;
  if p_amount < v_cfg.amb_min_withdrawal then
    raise exception 'Valor mínimo para saque: R$ %', v_cfg.amb_min_withdrawal;
  end if;
  v_avail := public.amb_available_balance(v_uid);
  if p_amount > v_avail then raise exception 'Saldo disponível insuficiente'; end if;

  insert into public.amb_withdrawals (user_id, amount) values (v_uid, p_amount);
  insert into public.amb_audit_log (actor, action, detail)
  values (v_uid, 'withdraw_request', jsonb_build_object('user', v_uid, 'amount', p_amount));
  insert into public.notifications (user_id, type, title, body)
  values (v_uid, 'embaixador', 'Saque solicitado',
    'Seu saque de R$ ' || p_amount::text || ' foi solicitado e está em análise.');
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.amb_withdraw to authenticated;

-- Liberação das comissões que saíram do prazo de segurança (cron do servidor)
create or replace function public.amb_release_due(p_secret text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_out int;
  v_c record;
begin
  if p_secret is null or p_secret <> (select rpc_secret from public.payment_settings where id = 1) then
    raise exception 'forbidden';
  end if;
  for v_c in
    update public.amb_commissions
      set status = 'disponivel'
      where status = 'pendente' and available_at <= now()
      returning *
  loop
    insert into public.notifications (user_id, type, title, body, dedupe_key)
    values (v_c.beneficiary, 'embaixador', 'Seu saldo está disponível para saque 💸',
      'Sua comissão de R$ ' || v_c.amount::text || ' saiu do período de segurança e já pode ser sacada.',
      'amb-avail-' || v_c.id::text)
    on conflict do nothing;
    v_out := coalesce(v_out, 0) + 1;
  end loop;
  return coalesce(v_out, 0);
end $$;

-- ============================================================
-- FUNÇÕES DO PAINEL MASTER
-- ============================================================

-- Dashboard master
create or replace function public.amb_admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  return jsonb_build_object(
    'ambassadors', (select count(*) from public.ambassadors),
    'new_ambassadors_30d', (select count(*) from public.ambassadors where created_at > now() - interval '30 days'),
    'referred_companies', (select count(*) from public.companies c join public.profiles p on p.id = c.owner_id where p.referred_by is not null),
    'indicated_revenue', coalesce((select sum(pay.amount) from public.payments pay
      join public.companies c on c.id = pay.company_id
      join public.profiles po on po.id = c.owner_id
      where pay.status = 'aprovado' and po.referred_by is not null), 0),
    'commissions_total', coalesce((select sum(amount) from public.amb_commissions), 0),
    'commissions_pending', coalesce((select sum(amount) from public.amb_commissions where status = 'pendente'), 0),
    'commissions_available', coalesce((select sum(amount) from public.amb_commissions where status = 'disponivel'), 0),
    'commissions_paid', coalesce((select -sum(amount) from public.amb_wallet_tx where kind = 'saque'), 0),
    'referrals_total', (select count(*) from public.referrals),
    'top', coalesce((
      select json_agg(json_build_object('name', pr.name, 'paying', t.paying, 'earned', t.earned) order by t.earned desc)
      from (
        select beneficiary, count(distinct source_user) as paying, sum(amount) as earned
        from public.amb_commissions where level = 1 group by beneficiary
        order by sum(amount) desc limit 5
      ) t join public.profiles pr on pr.id = t.beneficiary), '[]'::jsonb)
  );
end $$;
grant execute on function public.amb_admin_overview to authenticated;

-- Configuração (leitura)
create or replace function public.amb_admin_config()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v record;
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  select * into v from public.app_settings where id = 1;
  return jsonb_build_object(
    'enabled', v.amb_enabled, 'company_pct', v.amb_company_pct,
    'level_pcts', v.amb_level_pcts, 'safety_days', v.amb_safety_days,
    'min_withdrawal', v.amb_min_withdrawal, 'amb_levels', v.amb_levels,
    'rewards', coalesce((select json_agg(row_to_json(r)) from (select id, min_paying_clients, label, active from public.amb_rewards order by min_paying_clients) r), '[]'::json));
end $$;
grant execute on function public.amb_admin_config to authenticated;

-- Configuração (gravação) — sempre com auditoria
create or replace function public.amb_admin_save_config(
  p_enabled boolean, p_company_pct numeric, p_level_pcts jsonb,
  p_safety_days int, p_min_withdrawal numeric, p_amb_levels jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  if p_company_pct + coalesce((select sum((x)::numeric) from jsonb_array_elements_text(p_level_pcts) x), 0) <> 100 then
    raise exception 'A soma dos percentuais (empresa + níveis) deve ser 100';
  end if;
  update public.app_settings set
    amb_enabled = p_enabled,
    amb_company_pct = p_company_pct,
    amb_level_pcts = p_level_pcts,
    amb_safety_days = greatest(coalesce(p_safety_days, 0), 0),
    amb_min_withdrawal = greatest(coalesce(p_min_withdrawal, 0), 0),
    amb_levels = p_amb_levels,
    updated_at = now()
  where id = 1;
  insert into public.amb_audit_log (actor, action, detail)
  values (auth.uid(), 'amb_config_save', jsonb_build_object(
    'enabled', p_enabled, 'company_pct', p_company_pct, 'level_pcts', p_level_pcts,
    'safety_days', p_safety_days, 'min_withdrawal', p_min_withdrawal));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.amb_admin_save_config to authenticated;

-- Salvar metas/recompensas
create or replace function public.amb_admin_save_rewards(p_rewards jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  delete from public.amb_rewards where not exists (
    select 1 from jsonb_array_elements(p_rewards) j where (j->>'id')::uuid = amb_rewards.id);
  insert into public.amb_rewards (id, min_paying_clients, label, active)
  select (j->>'id')::uuid, (j->>'min')::int, j->>'label', coalesce((j->>'active')::boolean, true)
  from jsonb_array_elements(p_rewards) j
  where j->>'id' is not null and j->>'label' is not null
  on conflict (id) do update set min_paying_clients = excluded.min_paying_clients,
    label = excluded.label, active = excluded.active;
  insert into public.amb_audit_log (actor, action, detail)
  values (auth.uid(), 'amb_rewards_save', jsonb_build_object('count', jsonb_array_length(p_rewards)));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.amb_admin_save_rewards to authenticated;

-- Lista de embaixadores com métricas
create or replace function public.amb_admin_ambassadors()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'user_id', a.user_id, 'name', p.name, 'email', au.email, 'status', a.status,
      'flag', a.flag, 'created_at', a.created_at,
      'direct', (select count(*) from public.profiles pp where pp.referred_by = a.user_id),
      'paying', (select count(distinct c.source_user) from public.amb_commissions c where c.beneficiary = a.user_id and c.level = 1),
      'earned', coalesce((select sum(c.amount) from public.amb_commissions c where c.beneficiary = a.user_id), 0),
      'available', public.amb_available_balance(a.user_id),
      'chargebacks', (select count(*) from public.payments pay
        join public.companies c2 on c2.id = pay.company_id
        where c2.owner_id in (select id from public.profiles where referred_by = a.user_id)
        and pay.status = 'reembolsado')
    ) order by a.created_at desc)
    from public.ambassadors a
    join public.profiles p on p.id = a.user_id
    left join auth.users au on au.id = a.user_id
  ), '[]'::jsonb);
end $$;
grant execute on function public.amb_admin_ambassadors to authenticated;

-- Status/flag do embaixador (master)
create or replace function public.amb_admin_set_flag(p_user uuid, p_status text, p_flag text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  update public.ambassadors set status = coalesce(p_status, status), flag = coalesce(p_flag, flag)
  where user_id = p_user;
  insert into public.amb_audit_log (actor, action, detail)
  values (auth.uid(), 'amb_set_flag', jsonb_build_object('user', p_user, 'status', p_status, 'flag', p_flag));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.amb_admin_set_flag to authenticated;

-- Saques (lista master)
create or replace function public.amb_admin_withdrawals()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', w.id, 'user_id', w.user_id, 'name', p.name, 'email', au.email,
      'amount', w.amount, 'status', w.status, 'note', w.note,
      'created_at', w.created_at, 'decided_at', w.decided_at) order by w.created_at desc)
    from public.amb_withdrawals w
    join public.profiles p on p.id = w.user_id
    left join auth.users au on au.id = w.user_id
  ), '[]'::jsonb);
end $$;
grant execute on function public.amb_admin_withdrawals to authenticated;

-- Decisão de saque (master) — 'pago' gera movimentação na carteira
create or replace function public.amb_admin_decide_withdrawal(p_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_w record;
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  select * into v_w from public.amb_withdrawals where id = p_id for update;
  if v_w.id is null then raise exception 'saque não encontrado'; end if;
  if p_decision not in ('em_analise','aprovado','pago','recusado') then raise exception 'decisão inválida'; end if;
  if v_w.status = 'pago' then raise exception 'saque já pago'; end if;

  update public.amb_withdrawals set status = p_decision, note = coalesce(p_note, note), decided_at = now()
  where id = p_id;

  if p_decision = 'pago' then
    insert into public.amb_wallet_tx (user_id, kind, amount, withdrawal_id, detail)
    values (v_w.user_id, 'saque', -v_w.amount, p_id, 'Saque pago');
  end if;

  insert into public.notifications (user_id, type, title, body)
  values (v_w.user_id, 'embaixador',
    case p_decision
      when 'pago' then 'Saque realizado ✅'
      when 'recusado' then 'Saque recusado'
      when 'aprovado' then 'Saque aprovado ✅'
      else 'Saque em análise' end,
    case p_decision
      when 'recusado' then coalesce(p_note, 'Seu saque de R$ ' || v_w.amount::text || ' foi recusado. Entre em contato com o suporte.')
      else 'Seu saque de R$ ' || v_w.amount::text || ' teve o status atualizado para: ' || replace(p_decision, '_', ' ') || '.' end);

  insert into public.amb_audit_log (actor, action, detail)
  values (auth.uid(), 'withdraw_decide', jsonb_build_object('withdrawal', p_id, 'decision', p_decision, 'note', p_note));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.amb_admin_decide_withdrawal to authenticated;

-- Comissões (lista master)
create or replace function public.amb_admin_commissions()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', c.id, 'amount', c.amount, 'level', c.level, 'status', c.status,
      'created_at', c.created_at, 'available_at', c.available_at, 'mp_payment_id', c.mp_payment_id,
      'beneficiary', pb.name, 'source', ps.name) order by c.created_at desc)
    from (select * from public.amb_commissions order by created_at desc limit 200) c
    join public.profiles pb on pb.id = c.beneficiary
    join public.profiles ps on ps.id = c.source_user
  ), '[]'::jsonb);
end $$;
grant execute on function public.amb_admin_commissions to authenticated;

-- Auditoria (lista master)
create or replace function public.amb_admin_audit()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  return coalesce((
    select json_agg(json_build_object('id', l.id, 'action', l.action, 'detail', l.detail,
      'created_at', l.created_at) order by l.created_at desc)
    from (select * from public.amb_audit_log order by created_at desc limit 200) l
  ), '[]'::jsonb);
end $$;
grant execute on function public.amb_admin_audit to authenticated;
