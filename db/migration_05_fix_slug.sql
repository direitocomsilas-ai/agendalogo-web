-- Slug sem depender da extensão unaccent
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
  v_p1 uuid; v_p2 uuid;
  v_base timestamptz;
begin
  if v_uid is null then raise exception 'Não autenticado'; end if;
  if exists (select 1 from public.companies where owner_id = v_uid) then
    raise exception 'Você já possui uma empresa cadastrada';
  end if;

  v_slug := coalesce(p_slug, lower(regexp_replace(
    translate(p_name,
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
    '[^a-zA-Z0-9]+', '-', 'g')));
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
  select v_cid, d, d between 1 and 5 or d = 6, '09:00', case when d = 6 then '14:00' else '18:00' end
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
  insert into public.service_sections (company_id, name, position)
  values (v_cid, 'Principal', 1), (v_cid, 'Extras', 2);

  insert into public.services (company_id, section_id, name, description, price, duration_min, position)
  values
    (v_cid, (select id from public.service_sections where company_id = v_cid and name = 'Principal'), 'Consulta inicial', 'Primeira avaliação personalizada', 80, 60, 1),
    (v_cid, (select id from public.service_sections where company_id = v_cid and name = 'Principal'), 'Serviço completo', 'Atendimento completo com os melhores produtos', 150, 90, 2),
    (v_cid, (select id from public.service_sections where company_id = v_cid and name = 'Extras'), 'Retoque', 'Manutenção rápida', 60, 40, 3);

  insert into public.service_professionals (service_id, professional_id)
  select s.id, p.id from public.services s, public.professionals p
  where s.company_id = v_cid and p.company_id = v_cid;

  -- Clientes demo
  insert into public.clients (company_id, name, whatsapp, email) values
    (v_cid, 'Maria Oliveira', '(11) 97777-1111', 'maria@email.com'),
    (v_cid, 'Juliana Costa', '(11) 97777-2222', 'juliana@email.com'),
    (v_cid, 'Fernanda Lima', '(11) 97777-3333', 'fernanda@email.com'),
    (v_cid, 'Patrícia Alves', '(11) 97777-4444', 'patricia@email.com');

  -- Agendamentos demo
  v_base := (current_date::timestamp) at time zone 'America/Sao_Paulo';
  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  select v_cid, c.id, v_p1, s.id, v_base + interval '9 hours', v_base + interval '10 hours', 'concluido', s.price, 'painel'
  from public.clients c, public.services s
  where c.company_id = v_cid and s.company_id = v_cid and c.name = 'Maria Oliveira' and s.name = 'Consulta inicial';

  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  select v_cid, c.id, v_p1, s.id, v_base + interval '1 day 10 hours', v_base + interval '1 day 11 hours', 'confirmado', s.price, 'painel'
  from public.clients c, public.services s
  where c.company_id = v_cid and s.company_id = v_cid and c.name = 'Juliana Costa' and s.name = 'Serviço completo';

  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  select v_cid, c.id, v_p2, s.id, v_base + interval '1 day 14 hours', v_base + interval '1 day 15 hours', 'agendado', s.price, 'online'
  from public.clients c, public.services s
  where c.company_id = v_cid and s.company_id = v_cid and c.name = 'Fernanda Lima' and s.name = 'Consulta inicial';

  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  select v_cid, c.id, v_p2, s.id, v_base + interval '2 days 16 hours', v_base + interval '2 days 17 hours', 'agendado', s.price, 'painel'
  from public.clients c, public.services s
  where c.company_id = v_cid and s.company_id = v_cid and c.name = 'Patrícia Alves' and s.name = 'Retoque';

  insert into public.appointments (company_id, client_id, professional_id, service_id, starts_at, ends_at, status, price, source)
  select v_cid, c.id, v_p1, s.id, v_base - interval '2 days 15 hours', v_base - interval '2 days 14 hours', 'concluido', s.price, 'painel'
  from public.clients c, public.services s
  where c.company_id = v_cid and s.company_id = v_cid and c.name = 'Maria Oliveira' and s.name = 'Serviço completo';

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
