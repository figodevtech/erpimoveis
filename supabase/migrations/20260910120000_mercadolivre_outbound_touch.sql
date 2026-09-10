-- Registra toda escrita que o ERP faz num anúncio do Mercado Livre.
--
-- Sem isso não há como distinguir "o vendedor mexeu no anúncio pelo painel do ML"
-- de "o próprio ERP acabou de empurrar preço/estoque". O Mercado Livre devolve um
-- webhook `items` para as duas situações, e o ERP acabava avisando o usuário sobre
-- uma alteração que ele mesmo fez.
--
-- Os marcadores que existiam antes eram parciais: `_erp_stock_sync` só cobre
-- estoque, `mercadolivre_price_sync_log` só preço, e `mercadolivre_listing_edit_log`
-- só a ação `update_listing`. Pausar, encerrar, republicar, descrição, fotos e
-- compatibilidades não deixavam rastro nenhum.
create table if not exists public.mercadolivre_outbound_touch (
  id bigserial primary key,
  empresa_id integer not null references public.empresa(id) on delete cascade,
  ml_item_id text not null,
  kind text not null check (kind in (
    'PRECO',
    'ESTOQUE',
    'ANUNCIO',
    'STATUS',
    'DESCRICAO',
    'FOTOS',
    'COMPATIBILIDADE',
    'PRECO_QUANTIDADE'
  )),
  -- Rota ou função que originou a escrita, só para auditoria.
  origin text,
  created_at timestamptz not null default now()
);

-- A consulta quente é sempre "houve toque neste item nos últimos N minutos?".
create index if not exists mercadolivre_outbound_touch_item_created_idx
  on public.mercadolivre_outbound_touch (ml_item_id, created_at desc);

create index if not exists mercadolivre_outbound_touch_created_idx
  on public.mercadolivre_outbound_touch (created_at);

alter table public.mercadolivre_outbound_touch enable row level security;
revoke all on table public.mercadolivre_outbound_touch from anon, authenticated;

-- Backfill que antes rodava a cada entrega de webhook, dentro de
-- `requeueSupportedIgnoredNotifications()`. Era correção pontual de um deploy
-- antigo e ficou no caminho quente; aqui ela roda uma vez e a função sai do código.
update public.mercadolivre_notification
   set status = 'RECEBIDA',
       error = null,
       next_retry_at = null,
       locked_at = null,
       processed_at = null
 where status = 'IGNORADA'
   and topic in ('user-products-families', 'stock-locations');
