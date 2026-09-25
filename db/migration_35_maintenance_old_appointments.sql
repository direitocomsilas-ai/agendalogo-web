-- Migration 35: funções de manutenção para agendamentos antigos (master only)

create or replace function public.count_old_appointments(p_days integer default 365)
returns integer
language sql
security definer
as $$
  select count(*)::integer
  from public.appointments
  where starts_at < (now() - (p_days || ' days')::interval);
$$;

create or replace function public.delete_old_appointments(p_days integer default 365)
returns integer
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  if not public.is_master() then
    raise exception 'Apenas master pode executar esta rotina.';
  end if;

  delete from public.appointments
  where starts_at < (now() - (p_days || ' days')::interval);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.count_old_appointments(integer) to authenticated;
grant execute on function public.delete_old_appointments(integer) to authenticated;
