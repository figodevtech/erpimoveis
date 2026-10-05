-- Produto novo nasce PUBLICADO no canal Loja propria, como ja nasce com
-- "exibirPdv" = true (ver 20260803140000_produto_exibir_pdv_default_true).
--
-- A visibilidade no site nao e uma coluna de produto: vem de
-- site_product_link.status = 'PUBLICADO'. Sem vinculo, o produto nem entra em
-- site_catalog_export, entao todo cadastro novo ficava fora da loja ate alguem
-- publicar manualmente. Esconder do site passa a ser a excecao, marcada na aba
-- Marketplace (status PAUSADO/RASCUNHO), igual ao PDV.
--
-- Regras:
-- * Espelha o PDV: so publica quem nasce com "exibirPdv" = true e nao excluido.
--   Placeholders de integracao (Mercado Livre, Shopee) nascem com "exibirPdv" =
--   false e continuam fora do site.
-- * O canal exige empresa unica por banco (ver requireEmpresaId); com zero ou
--   mais de uma empresa o trigger nao faz nada.
-- * Nunca impede o cadastro: qualquer falha ao criar o vinculo vira WARNING.
-- * Produtos existentes nao sao tocados: um produto fora do site de proposito
--   deve continuar fora. Para publicar o catalogo antigo use "Publicar todos".
-- * Instalacoes sem loja configurada apenas acumulam o vinculo/fila; nada e
--   enviado sem STOREFRONT_API_URL e STOREFRONT_CATALOG_SYNC_SECRET.
begin;

create or replace function public.fn_publicar_produto_novo_no_site()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresas integer;
  v_empresa_id integer;
begin
  select count(*), min(id)
    into v_empresas, v_empresa_id
    from (select id from public.empresa order by id limit 2) empresas;

  if v_empresas <> 1 then
    return new;
  end if;

  begin
    -- O trigger de site_product_link enfileira a sincronizacao com a loja.
    insert into public.site_product_link (empresa_id, produto_id, status)
    values (v_empresa_id, new.id, 'PUBLICADO')
    on conflict (empresa_id, produto_id) do nothing;
  exception when others then
    raise warning 'Produto % cadastrado sem publicacao no site: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_publicar_produto_novo_no_site on public.produto;

create trigger trg_publicar_produto_novo_no_site
after insert on public.produto
for each row
when (new."exibirPdv" is true and coalesce(new.is_deleted, false) = false)
execute function public.fn_publicar_produto_novo_no_site();

comment on function public.fn_publicar_produto_novo_no_site() is
  'Cria site_product_link PUBLICADO para produto novo visivel no PDV. Ocultar do site e escolha explicita na aba Marketplace.';

commit;
