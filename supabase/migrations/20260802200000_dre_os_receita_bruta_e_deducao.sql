-- DRE — elimina a assimetria entre OS e venda no registro de desconto.
--
-- ANTES
-- Venda (migration 190000) registrava receita bruta pelo valor de tabela e o
-- desconto como DEDUCAO na linha 2.5. OS registrava receita ja liquida,
-- multiplicando cada item pelo `fator` (orcamentototal / soma dos itens).
--
-- Resultado: a linha 2.5 da DRE mostrava apenas descontos de venda, e o desconto
-- concedido em ordem de servico desaparecia dentro da receita. Duas origens, dois
-- criterios, um relatorio — a receita bruta nao era comparavel entre elas.
--
-- AGORA
-- OS tambem registra receita bruta (precounitario x quantidade, valor de tabela)
-- e um evento DESCONTO/DEDUCAO com a diferenca ate o `orcamentototal`. Esse
-- unico numero captura tanto o desconto dado item a item quanto o dado no total
-- da ordem, porque parte do valor de tabela e chega ao total fechado.
--
-- A receita liquida nao muda: bruto menos deducao continua dando exatamente o
-- `orcamentototal`. O que muda e a visibilidade — passa a ser possivel ver
-- quanto a oficina concede em desconto.
--
-- O QUE NAO MUDA
-- A base da comissao. `recalcular_comissao_osservico` continua aplicando o fator
-- para calcular sobre o liquido (decisao registrada na migration 140000). Como a
-- comissao e paga, e nao apresentada, ela nao segue a mudanca de exibicao.
--
-- OS de cortesia (100% de desconto) passa a mostrar receita bruta e deducao de
-- mesmo valor, em vez de receita zero. A receita liquida continua zero — mas
-- agora o relatorio revela que o servico foi prestado e integralmente
-- descontado, em vez de fazer a operacao desaparecer.
BEGIN;

CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_os(
  p_ordemservicoid integer,
  p_incluir_comissoes boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_total_os numeric := 0;
  v_bruto numeric := 0;
  v_deducao numeric := 0;
begin
  select coalesce(o.orcamentototal, 0),
         coalesce((select sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                     from public.osproduto op where op.ordemservicoid = o.id), 0)
           + coalesce((select sum(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0))
                     from public.osservico os where os.ordemservicoid = o.id), 0)
    into v_total_os, v_bruto
  from public.ordemservico o
  where o.id = p_ordemservicoid;

  if not found then return; end if;

  insert into public.eventos_financeiros
    (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
     produtoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  select p_ordemservicoid, 'PRODUTO', 'RECEITA', op.produtoid::text,
         'Venda - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         op.quantidade || ' unidade(s)',
         round(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, op.quantidade, op.precounitario,
         jsonb_build_object('subtotal', op.subtotal, 'bruto', round(coalesce(op.precounitario,0) * coalesce(op.quantidade,0), 2))
  from public.osproduto op join public.produto p on p.id = op.produtoid
  where op.ordemservicoid = p_ordemservicoid
  on conflict (ordemservicoid, origem, chave_origem, natureza) do nothing;

  insert into public.eventos_financeiros
    (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
     produtoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  select p_ordemservicoid, 'PRODUTO', 'DESPESA', op.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         case when op.custo_unitario_aplicado is null then 'Ultimo valor de compra no momento da aprovacao' else 'Custo registrado na OS' end,
         round(coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, op.quantidade, coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0),
         jsonb_build_object('custo_nao_informado',
           coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0) = 0)
  from public.osproduto op join public.produto p on p.id = op.produtoid
  where op.ordemservicoid = p_ordemservicoid
  on conflict (ordemservicoid, origem, chave_origem, natureza) do nothing;

  insert into public.eventos_financeiros
    (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
     servicoid, quantidade_snapshot, valor_unitario_snapshot, dados_snapshot)
  select p_ordemservicoid, 'SERVICO', 'RECEITA', os.servicoid::text,
         'Servico - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || os.servicoid),
         os.quantidade || ' unidade(s)',
         round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2),
         os.servicoid, os.quantidade, os.precounitario,
         jsonb_build_object('subtotal', os.subtotal, 'bruto', round(coalesce(os.precounitario,0) * coalesce(os.quantidade,0), 2))
  from public.osservico os join public.servico s on s.id = os.servicoid
  where os.ordemservicoid = p_ordemservicoid
  on conflict (ordemservicoid, origem, chave_origem, natureza) do nothing;

  -- Desconto: diferenca entre o valor de tabela e o total fechado da OS.
  v_deducao := round(greatest(v_bruto - v_total_os, 0), 2);

  if v_deducao > 0 then
    insert into public.eventos_financeiros
      (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor, dados_snapshot)
    values
      (p_ordemservicoid, 'DESCONTO', 'DESPESA', 'DESCONTO',
       'Desconto concedido - OS #' || p_ordemservicoid, 'Deducao da receita bruta',
       v_deducao, jsonb_build_object('bruto', v_bruto, 'total_os', v_total_os))
    on conflict (ordemservicoid, origem, chave_origem, natureza) do nothing;
  end if;

  if p_incluir_comissoes then
    insert into public.eventos_financeiros
      (ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
       servicoid, usuarioid, percentual_snapshot, valor_base_snapshot, dados_snapshot, pode_gerar_transacao)
    select p_ordemservicoid, 'COMISSAO', 'DESPESA', r.servicoid || ':' || r.usuarioid,
           'Comissao - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || r.servicoid),
           coalesce(u.nome, 'Realizador'), coalesce(r.valor_comissao, 0),
           r.servicoid, r.usuarioid, r.comissao_percent_aplicada, r.valor_base,
           jsonb_build_object('realizador_nome', u.nome), true
    from public.osservico_realizador r
    join public.osservico os on os.ordemservicoid = r.ordemservicoid and os.servicoid = r.servicoid
    join public.servico s on s.id = r.servicoid
    left join public.usuario u on u.id = r.usuarioid
    where r.ordemservicoid = p_ordemservicoid
      and s.gera_comissao
    on conflict (ordemservicoid, origem, chave_origem, natureza) do nothing;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reconciliar_eventos_financeiros_os(
  p_ordemservicoid integer,
  p_incluir_comissoes boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_total_os numeric := 0;
  v_bruto numeric := 0;
  v_deducao numeric := 0;
begin
  select coalesce(o.orcamentototal, 0),
         coalesce((select sum(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0))
                     from public.osproduto op where op.ordemservicoid = o.id), 0)
           + coalesce((select sum(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0))
                     from public.osservico os where os.ordemservicoid = o.id), 0)
    into v_total_os, v_bruto
  from public.ordemservico o
  where o.id = p_ordemservicoid;

  if not found then raise exception 'OS nao encontrada.'; end if;

  create temporary table if not exists pg_temp.eventos_os_desejados (
    origem text not null,
    natureza text not null,
    chave_origem text not null,
    descricao text not null,
    detalhe text,
    valor numeric(14,2) not null,
    produtoid integer,
    servicoid integer,
    usuarioid uuid,
    quantidade_snapshot numeric(14,4),
    valor_unitario_snapshot numeric(14,4),
    percentual_snapshot numeric(8,4),
    valor_base_snapshot numeric(14,2),
    dados_snapshot jsonb not null,
    pode_gerar_transacao boolean not null,
    primary key (origem, natureza, chave_origem)
  ) on commit drop;
  truncate pg_temp.eventos_os_desejados;

  insert into pg_temp.eventos_os_desejados
  select 'PRODUTO', 'RECEITA', op.produtoid::text,
         'Venda - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         op.quantidade || ' unidade(s)',
         round(coalesce(op.precounitario, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, null, null, op.quantidade, op.precounitario, null, null,
         jsonb_build_object('subtotal', op.subtotal), false
  from public.osproduto op join public.produto p on p.id = op.produtoid
  where op.ordemservicoid = p_ordemservicoid;

  insert into pg_temp.eventos_os_desejados
  select 'PRODUTO', 'DESPESA', op.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || op.produtoid),
         case when op.custo_unitario_aplicado is null then 'Ultimo valor de compra no momento da reconciliacao' else 'Custo registrado na OS' end,
         round(coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0) * coalesce(op.quantidade, 0), 2),
         op.produtoid, null, null, op.quantidade,
         coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0), null, null,
         jsonb_build_object('custo_nao_informado',
           coalesce(op.custo_unitario_aplicado, p.ultimovalordecompra, 0) = 0), false
  from public.osproduto op join public.produto p on p.id = op.produtoid
  where op.ordemservicoid = p_ordemservicoid;

  insert into pg_temp.eventos_os_desejados
  select 'SERVICO', 'RECEITA', os.servicoid::text,
         'Servico - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || os.servicoid),
         os.quantidade || ' unidade(s)',
         round(coalesce(os.precounitario, 0) * coalesce(os.quantidade, 0), 2),
         null, os.servicoid, null, os.quantidade, os.precounitario, null, null,
         jsonb_build_object('subtotal', os.subtotal), false
  from public.osservico os join public.servico s on s.id = os.servicoid
  where os.ordemservicoid = p_ordemservicoid;

  v_deducao := round(greatest(v_bruto - v_total_os, 0), 2);

  if v_deducao > 0 then
    insert into pg_temp.eventos_os_desejados
    values ('DESCONTO', 'DESPESA', 'DESCONTO',
            'Desconto concedido - OS #' || p_ordemservicoid, 'Deducao da receita bruta',
            v_deducao, null, null, null, null, null, null, null,
            jsonb_build_object('bruto', v_bruto, 'total_os', v_total_os), false);
  end if;

  if p_incluir_comissoes then
    insert into pg_temp.eventos_os_desejados
    select 'COMISSAO', 'DESPESA', r.servicoid || ':' || r.usuarioid,
           'Comissao - ' || coalesce(nullif(os.descricao, ''), nullif(s.descricao, ''), 'Servico #' || r.servicoid),
           coalesce(u.nome, 'Realizador'),
           coalesce(r.valor_comissao, 0),
           null, r.servicoid, r.usuarioid, null, null, r.comissao_percent_aplicada, r.valor_base,
           jsonb_build_object('realizador_nome', u.nome), true
    from public.osservico_realizador r
    join public.osservico os on os.ordemservicoid = r.ordemservicoid and os.servicoid = r.servicoid
    join public.servico s on s.id = r.servicoid
    left join public.usuario u on u.id = r.usuarioid
    where r.ordemservicoid = p_ordemservicoid
      and s.gera_comissao;
  end if;

  if exists (
    select 1
    from public.eventos_financeiros e
    left join pg_temp.eventos_os_desejados d
      on d.origem = e.origem and d.natureza = e.natureza and d.chave_origem = e.chave_origem
    where e.ordemservicoid = p_ordemservicoid
      and e.origem <> 'AVULSO'
      and e.status = 'CONVERTIDO'
      and (d.chave_origem is null or e.valor <> d.valor)
  ) then
    raise exception 'Existem eventos convertidos divergentes. Exclua as transacoes vinculadas antes de alterar o orcamento.';
  end if;

  insert into public.eventos_financeiros (
    ordemservicoid, origem, natureza, chave_origem, descricao, detalhe, valor,
    produtoid, servicoid, usuarioid, quantidade_snapshot, valor_unitario_snapshot,
    percentual_snapshot, valor_base_snapshot, dados_snapshot, pode_gerar_transacao, status, updated_at
  )
  select p_ordemservicoid, d.origem, d.natureza, d.chave_origem, d.descricao, d.detalhe, d.valor,
         d.produtoid, d.servicoid, d.usuarioid, d.quantidade_snapshot, d.valor_unitario_snapshot,
         d.percentual_snapshot, d.valor_base_snapshot, d.dados_snapshot, d.pode_gerar_transacao, 'ATIVO', now()
  from pg_temp.eventos_os_desejados d
  on conflict (ordemservicoid, origem, chave_origem, natureza) do update set
    descricao = excluded.descricao, detalhe = excluded.detalhe, valor = excluded.valor,
    produtoid = excluded.produtoid, servicoid = excluded.servicoid, usuarioid = excluded.usuarioid,
    quantidade_snapshot = excluded.quantidade_snapshot,
    valor_unitario_snapshot = excluded.valor_unitario_snapshot,
    percentual_snapshot = excluded.percentual_snapshot,
    valor_base_snapshot = excluded.valor_base_snapshot,
    dados_snapshot = excluded.dados_snapshot,
    pode_gerar_transacao = excluded.pode_gerar_transacao,
    status = 'ATIVO', updated_at = now()
  where eventos_financeiros.status <> 'CONVERTIDO';

  update public.eventos_financeiros e
     set status = 'CANCELADO', updated_at = now()
   where e.ordemservicoid = p_ordemservicoid
     and e.origem <> 'AVULSO'
     and e.status <> 'CONVERTIDO'
     and not exists (
       select 1 from pg_temp.eventos_os_desejados d
       where d.origem = e.origem and d.natureza = e.natureza and d.chave_origem = e.chave_origem
     );
end;
$function$;

-- Classifica o desconto de OS na mesma linha do desconto de venda.
UPDATE public.eventos_financeiros
   SET natureza_dre = 'DEDUCAO'
 WHERE origem = 'DESCONTO' AND natureza_dre IS DISTINCT FROM 'DEDUCAO';

WITH t AS (SELECT id FROM public.dre_template WHERE codigo = 'PADRAO' AND versao = 1)
INSERT INTO public.dre_mapeamento (template_id, linha_id, origem_tipo, origem_valor, percentual, observacao)
SELECT t.id, dl.id, 'EVENTO_ORIGEM', 'DESCONTO:DESPESA', 100, 'Desconto concedido em OS e venda.'
  FROM t JOIN public.dre_linha dl ON dl.template_id = t.id AND dl.codigo = '2.5'
 WHERE NOT EXISTS (
   SELECT 1 FROM public.dre_mapeamento x
    WHERE x.template_id = t.id AND x.origem_tipo = 'EVENTO_ORIGEM'
      AND x.origem_valor = 'DESCONTO:DESPESA'
 );

COMMIT;
