-- ============================================================
-- Agendez — Funções RPC
-- ============================================================

-- ---------- Template de mensagem ----------
create or replace function public.render_template(p_body text, p_client text, p_date text, p_time text, p_business text, p_service text, p_prof text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(replace(replace(replace(p_body,
    '{cliente}', coalesce(p_client,'')),
    '{data}', coalesce(p_date,'')),
    '{horario}', coalesce(p_time,'')),
    '{negocio}', coalesce(p_business,'')),
    '{servico}', coalesce(p_service,'')),
    '{profissional}', coalesce(p_prof,'')),
    '{horário}', coalesce(p_time,''));
$$;

-- ---------- CRIAÇÃO DE EMPRESA + DADOS DEMO ----------
create or replace function public.create_company(
  p_name text, p_category text, p_whatsapp text default '', p_description text default '', p_slug text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cid uuid;
  v_slug text;
  v_trial_days int;
  v_free_plan uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid;
  v_sv record;
  v_p1 uuid; v_p2 uuid;
  v_base timestamptz;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if exists (select 1 from public.companies where owner_id = v_uid) then
    raise exception 'Você já possui uma empresa cadastrada';
  end if;

  v_slug := coalesce(p_slug, lower(regexp_replace(unaccent(p_name), '[^a-zA-Z0-9]+', '-', 'g')));
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'empresa-' || substr(md5(random()::text),1,6); end if;
  while exists (select 1 from public.companies where slug = v_slug) loop
    v_slug := v_slug || '-' || substr(md5(random()::text),1,4);
  end loop;

  insert into public.companies (owner_id, name, slug, category, description, whatsapp)
  values (v_uid, p_name, v_slug, p_category, p_description, p_whatsapp)
  returning id into v_cid;

  insert into public.company_members (company_id, user_id, role) values (v_cid, v_uid, 'owner');
  insert into public.company_settings (company_id) values (v_cid);

  -- Expediente padrão: seg-sexta 09:00-18:00, sábado 09:00-14:00, domingo fechado
  insert into public.business_hours (company_id, weekday, is_open, start_time, end_time)
  select v_cid, d, d between 1 and 5 or d = 6, case when d = 6 then '09:00' else '09:00' end, case when d = 6 then '14:00' else '18:00' end
  from generate_series(0,6) d;

  -- Templates de WhatsApp
  insert into public.whatsapp_templates (company_id, type, body) values
    (v_cid, 'confirmacao', 'Olá, {cliente}! Seu atendimento em {negocio} está confirmado para {data} às {horario}. Até logo!'),
    (v_cid, 'lembrete', 'Olá, {cliente}! Passando para lembrar do seu atendimento em {negocio} em {data} às {horario}.'),
    (v_cid, 'cancelamento', 'Olá, {cliente}! Seu agendamento em {negocio} de {data} às {horario} foi cancelado.'),
    (v_cid, 'reagendamento', 'Olá, {cliente}! Seu atendimento em {negocio} foi reagendado para {data} às {horario}.'),
    (v_cid, 'concluido', 'Olá, {cliente}! Obrigado pela visita ao {negocio}. Esperamos vê-lo novamente!');

  -- Assinatura trial
  select trial_days into v_trial_days from public.app_settings where id = 1;
  select id into v_free_plan from public.plans where price = 0 order by sort limit 1;
  insert into public.subscriptions (company_id, plan_id, status, trial_ends_at, current_period_end, amount)
  values (v_cid, v_free_plan, 'trial', now() + make_interval(days => v_trial_days), now() + make_interval(days => v_trial_days), 0);

  -- Profissionais demo
  insert into public.professionals (company_id, name, specialty, commission, phone)
  values (v_cid, split_part(p_name, ' ', 1) || ' (você)', 'Especialista', 0, p_whatsapp)
  returning id into v_p1;
  insert into public.professionals (company_id, name, specialty, commission, phone)
  values (v_cid, 'Ana Souza', 'Designer', 40, '(11) 98888-7777')
  returning id into v_p2;

  -- Seções e serviços demo
  insert into public.service_sections (company_id, name, position) values (v_cid, 'Principal', 1) returning id into v_s1;
  insert into public.service_sections (company_id, name, position) values (v_cid, 'Extras', 2) returning id into v_s2;

  insert into public.services (company_id, section_id, name, description, price, duration_min, position)
  values (v_cid, v_s1, 'Consulta inicial', 'Primeira avaliação personalizada', 80, 60, 1);
  insert into public.services (company_id, section_id, name, description, price, duration_min, position)
  values (v_cid, v_s1, 'Serviço completo', 'Atendimento completo com os melhores produtos', 150, 90, 2);
  insert into public.services (company_id, section_id, name, description, price, duration_min, position)
  values (v_cid, v_s2, 'Retoque', 'Manutenção rápida', 60, 40, 3);

  insert into public.service_professionals (service_id, professional_id)
  select s.id, p.id from public.services s, public.professionals p
  where s.company_id = v_cid and p.company_id = v_cid;

  -- Clientes demo
  insert into public.clients (company_id, name, whatsapp, email) values
    (v_cid, 'Maria Oliveira', '(11) 97777-1111', 'maria@email.com'),
    (v_cid, 'Juliana Costa', '(11) 97777-2222', 'juliana@email.com'),
    (v_cid, 'Fernanda Lima', '(11) 97777-3333', 'fernanda@email.com'),
    (v_cid, 'Patrícia Alves', '(11) 97777-4444', 'patricia@email.com');

  -- Agendamentos demo (hoje e próximos dias)
  v_base := date_trunc('day', now());
  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source) 
  select v_cid, c.id, pr.id, s.id,
    v_base + interval '9 hours', v_base + interval '10 hours', 'concluido', s.price, 'painel'
  from public.clients c, public.professionals pr, public.services s
  where c.company_id = v_cid and pr.company_id = v_cid and s.company_id = v_cid
    and c.name = 'Maria Oliveira' and pr.id = v_p1 and s.name = 'Consulta inicial';

  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  select v_cid, c.id, pr.id, s.id,
    v_base + interval '1 day 10 hours', v_base + interval '1 day 11 hours', 'confirmado', s.price, 'painel'
  from public.clients c, public.professionals pr, public.services s
  where c.company_id = v_cid and pr.company_id = v_cid and s.company_id = v_cid
    and c.name = 'Juliana Costa' and pr.id = v_p1 and s.name = 'Serviço completo';

  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  select v_cid, c.id, pr.id, s.id,
    v_base + interval '1 day 14 hours', v_base + interval '1 day 15 hours', 'agendado', s.price, 'online'
  from public.clients c, public.professionals pr, public.services s
  where c.company_id = v_cid and pr.company_id = v_cid and s.company_id = v_cid
    and c.name = 'Fernanda Lima' and pr.id = v_p2 and s.name = 'Consulta inicial';

  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  select v_cid, c.id, pr.id, s.id,
    v_base + interval '2 days 16 hours', v_base + interval '2 days 17 hours', 'agendado', s.price, 'painel'
  from public.clients c, public.professionals pr, public.services s
  where c.company_id = v_cid and pr.company_id = v_cid and s.company_id = v_cid
    and c.name = 'Patrícia Alves' and pr.id = v_p2 and s.name = 'Retoque';

  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  select v_cid, c.id, pr.id, s.id,
    v_base - interval '2 days 15 hours', v_base - interval '2 days 16 hours', 'concluido', s.price, 'painel'
  from public.clients c, public.professionals pr, public.services s
  where c.company_id = v_cid and pr.company_id = v_cid and s.company_id = v_cid
    and c.name = 'Maria Oliveira' and pr.id = v_p1 and s.name = 'Serviço completo';

  -- Story demo
  insert into public.stories (company_id, title, text, button_label, starts_at, ends_at, position)
  values (v_cid, 'Promoção da semana', '20% de desconto nos serviços realizados até sexta!', 'Agendar', current_date, current_date + 7, 1);

  -- Template de anamnese demo
  insert into public.anamnesis_templates (company_id, name, fields)
  values (v_cid, 'Ficha de anamnese', '[
    {"key":"cpf","label":"CPF","type":"text","required":false},
    {"key":"nascimento","label":"Data de nascimento","type":"date","required":false},
    {"key":"alergias","label":"Alergias","type":"textarea","required":false},
    {"key":"restricoes","label":"Restrições médicas","type":"textarea","required":false},
    {"key":"historico","label":"Histórico relevante","type":"textarea","required":false},
    {"key":"observacoes","label":"Observações","type":"textarea","required":false}
  ]'::jsonb);

  -- Produtos demo
  insert into public.products (company_id, name, price, stock, description) values
    (v_cid, 'Produto Premium 100ml', 89.90, 12, 'Linha profissional'),
    (v_cid, 'Produto Essencial 50ml', 45.00, 30, 'Uso diário');

  return v_cid;
