-- MIGRATION 13 — create_company semeia os 8 templates da Central do WhatsApp
CREATE OR REPLACE FUNCTION public.create_company(p_name text, p_category text, p_whatsapp text DEFAULT ''::text, p_description text DEFAULT ''::text, p_slug text DEFAULT NULL::text, p_owner_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := coalesce(p_owner_id, auth.uid());
  v_cid uuid;
  v_slug text;
  v_trial_days int;
  v_free_plan uuid;
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

  insert into public.business_hours (company_id, weekday, is_open, start_time, end_time)
  select v_cid, d, d between 1 and 5 or d = 6, '09:00', case when d = 6 then '14:00' else '18:00' end
  from generate_series(0,6) d;

  insert into public.whatsapp_templates (company_id, type, body) values
    (v_cid, 'confirmacao', E'Olá, {cliente}! 😊\nSeu agendamento foi realizado com sucesso.\n📅 Data: {data}\n🕐 Horário: {horario}\n✨ Serviço: {servico}\nEstamos aguardando você! 💚'),
    (v_cid, 'lembrete_24h', E'Olá, {cliente}! 😊\nPassando para lembrar que você tem um horário agendado amanhã.\n📅 {data}\n🕐 {horario}\n✨ {servico}\nPodemos contar com você? 💚'),
    (v_cid, 'lembrete_3h', E'🔔 Olá, {cliente}!\nSeu atendimento está marcado para daqui a 3 horas.\n🕐 Horário: {horario}\n✨ {servico}\nEstamos esperando você! 💚'),
    (v_cid, 'confirmado', E'✅ Seu agendamento foi confirmado!\n📅 {data}\n🕐 {horario}\n✨ {servico}\nAté lá! 💚'),
    (v_cid, 'cancelamento', E'Olá, {cliente}.\nSeu agendamento do dia {data} às {horario} foi cancelado.\nCaso queira marcar um novo horário, estamos à disposição. 😊'),
    (v_cid, 'reagendamento', E'📅 Seu agendamento foi reagendado!\nNovo horário:\n📅 {data}\n🕐 {horario}\n✨ {servico}\nAté lá! 💚'),
    (v_cid, 'concluido', E'Olá, {cliente}! 💚\nFoi um prazer atender você hoje.\n✨ Serviço: {servico}\nProfissional: {profissional}\nVolte sempre! 😊'),
    (v_cid, 'faltou', E'Olá, {cliente}.\nRegistramos que você não compareceu ao horário de {horario} do dia {data}.\nSe quiser remarcar, estamos à disposição. 😊');

  select trial_days into v_trial_days from public.app_settings where id = 1;
  select id into v_free_plan from public.plans where price = 0 order by sort limit 1;
  insert into public.subscriptions (company_id, plan_id, status, trial_ends_at, current_period_end, amount)
  values (v_cid, v_free_plan, 'trial', now() + make_interval(days => v_trial_days), now() + make_interval(days => v_trial_days), 0);

  insert into public.professionals (company_id, name, specialty, commission, phone)
  values (v_cid, split_part(p_name, ' ', 1) || ' (você)', 'Especialista', 0, p_whatsapp);

  insert into public.service_sections (company_id, name, position)
  values (v_cid, 'Principal', 1);

  insert into public.anamnesis_templates (company_id, name, fields)
  values (v_cid, 'Ficha de anamnese', '[
    {"key":"cpf","label":"CPF","type":"text","required":false},
    {"key":"nascimento","label":"Data de nascimento","type":"date","required":false},
    {"key":"alergias","label":"Alergias","type":"textarea","required":false},
    {"key":"restricoes","label":"Restrições médicas","type":"textarea","required":false},
    {"key":"historico","label":"Histórico relevante","type":"textarea","required":false},
    {"key":"observacoes","label":"Observações","type":"textarea","required":false}
  ]'::jsonb);

  return v_cid;
end $function$;
