-- ============================================================
-- Agendez — SaaS de agendamento (schema completo)
-- ============================================================
create extension if not exists btree_gist;

-- ---------- PERFIS DE USUÁRIO ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  whatsapp text default '',
  is_master boolean not null default false,
  referral_code text not null unique,
  referred_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- CONFIGURAÇÕES GLOBAIS DO SAAS ----------
create table public.app_settings (
  id int primary key default 1 check (id = 1),
  trial_days int not null default 7,
  tolerance_days int not null default 3,
  referral_type text not null default 'fixed' check (referral_type in ('fixed','percent')),
  referral_value numeric not null default 20,
  referral_first_only boolean not null default true,
  master_email text,
  updated_at timestamptz not null default now()
);
insert into public.app_settings default values;

-- ---------- EMPRESAS (TENANTS) ----------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null unique,
  category text not null default 'Outro',
  description text default '',
  whatsapp text default '',
  instagram text default '',
  address text default '',
  city text default '',
  state text default '',
  zip text default '',
  timezone text default 'America/Sao_Paulo',
  logo_url text,
  photo_url text,
  cover_type text not null default 'color' check (cover_type in ('color','image')),
  cover_color text default '#059669',
  cover_url text,
  public_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(id),
  role text not null default 'professional' check (role in ('owner','admin','manager','professional')),
  status text not null default 'active' check (status in ('active','invited','disabled')),
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  photo_url text,
  phone text default '',
  email text default '',
  specialty text default '',
  commission numeric not null default 0,
  workdays jsonb not null default '[1,2,3,4,5]',
  start_time text default '09:00',
  end_time text default '18:00',
  status text not null default 'active' check (status in ('active','inactive')),
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- SERVIÇOS ----------
create table public.service_sections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  section_id uuid references public.service_sections(id) on delete set null,
  name text not null,
  description text default '',
  price numeric not null default 0,
  duration_min int not null default 60,
  mode text not null default 'presencial' check (mode in ('presencial','online','domicilio')),
  prepay boolean not null default false,
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.service_professionals (
  service_id uuid not null references public.services(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  primary key (service_id, professional_id)
);

-- ---------- CLIENTES ----------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  whatsapp text default '',
  phone text default '',
  email text default '',
  birthdate date,
  address text default '',
  notes text default '',
  created_at timestamptz not null default now()
);
create index clients_company_name on public.clients (company_id, lower(name));

-- ---------- AGENDAMENTOS ----------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  professional_id uuid references public.professionals(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'agendado' check (status in ('agendado','confirmado','em_atendimento','concluido','cancelado','faltou')),
  price numeric not null default 0,
  notes text default '',
  source text not null default 'painel' check (source in ('painel','online')),
  google_event_id text,
  created_at timestamptz not null default now()
);
create index appointments_company_start on public.appointments (company_id, starts_at);
alter table public.appointments add constraint no_double_booking
  exclude using gist (professional_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('agendado','confirmado','em_atendimento'));

-- ---------- STORIES ----------
create table public.stories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  text text default '',
  image_url text,
  link_url text default '',
  button_label text default 'Saiba mais',
  starts_at date,
  ends_at date,
  active boolean not null default true,
  position int not null default 0,
  views int not null default 0,
  clicks int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- ANAMNESE ----------
create table public.anamnesis_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null default 'Ficha de anamnese',
  fields jsonb not null default '[]',
  consent_text text default 'Autorizo o uso das informações acima para fins de atendimento.',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.anamnesis_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  template_id uuid references public.anamnesis_templates(id) on delete set null,
  answers jsonb not null default '{}',
  signature text,
  created_at timestamptz not null default now()
);

-- ---------- EXPEDIENTE / AGENDA ----------
create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  is_open boolean not null default false,
  start_time text not null default '09:00',
  end_time text not null default '18:00',
  breaks jsonb not null default '[]',
  unique (company_id, weekday)
);

create table public.date_blocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  block_date date not null,
  reason text default '',
  unique (company_id, block_date)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  address text default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  slot_interval int not null default 30,
  min_notice_hours int not null default 2,
  max_advance_days int not null default 60,
  allow_online boolean not null default true,
  reminder_hours int not null default 24,
  personal_contacts jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- ---------- WHATSAPP ----------
create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  type text not null check (type in ('confirmacao','lembrete','cancelamento','reagendamento','concluido')),
  body text not null,
  active boolean not null default true,
  unique (company_id, type)
);

create table public.message_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete cascade,
  type text not null,
  phone text not null default '',
  body text not null default '',
  status text not null default 'pendente' check (status in ('pendente','enviado','erro','cancelado')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- INTEGRAÇÕES ----------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('google_calendar','whatsapp','stripe','mercadopago','asaas')),
  config jsonb not null default '{}',
  connected boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (company_id, kind)
);

