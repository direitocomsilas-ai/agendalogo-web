-- Migration 37: meta de indicações — 10 indicações = R$ 200 via PIX
alter table public.app_settings
  add column if not exists master_whatsapp text,
  add column if not exists referral_goal_count int not null default 10,
  add column if not exists referral_goal_amount numeric not null default 200;

create table if not exists public.referral_goal_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  referral_count int not null default 0,
  reward_amount numeric not null default 200,
  status text not null default 'solicitado' check (status in ('solicitado','pago')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table public.referral_goal_claims enable row level security;
create policy referral_goal_claims_member on public.referral_goal_claims for all to authenticated
  using (user_id = auth.uid() or is_master())
  with check (user_id = auth.uid() or is_master());
