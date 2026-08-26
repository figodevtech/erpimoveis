-- Entrada fiscal: os tres destinos de estoque na mesma nota.
--
-- PROBLEMA
-- 20260826120000 gravou o escopo no cabecalho da entrada e fez a RPC recusar item
-- de outro estoque. Com isso a NF-e passou a caber em um estoque simples por vez, e
-- o seletor de destino por linha nunca oferecia os tres. Uma nota de fornecedor,
-- porem, mistura o que quiser: parte revenda, parte uso e consumo, parte geral.
--
-- POR QUE NAO DUAS ENTRADAS
-- `usoconsumo_entrada_chave_uk` e UNIQUE em `chave_nfe` GLOBALMENTE — nao por escopo
-- —, e `usoconsumo_entrada_dfe_uk` idem para `documento_fiscal_recebido_id`. Uma
-- NF-e nao pode gerar duas entradas confirmadas, e derrubar esses indices abriria a
-- porta para a mesma nota ser lancada duas vezes, que e o que eles impedem.
-- Alem disso `transacao` tem uma unica coluna `usoconsumo_entrada_id`, usada por
-- cancelamento, DRE, competencia e pelo indicador `financeiro_lancado`: duas
-- entradas exigiriam tabela de ligacao e a propagacao dela por todo o financeiro.
--
-- SOLUCAO
-- Uma nota, uma entrada — que passa a poder carregar item dos dois estoques simples.
-- O cabecalho ganha o valor `MISTO`, que significa "tem item de mais de um estoque".
--
-- `usoconsumo_item.escopo` continua sendo a VERDADE sobre a qual estoque um saldo
-- pertence; o cabecalho so resume, para filtro e rotulo. Nada muda no caminho do
-- saldo: a RPC resolve o item por id, e o item ja sabe de qual estoque e.
--
-- `usoconsumo_saida.escopo` NAO ganha `MISTO`: a saida sempre parte de uma pagina de
-- estoque e e sempre de um estoque so.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) O terceiro valor no cabecalho da entrada
-- ---------------------------------------------------------------------------

ALTER TABLE public.usoconsumo_entrada DROP CONSTRAINT IF EXISTS usoconsumo_entrada_escopo_check;
ALTER TABLE public.usoconsumo_entrada
  ADD CONSTRAINT usoconsumo_entrada_escopo_check
  CHECK (escopo IN ('USOCONSUMO', 'GERAL', 'MISTO'));

COMMENT ON COLUMN public.usoconsumo_entrada.escopo IS
  'Estoque simples da entrada, ou MISTO quando a nota tem item de mais de um. '
  'MISTO existe porque usoconsumo_entrada_chave_uk e global: uma NF-e nao pode '
  'virar duas entradas. Quem manda no saldo e sempre usoconsumo_item.escopo.';

-- ---------------------------------------------------------------------------
-- 2) Coerencia item <-> cabecalho, agora ciente do MISTO
--
-- Para cabecalho de escopo unico a exigencia continua sendo igualdade — a rede de
-- seguranca contra "item do estoque errado" nao foi afrouxada onde ela faz sentido.
-- Para MISTO basta o item existir e ser de um escopo valido.
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

  IF v_escopo_cabecalho = 'MISTO' THEN
    IF v_escopo_item NOT IN ('USOCONSUMO', 'GERAL') THEN
      RAISE EXCEPTION 'O item % nao pertence a nenhum estoque simples valido.', NEW.item_id
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF v_escopo_item IS DISTINCT FROM v_escopo_cabecalho THEN
    RAISE EXCEPTION
      'O item % pertence ao estoque % e nao pode entrar em um movimento do estoque %.',
      NEW.item_id, v_escopo_item, v_escopo_cabecalho USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 3) A RPC de entrada
--
-- Identica a 20260826120000, exceto em tres pontos: o escopo aceito, o rotulo do
-- titulo financeiro e o filtro do SELECT do item, que some quando o cabecalho e
-- MISTO. Saldo, movimento, apropriacao e financeiro ficam iguais.
-- ---------------------------------------------------------------------------

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
  IF v_escopo NOT IN ('USOCONSUMO','GERAL','MISTO') THEN
    RAISE EXCEPTION 'Escopo de estoque invalido: %.', v_escopo USING ERRCODE='22023';
  END IF;
  v_rotulo := CASE v_escopo
                WHEN 'GERAL' THEN 'Compra de material do estoque geral'
                WHEN 'MISTO' THEN 'Compra de material de uso e consumo e do estoque geral'
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
    -- MISTO aceita item de qualquer estoque simples; escopo unico exige o proprio.
    SELECT * INTO v_item FROM public.usoconsumo_item
    WHERE id=v_item_id AND ativo
      AND (v_escopo='MISTO' OR escopo=v_escopo)
    FOR UPDATE;
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

COMMIT;

-- O PostgREST so enxerga a mudanca depois de recarregar o cache de schema.
NOTIFY pgrst, 'reload schema';
