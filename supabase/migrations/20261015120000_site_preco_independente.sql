begin;

-- Preserva o preço publicado atual dos vinculos existentes.
update public.site_product_link link
set preco_site = case when link.usar_preco_erp
    then greatest(coalesce(produto.precovenda, 0), 0)
    else coalesce(link.preco_site, 0) end,
    usar_preco_erp = false
from public.produto produto
where produto.id = link.produto_id
  and (link.usar_preco_erp or link.preco_site is null);

alter table public.site_product_link alter column usar_preco_erp set default false;

-- Captura o preço do ERP somente ao criar o vinculo. Atualizacoes de status
-- e sincronização preservam o preço; apenas preco_site altera o valor da loja.
create or replace function public.fn_site_preco_independente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if new.preco_site is null then
      select greatest(coalesce(precovenda, 0), 0) into new.preco_site
      from public.produto where id = new.produto_id;
    end if;
  elsif new.preco_site is null then
    new.preco_site := old.preco_site;
  end if;
  new.usar_preco_erp := false;
  return new;
end;
$$;

create trigger trg_site_preco_independente
before insert or update on public.site_product_link
for each row execute function public.fn_site_preco_independente();

comment on column public.site_product_link.preco_site is
  'Preço independente da loja, iniciado com produto.precovenda e alterado apenas explicitamente.';
comment on column public.site_product_link.usar_preco_erp is
  'Compatibilidade legada: sempre false; preço da loja permanece independente do ERP.';
revoke all on function public.fn_site_preco_independente() from public, anon, authenticated;
grant execute on function public.fn_site_preco_independente() to service_role;

commit;
