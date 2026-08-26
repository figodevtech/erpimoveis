-- Terceiro estoque: Geral/Avulso.
--
-- O ERP tinha dois estoques: o de produtos de venda (`produto`, consumido por
-- venda e OS) e o de uso e consumo (`usoconsumo_*`, so entrada e saida). Entra um
-- terceiro, Geral/Avulso, funcionalmente identico ao de uso e consumo: mesmo
-- cadastro, mesmo bloco fiscal, mesmo fluxo de entrada/saida/inventario, mesmas
-- etiquetas, mesma NF-e avulsa. So os saldos sao independentes.
--
-- POR QUE UMA COLUNA E NAO TABELAS NOVAS
-- `transacao.usoconsumo_entrada_id` e `fiscal_dfe_item_apropriacao.usoconsumo_entrada_id`
-- ja apontam para `usoconsumo_entrada`. Duplicar as tabelas exigiria uma segunda FK
-- em `transacao` e a propagacao dela por DRE, fluxo de caixa, competencia,
-- reparcelamento, baixa parcial e entrada fiscal mista. Com `escopo`, o financeiro
-- nao muda uma linha e o `sourceItemId = 'usoconsumo:{id}'` da NF-e avulsa continua
-- valido, porque o espaco de ids e o mesmo.
--
-- O QUE CONTINUA COMPARTILHADO (decisao de negocio)
-- Grupos (`usoconsumo_grupo`), tipos de entrada, motivos de saida e as permissoes
-- `usoconsumo:*` valem para os dois estoques. Nenhuma permissao nova e criada e
-- nenhum CHECK de escopo de `tipos_entrada`/`tipos_motivo_saida` e alterado.
--
-- ETIQUETA E CODIGO DE BARRAS seguem unicos na tabela inteira, de proposito: o
-- indice `usoconsumo_item_etiqueta_uk` e o trigger global de 20260729143000 ficam
-- intactos, e uma etiqueta lida nunca fica ambigua entre os tres estoques.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Coluna de escopo
--
-- O DEFAULT faz o backfill das linhas existentes e e mantido de proposito:
-- qualquer chamada antiga que nao informe escopo continua caindo em uso e consumo.
-- ---------------------------------------------------------------------------

ALTER TABLE public.usoconsumo_item
  ADD COLUMN IF NOT EXISTS escopo text NOT NULL DEFAULT 'USOCONSUMO';
ALTER TABLE public.usoconsumo_entrada
  ADD COLUMN IF NOT EXISTS escopo text NOT NULL DEFAULT 'USOCONSUMO';
ALTER TABLE public.usoconsumo_saida
  ADD COLUMN IF NOT EXISTS escopo text NOT NULL DEFAULT 'USOCONSUMO';

ALTER TABLE public.usoconsumo_item DROP CONSTRAINT IF EXISTS usoconsumo_item_escopo_check;
ALTER TABLE public.usoconsumo_item
  ADD CONSTRAINT usoconsumo_item_escopo_check CHECK (escopo IN ('USOCONSUMO', 'GERAL'));

ALTER TABLE public.usoconsumo_entrada DROP CONSTRAINT IF EXISTS usoconsumo_entrada_escopo_check;
ALTER TABLE public.usoconsumo_entrada
  ADD CONSTRAINT usoconsumo_entrada_escopo_check CHECK (escopo IN ('USOCONSUMO', 'GERAL'));

ALTER TABLE public.usoconsumo_saida DROP CONSTRAINT IF EXISTS usoconsumo_saida_escopo_check;
ALTER TABLE public.usoconsumo_saida
  ADD CONSTRAINT usoconsumo_saida_escopo_check CHECK (escopo IN ('USOCONSUMO', 'GERAL'));

COMMENT ON COLUMN public.usoconsumo_item.escopo IS
  'A qual estoque simples o item pertence: USOCONSUMO ou GERAL (Geral/Avulso). Saldos sao independentes.';
COMMENT ON COLUMN public.usoconsumo_entrada.escopo IS
  'Estoque simples da entrada. Todos os itens da entrada precisam ter o mesmo escopo.';
COMMENT ON COLUMN public.usoconsumo_saida.escopo IS
  'Estoque simples da saida. Todos os itens da saida precisam ter o mesmo escopo.';

-- ---------------------------------------------------------------------------
-- 2) Indices
--
-- Toda listagem do modulo passa a filtrar por escopo, entao ele vira a primeira
-- coluna dos indices que ja existiam. Os indices unicos de etiqueta e codigo de
-- barras NAO entram aqui: continuam globais, para a leitura de etiqueta nunca
-- ficar ambigua entre os tres estoques.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.usoconsumo_item_status_idx;
CREATE INDEX usoconsumo_item_status_idx
  ON public.usoconsumo_item (escopo, status_estoque) WHERE ativo;

