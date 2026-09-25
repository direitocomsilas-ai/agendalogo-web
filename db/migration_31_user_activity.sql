-- Migration 31: rastreamento de atividade dos usuários (master vê quem está usando).
-- profiles.last_active_at recebe heartbeat a cada minuto enquanto o app está aberto.
alter table public.profiles add column if not exists last_active_at timestamptz;

create or replace function public.user_heartbeat()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'forbidden';
  end if;
  update public.profiles set last_active_at = now() where id = auth.uid();
end $$;

grant execute on function public.user_heartbeat to authenticated;
