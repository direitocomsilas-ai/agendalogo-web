-- FLUXO DE CAIXA: tabela, RLS, triggers automáticos e backfill
create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null default 'entrada' check (kind in ('entrada','saida')),
  origin text not null default 'manual' check (origin in ('agendamento','pedido','manual')),
  ref_type text,
  ref_id uuid,
  description text not null default '',
  amount numeric not null default 0 check (amount >= 0),
  occurred_at date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.cash_transactions enable row level security;
create policy cash_transactions_member on public.cash_transactions for all to authenticated
  using (company_id in (select public.my_company_ids()) or public.is_master())
  with check (company_id in (select public.my_company_ids()) or public.is_master());

create index if not exists cash_transactions_company_date on public.cash_transactions(company_id, occurred_at desc);
create unique index if not exists cash_transactions_ref on public.cash_transactions(origin, ref_id) where ref_id is not null;

-- Sincroniza caixa com agendamentos: concluído gera entrada; sair de concluído/remove apaga.
create or replace function public.appointment_cash_sync() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'DELETE' then
    delete from public.cash_transactions where origin = 'agendamento' and ref_id = old.id;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'concluido' and (new.status <> 'concluido' or new.price is distinct from old.price) then
    delete from public.cash_transactions where origin = 'agendamento' and ref_id = new.id;
  end if;
  if new.status = 'concluido' and new.price > 0 then
    insert into public.cash_transactions (company_id, kind, origin, ref_type, ref_id, description, amount, occurred_at)
    values (
      new.company_id, 'entrada', 'agendamento', 'appointment', new.id,
      coalesce((select c.name from public.clients c where c.id = new.client_id), 'Cliente') || ' — ' || coalesce((select s.name from public.services s where s.id = new.service_id), 'Serviço'),
      new.price,
      (new.starts_at at time zone 'UTC')::date
    )
    on conflict (origin, ref_id) where ref_id is not null do update
      set amount = excluded.amount,
          description = excluded.description,
          occurred_at = excluded.occurred_at;
  end if;
  return new;
end
$fn$;

drop trigger if exists appointments_cash_sync on public.appointments;
create trigger appointments_cash_sync
after insert or update or delete on public.appointments
for each row execute function public.appointment_cash_sync();

-- Sincroniza caixa com pedidos: pago gera entrada; sair de pago/remove apaga.
create or replace function public.order_cash_sync() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'DELETE' then
    delete from public.cash_transactions where origin = 'pedido' and ref_id = old.id;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'pago' and new.status <> 'pago' then
    delete from public.cash_transactions where origin = 'pedido' and ref_id = new.id;
  end if;
  if new.status = 'pago' and new.total > 0 then
    insert into public.cash_transactions (company_id, kind, origin, ref_type, ref_id, description, amount, occurred_at)
    values (
      new.company_id, 'entrada', 'pedido', 'order', new.id,
      'Pedido — ' || coalesce((select c.name from public.clients c where c.id = new.client_id), 'Cliente'),
      new.total,
      (new.created_at at time zone 'UTC')::date
    )
    on conflict (origin, ref_id) where ref_id is not null do update
      set amount = excluded.amount,
          description = excluded.description,
          occurred_at = excluded.occurred_at;
  end if;
  return new;
end
$fn$;

drop trigger if exists orders_cash_sync on public.orders;
create trigger orders_cash_sync
after insert or update or delete on public.orders
for each row execute function public.order_cash_sync();

-- Backfill: agendamentos concluídos e pedidos pagos já existentes entram no caixa.
insert into public.cash_transactions (company_id, kind, origin, ref_type, ref_id, description, amount, occurred_at)
select a.company_id, 'entrada', 'agendamento', 'appointment', a.id,
       coalesce((select c.name from public.clients c where c.id = a.client_id), 'Cliente') || ' — ' || coalesce((select s.name from public.services s where s.id = a.service_id), 'Serviço'),
       a.price, (a.starts_at at time zone 'UTC')::date
from public.appointments a
where a.status = 'concluido' and a.price > 0
on conflict (origin, ref_id) where ref_id is not null do nothing;

insert into public.cash_transactions (company_id, kind, origin, ref_type, ref_id, description, amount, occurred_at)
select o.company_id, 'entrada', 'pedido', 'order', o.id,
       'Pedido — ' || coalesce((select c.name from public.clients c where c.id = o.client_id), 'Cliente'),
       o.total, (o.created_at at time zone 'UTC')::date
from public.orders o
where o.status = 'pago' and o.total > 0
on conflict (origin, ref_id) where ref_id is not null do nothing;