end $$;

-- ---------- VINCULAR INDICAÇÃO APÓS CADASTRO ----------
create or replace function public.link_referral(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_referrer uuid;
begin
  if p_code is null or length(trim(p_code)) = 0 then return; end if;
  select id into v_referrer from public.profiles
    where referral_code = upper(trim(p_code)) and id <> auth.uid();
  if v_referrer is null then return; end if;
  update public.profiles set referred_by = v_referrer where id = auth.uid() and referred_by is null;
  insert into public.referrals (referrer_id, invited_id, referral_code)
  select v_referrer, auth.uid(), upper(trim(p_code))
  where not exists (select 1 from public.referrals where invited_id = auth.uid());
end $$;

-- ---------- AGENDAMENTO PÚBLICO ----------
create or replace function public.public_book(
  p_slug text, p_service_id uuid, p_professional_id uuid, p_start timestamptz,
  p_name text, p_whatsapp text, p_email text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company record;
  v_service record;
  v_prof record;
  v_settings record;
  v_end timestamptz;
  v_client uuid;
  v_appt uuid;
  v_body text;
  v_waid uuid;
begin
  if p_start < now() then raise exception 'Horário no passado'; end if;
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_whatsapp),'') = '' then
    raise exception 'Informe nome e WhatsApp';
  end if;

  select * into v_company from public.companies where slug = p_slug and public_enabled;
  if not found then raise exception 'Empresa não encontrada'; end if;

  select * into v_settings from public.company_settings where company_id = v_company.id;
  if v_settings is null or not v_settings.allow_online then raise exception 'Agendamento online desativado'; end if;
  if p_start > now() + make_interval(days => v_settings.max_advance_days) then
    raise exception 'Data fora do período permitido';
  end if;
  if p_start < now() + make_interval(hours => v_settings.min_notice_hours) then
    raise exception 'Agende com pelo menos %h de antecedência', v_settings.min_notice_hours;
  end if;

  select * into v_service from public.services
    where id = p_service_id and company_id = v_company.id and active;
  if not found then raise exception 'Serviço indisponível'; end if;

  select * into v_prof from public.professionals
    where id = p_professional_id and company_id = v_company.id and status = 'active';
  if not found then raise exception 'Profissional indisponível'; end if;
  if not exists (select 1 from public.service_professionals sp
                 where sp.service_id = p_service_id and sp.professional_id = p_professional_id) then
    raise exception 'Profissional não realiza este serviço';
  end if;

  -- Expediente
  if not exists (
    select 1 from public.business_hours bh
    where bh.company_id = v_company.id and bh.weekday = extract(isodow from p_start)::int % 7
      and bh.is_open
      and (p_start at time zone v_company.timezone)::time >= bh.start_time::time
      and ((p_start + make_interval(mins => v_service.duration_min)) at time zone v_company.timezone)::time <= bh.end_time::time
  ) then raise exception 'Fora do horário de atendimento'; end if;

  v_end := p_start + make_interval(mins => v_service.duration_min);

  if exists (
    select 1 from public.appointments a
    where a.professional_id = p_professional_id
      and a.status in ('agendado','confirmado','em_atendimento')
      and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_start, v_end)
  ) then raise exception 'Horário indisponível'; end if;

  -- Cliente: reutiliza existente por WhatsApp
  select id into v_client from public.clients
    where company_id = v_company.id and whatsapp = p_whatsapp limit 1;
  if v_client is null then
    insert into public.clients (company_id, name, whatsapp, email)
    values (v_company.id, p_name, p_whatsapp, p_email) returning id into v_client;
  else
    update public.clients set name = p_name, email = coalesce(nullif(p_email,''), email) where id = v_client;
  end if;

  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  values (v_company.id, v_client, p_professional_id, p_service_id, p_start, v_end, 'agendado', v_service.price, 'online')
  returning id into v_appt;

  -- Fila de confirmação WhatsApp
  select w.id into v_waid from public.whatsapp_templates w
    where w.company_id = v_company.id and w.type = 'confirmacao' and w.active;
  if v_waid is not null then
    select body into v_body from public.whatsapp_templates where id = v_waid;
    insert into public.message_queue (company_id, client_id, appointment_id, type, phone, body, scheduled_at)
    values (v_company.id, v_client, v_appt, 'confirmacao', p_whatsapp,
      public.render_template(v_body, p_name, to_char(p_start at time zone v_company.timezone, 'DD/MM/YYYY'),
        to_char(p_start at time zone v_company.timezone, 'HH24:MI'), v_company.name, v_service.name, v_prof.name),
      now());
  end if;

  return v_appt;
