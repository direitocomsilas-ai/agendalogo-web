-- ============================================================
-- Migration 47: tipo da chave PIX do sinal
-- O profissional escolhe o tipo da chave (cpf, cnpj, email,
-- telefone, aleatoria). O prefixo +55 só é aplicado no telefone.
-- ============================================================

alter table public.companies
  add column if not exists deposit_pix_type text;

drop function if exists public.deposit_save_u(boolean, numeric, text, text, text);

create or replace function public.deposit_save_u(
  p_enabled boolean, p_amount numeric,
  p_pix_key text default null, p_pix_name text default null, p_pix_city text default null,
  p_pix_type text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_co uuid;
  v_key text;
  v_name text;
  v_city text;
  v_type text;
begin
  select id into v_co from public.companies where owner_id = auth.uid() limit 1;
  if v_co is null then raise exception 'empresa não encontrada'; end if;
  if p_enabled and (p_amount is null or p_amount < 5) then
    raise exception 'O sinal deve ser de pelo menos R$ 5,00';
  end if;

  v_key := nullif(trim(coalesce(p_pix_key, '')), '');
  v_name := nullif(trim(coalesce(p_pix_name, '')), '');
  v_city := nullif(trim(coalesce(p_pix_city, '')), '');
  v_type := nullif(trim(coalesce(p_pix_type, '')), '');
  if v_type is not null and v_type not in ('cpf','cnpj','email','telefone','aleatoria') then
    v_type := null;
  end if;

  update public.companies
    set deposit_enabled = p_enabled,
        deposit_amount = greatest(coalesce(p_amount, 0), 0),
        deposit_pix_key = v_key,
        deposit_pix_name = v_name,
        deposit_pix_city = v_city,
        deposit_pix_type = v_type
    where id = v_co;
  return jsonb_build_object('ok', true, 'deposit_enabled', p_enabled,
    'deposit_amount', greatest(coalesce(p_amount, 0), 0),
    'deposit_pix_key', v_key, 'deposit_pix_name', v_name, 'deposit_pix_city', v_city,
    'deposit_pix_type', v_type);
end $$;
grant execute on function public.deposit_save_u to authenticated;