DROP INDEX IF EXISTS public.usoconsumo_item_grupo_idx;
CREATE INDEX usoconsumo_item_grupo_idx
  ON public.usoconsumo_item (escopo, grupo_id) WHERE ativo;

CREATE INDEX IF NOT EXISTS usoconsumo_item_escopo_idx
  ON public.usoconsumo_item (escopo, titulo) WHERE ativo;

DROP INDEX IF EXISTS public.usoconsumo_entrada_created_idx;
CREATE INDEX usoconsumo_entrada_created_idx
  ON public.usoconsumo_entrada (escopo, created_at DESC);

DROP INDEX IF EXISTS public.usoconsumo_saida_created_idx;
CREATE INDEX usoconsumo_saida_created_idx
  ON public.usoconsumo_saida (escopo, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3) Coerencia item <-> cabecalho
--
-- As RPCs abaixo ja validam, mas elas nao sao o unico caminho possivel se algum
-- dia outra funcao SECURITY DEFINER escrever direto. Este trigger e a rede de
-- seguranca barata, no mesmo espirito de `usoconsumo_proteger_saldo`.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.usoconsumo_validar_escopo_movimento()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_escopo_item text;
  v_escopo_cabecalho text;
BEGIN
  SELECT escopo INTO v_escopo_item
    FROM public.usoconsumo_item WHERE id = NEW.item_id;

  IF TG_ARGV[0] = 'ENTRADA' THEN
    SELECT escopo INTO v_escopo_cabecalho
      FROM public.usoconsumo_entrada WHERE id = NEW.entrada_id;
  ELSE
    SELECT escopo INTO v_escopo_cabecalho
      FROM public.usoconsumo_saida WHERE id = NEW.saida_id;
  END IF;

  IF v_escopo_item IS DISTINCT FROM v_escopo_cabecalho THEN
    RAISE EXCEPTION
      'O item % pertence ao estoque % e nao pode entrar em um movimento do estoque %.',
      NEW.item_id, v_escopo_item, v_escopo_cabecalho USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS usoconsumo_entrada_item_escopo_trg ON public.usoconsumo_entrada_item;
CREATE TRIGGER usoconsumo_entrada_item_escopo_trg
  AFTER INSERT ON public.usoconsumo_entrada_item
  FOR EACH ROW EXECUTE FUNCTION public.usoconsumo_validar_escopo_movimento('ENTRADA');

DROP TRIGGER IF EXISTS usoconsumo_saida_item_escopo_trg ON public.usoconsumo_saida_item;
CREATE TRIGGER usoconsumo_saida_item_escopo_trg
  AFTER INSERT ON public.usoconsumo_saida_item
  FOR EACH ROW EXECUTE FUNCTION public.usoconsumo_validar_escopo_movimento('SAIDA');

-- ---------------------------------------------------------------------------
-- 4) RPCs
--
-- Todas partem da definicao MAIS RECENTE de cada funcao, nao da original. O que
-- muda esta anotado acima de cada uma; o resto e identico.
--
-- `registrar_entrada_fiscal_mista` nao aparece aqui de proposito: ela repassa
-- `p_entrada_usoconsumo` inteiro para `registrar_entrada_usoconsumo`, entao o
-- escopo flui sozinho assim que a API o inclui no payload.
--
-- `cancelar_entrada_usoconsumo` e `cancelar_saida_usoconsumo` tambem ficam de
-- fora: o escopo vem da propria linha cancelada, e nada no estorno depende dele.
-- ---------------------------------------------------------------------------

-- Identica a 20260804120000, exceto: le `escopo` do item, grava na coluna nova e
-- propaga o mesmo escopo para a entrada de SALDO_INICIAL.
CREATE OR REPLACE FUNCTION public.criar_item_usoconsumo(
  p_item jsonb,
  p_estoque_inicial integer DEFAULT 0,
  p_created_by uuid DEFAULT NULL
) RETURNS public.usoconsumo_item
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_item public.usoconsumo_item%ROWTYPE;
  v_entrada_id bigint;
  v_entrada_item_id bigint;
  v_escopo text := upper(btrim(coalesce(p_item->>'escopo','USOCONSUMO')));
