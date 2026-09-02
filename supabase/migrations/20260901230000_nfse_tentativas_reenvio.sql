-- Reenvio de NFS-e rejeitada na propria nota, com o historico das recusas.
--
-- Ate aqui o botao "Reenviar sem alterar" criava uma linha nova em nfse e
-- deixava a rejeitada onde estava. Numa instabilidade da prefeitura -- tres,
-- quatro tentativas seguidas -- a OS acumulava uma pilha de notas recusadas que
-- o usuario tinha de excluir uma a uma.
--
-- Reusar a linha e seguro: rejeitada nunca virou documento, fica com numero,
-- protocolo e codigo_verificacao nulos e nao consome numeracao de RPS (ver o
-- comentario de 20260818130000_nfse_retorno_bruto.sql). O que a Focus nao aceita
-- e repetir uma referencia ja usada, e isso e um UPDATE da coluna, nao uma linha
-- nova.
--
-- O que se perdia ao reusar era o material de diagnostico da tentativa anterior
-- -- o envio e a resposta bruta, que foi o que permitiu investigar o L999 de
-- Joao Pessoa. Dai esta coluna: cada recusa e arquivada aqui antes de a linha ir
-- para a tentativa seguinte.
BEGIN;

ALTER TABLE public.nfse
  ADD COLUMN IF NOT EXISTS tentativas jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.nfse.tentativas IS
  'Tentativas de envio recusadas antes da atual, da mais antiga para a mais recente: referencia, status, erros, payload_enviado e retorno_bruto de cada uma. A tentativa corrente NAO entra aqui -- ela continua nas colunas erros, payload_enviado e retorno_bruto. Limitado as 10 ultimas pelo codigo, porque cada retorno bruto vai ate 20 mil caracteres. Diagnostico puro: nenhuma regra de negocio le esta coluna.';

-- Aviso de Telegram: uma mensagem por tentativa, nao por nota.
--
-- A fila deduplica por (usuario_id, evento_tipo, dedupe_chave) com ON CONFLICT
-- DO NOTHING. Com a chave em 'NFSE:' || id, a linha reusada so avisaria a
-- primeira rejeicao: da segunda em diante o INSERT cairia no conflito e quem
-- acompanha pelo Telegram nao saberia que a nota foi recusada de novo.
--
-- A referencia muda a cada envio (criarReferenciaPorServicos poe o timestamp),
-- entao ela e o que distingue uma tentativa da outra. AUTORIZADA e CANCELADA
-- mantem a referencia da emissao que deu certo e seguem deduplicando como antes.
CREATE OR REPLACE FUNCTION public.fn_notificar_telegram_nfse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Denegacao de NFS-e volta com o motivo no mesmo lugar da rejeicao e exige a
  -- mesma correcao: um evento so.
  v_evento := CASE upper(btrim(coalesce(NEW.status, '')))
    WHEN 'AUTORIZADA' THEN 'NFSE_AUTORIZADA'
    WHEN 'REJEITADA' THEN 'NFSE_REJEITADA'
    WHEN 'DENEGADA' THEN 'NFSE_REJEITADA'
    WHEN 'CANCELADA' THEN 'NFSE_CANCELADA'
    ELSE NULL
  END;

  IF v_evento IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.fn_enfileirar_notificacao_fiscal(
    'NFSE',
    NEW.id::bigint,
    v_evento,
    'NFSE:' || NEW.id::text || ':' || coalesce(NEW.referencia, '')
  );
  RETURN NEW;
END;
$$;

COMMIT;
