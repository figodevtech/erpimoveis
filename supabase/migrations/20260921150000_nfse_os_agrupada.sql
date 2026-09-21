-- Uma NFS-e pode documentar serviços de várias OS do MESMO cliente.
--
-- `nfse.ordemservicoid` continua sendo a ÂNCORA — a OS que abriu a emissão —
-- porque dela dependem o reenvio, a consulta e as notas já emitidas. Esta
-- tabela é aditiva e guarda o leque completo, linha de serviço a linha de
-- serviço.
--
-- A granularidade é por LINHA DE SERVIÇO, e não pela OS inteira, porque a
-- NFS-e já nasce de uma seleção de serviços: emitir dois serviços hoje e o
-- terceiro amanhã é fluxo normal. A identidade da linha é o par
-- (ordemservicoid, servicoid) — `osservico` não tem coluna `id`, sua PK é esse
-- par. Por isso `nfse.servico_ids` guardar `servicoid` sempre foi correto
-- DENTRO de uma OS; o que não existia era como distinguir a mesma linha entre
-- OS diferentes, e é exatamente isso que esta tabela resolve.
BEGIN;

CREATE TABLE IF NOT EXISTS public.nfse_os_servico_vinculo (
  nfse_id bigint NOT NULL REFERENCES public.nfse(id) ON DELETE CASCADE,
  ordemservico_id integer NOT NULL REFERENCES public.ordemservico(id) ON DELETE RESTRICT,
  servico_id integer NOT NULL,
  cliente_id integer NOT NULL REFERENCES public.cliente(id) ON DELETE RESTRICT,
  ancora boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (nfse_id, ordemservico_id, servico_id)
);

-- Sem chave estrangeira para (ordemservico_id, servico_id): ela existiria, já
-- que a PK de `osservico` é esse par, mas com ON DELETE RESTRICT passaria a
-- impedir a remoção de uma linha de serviço de qualquer OS que já tenha nota —
-- uma mudança de comportamento na tela de OS que não é o objetivo daqui. A
-- existência do par é conferida no trigger, na hora de gravar; depois disso o
-- vínculo é histórico fiscal e sobrevive à edição da OS.

CREATE INDEX IF NOT EXISTS nfse_os_servico_vinculo_os_idx
  ON public.nfse_os_servico_vinculo(ordemservico_id, nfse_id);

CREATE INDEX IF NOT EXISTS nfse_os_servico_vinculo_nfse_idx
  ON public.nfse_os_servico_vinculo(nfse_id);