BEGIN
  IF nullif(btrim(p_item->>'titulo'),'') IS NULL THEN
    RAISE EXCEPTION 'Informe o titulo.' USING ERRCODE='22023';
  END IF;
  IF v_escopo NOT IN ('USOCONSUMO','GERAL') THEN
    RAISE EXCEPTION 'Escopo de estoque invalido: %.', v_escopo USING ERRCODE='22023';
  END IF;
  IF p_estoque_inicial IS NULL OR p_estoque_inicial < 0 THEN
    RAISE EXCEPTION 'Estoque inicial invalido.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.usoconsumo_item (
    escopo,titulo,descricao,referencia,fabricante,grupo_id,unidade,conservacao,codigobarras,etiqueta,local,
    estoque,estoqueminimo,precocompra,ultimovalordecompra,ncm,cest,cfop_entrada,origem_mercadoria,
    csosn,cst,aliquotaicms,cst_pis,aliquota_pis,modo_pis,aliquota_por_unidade_pis,cst_cofins,
    aliquota_cofins,modo_cofins,aliquota_por_unidade_cofins,cst_ibscbs,cclass_trib,aliquota_ibs_uf,
    aliquota_ibs_municipio,aliquota_cbs,created_by,updated_by
  ) VALUES (
    v_escopo,
    btrim(p_item->>'titulo'),nullif(btrim(p_item->>'descricao'),''),nullif(btrim(p_item->>'referencia'),''),
    nullif(btrim(p_item->>'fabricante'),''),nullif(p_item->>'grupo_id','')::integer,
    coalesce(nullif(p_item->>'unidade','')::public.unidade_medida,'UN'),coalesce(nullif(p_item->>'conservacao',''),'NOVO'),
    nullif(btrim(p_item->>'codigobarras'),''),nullif(btrim(p_item->>'etiqueta'),''),nullif(btrim(p_item->>'local'),''),
    p_estoque_inicial,coalesce(nullif(p_item->>'estoqueminimo','')::integer,0),
    coalesce(nullif(p_item->>'precocompra','')::numeric,0),
    CASE WHEN p_estoque_inicial>0 THEN coalesce(nullif(p_item->>'precocompra','')::numeric,0) ELSE NULL END,
    nullif(btrim(p_item->>'ncm'),''),nullif(btrim(p_item->>'cest'),''),nullif(btrim(p_item->>'cfop_entrada'),''),
    nullif(btrim(p_item->>'origem_mercadoria'),''),nullif(btrim(p_item->>'csosn'),''),nullif(btrim(p_item->>'cst'),''),
    nullif(p_item->>'aliquotaicms','')::numeric,nullif(btrim(p_item->>'cst_pis'),''),nullif(p_item->>'aliquota_pis','')::numeric,
    nullif(btrim(p_item->>'modo_pis'),''),nullif(p_item->>'aliquota_por_unidade_pis','')::numeric,
    nullif(btrim(p_item->>'cst_cofins'),''),nullif(p_item->>'aliquota_cofins','')::numeric,
    nullif(btrim(p_item->>'modo_cofins'),''),nullif(p_item->>'aliquota_por_unidade_cofins','')::numeric,
    nullif(btrim(p_item->>'cst_ibscbs'),''),nullif(btrim(p_item->>'cclass_trib'),''),
    nullif(p_item->>'aliquota_ibs_uf','')::numeric,nullif(p_item->>'aliquota_ibs_municipio','')::numeric,
    nullif(p_item->>'aliquota_cbs','')::numeric,p_created_by,p_created_by
  ) RETURNING * INTO v_item;
  IF p_estoque_inicial>0 THEN
    INSERT INTO public.usoconsumo_entrada(escopo,tipo,origem,valor_total,created_by)
      VALUES(v_escopo,'SALDO_INICIAL','AJUSTE_RAPIDO',round(p_estoque_inicial*v_item.precocompra,2),p_created_by)
      RETURNING id INTO v_entrada_id;
    INSERT INTO public.usoconsumo_entrada_item(
      entrada_id,item_id,quantidade,unidade,valor_unitario_compra,valor_total,saldo_anterior,saldo_resultante,titulo
    ) VALUES(v_entrada_id,v_item.id,p_estoque_inicial,v_item.unidade,v_item.precocompra,
      round(p_estoque_inicial*v_item.precocompra,2),0,p_estoque_inicial,v_item.titulo)
    RETURNING id INTO v_entrada_item_id;
    INSERT INTO public.usoconsumo_movimento_entrada(
      entrada_id,entrada_item_id,item_id,tipo,quantidade,saldo_anterior,saldo_resultante,valor_unitario_compra,created_by
    ) VALUES(v_entrada_id,v_entrada_item_id,v_item.id,'ENTRADA',p_estoque_inicial,0,p_estoque_inicial,v_item.precocompra,p_created_by);
  END IF;
  RETURN v_item;
END $$;