-- ---------- CATÁLOGO ----------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  photo_url text,
  price numeric not null default 0,
  stock int not null default 0,
  code text default '',
  description text default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  target_type text not null default 'servico' check (target_type in ('servico','produto')),
  target_id uuid,
  discount numeric not null default 0,
  discount_type text not null default 'percent' check (discount_type in ('percent','value')),
  starts_at date,
  ends_at date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  items jsonb not null default '[]',
  price numeric not null default 0,
  validity_days int not null default 90,
  discount numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  items jsonb not null default '[]',
  total numeric not null default 0,
  payment_method text default 'pix',
  status text not null default 'pendente' check (status in ('pendente','pago','cancelado')),
  created_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  items jsonb not null default '[]',
  discount numeric not null default 0,
  notes text default '',
  valid_until date,
  status text not null default 'rascunho' check (status in ('rascunho','enviado','aprovado','recusado','expirado')),
  created_at timestamptz not null default now()
);

-- ---------- COMISSÕES DE PROFISSIONAIS ----------
create table public.commission_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete cascade,
  amount numeric not null default 0,
  reference text default '',
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------- PLANOS E ASSINATURAS ----------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null default 0,
  period text not null default 'month' check (period in ('month','year')),
  max_professionals int,
  max_clients int,
  max_appointments int,
  features jsonb not null default '{}',
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  plan_id uuid references public.plans(id),
  status text not null default 'trial' check (status in ('trial','gratuito','ativo','pendente','vencido','cancelado','bloqueado')),
  starts_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  next_billing_at timestamptz,
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  amount numeric not null default 0,
  status text not null default 'pendente' check (status in ('pendente','aprovado','falhou','reembolsado')),
  method text default 'pix',
  gateway text not null default 'simulado' check (gateway in ('simulado','stripe','mercadopago','asaas')),
  gateway_ref text not null unique,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- INDICAÇÕES ----------
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  invited_id uuid not null references public.profiles(id) on delete cascade,
  referral_code text not null default '',
  status text not null default 'pendente' check (status in ('pendente','convertido','cancelado')),
  converted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null default 0,
  type text not null default 'primeira' check (type in ('primeira','recorrente')),
  status text not null default 'pendente' check (status in ('pendente','disponivel','paga')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- NOTIFICAÇÕES E SUPORTE ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  body text default '',
  read boolean not null default false,
  dedupe_key text,
  created_at timestamptz not null default now()
);
create unique index notifications_dedupe on public.notifications (coalesce(company_id::text, user_id::text), dedupe_key) where dedupe_key is not null;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject text not null,
  message text not null default '',
  attachment_url text,
  status text not null default 'aberto' check (status in ('aberto','respondido','resolvido')),
  created_at timestamptz not null default now()
);

create table public.support_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid references public.profiles(id),
  is_admin boolean not null default false,
  body text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- FUNÇÕES AUXILIARES
-- ============================================================
create or replace function public.is_master()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_master from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.my_company_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select company_id from public.company_members where user_id = auth.uid() and status = 'active';
$$;

create or replace function public.is_public_company(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.companies c where c.id = cid and c.public_enabled);
$$;

-- ============================================================
-- TRIGGER DE NOVO USUÁRIO
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_master boolean;
begin
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  while exists (select 1 from public.profiles where referral_code = v_code) loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  end loop;
  v_master := (select count(*) from public.profiles) = 0
    or new.email = (select master_email from public.app_settings where id = 1);
  insert into public.profiles (id, name, whatsapp, is_master, referral_code)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), coalesce(new.raw_user_meta_data->>'whatsapp',''), v_master, v_code);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- RLS
-- ============================================================
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_master() or public.is_master());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_master()) with check (id = auth.uid() or public.is_master());

alter table public.app_settings enable row level security;
create policy app_settings_read on public.app_settings for select using (true);
create policy app_settings_master on public.app_settings for all to authenticated
  using (public.is_master()) with check (public.is_master());

alter table public.plans enable row level security;
create policy plans_read on public.plans for select using (active or public.is_master());
create policy plans_master on public.plans for all to authenticated
  using (public.is_master()) with check (public.is_master());

alter table public.companies enable row level security;
create policy companies_read on public.companies for select
  using (public.is_public_company(id) or owner_id = auth.uid() or id in (select public.my_company_ids()) or public.is_master());
create policy companies_insert on public.companies for insert to authenticated
  with check (owner_id = auth.uid() or public.is_master());
create policy companies_update on public.companies for update to authenticated
  using (owner_id = auth.uid() or id in (select public.my_company_ids()) or public.is_master())
  with check (owner_id = auth.uid() or id in (select public.my_company_ids()) or public.is_master());
create policy companies_delete on public.companies for delete to authenticated
  using (public.is_master());

alter table public.company_members enable row level security;
create policy members_all on public.company_members for all to authenticated
  using (company_id in (select public.my_company_ids()) or public.is_master())
  with check (company_id in (select public.my_company_ids()) or public.is_master());