end $$;
grant execute on function public.public_book to anon, authenticated;

-- ---------- CHECKOUT DE ASSINATURA ----------
create or replace function public.start_checkout(p_plan_id uuid, p_gateway text default 'simulado')
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid;
  v_plan record;
  v_ref text;
  v_sub uuid;
begin
  select company_id into v_cid from public.company_members
    where user_id = auth.uid() and role in ('owner','admin') and status = 'active' limit 1;
  if v_cid is null and public.is_master() then
    raise exception 'Administrador master não possui empresa';
  end if;
  if v_cid is null then raise exception 'Sem empresa vinculada'; end if;

  select * into v_plan from public.plans where id = p_plan_id and active;
  if not found then raise exception 'Plano indisponível'; end if;

  select id into v_sub from public.subscriptions where company_id = v_cid;
  if v_sub is null then
    insert into public.subscriptions (company_id, plan_id, status) values (v_cid, p_plan_id, 'pendente') returning id into v_sub;
  end if;

  v_ref := 'PAY-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 16));
  insert into public.payments (company_id, subscription_id, amount, status, method, gateway, gateway_ref)
  values (v_cid, v_sub, v_plan.price, 'pendente', 'pix', p_gateway, v_ref);
  return v_ref;
end $$;
grant execute on function public.start_checkout to authenticated;

