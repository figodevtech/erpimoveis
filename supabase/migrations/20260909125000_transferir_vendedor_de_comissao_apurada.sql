-- Trocar o vendedor de uma venda cuja comissao foi apurada mas nao foi lancada.
--
-- O PROBLEMA. `reconciliar_comissao_venda` (20260904180000) recusava qualquer
-- troca de vendedor assim que a comissao congelava -- e ela congela quando a
-- venda entra em PAGAMENTO, que e onde `venda_reconhece_receita` passa a valer.
-- Ou seja: a venda ainda esta no balcao, nada foi lancado no financeiro, e
-- corrigir um nome digitado errado so era possivel revertendo a venda a
-- orcamento, o que estorna estoque e apaga `pagamento_em`. Remedio grande
-- demais para trocar um nome. Medido na venda #153 do Demir.
--
-- A REGRA NOVA. Congelar existe para impedir que um reajuste de cadastro
-- reescreva mes fechado sozinho -- e deriva, nao ato. Trocar o vendedor e ato
-- explicito de quem opera: a comissao vai junto e e reapurada pela taxa de quem
-- entrou, lida do cadastro. A taxa congelada pertence a pessoa que saiu e nao
-- significa nada para quem entrou.
--
-- O QUE CONTINUA BARRADO. Dinheiro comprometido, na trava logo abaixo, que ja
-- existia e nao muda: comissao CONVERTIDO, com `transacaoid` ou com
-- `lancamento_id` recusa com 'Desfaca o lancamento financeiro da comissao antes
-- de alterar ou cancelar esta venda.' -- que e a mensagem certa, porque diz o
-- que fazer. O predicado dela ja inclui `e.usuarioid IS DISTINCT FROM
-- v_usuario`, entao a transferencia de uma comissao lancada cai ali.
--
-- O QUE NAO MUDA. `congelada_em` continua vindo de `pagamento_em`: a venda nao
-- muda de periodo por trocar de dono, e a Central Pessoal e os relatorios
-- continuam lendo o mesmo eixo. Sem backfill -- e regra de daqui pra frente e
-- nao reescreve valor nenhum ja gravado.
--
-- JUNTO VAI UMA SEGUNDA CORRECAO, no fim do arquivo: o pagamento da comissao
-- de venda entrava na DRE duas vezes. As duas moram no mesmo caminho -- apurar
-- e lancar a comissao da venda -- e a primeira nao serve de nada se a segunda
-- dobra o custo assim que o financeiro lanca.
BEGIN;

CREATE OR REPLACE FUNCTION public.reconciliar_comissao_venda(p_vendaid bigint)
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
  -- Congelada e com o mesmo beneficiario: a taxa e historico e nao se move.
  -- Beneficiario diferente: a apuracao esta sendo refeita para outra pessoa, e
  -- a taxa dela vem do cadastro.
  IF v_reconhecida AND v_snapshot.congelada_em IS NOT NULL
     AND v_usuario IS NOT DISTINCT FROM v_snapshot.usuarioid THEN
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

COMMENT ON FUNCTION public.reconciliar_comissao_venda(bigint) IS
  'Apura a comissao da venda. A taxa congela com a venda, mas trocar o vendedor transfere a comissao e reapura pela taxa de quem entrou. Comissao ja lancada no financeiro recusa a alteracao.';


-- ---------------------------------------------------------------------------
-- O pagamento da comissao nao pode virar custo duas vezes
-- ---------------------------------------------------------------------------
-- `transacao_gera_evento_de_resultado` (20260908160000) ja diz a regra:
-- liquidacao de algo que o livro ja reconheceu nao e resultado novo. Ela lista
-- `evento_financeiro_id` -- o vinculo de UM evento -- e esqueceu
-- `lancamento_id`, que e o mesmo vinculo quando o pagamento cobre varios
-- eventos de uma vez. Nao e escolha de negocio: e um caso que faltou no
-- conjunto que a propria funcao define.
--
-- Sem isto, a transacao criada por `registrar_lancamento_de_eventos` gera
-- evento proprio sempre que nao sobra uma OS unica para carimbar em
-- `ordemservicoid` -- exatamente os dois caminhos novos: a comissao de venda
-- (que nunca tem OS) e o lancamento que atravessa varias OS (20260904120000).
-- O custo entrava na DRE duas vezes: uma como COMISSAO/DESPESA, outra como o
-- evento da transacao.
--
-- MEDIDO ANTES DE ESCREVER: zero transacao com `lancamento_id` tem evento
-- proprio hoje, nos quatro bancos. O defeito e latente -- nenhuma comissao de
-- venda foi lancada ainda --, entao esta correcao nao reescreve DRE nenhuma.
-- Ela impede o primeiro lancamento de nascer dobrado. Por isso tambem nao ha
-- backfill: nao ha o que limpar.
--
-- O teste `supabase/tests/comissao_de_vendas.sql` cobre o caso desde que foi
-- escrito, na assercao 'O pagamento duplicou o custo na DRE.', e falhava.
CREATE OR REPLACE FUNCTION public.transacao_gera_evento_de_resultado(
  p_transacao_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tx public.transacao%ROWTYPE;
  v_exclui boolean;
BEGIN
  SELECT * INTO v_tx FROM public.transacao WHERE id = p_transacao_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Liquidacao de algo ja reconhecido, compra que vira estoque, ou saldo de
  -- abertura trazido de outro sistema: nao e resultado novo.
  IF v_tx.is_deleted
     OR v_tx.evento_financeiro_id IS NOT NULL
     OR v_tx.lancamento_id IS NOT NULL
     OR v_tx.ordemservicoid IS NOT NULL
     OR v_tx.vendaid IS NOT NULL
     OR v_tx.entrada_id IS NOT NULL
     OR v_tx.usoconsumo_entrada_id IS NOT NULL
     OR v_tx.origem = 'ORIGEM_MIGRACAO' THEN
    RETURN false;
  END IF;

  -- Grupo marcado para ficar fora do resultado. O `limit 1` e o mesmo criterio
  -- da sincronizacao: mais de um mapeamento ativo por grupo ja e barrado pelo
  -- indice unico parcial.
  SELECT mp.exclui_do_resultado
    INTO v_exclui
    FROM public.planosdeconta pc
    JOIN public.dre_mapeamento mp
      ON mp.origem_tipo = 'PLANO_GRUPO' AND mp.origem_id = pc.grupo_id AND mp.ativo
   WHERE pc.id = v_tx.plano_de_conta_id
   LIMIT 1;

  RETURN NOT coalesce(v_exclui, false);
END;
$function$;

COMMENT ON FUNCTION public.transacao_gera_evento_de_resultado(bigint) IS
  'Verdadeiro quando a transacao deve gerar evento financeiro proprio. Regra unica, usada pela sincronizacao e pela fila de pendencias: transacao ligada a OS, venda, entrada, uso e consumo ou a um lancamento de eventos, carga de migracao e conta em grupo excluido nao geram evento — nao sao fato novo.';

NOTIFY pgrst, 'reload schema';
COMMIT;