-- Tabelas com escopo por empresa (padrão: member all + master all)
alter table public.professionals enable row level security;
create policy professionals_member on public.professionals for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.service_sections enable row level security;
create policy service_sections_member on public.service_sections for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.services enable row level security;
create policy services_member on public.services for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.service_professionals enable row level security;
create policy service_professionals_member on public.service_professionals for all to authenticated using (exists (select 1 from public.services s where s.id = service_professionals.service_id and (s.company_id in (select public.my_company_ids()) or public.is_master()))) with check (exists (select 1 from public.services s where s.id = service_professionals.service_id and (s.company_id in (select public.my_company_ids()) or public.is_master())));
alter table public.clients enable row level security;
create policy clients_member on public.clients for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.appointments enable row level security;
create policy appointments_member on public.appointments for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.stories enable row level security;
create policy stories_member on public.stories for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.anamnesis_templates enable row level security;
create policy anamnesis_templates_member on public.anamnesis_templates for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.anamnesis_records enable row level security;
create policy anamnesis_records_member on public.anamnesis_records for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.business_hours enable row level security;
create policy business_hours_member on public.business_hours for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.date_blocks enable row level security;
create policy date_blocks_member on public.date_blocks for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.locations enable row level security;
create policy locations_member on public.locations for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.company_settings enable row level security;
create policy company_settings_member on public.company_settings for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.whatsapp_templates enable row level security;
create policy whatsapp_templates_member on public.whatsapp_templates for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.message_queue enable row level security;
create policy message_queue_member on public.message_queue for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.integrations enable row level security;
create policy integrations_member on public.integrations for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.products enable row level security;
create policy products_member on public.products for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.promotions enable row level security;
create policy promotions_member on public.promotions for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.packages enable row level security;
create policy packages_member on public.packages for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.orders enable row level security;
create policy orders_member on public.orders for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.quotes enable row level security;
create policy quotes_member on public.quotes for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.commission_payments enable row level security;
create policy commission_payments_member on public.commission_payments for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.subscriptions enable row level security;
create policy subscriptions_member on public.subscriptions for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());
alter table public.payments enable row level security;
create policy payments_member on public.payments for all to authenticated using (company_id in (select public.my_company_ids()) or public.is_master()) with check (company_id in (select public.my_company_ids()) or public.is_master());

-- Leitura pública (anônima) para a página de agendamento
create policy services_public on public.services for select using (public.is_public_company(company_id));
create policy sections_public on public.service_sections for select using (public.is_public_company(company_id));
create policy professionals_public on public.professionals for select using (public.is_public_company(company_id));
create policy hours_public on public.business_hours for select using (public.is_public_company(company_id));
create policy blocks_public on public.date_blocks for select using (public.is_public_company(company_id));
create policy sp_public on public.service_professionals for select using (
  exists (select 1 from public.services s join public.companies c on c.id = s.company_id
          where s.id = service_professionals.service_id and c.public_enabled));
create policy companies_public on public.companies for select using (public_enabled);

-- Notificações
alter table public.notifications enable row level security;
create policy notifications_user on public.notifications for all to authenticated
  using (user_id = auth.uid() or company_id in (select public.my_company_ids()) or public.is_master())
  with check (user_id = auth.uid() or company_id in (select public.my_company_ids()) or public.is_master());

-- Indicações
alter table public.referrals enable row level security;
create policy referrals_own on public.referrals for all to authenticated
  using (referrer_id = auth.uid() or invited_id = auth.uid() or public.is_master())
  with check (referrer_id = auth.uid() or public.is_master());

alter table public.referral_commissions enable row level security;
create policy refcom_own on public.referral_commissions for all to authenticated
  using (user_id = auth.uid() or public.is_master())
  with check (user_id = auth.uid() or public.is_master());

-- Suporte
alter table public.support_tickets enable row level security;
create policy tickets_own on public.support_tickets for all to authenticated
  using (user_id = auth.uid() or company_id in (select public.my_company_ids()) or public.is_master())
  with check (user_id = auth.uid() or company_id in (select public.my_company_ids()) or public.is_master());

alter table public.support_replies enable row level security;
create policy replies_own on public.support_replies for all to authenticated
  using (is_admin and public.is_master()
         or exists (select 1 from public.support_tickets st
                    where st.id = support_replies.ticket_id
                      and (st.user_id = auth.uid() or st.company_id in (select public.my_company_ids()))))
  with check (exists (select 1 from public.support_tickets st
                      where st.id = support_replies.ticket_id
                        and (st.user_id = auth.uid() or st.company_id in (select public.my_company_ids()) or public.is_master())));

-- ============================================================
-- PLANOS PADRÃO
-- ============================================================
insert into public.plans (name, price, period, max_professionals, max_clients, max_appointments, features, sort) values
('Gratuito', 0, 'month', 1, 30, 60, '{"stories":false,"whatsapp":false,"anamnese":true,"reports":false,"integrations":false,"google_calendar":false}', 1),
('Básico', 49.90, 'month', 2, 300, 500, '{"stories":true,"whatsapp":false,"anamnese":true,"reports":true,"integrations":false,"google_calendar":false}', 2),
('Profissional', 89.90, 'month', 6, 2000, 3000, '{"stories":true,"whatsapp":true,"anamnese":true,"reports":true,"integrations":true,"google_calendar":true}', 3),
('Premium', 149.90, 'month', 20, null, null, '{"stories":true,"whatsapp":true,"anamnese":true,"reports":true,"integrations":true,"google_calendar":true}', 4);
