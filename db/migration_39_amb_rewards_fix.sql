-- ============================================================
-- Migration 39: Correção do gatilho de embaixadores
-- - Metas/recompensas agora são verificadas para CADA embaixador
--   beneficiário da comissão (antes eram atribuídas ao pagador).
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

            -- ---- Metas / recompensas (por embaixador beneficiário) ----
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