-- Espelha STATUS_ATIVOS das rotas de NFS-e (de-os e reemitir), hoje duplicado
-- nos dois arquivos. Uma nota rejeitada ou cancelada libera o serviço para
-- nova emissão; PROCESSANDO, AUTORIZADA e DENEGADA o ocupam.
CREATE OR REPLACE FUNCTION public.nfse_status_ocupa_servico(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT upper(coalesce(p_status, '')) IN ('PROCESSANDO', 'AUTORIZADA', 'DENEGADA');
$fn$;

-- Backfill antes do trigger e do índice único, como no vínculo de NF-e: a
-- validação de cliente vale para emissões novas, não retroativamente, e há
-- notas antigas cujo `servico_ids` aponta para linhas que já saíram da OS.
INSERT INTO public.nfse_os_servico_vinculo (
  nfse_id, ordemservico_id, servico_id, cliente_id, ancora, ativo
)
SELECT DISTINCT
       n.id,
       n.ordemservicoid,
       servico_id,
       n.clienteid,
       true,
       public.nfse_status_ocupa_servico(n.status)
  FROM public.nfse n
 CROSS JOIN LATERAL unnest(coalesce(n.servico_ids, '{}'::integer[])) AS servico_id
 WHERE n.ordemservicoid IS NOT NULL
   AND n.clienteid IS NOT NULL
ON CONFLICT DO NOTHING;

-- Duas notas vivas disputando a mesma linha de serviço impediriam o índice
-- único. A checagem atual é de aplicação (`.overlaps`), suscetível a corrida,
-- então o histórico pode ter casos. Mantém a nota mais recente ocupando o
-- serviço e desativa as anteriores, sem perder nenhum vínculo.
DO $backfill$
DECLARE
  v_desativados integer;
BEGIN
  WITH ordenados AS (
    SELECT ctid,
           row_number() OVER (
             PARTITION BY ordemservico_id, servico_id
             ORDER BY nfse_id DESC
           ) AS posicao
      FROM public.nfse_os_servico_vinculo
     WHERE ativo
  )
  UPDATE public.nfse_os_servico_vinculo vinculo
     SET ativo = false,
         updated_at = now()
    FROM ordenados
   WHERE vinculo.ctid = ordenados.ctid
     AND ordenados.posicao > 1;

  GET DIAGNOSTICS v_desativados = ROW_COUNT;

  IF v_desativados > 0 THEN
    RAISE NOTICE
      'nfse_os_servico_vinculo: % vinculo(s) historico(s) desativado(s) por disputarem o mesmo servico. Notas preservadas.',
      v_desativados;
  END IF;
END;
$backfill$;

-- Substitui por constraint a checagem `.overlaps("servico_ids", ...)` feita na
-- aplicação, que é leitura seguida de escrita e portanto perde a corrida com
-- um duplo clique. Ganho real mesmo na emissão de uma OS só.
CREATE UNIQUE INDEX IF NOT EXISTS nfse_os_servico_vinculo_ativo_idx
  ON public.nfse_os_servico_vinculo(ordemservico_id, servico_id)
  WHERE ativo;

CREATE OR REPLACE FUNCTION public.nfse_os_servico_vinculo_validar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_status text;
  v_nfse_cliente integer;
  v_nfse_os integer;
  v_os_cliente integer;
BEGIN
  SELECT status, clienteid, ordemservicoid
    INTO v_status, v_nfse_cliente, v_nfse_os
    FROM public.nfse
   WHERE id = NEW.nfse_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O vinculo exige uma NFS-e existente.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.osservico
     WHERE ordemservicoid = NEW.ordemservico_id
       AND servicoid = NEW.servico_id
  ) THEN
    RAISE EXCEPTION 'O servico % nao pertence a OS %.', NEW.servico_id, NEW.ordemservico_id
      USING ERRCODE = '23514';
  END IF;

  SELECT clienteid INTO v_os_cliente
    FROM public.ordemservico WHERE id = NEW.ordemservico_id;

  -- Uma NFS-e tem um unico tomador: as OS agrupadas precisam ser do mesmo
  -- cliente da nota.
  IF v_os_cliente IS DISTINCT FROM v_nfse_cliente OR NEW.cliente_id <> v_nfse_cliente THEN
    RAISE EXCEPTION
      'A OS % pertence ao cliente % e a NFS-e foi emitida para o cliente %. Uma NFS-e tem um unico tomador.',
      NEW.ordemservico_id, v_os_cliente, v_nfse_cliente
      USING ERRCODE = '23514';
  END IF;

  NEW.ancora := v_nfse_os IS NOT DISTINCT FROM NEW.ordemservico_id;
  NEW.ativo := public.nfse_status_ocupa_servico(v_status);
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_nfse_os_servico_vinculo_validar
  ON public.nfse_os_servico_vinculo;
CREATE TRIGGER trg_nfse_os_servico_vinculo_validar
BEFORE INSERT OR UPDATE OF nfse_id, ordemservico_id, servico_id, cliente_id
ON public.nfse_os_servico_vinculo
FOR EACH ROW
EXECUTE FUNCTION public.nfse_os_servico_vinculo_validar();

