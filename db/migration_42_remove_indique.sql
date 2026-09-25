-- ============================================================
-- Migration 42: Desativação do programa "Indique e ganhe"
-- - confirm_payment não paga mais comissão fixa de indicação
--   (mantém a marcação de 'convertido' para histórico)
-- - referral_value = 0 por segurança
-- - O programa vigente passa a ser o de Embaixadores (10 níveis),
--   que usa o mesmo vínculo profiles.referred_by
-- ============================================================

update public.app_settings set referral_value = 0 where id = 1;

create or replace function public.confirm_payment(p_ref text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pay record;
  v_period timestamptz;
  v_owner uuid;
  v_ref record;
begin
  select * into v_pay from public.payments where gateway_ref = p_ref for update;
  if not found then raise exception 'Pagamento não encontrado'; end if;
  if v_pay.status = 'aprovado' then return; end if;

  -- Quem confirma precisa ser membro da empresa ou master
  if not public.is_master() and v_pay.company_id not in (select public.my_company_ids()) then
    raise exception 'Sem permissão';
  end if;

  update public.payments set status = 'aprovado', paid_at = now() where id = v_pay.id;

  select current_period_end into v_period from public.subscriptions where company_id = v_pay.company_id;
  v_period := greatest(coalesce(v_period, now()), now()) + interval '1 month';

  update public.subscriptions
    set status = 'ativo', current_period_end = v_period, next_billing_at = v_period, amount = v_pay.amount
    where company_id = v_pay.company_id;

  -- Histórico: marca indicação como convertida (sem pagamento —
  -- as comissões agora são do programa de Embaixadores, via trigger amb_on_payment_change)
  select owner_id into v_owner from public.companies where id = v_pay.company_id;
  update public.referrals set status = 'convertido', converted_at = now()
    where id = (select id from public.referrals where invited_id = v_owner and status = 'pendente' limit 1);

  insert into public.notifications (company_id, type, title, body)
  values (v_pay.company_id, 'pagamento', 'Pagamento aprovado',
    'Seu pagamento de R$ ' || v_pay.amount::text || ' foi aprovado e o acesso está ativo.');
end $$;
grant execute on function public.confirm_payment to authenticated;
