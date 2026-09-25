-- ============================================================
-- Migration 40: fix de tipos json/jsonb nas funções de embaixadores
-- json_agg (retorna json) misturado com fallback '[]'::jsonb dentro de
-- COALESCE quebrava as chamadas. Substituído por jsonb_agg.
-- ============================================================

-- ---------- Painel completo do embaixador ----------
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

  v_tree := '[]'::jsonb;
  for v_lvl in 1..3 loop
    if v_lvl = 1 then
      select coalesce(jsonb_agg(json_build_object('id', q.id, 'name', q.name, 'paying', exists (
        select 1 from public.amb_commissions ac
        where ac.beneficiary = v_uid and ac.level = 1 and ac.source_user = q.id))), '[]'::jsonb)
      into v_lvl_nodes
      from public.profiles q
      where q.referred_by = v_uid;
    elsif v_lvl = 2 then
      select coalesce(jsonb_agg(json_build_object('id', q.id, 'name', q.name, 'paying', exists (
        select 1 from public.amb_commissions ac
        where ac.beneficiary = v_uid and ac.level = 2 and ac.source_user = q.id))), '[]'::jsonb)
      into v_lvl_nodes
      from public.profiles q
      where q.referred_by in (select id from public.profiles where referred_by = v_uid);
    else
      select coalesce(jsonb_agg(json_build_object('id', q.id, 'name', q.name, 'paying', false)), '[]'::jsonb)
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

-- ---------- Dashboard master ----------
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
      select jsonb_agg(json_build_object('name', pr.name, 'paying', t.paying, 'earned', t.earned) order by t.earned desc)
      from (
        select beneficiary, count(distinct source_user) as paying, sum(amount) as earned
        from public.amb_commissions where level = 1 group by beneficiary
        order by sum(amount) desc limit 5
      ) t join public.profiles pr on pr.id = t.beneficiary), '[]'::jsonb)
  );
end $$;
grant execute on function public.amb_admin_overview to authenticated;

-- ---------- Lista de embaixadores ----------
create or replace function public.amb_admin_ambassadors()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  return coalesce((
    select jsonb_agg(json_build_object(
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

-- ---------- Saques ----------
create or replace function public.amb_admin_withdrawals()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  return coalesce((
    select jsonb_agg(json_build_object(
      'id', w.id, 'user_id', w.user_id, 'name', p.name, 'email', au.email,
      'amount', w.amount, 'status', w.status, 'note', w.note,
      'created_at', w.created_at, 'decided_at', w.decided_at) order by w.created_at desc)
    from public.amb_withdrawals w
    join public.profiles p on p.id = w.user_id
    left join auth.users au on au.id = w.user_id
  ), '[]'::jsonb);
end $$;
grant execute on function public.amb_admin_withdrawals to authenticated;

-- ---------- Comissões ----------
create or replace function public.amb_admin_commissions()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  return coalesce((
    select jsonb_agg(json_build_object(
      'id', c.id, 'amount', c.amount, 'level', c.level, 'status', c.status,
      'created_at', c.created_at, 'available_at', c.available_at, 'mp_payment_id', c.mp_payment_id,
      'beneficiary', pb.name, 'source', ps.name) order by c.created_at desc)
    from (select * from public.amb_commissions order by created_at desc limit 200) c
    join public.profiles pb on pb.id = c.beneficiary
    join public.profiles ps on ps.id = c.source_user
  ), '[]'::jsonb);
end $$;
grant execute on function public.amb_admin_commissions to authenticated;

-- ---------- Auditoria ----------
create or replace function public.amb_admin_audit()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  return coalesce((
    select jsonb_agg(json_build_object('id', l.id, 'action', l.action, 'detail', l.detail,
      'created_at', l.created_at) order by l.created_at desc)
    from (select * from public.amb_audit_log order by created_at desc limit 200) l
  ), '[]'::jsonb);
end $$;
grant execute on function public.amb_admin_audit to authenticated;
