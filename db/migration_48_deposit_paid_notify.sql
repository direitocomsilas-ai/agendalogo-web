-- ============================================================
-- Migration 48: agendamento só após pagamento do sinal (PIX direto)
-- O cliente só consegue concluir o agendamento após informar que
-- pagou o PIX. O profissional recebe o aviso para conferir o
-- recebimento e confirmar o horário.
-- ============================================================

create or replace function public.deposit_paid_notify(
  p_slug text, p_name text default '', p_amount numeric default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_co record;
begin
  select * into v_co from public.companies where slug = p_slug and public_enabled;
  if not found then return; end if;
  insert into public.notifications (company_id, user_id, type, title, body)
  values (
    v_co.id, v_co.owner_id, 'sinal',
    '🟡 Cliente informou pagamento do sinal',
    'Cliente ' || coalesce(nullif(trim(p_name), ''), '') || ' informou que pagou o sinal de R$ ' ||
      coalesce(p_amount, 0)::text || ' via PIX. Confira o recebimento na sua conta e confirme o horário na agenda.'
  );
end $$;
grant execute on function public.deposit_paid_notify to anon, authenticated;
