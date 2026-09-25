-- Migration 34: adiciona foto aos serviços
alter table public.services add column if not exists photo_url text;
