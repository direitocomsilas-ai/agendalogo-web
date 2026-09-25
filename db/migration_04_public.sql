-- Stories visíveis na página pública
create policy stories_public on public.stories for select using (public.is_public_company(company_id));

-- Rastreamento de views/cliques nos stories
create or replace function public.track_story(p_story_id uuid, p_is_click boolean default false)
returns void
language sql security definer set search_path = public as $$
  update public.stories
    set views = views + case when p_is_click then 0 else 1 end,
        clicks = clicks + case when p_is_click then 1 else 0 end
    where id = p_story_id
      and exists (select 1 from public.companies c where c.id = stories.company_id and c.public_enabled);
$$;
grant execute on function public.track_story to anon, authenticated;
