-- ============================================================
-- Migration 51: saques no painel master mostram a chave PIX
-- ============================================================

create or replace function public.amb_admin_withdrawals()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_master() then raise exception 'somente master'; end if;
  return coalesce((
    select jsonb_agg(json_build_object(
      'id', w.id, 'user_id', w.user_id, 'name', p.name, 'email', au.email,
      'amount', w.amount, 'status', w.status, 'note', w.note,
      'pix_key', w.pix_key, 'pix_key_type', w.pix_key_type, 'pix_holder', w.pix_holder,
      'created_at', w.created_at, 'decided_at', w.decided_at) order by w.created_at desc)
    from public.amb_withdrawals w
    join public.profiles p on p.id = w.user_id
    left join auth.users au on au.id = w.user_id
  ), '[]'::jsonb);
end $$;
grant execute on function public.amb_admin_withdrawals to authenticated;
