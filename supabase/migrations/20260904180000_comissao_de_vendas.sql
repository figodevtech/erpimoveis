-- Comissão de venda: apuração persistida, despesa na DRE e lançamento no caixa.
-- Beneficiário e taxa: vendedor, com fallback para criador quando não informado.
-- Retroatividade autorizada: setembro de 2026. O histórico anterior
-- recebe um snapshot de leitura com a regra antiga, sem publicar novas despesas.
BEGIN;

CREATE TABLE public.venda_comissao (
  vendaid integer PRIMARY KEY REFERENCES public.venda(id) ON DELETE CASCADE,
  usuarioid uuid REFERENCES public.usuario(id),
  base numeric(14,2) NOT NULL CHECK (base >= 0),
  percentual numeric(7,4) NOT NULL CHECK (percentual BETWEEN 0 AND 100),
  valor_comissao numeric(14,2) NOT NULL CHECK (valor_comissao >= 0),
  integrada boolean NOT NULL DEFAULT true,
  congelada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.venda_comissao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venda_comissao FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venda_comissao TO service_role;
CREATE INDEX venda_comissao_usuario_idx ON public.venda_comissao(usuarioid, vendaid);
COMMENT ON TABLE public.venda_comissao IS
  'Uma comissão por venda, pois a taxa é única para todos os itens. Base líquida sem frete; valor, taxa e beneficiário persistidos. Integrada=false preserva o histórico anterior à implantação sem alterar sua DRE.';

-- Preserva exatamente a base e a taxa que os relatórios antigos liam. Nunca
-- deixa um relatório depender do cadastro atual para reconstruir este período.
INSERT INTO public.venda_comissao
  (vendaid, usuarioid, base, percentual, valor_comissao, integrada, congelada_em)
SELECT v.id, coalesce(v.vendedor, v.created_by),
       greatest(coalesce(v.valortotal,0)-coalesce(v.valor_frete,0),0),
       coalesce(v.comissao_venda_percent_aplicada,0),
       round(greatest(coalesce(v.valortotal,0)-coalesce(v.valor_frete,0),0)
             * coalesce(v.comissao_venda_percent_aplicada,0)/100,2),
       false, coalesce(v.pagamento_em,v.datavenda,v.createdat)
  FROM public.venda v
 WHERE coalesce(v.datavenda,v.createdat) <
       timestamptz '2026-09-01 00:00:00-03';

CREATE FUNCTION public.reconciliar_comissao_venda(p_vendaid bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE
  v_venda public.venda%ROWTYPE;
  v_snapshot public.venda_comissao%ROWTYPE;
  v_usuario uuid;
  v_pct numeric;
  v_base numeric;
  v_valor numeric;
  v_frete_itens numeric;
  v_reconhecida boolean;
  v_nome text;
BEGIN
  SELECT * INTO v_venda FROM public.venda WHERE id=p_vendaid FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_snapshot FROM public.venda_comissao WHERE vendaid=p_vendaid;
  IF FOUND AND NOT v_snapshot.integrada THEN RETURN; END IF;

  v_reconhecida := public.venda_reconhece_receita(v_venda.status::text);
  v_usuario := coalesce(v_venda.vendedor,v_venda.created_by);
  IF v_reconhecida AND v_snapshot.congelada_em IS NOT NULL THEN
    IF v_usuario IS DISTINCT FROM v_snapshot.usuarioid THEN
      RAISE EXCEPTION 'Reabra a venda antes de trocar o vendedor de uma comissão já apurada.' USING ERRCODE='P0001';
    END IF;
    v_pct := v_snapshot.percentual;
  ELSE
    SELECT coalesce(comissao_venda_percent,0) INTO v_pct FROM public.usuario WHERE id=v_usuario;
  END IF;
  v_pct := coalesce(v_pct,0);
  SELECT coalesce(sum(valor_frete),0) INTO v_frete_itens FROM public.vendaproduto WHERE venda_id=p_vendaid;
  v_base := round(greatest(coalesce(v_venda.valortotal,0)-coalesce(v_venda.valor_frete,0)-v_frete_itens,0),2);
  v_valor := round(v_base*v_pct/100,2);

  -- Uma comissão comprometida não pode ser cancelada, transferida ou alterada
  -- silenciosamente. A operação inteira (inclusive itens/estoque) é desfeita.
  PERFORM 1 FROM public.eventos_financeiros
   WHERE source_type='VENDA' AND source_id=p_vendaid AND origem='COMISSAO' FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.eventos_financeiros e
     WHERE e.source_type='VENDA' AND e.source_id=p_vendaid AND e.origem='COMISSAO'
       AND (e.status='CONVERTIDO' OR e.transacaoid IS NOT NULL OR e.lancamento_id IS NOT NULL)
       AND (NOT v_reconhecida OR e.valor IS DISTINCT FROM v_valor
            OR e.usuarioid IS DISTINCT FROM v_usuario)
  ) THEN
    RAISE EXCEPTION 'Desfaça o lançamento financeiro da comissão antes de alterar ou cancelar esta venda.' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.venda_comissao(vendaid,usuarioid,base,percentual,valor_comissao,congelada_em)
  VALUES(p_vendaid,v_usuario,v_base,v_pct,v_valor,
    CASE WHEN v_reconhecida THEN coalesce(v_snapshot.congelada_em,v_venda.pagamento_em,now()) END)
  ON CONFLICT(vendaid) DO UPDATE SET
    usuarioid=excluded.usuarioid,base=excluded.base,percentual=excluded.percentual,
    valor_comissao=excluded.valor_comissao,congelada_em=excluded.congelada_em,updated_at=now();

  IF NOT v_reconhecida THEN
    UPDATE public.eventos_financeiros SET status='CANCELADO',updated_at=now()
     WHERE source_type='VENDA' AND source_id=p_vendaid AND origem='COMISSAO' AND status='ATIVO' AND NOT is_manual;
    RETURN;
  END IF;
  SELECT coalesce(nullif(nome,''),'Vendedor') INTO v_nome FROM public.usuario WHERE id=v_usuario;
  INSERT INTO public.eventos_financeiros
    (source_type,source_id,origem,natureza,natureza_dre,chave_origem,descricao,detalhe,
     valor,usuarioid,valor_base_snapshot,percentual_snapshot,competencia_em,dados_snapshot,pode_gerar_transacao)
  VALUES ('VENDA',p_vendaid,'COMISSAO','DESPESA',public.natureza_dre_de_evento('COMISSAO','DESPESA'),
    'COMISSAO_VENDA','Comissão da venda #'||p_vendaid||' - '||coalesce(v_nome,'Sem vendedor'),
    'Base líquida sem frete: R$ '||v_base||' × '||v_pct||'%',v_valor,v_usuario,v_base,v_pct,
    coalesce(v_venda.datavenda,v_venda.createdat,now()),
    jsonb_build_object('vendaid',p_vendaid,'usuarioid',v_usuario,'base',v_base,'percentual',v_pct,'valor_comissao',v_valor),
    v_valor>0 AND v_usuario IS NOT NULL)
  ON CONFLICT(source_type,source_id,origem,chave_origem,natureza) WHERE ordemservicoid IS NULL
  DO UPDATE SET valor=excluded.valor,usuarioid=excluded.usuarioid,descricao=excluded.descricao,
    detalhe=excluded.detalhe,valor_base_snapshot=excluded.valor_base_snapshot,
    percentual_snapshot=excluded.percentual_snapshot,competencia_em=excluded.competencia_em,
    dados_snapshot=excluded.dados_snapshot,pode_gerar_transacao=excluded.pode_gerar_transacao,
    status='ATIVO',updated_at=now()
  WHERE eventos_financeiros.status<>'CONVERTIDO' AND NOT eventos_financeiros.is_manual;
END;
$function$;
REVOKE ALL ON FUNCTION public.reconciliar_comissao_venda(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconciliar_comissao_venda(bigint) TO service_role;

-- A fila mantém o vínculo da OS e acrescenta somente as comissões de vendas.
-- Colunas planas deixam lista, filtros, totais e seleção usar o mesmo recorte.
CREATE VIEW public.eventos_financeiros_fila WITH (security_invoker=true) AS
SELECT e.*, CASE WHEN o.id IS NOT NULL THEN 'OS' ELSE 'VENDA' END AS documento_tipo,
       coalesce(o.id,v.id) AS documento_id,coalesce(o.clienteid,v.clienteid) AS cliente_id,
       CASE WHEN o.id IS NOT NULL THEN jsonb_build_object('id',o.id,'status',o.status,'dataentrada',o.dataentrada,
         'cliente',jsonb_build_object('id',c.id,'nomerazaosocial',c.nomerazaosocial)) END AS ordem,
       CASE WHEN v.id IS NOT NULL THEN jsonb_build_object('id',v.id,'status',v.status,
         'cliente',jsonb_build_object('id',c.id,'nomerazaosocial',c.nomerazaosocial)) END AS venda
 FROM public.eventos_financeiros e
 LEFT JOIN public.ordemservico o ON o.id=e.ordemservicoid
 LEFT JOIN public.venda v ON e.source_type='VENDA' AND e.source_id=v.id AND e.origem='COMISSAO'
 LEFT JOIN public.cliente c ON c.id=coalesce(o.clienteid,v.clienteid)
 WHERE (o.id IS NOT NULL AND NOT o.is_deleted) OR (e.ordemservicoid IS NULL AND v.id IS NOT NULL);
REVOKE ALL ON public.eventos_financeiros_fila FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.eventos_financeiros_fila TO service_role;

-- As funções que publicam a venda e registram o pagamento são atualizadas abaixo.

CREATE FUNCTION public.tg_venda_comissao_responsavel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
BEGIN
  PERFORM public.reconciliar_comissao_venda(new.id);
  RETURN new;
END;
$function$;
CREATE TRIGGER trg_venda_comissao_responsavel AFTER UPDATE OF vendedor ON public.venda
FOR EACH ROW EXECUTE FUNCTION public.tg_venda_comissao_responsavel();

CREATE FUNCTION public.tg_venda_comissao_percentual()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
BEGIN
  SELECT coalesce(u.comissao_venda_percent,0) INTO new.comissao_venda_percent_aplicada
    FROM public.usuario u WHERE u.id=coalesce(new.vendedor,new.created_by);
  new.comissao_venda_percent_aplicada := coalesce(new.comissao_venda_percent_aplicada,0);
  RETURN new;
END;
$function$;
CREATE TRIGGER trg_venda_comissao_percentual BEFORE INSERT OR UPDATE OF vendedor ON public.venda
FOR EACH ROW EXECUTE FUNCTION public.tg_venda_comissao_percentual();

CREATE FUNCTION public.tg_venda_comissao_exclusao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
BEGIN
  PERFORM 1 FROM public.eventos_financeiros
   WHERE source_type='VENDA' AND source_id=old.id AND origem='COMISSAO' FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.eventos_financeiros
    WHERE source_type='VENDA' AND source_id=old.id AND origem='COMISSAO'
      AND (status='CONVERTIDO' OR transacaoid IS NOT NULL OR lancamento_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Desfaça o lançamento financeiro da comissão antes de excluir esta venda.' USING ERRCODE='P0001';
  END IF;
  RETURN old;
END;
$function$;
CREATE TRIGGER trg_venda_comissao_exclusao BEFORE DELETE ON public.venda
FOR EACH ROW EXECUTE FUNCTION public.tg_venda_comissao_exclusao();

CREATE OR REPLACE FUNCTION public.sincronizar_eventos_financeiros_venda(p_vendaid bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_venda public.venda%ROWTYPE;
  v_competencia timestamptz;
  v_desconto numeric(14,2);
  v_frete numeric(14,2);
begin
  perform public.reconciliar_comissao_venda(p_vendaid);
  select * into v_venda from public.venda where id = p_vendaid;
  if not found then return; end if;

  -- Venda que deixou de ser reconhecida (cancelada, revertida a orcamento):
  -- encerra os eventos em vez de apaga-los. CONVERTIDO e preservado — virou
  -- transacao e cabe ao financeiro estornar.
  if not public.venda_reconhece_receita(v_venda.status::text) then
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'VENDA' and source_id = p_vendaid and status = 'ATIVO';
    return;
  end if;

  v_competencia := coalesce(v_venda.datavenda, v_venda.createdat, now());

  -- Receita bruta por item, pelo valor de tabela.
  insert into public.eventos_financeiros
    (ordemservicoid, source_type, source_id, source_item_id, origem, natureza, natureza_dre,
     chave_origem, descricao, detalhe, valor, produtoid, quantidade_snapshot,
     valor_unitario_snapshot, competencia_em, dados_snapshot, pode_gerar_transacao)
  select null, 'VENDA', p_vendaid, vp.id, 'PRODUTO', 'RECEITA', 'RECEITA',
         vp.produtoid::text,
         'Venda - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || vp.produtoid),
         vp.quantidade || ' unidade(s)',
         round(coalesce(vp.sub_total, 0), 2),
         vp.produtoid, vp.quantidade,
         case when coalesce(vp.quantidade, 0) > 0
              then round(coalesce(vp.sub_total, 0) / vp.quantidade, 4) else 0 end,
         v_competencia,
         jsonb_build_object('venda_item_id', vp.id, 'valor_liquido_item', vp.valor_total),
         false
    from public.vendaproduto vp
    join public.produto p on p.id = vp.produtoid
   where vp.venda_id = p_vendaid
  on conflict (source_type, source_id, origem, chave_origem, natureza)
    where ordemservicoid is null
  do update set valor = excluded.valor,
                descricao = excluded.descricao,
                detalhe = excluded.detalhe,
                quantidade_snapshot = excluded.quantidade_snapshot,
                valor_unitario_snapshot = excluded.valor_unitario_snapshot,
                competencia_em = excluded.competencia_em,
                dados_snapshot = excluded.dados_snapshot,
                status = 'ATIVO',
                updated_at = now()
  where public.eventos_financeiros.status <> 'CONVERTIDO';

  -- Custo da mercadoria vendida, pelo custo congelado na venda.
  insert into public.eventos_financeiros
    (ordemservicoid, source_type, source_id, source_item_id, origem, natureza, natureza_dre,
     chave_origem, descricao, detalhe, valor, produtoid, quantidade_snapshot,
     valor_unitario_snapshot, competencia_em, dados_snapshot, pode_gerar_transacao)
  select null, 'VENDA', p_vendaid, vp.id, 'PRODUTO', 'DESPESA', 'CUSTO',
         vp.produtoid::text,
         'Custo - ' || coalesce(nullif(p.titulo, ''), nullif(p.descricao, ''), 'Produto #' || vp.produtoid),
         case when coalesce(vp.custo_unitario_aplicado, 0) = 0
              then 'Custo nao informado — margem superestimada'
              else 'Custo registrado na venda' end,
         round(coalesce(vp.custo_unitario_aplicado, 0) * coalesce(vp.quantidade, 0), 2),
         vp.produtoid, vp.quantidade, coalesce(vp.custo_unitario_aplicado, 0),
         v_competencia,
         -- Zero conta como nao informado: tratar isso como custo real produziria
         -- 100% de margem em produto. A tela de pendencias usa esta flag.
         jsonb_build_object('custo_nao_informado', coalesce(vp.custo_unitario_aplicado, 0) = 0),
         false
    from public.vendaproduto vp
    join public.produto p on p.id = vp.produtoid
   where vp.venda_id = p_vendaid
  on conflict (source_type, source_id, origem, chave_origem, natureza)
    where ordemservicoid is null
  do update set valor = excluded.valor,
                descricao = excluded.descricao,
                detalhe = excluded.detalhe,
                quantidade_snapshot = excluded.quantidade_snapshot,
                valor_unitario_snapshot = excluded.valor_unitario_snapshot,
                competencia_em = excluded.competencia_em,
                dados_snapshot = excluded.dados_snapshot,
                status = 'ATIVO',
                updated_at = now()
  where public.eventos_financeiros.status <> 'CONVERTIDO';

  -- Item que saiu da venda: encerra o evento em vez de deixa-lo para sempre.
  -- Os dois upserts acima so alcancam o que existe hoje; sem isto, remover um
  -- item da venda mantinha a receita e o custo dele no livro. CONVERTIDO fica —
  -- virou transacao e cabe ao financeiro estornar.
  update public.eventos_financeiros e
     set status = 'CANCELADO', updated_at = now()
   where e.source_type = 'VENDA'
     and e.source_id = p_vendaid
     and e.origem = 'PRODUTO'
     and e.status = 'ATIVO'
     and not exists (
       select 1 from public.vendaproduto vp
        where vp.venda_id = p_vendaid
          and vp.produtoid::text = e.chave_origem);

  -- Frete: receita da atividade, igual ao lado da OS. Soma o cobrado na venda
  -- com o atribuido item a item — sao campos distintos e podem coexistir.
  -- Sem isto, `bruto - desconto` da o total da venda MENOS o frete, e o que o
  -- cliente pagou de frete nao existe em lugar nenhum do livro.
  select round(coalesce(sum(coalesce(vp.valor_frete, 0)), 0), 2)
    into v_frete
    from public.vendaproduto vp
   where vp.venda_id = p_vendaid;

  v_frete := v_frete + round(coalesce(v_venda.valor_frete, 0), 2);

  if v_frete > 0 then
    insert into public.eventos_financeiros
      (ordemservicoid, source_type, source_id, origem, natureza, natureza_dre,
       chave_origem, descricao, detalhe, valor, competencia_em, dados_snapshot, pode_gerar_transacao)
    values
      (null, 'VENDA', p_vendaid, 'FRETE', 'RECEITA',
       public.natureza_dre_de_evento('FRETE', 'RECEITA'),
       'FRETE', 'Frete - venda #' || p_vendaid,
       'Receita de frete da venda', v_frete, v_competencia,
       jsonb_build_object('frete_venda', round(coalesce(v_venda.valor_frete, 0), 2),
                          'frete_itens', v_frete - round(coalesce(v_venda.valor_frete, 0), 2)),
       false)
    on conflict (source_type, source_id, origem, chave_origem, natureza)
      where ordemservicoid is null
    do update set valor = excluded.valor,
                  natureza_dre = excluded.natureza_dre,
                  competencia_em = excluded.competencia_em,
                  dados_snapshot = excluded.dados_snapshot,
                  status = 'ATIVO',
                  updated_at = now()
    where public.eventos_financeiros.status <> 'CONVERTIDO';
  else
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'VENDA' and source_id = p_vendaid
       and origem = 'FRETE' and status = 'ATIVO';
  end if;

  -- Desconto: soma o concedido item a item com o concedido na venda.
  select round(coalesce(sum(coalesce(vp.valor_desconto, 0)), 0), 2)
    into v_desconto
    from public.vendaproduto vp
   where vp.venda_id = p_vendaid;

  v_desconto := v_desconto + round(coalesce(v_venda.desconto_valor, 0), 2);

  if v_desconto > 0 then
    insert into public.eventos_financeiros
      (ordemservicoid, source_type, source_id, origem, natureza, natureza_dre,
       chave_origem, descricao, detalhe, valor, competencia_em, dados_snapshot, pode_gerar_transacao)
    values
      (null, 'VENDA', p_vendaid, 'DESCONTO', 'DESPESA', 'DEDUCAO',
       'DESCONTO', 'Desconto concedido - venda #' || p_vendaid,
       'Deducao da receita bruta', v_desconto, v_competencia,
       jsonb_build_object('desconto_venda', v_venda.desconto_valor), false)
    on conflict (source_type, source_id, origem, chave_origem, natureza)
      where ordemservicoid is null
    do update set valor = excluded.valor,
                  competencia_em = excluded.competencia_em,
                  dados_snapshot = excluded.dados_snapshot,
                  status = 'ATIVO',
                  updated_at = now()
    where public.eventos_financeiros.status <> 'CONVERTIDO';
  else
    update public.eventos_financeiros
       set status = 'CANCELADO', updated_at = now()
     where source_type = 'VENDA' and source_id = p_vendaid
       and origem = 'DESCONTO' and status = 'ATIVO';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_lancamento_de_eventos(p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_os_id integer := nullif(p_payload->>'ordemservicoid', '')::integer;
  v_created_by uuid := nullif(p_payload->>'created_by', '')::uuid;
  v_pendente boolean := coalesce((p_payload->>'pendente')::boolean, true);
  v_data timestamptz := coalesce(nullif(p_payload->>'data', '')::timestamptz, now());
  v_metodo public.metodo_pagamento := nullif(p_payload->>'metodopagamento', '')::public.metodo_pagamento;
  v_categoria text := coalesce(nullif(p_payload->>'categoria', ''), 'NAO RELACIONADO');
  v_categoria_id integer := nullif(p_payload->>'categoria_id', '')::integer;
  v_plano_id integer := nullif(p_payload->>'plano_de_conta_id', '')::integer;
  v_centro_id integer := nullif(p_payload->>'centro_custo_id', '')::integer;
  v_fornecedor_id integer := nullif(p_payload->>'fornecedor_id', '')::integer;
  v_banco_id bigint := nullif(p_payload->>'banco_id', '')::bigint;
  v_nome text := coalesce(nullif(btrim(p_payload->>'nomepagador'), ''), 'Despesa interna');
  v_cpfcnpj text := coalesce(nullif(btrim(p_payload->>'cpfcnpjpagador'), ''), 'NAO INFORMADO');
  v_ids bigint[];
  v_os_ids integer[];
  v_qtd_os integer;
  v_qtd_vendas integer;
  v_os_efetiva integer;
  v_qtd integer;
  v_soma_eventos numeric(14,2);
  v_soma_linhas numeric(14,2);
  v_maus text;
  v_grupo_id bigint;
  v_descricao_grupo text;
  v_descricao text;
  v_total_parcelas integer;
  v_parcela record;
BEGIN
  IF jsonb_typeof(p_payload->'eventos_ids') <> 'array'
     OR jsonb_array_length(p_payload->'eventos_ids') = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma despesa para lancar.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_payload->'linhas') <> 'array'
     OR jsonb_array_length(p_payload->'linhas') = 0 THEN
    RAISE EXCEPTION 'Informe as parcelas do lancamento.' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT item::text::bigint)
    INTO v_ids
    FROM jsonb_array_elements(p_payload->'eventos_ids') AS item;

  -- Trava todas as despesas ate o fim desta transacao: duas telas lancando
  -- grupos que dividem uma despesa serializam aqui, e a segunda encontra o
  -- vinculo ja preenchido.
  PERFORM 1 FROM public.eventos_financeiros WHERE id = ANY (v_ids) FOR UPDATE;

  SELECT count(*), round(coalesce(sum(e.valor), 0), 2)
    INTO v_qtd, v_soma_eventos
    FROM public.eventos_financeiros e WHERE e.id = ANY (v_ids);

  IF v_qtd <> coalesce(array_length(v_ids, 1), 0) THEN
    RAISE EXCEPTION 'Uma ou mais despesas selecionadas nao existem mais.' USING ERRCODE = 'P0002';
  END IF;

  SELECT string_agg(e.id::text, ', ' ORDER BY e.id) INTO v_maus
    FROM public.eventos_financeiros e
   WHERE e.id = ANY (v_ids)
     AND (e.status <> 'ATIVO' OR e.transacaoid IS NOT NULL OR e.lancamento_id IS NOT NULL);
  IF v_maus IS NOT NULL THEN
    RAISE EXCEPTION 'Despesa(s) % ja foi(ram) lancada(s) no financeiro ou cancelada(s).', v_maus
      USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg(e.id::text, ', ' ORDER BY e.id) INTO v_maus
    FROM public.eventos_financeiros e
   WHERE e.id = ANY (v_ids) AND NOT e.pode_gerar_transacao;
  IF v_maus IS NOT NULL THEN
    RAISE EXCEPTION 'Despesa(s) % e(sao) lancamento(s) automatico(s) e nao gera(m) transacao.', v_maus
      USING ERRCODE = 'P0001';
  END IF;

  SELECT string_agg(e.id::text, ', ' ORDER BY e.id) INTO v_maus
    FROM public.eventos_financeiros e
   WHERE e.id = ANY (v_ids) AND e.natureza <> 'DESPESA';
  IF v_maus IS NOT NULL THEN
    RAISE EXCEPTION 'Lancamento(s) % nao e(sao) despesa.', v_maus USING ERRCODE = 'P0001';
  END IF;

  -- Além de OS, aceita comissão de venda com documento existente.
  -- Entradas e transações avulsas continuam fora deste caminho.
  SELECT string_agg(e.id::text, ', ' ORDER BY e.id) INTO v_maus
    FROM public.eventos_financeiros e
   WHERE e.id = ANY (v_ids) AND e.ordemservicoid IS NULL
     AND NOT (e.source_type IS NOT DISTINCT FROM 'VENDA' AND e.origem = 'COMISSAO'
              AND EXISTS (SELECT 1 FROM public.venda v WHERE v.id = e.source_id));
  IF v_maus IS NOT NULL THEN
    RAISE EXCEPTION 'Despesa(s) % nao pertence(m) a uma OS ou comissao de venda.', v_maus
      USING ERRCODE = 'P0001';
  END IF;

  -- Quem informa a OS continua preso a ela. E o caminho do painel da propria OS,
  -- que sabe de qual ordem esta falando; afrouxar ali so esconderia um engano.
  IF v_os_id IS NOT NULL THEN
    SELECT string_agg(e.id::text, ', ' ORDER BY e.id) INTO v_maus
      FROM public.eventos_financeiros e
     WHERE e.id = ANY (v_ids) AND e.ordemservicoid IS DISTINCT FROM v_os_id;
    IF v_maus IS NOT NULL THEN
      RAISE EXCEPTION 'Despesa(s) % nao pertence(m) a esta OS.', v_maus USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT array_agg(DISTINCT e.ordemservicoid) FILTER (WHERE e.ordemservicoid IS NOT NULL),
         count(DISTINCT e.source_id) FILTER (WHERE e.source_type = 'VENDA' AND e.ordemservicoid IS NULL)
    INTO v_os_ids, v_qtd_vendas
    FROM public.eventos_financeiros e WHERE e.id = ANY (v_ids);

  v_qtd_os := coalesce(array_length(v_os_ids, 1), 0);
  -- Uma OS so: grupo e parcelas ficam carimbados com ela, como sempre foram.
  -- Varias: nao ha resposta unica, e inventar uma seria pior que a ausencia.
  v_os_efetiva := CASE WHEN v_qtd_os = 1 AND v_qtd_vendas = 0 THEN v_os_ids[1] ELSE NULL END;

  SELECT round(coalesce(sum((item->>'valor')::numeric), 0), 2)
    INTO v_soma_linhas
    FROM jsonb_array_elements(p_payload->'linhas') AS item;

  IF v_soma_linhas <> v_soma_eventos THEN
    RAISE EXCEPTION 'A soma das parcelas (%) difere da soma das despesas selecionadas (%).',
      v_soma_linhas, v_soma_eventos USING ERRCODE = 'P0001';
  END IF;

  v_descricao_grupo := coalesce(
    nullif(btrim(p_payload->>'descricao'), ''),
    CASE WHEN v_os_efetiva IS NOT NULL
      THEN 'Despesas da OS #' || v_os_efetiva
      WHEN v_qtd_os = 0 THEN 'Comissões de ' || v_qtd_vendas || ' venda(s)'
      ELSE 'Despesas de ' || v_qtd_os || ' OS e ' || v_qtd_vendas || ' venda(s)'
    END);

  INSERT INTO public.lancamento_de_eventos (ordemservicoid, descricao, created_by)
  VALUES (v_os_efetiva, v_descricao_grupo, v_created_by)
  RETURNING id INTO v_grupo_id;

  SELECT max((item->>'total_parcelas')::integer) INTO v_total_parcelas
    FROM jsonb_array_elements(p_payload->'linhas') AS item;
  v_total_parcelas := greatest(coalesce(v_total_parcelas, 1), 1);

  FOR v_parcela IN
    SELECT (item->>'parcela')::integer AS numero,
           round((item->>'valor')::numeric, 2) AS valor,
           round(coalesce((item->>'valor_liquido')::numeric,
                          (item->>'valor')::numeric), 2) AS valor_liquido,
           nullif(item->>'vencimento_em', '') AS vencimento
      FROM jsonb_array_elements(p_payload->'linhas') AS item
     ORDER BY 1
  LOOP
    v_descricao := v_descricao_grupo;
    IF v_total_parcelas > 1 THEN
      v_descricao := v_descricao || ' - Parcela ' || v_parcela.numero || '/' || v_total_parcelas;
    END IF;

    INSERT INTO public.transacao (
      descricao, valor, "valorLiquido", data, vencimento_em, metodopagamento,
      categoria, categoria_id, plano_de_conta_id, centro_custo_id, tipo,
      fornecedor_id, banco_id, nomepagador, cpfcnpjpagador, pendente, pago_em,
      ordemservicoid, lancamento_id, created_by, baixado_por
    ) VALUES (
      v_descricao,
      v_parcela.valor,
      v_parcela.valor_liquido,
      coalesce(v_parcela.vencimento::timestamptz, v_data),
      v_parcela.vencimento::timestamptz,
      v_metodo, v_categoria, v_categoria_id, v_plano_id, v_centro_id,
      'DESPESA'::public.tipos_transacao,
      v_fornecedor_id,
      CASE WHEN v_pendente THEN NULL ELSE v_banco_id END,
      v_nome, v_cpfcnpj,
      v_pendente,
      CASE WHEN v_pendente THEN NULL ELSE v_data END,
      v_os_efetiva, v_grupo_id, v_created_by,
      CASE WHEN v_pendente THEN NULL ELSE v_created_by END
    );
  END LOOP;

  UPDATE public.eventos_financeiros
     SET status = 'CONVERTIDO', lancamento_id = v_grupo_id, updated_at = now()
   WHERE id = ANY (v_ids);

  RETURN v_grupo_id;
END;
$function$;

-- Apura a partir de setembro de 2026; não reprocessa receitas/custos antigos.
DO $backfill$
DECLARE v_id integer;
BEGIN
  FOR v_id IN SELECT id FROM public.venda ORDER BY id LOOP
    PERFORM public.reconciliar_comissao_venda(v_id);
  END LOOP;
END;
$backfill$;
NOTIFY pgrst, 'reload schema';
COMMIT;
