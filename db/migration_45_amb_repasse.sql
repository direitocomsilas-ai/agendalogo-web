-- ============================================================
-- Migration 45: Repasse direto no programa de embaixadores
-- Cada embaixador vê apenas:
--   1) QUEM está acima dele (padrinho) — quem faz o repasse para ele;
--   2) Seus indicados DIRETOS (1º nível) — para quem ele repassa.
-- A árvore multi-nível sai do painel do embaixador.
-- ============================================================

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
  v_sponsor record;
  v_lvl1 jsonb;
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

  -- Padrinho: o profissional diretamente acima (repassa as comissões para mim)
  select s.id, s.name, s.whatsapp into v_sponsor
    from public.profiles p
    join public.profiles s on s.id = p.referred_by
    where p.id = v_uid
    limit 1;

  -- Indicados diretos (1º nível): para quem EU repasso
  select coalesce(json_agg(json_build_object(
    'id', q.id, 'name', q.name, 'whatsapp', q.whatsapp, 'paying', exists (
      select 1 from public.amb_commissions ac
      where ac.beneficiary = v_uid and ac.level = 1 and ac.source_user = q.id))), '[]'::jsonb)
  into v_lvl1
  from public.profiles q
  where q.referred_by = v_uid;

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
    'sponsor', case when v_sponsor.id is null then null
      else jsonb_build_object('id', v_sponsor.id, 'name', v_sponsor.name, 'whatsapp', v_sponsor.whatsapp) end,
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
    'tree', jsonb_build_array(jsonb_build_object('level', 1, 'nodes', v_lvl1)),
    'rewards', coalesce((
      select json_agg(json_build_object('id', r.id, 'min', r.min_paying_clients, 'label', r.label, 'achieved',
        exists(select 1 from public.amb_reward_claims rc where rc.user_id = v_uid and rc.reward_id = r.id)) order by r.min_paying_clients)
      from public.amb_rewards r where r.active), '[]'::jsonb)
  );
end $$;
grant execute on function public.amb_me to authenticated;