-- ---------- CONFIRMAÇÃO DE PAGAMENTO (estilo webhook) ----------
create or replace function public.confirm_payment(p_ref text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pay record;
  v_period timestamptz;
  v_owner uuid;
  v_ref record;
  v_comm numeric;
  v_settings record;
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

  -- Comissão de indicação
  select owner_id into v_owner from public.companies where id = v_pay.company_id;
  select * into v_ref from public.referrals
    where invited_id = v_owner and status = 'pendente' limit 1;
  if v_ref is not null then
    update public.referrals set status = 'convertido', converted_at = now() where id = v_ref.id;
    select * into v_settings from public.app_settings where id = 1;
    if not v_settings.referral_first_only or not exists (
      select 1 from public.referral_commissions rc where rc.user_id = v_ref.referrer_id
    ) then
      v_comm := case v_settings.referral_type
        when 'fixed' then v_settings.referral_value
        else round(v_pay.amount * v_settings.referral_value / 100.0, 2) end;
      insert into public.referral_commissions (referral_id, user_id, amount, type, status)
      values (v_ref.id, v_ref.referrer_id, v_comm, 'primeira', 'disponivel');
      insert into public.notifications (company_id, user_id, type, title, body)
      values (null, v_ref.referrer_id, 'indicacao', 'Indicação convertida!',
        'Alguém que entrou pelo seu link assinou um plano. Você ganhou R$ ' || v_comm::text || ' em comissões.');
    end if;
  end if;

  insert into public.notifications (company_id, type, title, body)
  values (v_pay.company_id, 'pagamento', 'Pagamento aprovado',
    'Seu pagamento de R$ ' || v_pay.amount::text || ' foi aprovado e o acesso está ativo.');
end $$;
grant execute on function public.confirm_payment to authenticated;

-- ---------- PROCESSAR VENCIMENTOS / TRIALS / AVISOS ----------
create or replace function public.process_subscriptions()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tol int;
  s record;
  v_title text;
  v_key text;
begin
  select tolerance_days into v_tol from public.app_settings where id = 1;

  for s in
    select sub.*, c.owner_id from public.subscriptions sub
    join public.companies c on c.id = sub.company_id
    where sub.status in ('trial','ativo','pendente','vencido')
  loop
    if s.status = 'trial' and s.trial_ends_at is not null and now() > s.trial_ends_at then
      update public.subscriptions set status = 'vencido' where id = s.id;
      insert into public.notifications (company_id, type, title, body)
      values (s.company_id, 'vencimento', 'Trial encerrado',
        'Seu período gratuito terminou. Escolha um plano para continuar usando todas as funções.')
      on conflict do nothing;
    elsif s.status = 'ativo' and s.current_period_end is not null then
      -- avisos 7/3/1/0 dias
      if s.current_period_end - now() <= interval '7 days' and s.current_period_end > now() then
        v_key := 'aviso7-' || to_char(s.current_period_end, 'YYYYMMDD');
        v_title := 'Seu plano vence em 7 dias';
        if s.current_period_end - now() <= interval '3 days' then
          v_key := 'aviso3-' || to_char(s.current_period_end, 'YYYYMMDD');
          v_title := 'Seu plano vence em 3 dias';
        end if;
        if s.current_period_end - now() <= interval '1 day' then
          v_key := 'aviso1-' || to_char(s.current_period_end, 'YYYYMMDD');
          v_title := 'Seu plano vence amanhã';
        end if;
        if s.current_period_end - now() <= interval '0 hours' then
          v_key := 'aviso0-' || to_char(s.current_period_end, 'YYYYMMDD');
          v_title := 'Seu plano vence hoje';
        end if;
        insert into public.notifications (company_id, type, title, body, dedupe_key)
        values (s.company_id, 'vencimento', v_title, 'Renove seu plano para manter o acesso sem interrupções.', v_key)
        on conflict do nothing;
      end if;
      if now() > s.current_period_end + make_interval(days => v_tol) then
        update public.subscriptions set status = 'bloqueado' where id = s.id;
        insert into public.notifications (company_id, type, title, body)
        values (s.company_id, 'vencimento', 'Acesso suspenso',
          'Seu pagamento está pendente e o período de tolerância terminou. Regularize para reativar o acesso.');
      elsif now() > s.current_period_end then
        update public.subscriptions set status = 'vencido' where id = s.id;
        insert into public.notifications (company_id, type, title, body, dedupe_key)
        values (s.company_id, 'vencimento', 'Seu pagamento está pendente.',
          'Regularize o pagamento para manter o acesso. Você tem ' || v_tol || ' dias de tolerância.',
          'venc-' || to_char(s.current_period_end, 'YYYYMMDD'))
        on conflict do nothing;
      end if;
    end if;
  end loop;
end $$;
grant execute on function public.process_subscriptions to authenticated;

-- ---------- REGISTRAR ACESSO POR LINK DE INDICAÇÃO ----------
grant execute on function public.link_referral to authenticated;
grant execute on function public.create_company to authenticated;
