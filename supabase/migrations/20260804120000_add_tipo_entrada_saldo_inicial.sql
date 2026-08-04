-- Saldo inicial deixa de ser gravado como "Compra fornecedor".
--
-- Cadastrar um produto (ou item de uso e consumo) com estoque inicial nao grava
-- o saldo direto: cria uma entrada auditavel. Ate aqui essa entrada nascia com
-- tipo COMPRA_FORNECEDOR, errado em dois sentidos. O saldo inicial nao veio de
-- compra alguma; e COMPRA_FORNECEDOR tem exige_valor = true, entao cadastrar um
-- produto com estoque e sem valor de compra falhava com "O tipo 'Compra
-- fornecedor' exige valor unitario maior que zero" — mensagem que parecia erro
-- de fornecedor e que ainda derrubava, no rollback, o produto recem-criado.
--
-- Entra um tipo proprio, SALDO_INICIAL, que aceita valor zero. Como ele e
-- sempre gerado pelo sistema e nunca escolhido a mao, a coluna `sistema` marca
-- esse caso: tipos do sistema ficam fora do seletor de entrada manual e nao
-- podem ser desativados nem ter suas regras mudadas em Configuracoes > Tipos —
-- desativar SALDO_INICIAL voltaria a quebrar o cadastro de produtos.
BEGIN;

ALTER TABLE public.tipos_entrada
  ADD COLUMN IF NOT EXISTS sistema boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tipos_entrada.sistema IS
  'true: tipo gerado pelo sistema. Fica fora da selecao manual de entrada e suas regras sao imutaveis.';

-- ON CONFLICT preserva nome/descricao de um tipo homonimo que ja exista, mas
-- forca as regras de que o cadastro de produtos depende.
INSERT INTO public.tipos_entrada (codigo, nome, descricao, escopo, exige_valor, ativo, sistema) VALUES (
  'SALDO_INICIAL',
  'Saldo inicial',
  'Estoque informado no cadastro do produto ou do item de uso e consumo. Gerado pelo sistema.',
  'AMBOS',
  false,
  true,
  true
)
ON CONFLICT (codigo) DO UPDATE SET
  escopo = 'AMBOS',
  exige_valor = false,
  ativo = true,
  sistema = true,
  updatedat = now();

CREATE OR REPLACE FUNCTION public.proteger_tipo_entrada_sistema()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.sistema THEN
      RAISE EXCEPTION 'O tipo de entrada "%" e do sistema e nao pode ser removido.', OLD.nome
        USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT OLD.sistema THEN
    RETURN NEW;
  END IF;

  -- Nome e descricao continuam editaveis: sao rotulo, nao regra.
  IF NEW.codigo IS DISTINCT FROM OLD.codigo
     OR NEW.escopo IS DISTINCT FROM OLD.escopo
     OR NEW.exige_valor IS DISTINCT FROM OLD.exige_valor
     OR NEW.ativo IS DISTINCT FROM OLD.ativo
     OR NEW.sistema IS DISTINCT FROM OLD.sistema THEN
    RAISE EXCEPTION 'O tipo de entrada "%" e do sistema: as regras dele nao podem ser alteradas.', OLD.nome
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tipos_entrada_protege_sistema ON public.tipos_entrada;
CREATE TRIGGER tipos_entrada_protege_sistema
  BEFORE UPDATE OR DELETE ON public.tipos_entrada
  FOR EACH ROW EXECUTE FUNCTION public.proteger_tipo_entrada_sistema();

-- Recriada apenas para trocar o literal do tipo na entrada de saldo inicial
-- (linha do INSERT em usoconsumo_entrada). O restante e identico a
-- 20260729100000_create_usoconsumo_inventory.
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
BEGIN
  IF nullif(btrim(p_item->>'titulo'),'') IS NULL THEN
    RAISE EXCEPTION 'Informe o titulo.' USING ERRCODE='22023';
  END IF;
  IF p_estoque_inicial IS NULL OR p_estoque_inicial < 0 THEN
    RAISE EXCEPTION 'Estoque inicial invalido.' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.usoconsumo_item (
    titulo,descricao,referencia,fabricante,grupo_id,unidade,conservacao,codigobarras,etiqueta,local,
    estoque,estoqueminimo,precocompra,ultimovalordecompra,ncm,cest,cfop_entrada,origem_mercadoria,
    csosn,cst,aliquotaicms,cst_pis,aliquota_pis,modo_pis,aliquota_por_unidade_pis,cst_cofins,
    aliquota_cofins,modo_cofins,aliquota_por_unidade_cofins,cst_ibscbs,cclass_trib,aliquota_ibs_uf,
    aliquota_ibs_municipio,aliquota_cbs,created_by,updated_by
  ) VALUES (
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
    INSERT INTO public.usoconsumo_entrada(tipo,origem,valor_total,created_by)
      VALUES('SALDO_INICIAL','AJUSTE_RAPIDO',round(p_estoque_inicial*v_item.precocompra,2),p_created_by)
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

COMMIT;