-- Identica a 20260813030000, exceto: le `escopo` do cabecalho, grava na entrada e
-- so aceita item do mesmo estoque (o SELECT do item passa a filtrar por escopo).
CREATE OR REPLACE FUNCTION public.registrar_entrada_usoconsumo(p_entrada jsonb, p_itens jsonb, p_transacoes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entrada_id bigint; v_item_json jsonb; v_item public.usoconsumo_item%ROWTYPE;
  v_entrada_item_id bigint; v_item_id integer; v_qtd integer; v_custo numeric(14,4);
  v_desc numeric(14,2); v_frete numeric(14,2); v_outras numeric(14,2); v_total_item numeric(14,2);
  v_total numeric(14,2):=0; v_total_fin numeric(14,2); v_tx jsonb; v_fiscal boolean;
  v_chave text; v_documento_id bigint; v_numero_item integer; v_user uuid;
  v_total_documento numeric(14,2) := nullif(p_entrada->>'valor_total_documento','')::numeric;
  v_total_devido numeric(14,2);
  v_escopo text := upper(btrim(coalesce(p_entrada->>'escopo','USOCONSUMO')));
  v_rotulo text;
BEGIN
  IF jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.' USING ERRCODE='22023';
  END IF;
  IF v_escopo NOT IN ('USOCONSUMO','GERAL') THEN
    RAISE EXCEPTION 'Escopo de estoque invalido: %.', v_escopo USING ERRCODE='22023';
  END IF;
  v_rotulo := CASE WHEN v_escopo='GERAL'
                   THEN 'Compra de material do estoque geral'
                   ELSE 'Compra de material de uso e consumo' END;
  IF v_total_documento IS NOT NULL AND v_total_documento < 0 THEN
    RAISE EXCEPTION 'O total do documento fiscal nao pode ser negativo.' USING ERRCODE='22023';
  END IF;
  v_fiscal:=coalesce((p_entrada->>'fiscal')::boolean,false);
  v_chave:=nullif(regexp_replace(coalesce(p_entrada->>'chave_nfe',''),'\D','','g'),'');
  v_documento_id:=nullif(p_entrada->>'documento_fiscal_recebido_id','')::bigint;
  v_user:=nullif(p_entrada->>'created_by','')::uuid;
  IF v_fiscal AND (v_chave IS NULL OR length(v_chave)<>44 OR nullif(p_entrada->>'fornecedor_id','') IS NULL) THEN
    RAISE EXCEPTION 'A entrada fiscal exige chave valida e fornecedor.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.usoconsumo_entrada(
    escopo,fornecedor_id,fiscal,chave_nfe,numero_nota,serie_nota,data_emissao,tipo,origem,documento_fiscal_recebido_id,created_by,observacao
  ) VALUES(
    v_escopo,
    nullif(p_entrada->>'fornecedor_id','')::integer,v_fiscal,v_chave,nullif(p_entrada->>'numero_nota',''),
    nullif(p_entrada->>'serie_nota',''),nullif(p_entrada->>'data_emissao','')::timestamptz,
    coalesce(nullif(p_entrada->>'tipo',''),'COMPRA_FORNECEDOR'),coalesce(nullif(p_entrada->>'origem',''),'MANUAL'),
    v_documento_id,v_user,nullif(btrim(coalesce(p_entrada->>'observacao','')),'')
  ) RETURNING id INTO v_entrada_id;

  FOR v_item_json IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_item_id:=nullif(v_item_json->>'item_id','')::integer;
    v_qtd:=nullif(v_item_json->>'quantidade','')::integer;
    v_custo:=nullif(v_item_json->>'valor_unitario_compra','')::numeric;
    v_desc:=coalesce(nullif(v_item_json->>'valor_desconto','')::numeric,0);
    v_frete:=coalesce(nullif(v_item_json->>'valor_frete','')::numeric,0);
    v_outras:=coalesce(nullif(v_item_json->>'outras_despesas','')::numeric,0);
    v_numero_item:=nullif(v_item_json->>'numero_item_fiscal','')::integer;
    IF v_item_id IS NULL OR v_qtd IS NULL OR v_qtd<=0 OR v_custo IS NULL OR v_custo<0
       OR v_desc<0 OR v_frete<0 OR v_outras<0 THEN
      RAISE EXCEPTION 'Item, quantidade ou valores invalidos.' USING ERRCODE='22023';
    END IF;
    IF v_fiscal AND v_documento_id IS NOT NULL AND v_numero_item IS NULL THEN
      RAISE EXCEPTION 'Informe o numero do item fiscal.' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_item FROM public.usoconsumo_item WHERE id=v_item_id AND ativo AND escopo=v_escopo FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % nao encontrado neste estoque.',v_item_id USING ERRCODE='P0002';
    END IF;
    v_total_item:=round(v_qtd*v_custo-v_desc+v_frete+v_outras,2);
    IF v_total_item<0 THEN RAISE EXCEPTION 'Total do item invalido.' USING ERRCODE='22023'; END IF;
    INSERT INTO public.usoconsumo_entrada_item(
      entrada_id,item_id,numero_item_fiscal,codigo_fornecedor,quantidade,unidade,valor_unitario_compra,
      valor_desconto,valor_frete,outras_despesas,valor_total,saldo_anterior,saldo_resultante,ncm,cest,csosn,
      referencia,titulo,cst,aliquotaicms,cfop,cst_pis,aliquota_pis,cst_cofins,aliquota_cofins,cst_ibscbs,
      cclass_trib,aliquota_ibs_uf,aliquota_ibs_municipio,aliquota_cbs
    ) VALUES(
      v_entrada_id,v_item_id,v_numero_item,nullif(v_item_json->>'codigo_fornecedor',''),v_qtd,
      coalesce(nullif(v_item_json->>'unidade','')::public.unidade_medida,v_item.unidade),v_custo,v_desc,v_frete,v_outras,
      v_total_item,v_item.estoque,v_item.estoque+v_qtd,coalesce(nullif(v_item_json->>'ncm',''),v_item.ncm),
      coalesce(nullif(v_item_json->>'cest',''),v_item.cest),coalesce(nullif(v_item_json->>'csosn',''),v_item.csosn),
      coalesce(nullif(v_item_json->>'referencia',''),v_item.referencia),coalesce(nullif(v_item_json->>'titulo',''),v_item.titulo),
      coalesce(nullif(v_item_json->>'cst',''),v_item.cst),coalesce(nullif(v_item_json->>'aliquotaicms','')::numeric,v_item.aliquotaicms),
      coalesce(nullif(v_item_json->>'cfop',''),v_item.cfop_entrada),coalesce(nullif(v_item_json->>'cst_pis',''),v_item.cst_pis),
      coalesce(nullif(v_item_json->>'aliquota_pis','')::numeric,v_item.aliquota_pis),
      coalesce(nullif(v_item_json->>'cst_cofins',''),v_item.cst_cofins),coalesce(nullif(v_item_json->>'aliquota_cofins','')::numeric,v_item.aliquota_cofins),
      coalesce(nullif(v_item_json->>'cst_ibscbs',''),v_item.cst_ibscbs),coalesce(nullif(v_item_json->>'cclass_trib',''),v_item.cclass_trib),
      coalesce(nullif(v_item_json->>'aliquota_ibs_uf','')::numeric,v_item.aliquota_ibs_uf),
      coalesce(nullif(v_item_json->>'aliquota_ibs_municipio','')::numeric,v_item.aliquota_ibs_municipio),
      coalesce(nullif(v_item_json->>'aliquota_cbs','')::numeric,v_item.aliquota_cbs)
    ) RETURNING id INTO v_entrada_item_id;
    PERFORM set_config('app.usoconsumo_movimento','permitido',true);
    UPDATE public.usoconsumo_item SET estoque=estoque+v_qtd,ultimovalordecompra=v_custo,updated_by=v_user WHERE id=v_item_id;
    INSERT INTO public.usoconsumo_movimento_entrada(
      entrada_id,entrada_item_id,item_id,tipo,quantidade,saldo_anterior,saldo_resultante,valor_unitario_compra,created_by
    ) VALUES(v_entrada_id,v_entrada_item_id,v_item_id,'ENTRADA',v_qtd,v_item.estoque,v_item.estoque+v_qtd,v_custo,v_user);
    IF nullif(p_entrada->>'fornecedor_id','') IS NOT NULL THEN
      INSERT INTO public.usoconsumo_fornecedor_item(fornecedor_id,item_id,codigo_fornecedor,ultimo_valor_compra)
      VALUES((p_entrada->>'fornecedor_id')::integer,v_item_id,nullif(v_item_json->>'codigo_fornecedor',''),v_custo)
      ON CONFLICT(fornecedor_id,item_id) DO UPDATE SET
        codigo_fornecedor=coalesce(EXCLUDED.codigo_fornecedor,usoconsumo_fornecedor_item.codigo_fornecedor),
        ultimo_valor_compra=EXCLUDED.ultimo_valor_compra,updated_at=now();
    END IF;
    IF v_fiscal AND v_documento_id IS NOT NULL THEN
      INSERT INTO public.fiscal_dfe_item_apropriacao(
        documento_id,numero_item,destino,usoconsumo_entrada_id,quantidade,created_by
      ) VALUES(v_documento_id,v_numero_item,'USOCONSUMO',v_entrada_id,v_qtd,v_user);
    END IF;
    v_total:=v_total+v_total_item;
  END LOOP;

  v_total_devido := round(coalesce(v_total_documento, v_total),2);
  UPDATE public.usoconsumo_entrada SET valor_total=v_total_devido WHERE id=v_entrada_id;

  IF jsonb_typeof(p_transacoes)='array' AND jsonb_array_length(p_transacoes)>0 THEN
    SELECT round(coalesce(sum((value->>'valor')::numeric),0),2) INTO v_total_fin FROM jsonb_array_elements(p_transacoes);
    IF v_total_fin<>v_total_devido THEN
      RAISE EXCEPTION 'A soma dos lancamentos financeiros (%) difere do total da entrada (%).',
        v_total_fin, v_total_devido USING ERRCODE='22023';
    END IF;
    FOR v_tx IN SELECT value FROM jsonb_array_elements(p_transacoes) LOOP
      IF coalesce(nullif(v_tx->>'valor','')::numeric,0)<=0 THEN
        RAISE EXCEPTION 'Valor financeiro invalido.' USING ERRCODE='22023';
      END IF;
      INSERT INTO public.transacao(
        descricao,valor,"valorLiquido",data,vencimento_em,metodopagamento,categoria,categoria_id,tipo,cliente_id,
        banco_id,nomepagador,cpfcnpjpagador,pendente,plano_de_conta_id,plano_de_conta,centro_custo_id,
        centro_custo,usoconsumo_entrada_id,origem,created_by
      ) VALUES(
        coalesce(nullif(v_tx->>'descricao',''),v_rotulo),(v_tx->>'valor')::numeric,
        (v_tx->>'valor')::numeric,coalesce(nullif(v_tx->>'data','')::timestamptz,now()),
        nullif(v_tx->>'vencimento_em','')::timestamptz,nullif(v_tx->>'metodopagamento','')::public.metodo_pagamento,
        coalesce(nullif(v_tx->>'categoria',''),v_rotulo),
        nullif(v_tx->>'categoria_id','')::integer,'DESPESA',NULL,nullif(v_tx->>'banco_id','')::bigint,
        coalesce(nullif(v_tx->>'nomepagador',''),'Fornecedor'),
        coalesce(nullif(regexp_replace(v_tx->>'cpfcnpjpagador','\D','','g'),''),'NAO INFORMADO'),
        coalesce((v_tx->>'pendente')::boolean,false),nullif(v_tx->>'plano_de_conta_id','')::integer,
        nullif(v_tx->>'plano_de_conta',''),nullif(v_tx->>'centro_custo_id','')::integer,
        nullif(v_tx->>'centro_custo',''),v_entrada_id,'USOCONSUMO_ENTRADA',v_user
      );
    END LOOP;
  END IF;
  RETURN jsonb_build_object('entrada_id',v_entrada_id,'valor_total',v_total_devido,'escopo',v_escopo);
