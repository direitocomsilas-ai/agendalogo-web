-- ============================================================
-- Agendez — complementos
-- ============================================================
alter table public.professionals add column if not exists invite_code text;

-- Horários disponíveis para a página pública
create or replace function public.public_slots(
  p_slug text, p_service_id uuid, p_professional_id uuid, p_date date
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company record;
  v_service record;
  v_settings record;
  v_hours record;
  v_break jsonb;
  v_start timestamptz;
  v_end_time time;
  v_slot timestamptz;
  v_slot_end timestamptz;
  v_res jsonb := '[]'::jsonb;
begin
  select * into v_company from public.companies where slug = p_slug and public_enabled;
  if not found then return v_res; end if;
  select * into v_service from public.services where id = p_service_id and company_id = v_company.id and active;
  if not found then return v_res; end if;
  select * into v_settings from public.company_settings where company_id = v_company.id;

  select * into v_hours from public.business_hours
    where company_id = v_company.id and weekday = extract(isodow from p_date)::int % 7 and is_open;
  if not found then return v_res; end if;
  if exists (select 1 from public.date_blocks where company_id = v_company.id and block_date = p_date) then
    return v_res;
  end if;

  v_start := (p_date + v_hours.start_time::time) at time zone v_company.timezone;
  v_end_time := v_hours.end_time::time;

  v_slot := v_start;
  while ((v_slot at time zone v_company.timezone)::time + interval '1 minute' * v_service.duration_min) <= v_end_time loop
    v_slot_end := v_slot + make_interval(mins => v_service.duration_min);
    if v_slot > now() + make_interval(hours => coalesce(v_settings.min_notice_hours, 0)) then
      if not exists (
        select 1 from public.appointments a
        where a.professional_id = p_professional_id
          and a.status in ('agendado','confirmado','em_atendimento')
          and tstzrange(a.starts_at, a.ends_at) && tstzrange(v_slot, v_slot_end)
      ) then
        -- checa pausas
        v_break := null;
        select b into v_break from jsonb_array_elements(v_hours.breaks) b
          where (v_slot at time zone v_company.timezone)::time >= (b->>'start')::time
            and ((v_slot at time zone v_company.timezone)::time + interval '1 minute' * v_service.duration_min) > (b->>'end')::time
          limit 1;
        if v_break is null then
          v_res := v_res || to_jsonb(to_char((v_slot at time zone v_company.timezone)::time, 'HH24:MI'));
        end if;
      end if;
    end if;
    v_slot := v_slot + make_interval(mins => coalesce(v_settings.slot_interval, 30));
  end loop;
  return v_res;
end $$;
grant execute on function public.public_slots to anon, authenticated;