-- É este trigger que devolve o serviço para a fila quando a nota é rejeitada
-- ou cancelada. A NFS-e não tem `is_deleted`: a exclusão é física e só vale
-- para rejeitada, e o ON DELETE CASCADE já limpa o vínculo nesse caso.
CREATE OR REPLACE FUNCTION public.nfse_os_servico_vinculo_sincronizar_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.nfse_os_servico_vinculo
     SET ativo = public.nfse_status_ocupa_servico(NEW.status),
         updated_at = now()
   WHERE nfse_id = NEW.id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_nfse_os_servico_vinculo_sincronizar_status ON public.nfse;
CREATE TRIGGER trg_nfse_os_servico_vinculo_sincronizar_status
AFTER UPDATE OF status ON public.nfse
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.nfse_os_servico_vinculo_sincronizar_status();

-- Grava o leque de serviços da nota numa transação.
--
-- Diferente da NF-e, aqui a chamada externa à Focus vem DEPOIS: a rota grava o
-- registro, chama esta função e só então transmite. Se o serviço já estiver
-- ocupado, a emissão falha por constraint antes de qualquer efeito externo —
-- que é a única ordem segura, porque uma NFS-e transmitida não se desfaz.
CREATE OR REPLACE FUNCTION public.vincular_nfse_os(
  p_nfse_id bigint,
  p_itens jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_item jsonb;
  v_nfse_os integer;
  v_nfse_cliente integer;
BEGIN
  IF p_nfse_id IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Informe a NFS-e e ao menos um servico.' USING ERRCODE = '22023';
  END IF;

  SELECT ordemservicoid, clienteid
    INTO v_nfse_os, v_nfse_cliente
    FROM public.nfse
   WHERE id = p_nfse_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NFS-e invalida para vinculo com servicos.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_itens) item
     WHERE nullif(item->>'ordemservico_id', '')::integer = v_nfse_os
  ) THEN
    RAISE EXCEPTION 'A OS principal da NFS-e precisa permanecer no grupo.' USING ERRCODE = '22023';
  END IF;

  -- Travas na mesma ordem para duas emissoes concorrentes nao cruzarem.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('nfse:os-servico:%s:%s', ids.ordemservico_id, ids.servico_id), 0)
  )
  FROM (
    SELECT DISTINCT
           nullif(item->>'ordemservico_id', '')::integer AS ordemservico_id,
           nullif(item->>'servico_id', '')::integer AS servico_id
      FROM jsonb_array_elements(p_itens) item
     ORDER BY 1, 2
  ) ids;

  DELETE FROM public.nfse_os_servico_vinculo WHERE nfse_id = p_nfse_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    INSERT INTO public.nfse_os_servico_vinculo (
      nfse_id, ordemservico_id, servico_id, cliente_id
    ) VALUES (
      p_nfse_id,
      nullif(v_item->>'ordemservico_id', '')::integer,
      nullif(v_item->>'servico_id', '')::integer,
      v_nfse_cliente
    );
  END LOOP;

  RETURN jsonb_build_object(
    'nfse_id', p_nfse_id,
    'ordens', (SELECT count(DISTINCT ordemservico_id) FROM public.nfse_os_servico_vinculo WHERE nfse_id = p_nfse_id),
    'servicos', (SELECT count(*) FROM public.nfse_os_servico_vinculo WHERE nfse_id = p_nfse_id)
  );
END;
$fn$;

ALTER TABLE public.nfse_os_servico_vinculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfse_os_servico_vinculo FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.nfse_os_servico_vinculo TO service_role;
REVOKE ALL ON FUNCTION public.vincular_nfse_os(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_nfse_os(bigint, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.nfse_status_ocupa_servico(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nfse_status_ocupa_servico(text) TO service_role;

COMMENT ON TABLE public.nfse_os_servico_vinculo IS
  'Elo entre uma NFS-e e cada linha de servico (OS + servico) que ela documenta. nfse.ordemservicoid segue como ancora; esta tabela e aditiva e trava a concorrencia por servico.';

COMMIT;