END $function$;

-- Identica a 20260730160000, exceto: le `escopo` do cabecalho, grava na saida e
-- so aceita item do mesmo estoque. O cadastro de motivos continua compartilhado:
-- o escopo consultado em `tipos_motivo_saida` e sempre USOCONSUMO, tambem para o
-- Geral/Avulso.
CREATE OR REPLACE FUNCTION public.registrar_saida_usoconsumo(
  p_saida jsonb, p_itens jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_saida_id bigint; v_json jsonb; v_item public.usoconsumo_item%ROWTYPE;
  v_item_id integer; v_qtd integer; v_user uuid; v_motivo text;
  v_escopo text := upper(btrim(coalesce(p_saida->>'escopo','USOCONSUMO')));
BEGIN
  IF jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 THEN
    RAISE EXCEPTION 'Informe ao menos um item.' USING ERRCODE='22023';
  END IF;
  IF v_escopo NOT IN ('USOCONSUMO','GERAL') THEN
    RAISE EXCEPTION 'Escopo de estoque invalido: %.', v_escopo USING ERRCODE='22023';
  END IF;
  v_motivo := upper(btrim(coalesce(p_saida->>'motivo','')));
  IF NOT EXISTS (
    SELECT 1 FROM public.tipos_motivo_saida
    WHERE codigo = v_motivo AND ativo AND escopo IN ('USOCONSUMO', 'AMBOS')
  ) THEN RAISE EXCEPTION 'Motivo invalido.' USING ERRCODE='22023'; END IF;
  IF v_motivo='OUTRO' AND nullif(btrim(p_saida->>'observacao'),'') IS NULL THEN
    RAISE EXCEPTION 'Informe a observacao.' USING ERRCODE='22023';
  END IF;
  v_user:=nullif(p_saida->>'created_by','')::uuid;
  INSERT INTO public.usoconsumo_saida(escopo,motivo,observacao,setor,funcionario,centro_custo_id,created_by)
  VALUES(v_escopo,v_motivo,nullif(btrim(p_saida->>'observacao'),''),nullif(btrim(p_saida->>'setor'),''),
    nullif(btrim(p_saida->>'funcionario'),''),nullif(p_saida->>'centro_custo_id','')::integer,v_user)
  RETURNING id INTO v_saida_id;
  FOR v_json IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_item_id:=nullif(v_json->>'item_id','')::integer; v_qtd:=nullif(v_json->>'quantidade','')::integer;
    IF v_item_id IS NULL OR v_qtd IS NULL OR v_qtd<=0 THEN
      RAISE EXCEPTION 'Item ou quantidade invalida.' USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_item FROM public.usoconsumo_item WHERE id=v_item_id AND ativo AND escopo=v_escopo FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % nao encontrado neste estoque.',v_item_id USING ERRCODE='P0002';
    END IF;
    IF v_item.estoque<v_qtd THEN
      RAISE EXCEPTION 'Estoque insuficiente para o item %.',v_item_id USING ERRCODE='23514';
    END IF;
    INSERT INTO public.usoconsumo_saida_item(saida_id,item_id,quantidade,saldo_anterior,saldo_resultante,valor_custo_aplicado)
      VALUES(v_saida_id,v_item_id,v_qtd,v_item.estoque,v_item.estoque-v_qtd,coalesce(v_item.ultimovalordecompra,v_item.precocompra,0));
    PERFORM set_config('app.usoconsumo_movimento','permitido',true);
    UPDATE public.usoconsumo_item SET estoque=estoque-v_qtd,updated_by=v_user WHERE id=v_item_id;
  END LOOP;
  RETURN jsonb_build_object('saida_id',v_saida_id,'escopo',v_escopo);
END $$;

-- Identica a 20260729100000, exceto: propaga o escopo do proprio item para a
-- entrada ou a saida gerada pelo ajuste.
CREATE OR REPLACE FUNCTION public.ajustar_inventario_usoconsumo(
  p_item_id integer,p_novo_saldo integer,p_observacao text,p_created_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_item public.usoconsumo_item%ROWTYPE; v_diferenca integer; v_result jsonb;
BEGIN
  IF p_novo_saldo IS NULL OR p_novo_saldo<0 THEN RAISE EXCEPTION 'Novo saldo invalido.' USING ERRCODE='22023'; END IF;
  IF nullif(btrim(p_observacao),'') IS NULL THEN RAISE EXCEPTION 'Informe a justificativa do inventario.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.usoconsumo_item WHERE id=p_item_id AND ativo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item nao encontrado.' USING ERRCODE='P0002'; END IF;
  v_diferenca:=p_novo_saldo-v_item.estoque;
  IF v_diferenca=0 THEN RETURN jsonb_build_object('item_id',p_item_id,'saldo',p_novo_saldo,'alterado',false); END IF;
  IF v_diferenca>0 THEN
    SELECT public.registrar_entrada_usoconsumo(
      jsonb_build_object('fiscal',false,'origem','INVENTARIO','tipo','DEVOLUCAO','escopo',v_item.escopo,'created_by',p_created_by),
      jsonb_build_array(jsonb_build_object('item_id',p_item_id,'quantidade',v_diferenca,'valor_unitario_compra',coalesce(v_item.ultimovalordecompra,v_item.precocompra,0))),
      '[]'::jsonb
    ) INTO v_result;
  ELSE
    SELECT public.registrar_saida_usoconsumo(
      jsonb_build_object('motivo','AJUSTE_INVENTARIO','observacao',p_observacao,'escopo',v_item.escopo,'created_by',p_created_by),
      jsonb_build_array(jsonb_build_object('item_id',p_item_id,'quantidade',abs(v_diferenca)))
    ) INTO v_result;
  END IF;
  RETURN v_result || jsonb_build_object('item_id',p_item_id,'saldo',p_novo_saldo,'alterado',true);
END $$;

-- ---------------------------------------------------------------------------
-- 5) Visoes do historico
--
-- Recriadas do zero pelo mesmo motivo de 20260820100000: `CREATE OR REPLACE VIEW`
-- so acrescenta coluna no fim, e a visao financeira consome `historico.*`.
-- A unica mudanca em relacao aquela versao e a coluna `escopo`, que a API usa
-- para filtrar a aba do historico.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.usoconsumo_movimento_financeiro_historico;
DROP VIEW IF EXISTS public.usoconsumo_movimento_historico;

CREATE VIEW public.usoconsumo_movimento_historico AS
SELECT
  'entrada'::text AS sentido,
  e.id,
  e.escopo,
  e.created_at,
  e.status,
  e.valor_total,
  e.numero_nota,
  e.tipo,
  te.nome AS tipo_nome,
  e.origem,
  NULL::text AS motivo,
  NULL::text AS motivo_nome,
  e.observacao,
  f.nomerazaosocial AS parte,
  (
    coalesce(e.fiscal, false)
    OR nullif(btrim(coalesce(e.numero_nota, '')), '') IS NOT NULL
    OR e.origem = 'NFE_TERCEIRO'
  ) AS fiscal,
  itens.resumo AS itens_resumo,
  e.created_by,
  u.nome AS criador_nome,
  lower(concat_ws(' ',
    e.id::text,
    e.numero_nota,
    f.nomerazaosocial,
    replace(coalesce(e.tipo, ''), '_', ' '),
    te.nome,
    e.observacao,
    itens.resumo,
    u.nome,
    'entrada',
    e.status,
    CASE
      WHEN coalesce(e.fiscal, false) OR e.numero_nota IS NOT NULL
      THEN 'nf-e nota fiscal'
    END
  )) AS busca
FROM public.usoconsumo_entrada e
LEFT JOIN public.tipos_entrada te ON te.codigo = e.tipo
LEFT JOIN public.fornecedor f ON f.id = e.fornecedor_id
LEFT JOIN public.usuario u ON u.id = e.created_by
LEFT JOIN LATERAL (
  SELECT string_agg(
           coalesce(nullif(btrim(coalesce(ei.titulo, '')), ''), i.titulo, 'Item')
             || ' (' || ei.quantidade || ' ' || ei.unidade::text || ')',
           ', ' ORDER BY ei.id
         ) AS resumo
  FROM public.usoconsumo_entrada_item ei
  LEFT JOIN public.usoconsumo_item i ON i.id = ei.item_id
  WHERE ei.entrada_id = e.id
) itens ON true

UNION ALL

SELECT
  'saida'::text AS sentido,
  s.id,
  s.escopo,
  s.created_at,
  s.status,
  NULL::numeric AS valor_total,
  NULL::text AS numero_nota,
  NULL::text AS tipo,
  NULL::text AS tipo_nome,
  NULL::text AS origem,
  s.motivo,
  tms.nome AS motivo_nome,
  s.observacao,
  coalesce(nullif(btrim(coalesce(s.funcionario, '')), ''),
           nullif(btrim(coalesce(s.setor, '')), ''),
           cc.nome) AS parte,
  false AS fiscal,
  itens.resumo AS itens_resumo,
  s.created_by,
  u.nome AS criador_nome,
  lower(concat_ws(' ',
    s.id::text,
    replace(coalesce(s.motivo, ''), '_', ' '),
    tms.nome,
    s.observacao,
    s.funcionario,
    s.setor,
    cc.nome,
    itens.resumo,
    u.nome,
    'saida',
    s.status
  )) AS busca
FROM public.usoconsumo_saida s
LEFT JOIN public.tipos_motivo_saida tms ON tms.codigo = s.motivo
LEFT JOIN public.centrosdecusto cc ON cc.id = s.centro_custo_id
LEFT JOIN public.usuario u ON u.id = s.created_by
LEFT JOIN LATERAL (
  SELECT string_agg(
           coalesce(i.titulo, 'Item') || ' (' || si.quantidade || ' ' || i.unidade::text || ')',
           ', ' ORDER BY si.id
         ) AS resumo
  FROM public.usoconsumo_saida_item si
  LEFT JOIN public.usoconsumo_item i ON i.id = si.item_id
  WHERE si.saida_id = s.id
) itens ON true;

COMMENT ON VIEW public.usoconsumo_movimento_historico IS
  'Entradas e saidas dos estoques simples (uso e consumo e geral/avulso) em uma linha do tempo unica, separadas por `escopo`.';

ALTER VIEW public.usoconsumo_movimento_historico OWNER TO postgres;

CREATE VIEW public.usoconsumo_movimento_financeiro_historico AS
SELECT
  historico.*,
  CASE
    WHEN historico.sentido = 'entrada'
    THEN EXISTS (
      SELECT 1
        FROM public.transacao transacao
       WHERE transacao.usoconsumo_entrada_id = historico.id
         AND transacao.is_deleted = false
    )
    ELSE NULL
  END AS financeiro_lancado
FROM public.usoconsumo_movimento_historico historico;

COMMENT ON VIEW public.usoconsumo_movimento_financeiro_historico IS
  'Historico dos estoques simples acrescido do indicador de lancamento financeiro ativo da entrada.';

ALTER VIEW public.usoconsumo_movimento_financeiro_historico OWNER TO postgres;

-- Autores: passa a aceitar o filtro por escopo, para o seletor de usuario de cada
-- aba do historico listar so quem assinou movimento daquele estoque.
DROP VIEW IF EXISTS public.usoconsumo_movimento_autor;
CREATE VIEW public.usoconsumo_movimento_autor AS
SELECT DISTINCT u.id, u.nome, movimento.escopo
FROM public.usuario u
JOIN LATERAL (
  SELECT e.escopo FROM public.usoconsumo_entrada e WHERE e.created_by = u.id
  UNION
  SELECT s.escopo FROM public.usoconsumo_saida s WHERE s.created_by = u.id
) movimento ON true;

COMMENT ON VIEW public.usoconsumo_movimento_autor IS
  'Usuarios com pelo menos uma entrada ou saida, por estoque simples (`escopo`).';

ALTER VIEW public.usoconsumo_movimento_autor OWNER TO postgres;

REVOKE ALL ON public.usoconsumo_movimento_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.usoconsumo_movimento_historico TO service_role;

REVOKE ALL ON public.usoconsumo_movimento_financeiro_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.usoconsumo_movimento_financeiro_historico TO service_role;

REVOKE ALL ON public.usoconsumo_movimento_autor FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.usoconsumo_movimento_autor TO service_role;

COMMIT;

-- O PostgREST so enxerga a mudanca depois de recarregar o cache de schema.
NOTIFY pgrst, 'reload schema';
