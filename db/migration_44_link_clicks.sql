-- ============================================================
-- Migration 44: Contagem de cliques no link público
-- Cada abertura de /b/:slug registra um clique. O relatório do
-- profissional mostra quantas pessoas clicaram no link.
-- ============================================================

create table if not exists public.link_clicks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  referrer text,
  created_at timestamptz not null default now()
);

create index if not exists link_clicks_company_created
  on public.link_clicks (company_id, created_at desc);

alter table public.link_clicks enable row level security;

drop policy if exists link_clicks_read on public.link_clicks;
create policy link_clicks_read on public.link_clicks
  for select to authenticated
  using (company_id in (select public.my_company_ids()) or public.is_master());

-- Registro público (anônimo): resolve a empresa pelo slug.
create or replace function public.link_click_log(p_slug text, p_referrer text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.companies
    where slug = p_slug and public_enabled = true
    limit 1;
  if v_id is null then return; end if;
  insert into public.link_clicks (company_id, referrer)
    values (v_id, left(nullif(p_referrer, ''), 300));
end $$;

grant execute on function public.link_click_log(text, text) to anon, authenticated;
