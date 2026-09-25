-- ============================================================
-- Migration 41: Comissões de embaixadores até o 10º nível
-- - level aceita 1..10
-- - Trigger percorre a cadeia referred_by até 10 níveis
-- - Novos percentuais padrão: 20/15/10/5/5/5/5/5/5/5 (empresa 20)
-- - amb_me: árvore dinâmica até 10 níveis
-- - amb_admin_save_config: valida soma com até 10 níveis
-- ============================================================

alter table public.amb_commissions drop constraint if exists amb_commissions_level_check;
alter table public.amb_commissions add constraint amb_commissions_level_check check (level between 1 and 10);

update public.app_settings set
  amb_company_pct = 20,
  amb_level_pcts = '[20,15,10,5,5,5,5,5,5,5]'::jsonb
where id = 1 and jsonb_array_length(amb_level_pcts) < 10;

-- ---------- Motor (10 níveis) ----------
create or replace function public.amb_on_payment_change()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_uid uuid;
  v_lvl int;
  v_pcts jsonb;
  v_n_levels int;
  v_pct numeric;
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
    v_pcts := coalesce(v_cfg.amb_level_pcts, '[20,15,10,5,5,5,5,5,5,5]'::jsonb);
    v_n_levels := jsonb_array_length(v_pcts);

    select count(*) into v_paid_count
      from public.payments where company_id = NEW.company_id and status = 'aprovado';

    v_uid := v_owner;
    for v_lvl in 1..least(v_n_levels, 10) loop
      select p.referred_by into v_uid from public.profiles p where p.id = v_uid;
      exit when v_uid is null;
      exit when v_uid = v_owner; -- proteção contra autoindicação / ciclos

      if exists (
        select 1 from public.ambassadors a
        where a.user_id = v_uid and a.status = 'ativo' and a.flag <> 'bloqueado'
      ) then
        v_pct := coalesce((v_pcts ->> (v_lvl - 1))::numeric, 0);
        v_amt := round(NEW.amount * v_pct / 100.0, 2);
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
                then 'Seu indicado assinou um plano. Comissão de nível ' || v_lvl::text || ' (R$ ' || v_amt::text || ') registrada — fica pendente por ' || v_cfg.amb_safety_days::text || ' dias (período de segurança).'
                else 'Seu indicado renovou o plano. Comissão de nível ' || v_lvl::text || ' (R$ ' || v_amt::text || ') registrada.' end);

            -- ---- Metas / recompensas (por embaixador beneficiário do 1º nível) ----
            if v_lvl = 1 then
              insert into public.amb_reward_claims (user_id, reward_id)
              select v_uid, r.id from public.amb_rewards r
              where r.active
                and r.min_paying_clients <= (
                  select count(distinct ac.source_user) from public.amb_commissions ac
                  where ac.beneficiary = v_uid and ac.level = 1)
                and not exists (select 1 from public.amb_reward_claims c where c.user_id = v_uid and c.reward_id = r.id)
              on conflict do nothing;
              if found then
                insert into public.notifications (user_id, type, title, body)
                values (v_uid, 'embaixador', '🏆 Você atingiu uma nova meta!',
                  'Você alcançou uma meta do programa de embaixadores. Confira seus benefícios na Central do Embaixador.');
              end if;
            end if;
          end if;
        end if;
      end if;
    end loop;
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

-- ---------- amb_me: árvore dinâmica até 10 níveis ----------
create or replace function public.amb_me()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_root uuid;
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
  v_parents uuid[];
  v_children uuid[];
  v_child uuid;
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

  -- árvore: percorre dinamicamente até 10 níveis
  v_root := v_uid;
  v_tree := '[]'::jsonb;
  v_parents := array[v_root];
  for v_lvl in 1..10 loop
    exit when array_length(v_parents, 1) is null;
    select coalesce(array_agg(q.id), '{}') into v_children
      from public.profiles q where q.referred_by = any(v_parents);
    v_lvl_nodes := '[]'::jsonb;
    if array_length(v_children, 1) is not null then
      select coalesce(jsonb_agg(json_build_object('id', q.id, 'name', q.name, 'paying', exists (
        select 1 from public.amb_commissions ac
        where ac.beneficiary = v_root and ac.level = v_lvl and ac.source_user = q.id))), '[]'::jsonb)
      into v_lvl_nodes
      from public.profiles q
      where q.id = any(v_children);
    end if;
    v_tree := v_tree || jsonb_build_array(json_build_object('level', v_lvl, 'nodes', v_lvl_nodes));
    v_parents := v_children;
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
      select jsonb_agg(json_build_object('id', c.id, 'amount', c.amount, 'level', c.level, 'status', c.status,
        'created_at', c.created_at, 'available_at', c.available_at) order by c.created_at desc)
      from (select * from public.amb_commissions where beneficiary = v_uid order by created_at desc limit 50) c), '[]'::jsonb),
    'wallet_tx', coalesce((
      select jsonb_agg(json_build_object('id', t.id, 'kind', t.kind, 'amount', t.amount, 'detail', t.detail, 'created_at', t.created_at) order by t.created_at desc)
      from (select * from public.amb_wallet_tx where user_id = v_uid order by created_at desc limit 50) t), '[]'::jsonb),
    'withdrawals', coalesce((
      select jsonb_agg(json_build_object('id', w.id, 'amount', w.amount, 'status', w.status, 'note', w.note, 'created_at', w.created_at, 'decided_at', w.decided_at) order by w.created_at desc)
      from (select * from public.amb_withdrawals where user_id = v_uid order by created_at desc limit 30) w), '[]'::jsonb),
    'tree', v_tree,
    'rewards', coalesce((
      select jsonb_agg(json_build_object('id', r.id, 'min', r.min_paying_clients, 'label', r.label, 'achieved',
        exists(select 1 from public.amb_reward_claims rc where rc.user_id = v_uid and rc.reward_id = r.id)) order by r.min_paying_clients)
      from public.amb_rewards r where r.active), '[]'::jsonb)
  );
end $$;
grant execute on function public.amb_me to authenticated;

-- ---------- Config: valida soma com até 10 níveis ----------
create or replace function public.amb_admin_save_config(
  p_enabled boolean, p_company_pct numeric, p_level_pcts jsonb,
  p_safety_days int, p_min_withdrawal numeric, p_amb_levels jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  if jsonb_array_length(p_level_pcts) > 10 then
    raise exception 'Máximo de 10 níveis';
  end if;
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
