begin;

-- Mantem apenas as unicidades que fazem parte da regra atual do projeto.
-- Telefone pode se repetir (ha registros assim no Demir), e a etiqueta global
-- ja e protegida pelos triggers compartilhados de estoque.
alter table public.cliente
  drop constraint if exists cliente_telefone_key;

alter table public.produto
  drop constraint if exists produto_etiqueta_key;

-- A migration original de auditoria declara esta validacao. Em bancos onde a
-- tabela ja existia, o CREATE TABLE IF NOT EXISTS nao chegou a cria-la.
alter table public.auditoria_evento
  drop constraint if exists auditoria_evento_fonte_check;

alter table public.auditoria_evento
  add constraint auditoria_evento_fonte_check
  check (fonte in ('evento', 'legado'));

-- Padroniza a FK da imagem com o mesmo nome e comportamento do baseline.
alter table public.imagemvistoria
  drop constraint if exists fk_imagem_vistoria_checklist,
  drop constraint if exists imagemvistoria_checklistid_fkey;

alter table public.imagemvistoria
  add constraint fk_imagem_vistoria_checklist
  foreign key (checklistid) references public.checklist(id);

-- Estas tabelas foram criadas sem cascata pela migration do modulo de pedidos.
alter table public.cliente_endereco
  drop constraint if exists cliente_endereco_cliente_id_fkey;

alter table public.cliente_endereco
  add constraint cliente_endereco_cliente_id_fkey
  foreign key (cliente_id) references public.cliente(id);

alter table public.favorito
  drop constraint if exists favorito_cliente_id_fkey;

alter table public.favorito
  add constraint favorito_cliente_id_fkey
  foreign key (cliente_id) references public.cliente(id);

alter table public.item_pedido
  drop constraint if exists item_pedido_pedido_id_fkey;

alter table public.item_pedido
  add constraint item_pedido_pedido_id_fkey
  foreign key (pedido_id) references public.pedido(id);

-- Transferencias sao historico; excluir um cliente nao deve apagar o registro.
alter table public.transferencias_veiculos
  drop constraint if exists transferencias_veiculos_dono_anteior_fkey,
  drop constraint if exists transferencias_veiculos_novo_dono_fkey;

alter table public.transferencias_veiculos
  add constraint transferencias_veiculos_dono_anteior_fkey
    foreign key (dono_anteior) references public.cliente(id),
  add constraint transferencias_veiculos_novo_dono_fkey
    foreign key (novo_dono) references public.cliente(id);

-- Tipos canonicos para aliquotas e valores monetarios.
alter table public.entradaitens
  alter column aliquota_pis type numeric(5,2)
    using aliquota_pis::numeric(5,2),
  alter column aliquota_cofins type numeric(5,2)
    using aliquota_cofins::numeric(5,2);

alter table public.item_pedido
  alter column preco_unitario type numeric(10,2)
    using preco_unitario::numeric(10,2);

alter table public.pedido
  alter column total type numeric(10,2)
    using total::numeric(10,2);

-- Indices presentes no Demir e na Demonstracao, mas ausentes no AlphaGarage.
create unique index if not exists uniq_checklist_os_item
  on public.checklist using btree (ordemservicoid, item);

create index if not exists cliente_user_id_idx
  on public.cliente using btree (user_id);

create index if not exists idx_venda_online_envio_rastreio
  on public.venda using btree (status, codigo_rastreio)
  where canal = 'ONLINE'::public.enum_canal_venda
    and codigo_rastreio is not null;

-- Publica o conjunto efetivamente acompanhado pelo projeto. A tabela pedido
-- estava publicada somente na Demonstracao e nao possui listener no codigo.
do $$
declare
  v_tabela text;
begin
  foreach v_tabela in array array[
    'nfse',
    'ordemservico',
    'osservico',
    'osservico_realizador',
    'produto',
    'transacao',
    'venda'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
      join pg_namespace n on n.oid = c.relnamespace
      where p.pubname = 'supabase_realtime'
        and n.nspname = 'public'
        and c.relname = v_tabela
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        v_tabela
      );
    end if;
  end loop;

  if exists (
    select 1
    from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname = 'supabase_realtime'
      and n.nspname = 'public'
      and c.relname = 'pedido'
  ) then
    alter publication supabase_realtime drop table public.pedido;
  end if;
end
$$;

-- O cliente Realtime usa somente a chave primaria de payload.old em DELETE.
alter table public.ordemservico replica identity default;

commit;
