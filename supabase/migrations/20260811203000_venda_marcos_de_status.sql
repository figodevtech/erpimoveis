-- Marcos de status da venda: orçamento, pagamento e baixa.
--
-- PROBLEMA
-- A venda só guardava `datavenda` (o instante do registro) e `updatedat` (que é
-- sobrescrito por qualquer alteração). Não havia como responder "quando esta
-- venda foi para pagamento?" nem "quando ela foi baixada?" — e a Central Pessoal
-- filtrava vendas por `datavenda`, ou seja, pelo momento em que o orçamento foi
-- digitado, e não pelo momento em que a venda virou receita do vendedor.
--
-- SOLUÇÃO
-- Três colunas de marco, carimbadas por trigger BEFORE. Trigger, e não escrita
-- no call site, porque a venda muda de status por muitos caminhos:
-- fn_criar_venda_com_itens, PDV, PATCH /api/venda/[id], baixar_transacao_pendente,
-- integrações de marketplace e cancelar_venda. Carimbar em cada um seria garantia
-- de esquecer algum.
--
-- O gatilho é `BEFORE INSERT OR UPDATE` sem restrição de coluna, de propósito:
-- `UPDATE OF status` só dispara quando a coluna aparece no SET do comando, nunca
-- quando outro trigger BEFORE a escreve. Foi exatamente essa pegadinha que deixou
-- a DRE vazia em 20260806260000 — não repetir.
--
-- Sufixo `_em` para acompanhar `execucao_fim_em` da OS, que é o análogo direto
-- destas colunas (mesmo papel, mesmo painel).
BEGIN;

ALTER TABLE public.venda
  ADD COLUMN IF NOT EXISTS orcamento_em timestamptz,
  ADD COLUMN IF NOT EXISTS pagamento_em timestamptz,
  ADD COLUMN IF NOT EXISTS baixada_em timestamptz;

COMMENT ON COLUMN public.venda.orcamento_em IS
  'Quando a venda foi registrada como orçamento (nasceu ABERTA). Nulo para venda de balcão/PDV, que já nasce em PAGAMENTO.';
COMMENT ON COLUMN public.venda.pagamento_em IS
  'Quando a venda entrou em PAGAMENTO. Eixo de período da Central Pessoal.';
COMMENT ON COLUMN public.venda.baixada_em IS
  'Quando a venda foi quitada (entrou em FINALIZADA). Zerado se a baixa for estornada.';

CREATE OR REPLACE FUNCTION public.tg_venda_carimbar_marcos()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
declare
  v_status text := upper(new.status::text);
  v_anterior text := case when tg_op = 'UPDATE' then upper(old.status::text) else null end;
  -- Venda importada ou lançada com data retroativa: o marco acompanha a data
  -- informada, senão o histórico do vendedor migra todo para o dia da carga.
  v_referencia timestamptz := coalesce(new.datavenda, now());
begin
  if tg_op = 'INSERT' then
    if v_status = 'ABERTA' then
      new.orcamento_em := coalesce(new.orcamento_em, v_referencia);
    elsif v_status = 'PAGAMENTO' then
      new.pagamento_em := coalesce(new.pagamento_em, v_referencia);
    elsif v_status = 'FINALIZADA' then
      new.pagamento_em := coalesce(new.pagamento_em, v_referencia);
      new.baixada_em := coalesce(new.baixada_em, v_referencia);
    end if;
    return new;
  end if;

  if v_status is not distinct from v_anterior then
    return new;
  end if;

  -- `coalesce` em vez de atribuição direta: se a venda voltar de FINALIZADA por
  -- estorno e for para pagamento de novo, o marco que vale é o primeiro — é ele
  -- que define o período de comissão do vendedor.
  if v_status = 'PAGAMENTO' then
    new.pagamento_em := coalesce(new.pagamento_em, now());
  end if;

  if v_status = 'FINALIZADA' then
    -- Venda que pula direto para FINALIZADA (quitada no ato) nunca passou por um
    -- UPDATE para PAGAMENTO: sem isto ela ficaria fora do filtro da aba.
    new.pagamento_em := coalesce(new.pagamento_em, now());
    new.baixada_em := coalesce(new.baixada_em, now());
  elsif v_anterior = 'FINALIZADA' and v_status = 'PAGAMENTO' then
    -- Estorno da baixa: sem limpar, a venda ficaria em PAGAMENTO exibindo data
    -- de baixa. Cancelamento não passa por aqui — lá o histórico é preservado.
    new.baixada_em := null;
  end if;

  return new;
end;
$function$;

ALTER FUNCTION public.tg_venda_carimbar_marcos() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_venda_carimbar_marcos ON public.venda;
CREATE TRIGGER trg_venda_carimbar_marcos
BEFORE INSERT OR UPDATE ON public.venda
FOR EACH ROW EXECUTE FUNCTION public.tg_venda_carimbar_marcos();

-- ---------------------------------------------------------------------------
-- Backfill. Cada marco usa a melhor evidência disponível e nada é inventado:
-- coluna que não tem como ser reconstituída fica nula.
-- ---------------------------------------------------------------------------

-- Orçamento: só quem ainda está ABERTA comprova ter nascido como orçamento.
-- Para as demais não há registro de que tenha havido essa etapa.
UPDATE public.venda
   SET orcamento_em = coalesce(createdat, datavenda)
 WHERE status::text = 'ABERTA'
   AND orcamento_em IS NULL;

-- Pagamento: o título nasce quando a venda entra em cobrança, então a criação do
-- primeiro título é a melhor testemunha. Sem título, cai na data da venda.
UPDATE public.venda v
   SET pagamento_em = coalesce(
     (SELECT min(t.created_at)
        FROM public.transacao t
       WHERE t.vendaid = v.id
         AND t.is_deleted = false),
     v.datavenda,
     v.createdat
   )
 WHERE v.status::text IN ('PAGAMENTO', 'FINALIZADA')
   AND v.pagamento_em IS NULL;

-- Baixa: aqui a data é exata, não é proxy — está no `pago_em` dos títulos
-- quitados da venda. `updatedat` só entra para venda finalizada sem título.
UPDATE public.venda v
   SET baixada_em = coalesce(
     (SELECT max(t.pago_em)
        FROM public.transacao t
       WHERE t.vendaid = v.id
         AND upper(t.tipo::text) = 'RECEITA'
         AND t.pendente = false
         AND t.is_deleted = false),
     v.updatedat
   )
 WHERE v.status::text = 'FINALIZADA'
   AND v.baixada_em IS NULL;

-- A Central Pessoal sempre consulta por vendedor + janela de pagamento_em.
CREATE INDEX IF NOT EXISTS idx_venda_vendedor_pagamento_em
  ON public.venda (vendedor, pagamento_em DESC);

COMMIT;
