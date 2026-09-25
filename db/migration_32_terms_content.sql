-- Migration 32: termo de uso editável pelo master.
-- Texto livre; linhas iniciando com "# " viram títulos de seção; linhas em
-- branco separam parágrafos. Vazio/null = termo padrão do sistema.
alter table public.app_settings add column if not exists terms_content text;
