-- Uma NF-e pode documentar várias OS ou várias vendas do MESMO cliente (nota
-- consolidada). As colunas `nfe.ordemservicoid` / `nfe.vendaid` continuam
-- existindo como ÂNCORA — a origem que abriu a emissão — porque é delas que a
-- reabertura de rascunho e todas as notas legadas dependem. Esta tabela é
-- aditiva: é o elo fiscal completo entre o documento e cada origem coberta.
--
-- O desenho é o mesmo de nfe_saida_item_vinculo (20260821100000), com uma
-- diferença de granularidade deliberada: a saída vincula por ITEM porque
-- devolução parcial referencia item a item. OS e venda vinculam pela ORIGEM
-- inteira — não existe "meia OS na nota" — e `osproduto` nem teria chave de
-- linha para isso: sua PK é (ordemservicoid, produtoid), sem coluna id.
BEGIN;

-- `ordemservico_id` e `venda_id` carregam a integridade referencial de verdade;
-- `tipo` e `origem_id` são a forma canônica que o índice único e as consultas
-- usam. O CHECK abaixo impede que as duas representações divirjam.
CREATE TABLE IF NOT EXISTS public.nfe_origem_vinculo (
  nfe_id bigint NOT NULL REFERENCES public.nfe(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('OS', 'VENDA')),
  ordemservico_id integer REFERENCES public.ordemservico(id) ON DELETE RESTRICT,
  venda_id integer REFERENCES public.venda(id) ON DELETE RESTRICT,
  origem_id integer NOT NULL,
  -- Denormalizado de `nfe`: o índice parcial único precisa discriminar por
  -- modelo, senão a NFC-e da mesma venda bloquearia a NF-e 55 e vice-versa.
  modelo text NOT NULL,
  -- Espelha `nfe.clienteid`. Uma NF-e tem um único destinatário, então é este
  -- campo que sustenta a invariante "todas as origens do grupo são do mesmo
  -- cliente" no banco, e não só na aplicação.
  cliente_id integer NOT NULL REFERENCES public.cliente(id) ON DELETE RESTRICT,
  ancora boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (nfe_id, tipo, origem_id),
  CONSTRAINT nfe_origem_vinculo_origem_coerente CHECK (
    (tipo = 'OS' AND ordemservico_id IS NOT NULL AND venda_id IS NULL AND origem_id = ordemservico_id)
    OR
    (tipo = 'VENDA' AND venda_id IS NOT NULL AND ordemservico_id IS NULL AND origem_id = venda_id)
  )
);

CREATE INDEX IF NOT EXISTS nfe_origem_vinculo_origem_idx
  ON public.nfe_origem_vinculo(tipo, origem_id, nfe_id);

CREATE INDEX IF NOT EXISTS nfe_origem_vinculo_nfe_idx
  ON public.nfe_origem_vinculo(nfe_id);

-- Lista única de status que "ocupam" a origem, para TS e SQL não divergirem.
-- Espelha STATUS_OCUPAM_ORIGEM de src/services/fiscal/nfeOrigemService.ts.
--
-- DIFERE de propósito da lista usada no vínculo de saída, que inclui
-- AUTORIZADA: a saída é consumida fisicamente e não admite segunda nota, mas
-- uma OS já faturada pode receber outra nota deliberadamente (complementar).
-- REJEITADA, CANCELADA e DENEGADA também liberam a origem.
CREATE OR REPLACE FUNCTION public.nfe_status_ocupa_origem(
  p_status text,
  p_is_deleted boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT NOT coalesce(p_is_deleted, false)
     AND p_status IN (
       'RASCUNHO', 'ASSINADA', 'ENVIADA', 'PENDENTE_ENVIO',
       'CONTINGENCIA', 'RESULTADO_INCERTO'
     );
$fn$;

-- Backfill ANTES do trigger de validação e do índice único, de propósito.
--
-- O trigger exige que o cliente da origem seja o mesmo da nota. Isso vale para
-- vínculos novos, mas não pode valer retroativamente: a troca de titularidade
-- de uma OS altera `ordemservico.clienteid` sem tocar nas notas já emitidas,
-- então há notas legadas legítimas em que os dois divergem. Gravar
-- `nfe.clienteid` mantém cada vínculo coerente com a nota que ele descreve.
--
-- Só NF-e modelo 55 entra na junção. A NFC-e nunca é agrupada (é venda de
-- balcão, uma por vez) e admite um destinatário diferente do cliente da venda:
-- o consumidor que se identifica no caixa. Incluí-la aqui faria a validação de
-- destinatário único recusar uma emissão que hoje é legítima. Ela continua
-- protegida pelo trigger nfe_impedir_origem_transmitida_duplicada.
INSERT INTO public.nfe_origem_vinculo (
  nfe_id, tipo, ordemservico_id, venda_id, origem_id, modelo, cliente_id, ancora, ativo
)
SELECT n.id,
       'OS',
       n.ordemservicoid,
       NULL,
       n.ordemservicoid,
       n.modelo::text,
       n.clienteid,
       true,
       public.nfe_status_ocupa_origem(n.status::text, n.is_deleted)
  FROM public.nfe n
 WHERE n.ordemservicoid IS NOT NULL
   AND n.clienteid IS NOT NULL
   AND n.modelo = 'NFE'
ON CONFLICT DO NOTHING;

INSERT INTO public.nfe_origem_vinculo (
  nfe_id, tipo, ordemservico_id, venda_id, origem_id, modelo, cliente_id, ancora, ativo
)
SELECT n.id,
       'VENDA',
       NULL,
       n.vendaid,
       n.vendaid,
       n.modelo::text,
       n.clienteid,
       true,
       public.nfe_status_ocupa_origem(n.status::text, n.is_deleted)
  FROM public.nfe n
 WHERE n.vendaid IS NOT NULL
   AND n.clienteid IS NOT NULL
   AND n.modelo = 'NFE'
ON CONFLICT DO NOTHING;

-- Os índices nfe_origem_venda_modelo_transmitida_idx e o equivalente de OS
-- deixaram de ser únicos em 20260810200000, e o trigger de duplicidade nem
-- considera RASCUNHO. Logo o banco PODE já ter duas notas ocupando a mesma
-- origem, e o índice único abaixo falharia. Em vez de abortar a migration por
-- causa de dado histórico, mantém a nota mais recente ocupando a origem e
-- desativa as anteriores — elas continuam vinculadas e legíveis, apenas não
-- travam mais uma nova emissão.
DO $backfill$
DECLARE
  v_desativados integer;
BEGIN
  WITH ordenados AS (
    SELECT ctid,
           row_number() OVER (
             PARTITION BY tipo, origem_id, modelo
             ORDER BY nfe_id DESC
           ) AS posicao
      FROM public.nfe_origem_vinculo
     WHERE ativo
  )
  UPDATE public.nfe_origem_vinculo vinculo
     SET ativo = false,
         updated_at = now()
    FROM ordenados
   WHERE vinculo.ctid = ordenados.ctid
     AND ordenados.posicao > 1;

  GET DIAGNOSTICS v_desativados = ROW_COUNT;

  IF v_desativados > 0 THEN
    RAISE NOTICE
      'nfe_origem_vinculo: % vinculo(s) historico(s) desativado(s) por disputarem a mesma origem. Notas preservadas.',
      v_desativados;
  END IF;
END;
$backfill$;

-- A TRAVA DE CONCORRÊNCIA REAL.
--
-- O trigger nfe_impedir_origem_transmitida_duplicada só enxerga as colunas
-- escalares da nota, então nunca protegeria uma origem agregada. Este índice
-- cobre âncora e agregadas igualmente, e protege inclusive RASCUNHO: enquanto
-- a nota ocupar a origem, a mesma OS/venda não pode ser escolhida por outra
-- emissão concorrente.
CREATE UNIQUE INDEX IF NOT EXISTS nfe_origem_vinculo_ativo_idx
  ON public.nfe_origem_vinculo(tipo, origem_id, modelo)
  WHERE ativo;

CREATE OR REPLACE FUNCTION public.nfe_origem_vinculo_validar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_modelo text;
  v_status text;
  v_excluida boolean;
  v_nfe_cliente integer;
  v_nfe_os integer;
  v_nfe_venda integer;
  v_origem_cliente integer;
  v_origem_existe boolean;
  v_ancora_esperada boolean;
BEGIN
  SELECT modelo::text, status::text, coalesce(is_deleted, false), clienteid, ordemservicoid, vendaid
    INTO v_modelo, v_status, v_excluida, v_nfe_cliente, v_nfe_os, v_nfe_venda
    FROM public.nfe
   WHERE id = NEW.nfe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'O vinculo de origem exige uma NF-e existente.' USING ERRCODE = '23514';
  END IF;

  IF NEW.modelo <> v_modelo THEN
    RAISE EXCEPTION 'O modelo do vinculo difere do modelo da NF-e.' USING ERRCODE = '23514';
  END IF;

  -- Só modelo 55. A NFC-e admite um destinatário diferente do cliente da venda
  -- (o consumidor que se identifica no caixa), então a validação de cliente
  -- abaixo recusaria emissões legítimas.
  IF v_modelo <> 'NFE' THEN
    RAISE EXCEPTION 'Somente NF-e modelo 55 usa vinculo de origem.' USING ERRCODE = '23514';
  END IF;

  IF NEW.tipo = 'OS' THEN
    SELECT clienteid INTO v_origem_cliente
      FROM public.ordemservico WHERE id = NEW.ordemservico_id;
    v_origem_existe := FOUND;
    v_ancora_esperada := v_nfe_os IS NOT DISTINCT FROM NEW.ordemservico_id;
  ELSE
    SELECT clienteid INTO v_origem_cliente
      FROM public.venda WHERE id = NEW.venda_id;
    v_origem_existe := FOUND;
    v_ancora_esperada := v_nfe_venda IS NOT DISTINCT FROM NEW.venda_id;
  END IF;

  IF NOT v_origem_existe THEN
    RAISE EXCEPTION 'A origem informada no vinculo nao existe.' USING ERRCODE = '23514';
  END IF;

  -- A invariante do destinatário único, no banco: uma NF-e só documenta
  -- origens do mesmo cliente que consta na própria nota.
  IF NEW.cliente_id <> v_nfe_cliente THEN
    RAISE EXCEPTION 'O vinculo aponta para um cliente diferente do destinatario da NF-e.'
      USING ERRCODE = '23514';
  END IF;

  IF v_origem_cliente IS DISTINCT FROM v_nfe_cliente THEN
    RAISE EXCEPTION
      'A origem % pertence ao cliente % e a NF-e foi emitida para o cliente %. Uma NF-e tem um unico destinatario.',
      NEW.origem_id, v_origem_cliente, v_nfe_cliente
      USING ERRCODE = '23514';
  END IF;

  -- `ancora` não é escolha de quem grava: é um fato derivado de qual origem
  -- está na coluna escalar da nota.
  NEW.ancora := v_ancora_esperada;
  NEW.ativo := public.nfe_status_ocupa_origem(v_status, v_excluida);
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_nfe_origem_vinculo_validar
  ON public.nfe_origem_vinculo;
CREATE TRIGGER trg_nfe_origem_vinculo_validar
BEFORE INSERT OR UPDATE OF nfe_id, tipo, ordemservico_id, venda_id, origem_id, modelo, cliente_id
ON public.nfe_origem_vinculo
FOR EACH ROW
EXECUTE FUNCTION public.nfe_origem_vinculo_validar();

-- É este trigger que devolve a origem para a fila quando a nota é cancelada,
-- rejeitada, autorizada ou excluída.
CREATE OR REPLACE FUNCTION public.nfe_origem_vinculo_sincronizar_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.nfe_origem_vinculo
     SET ativo = public.nfe_status_ocupa_origem(NEW.status::text, NEW.is_deleted),
         updated_at = now()
   WHERE nfe_id = NEW.id;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_nfe_origem_vinculo_sincronizar_status ON public.nfe;
CREATE TRIGGER trg_nfe_origem_vinculo_sincronizar_status
AFTER UPDATE OF status, is_deleted ON public.nfe
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.is_deleted IS DISTINCT FROM NEW.is_deleted)
EXECUTE FUNCTION public.nfe_origem_vinculo_sincronizar_status();

-- Substitui todos os vínculos da nota numa única transação, para reabrir um
-- rascunho ser idempotente. As travas são obtidas sempre na mesma ordem para
-- duas emissões concorrentes com origens em comum não cruzarem.
CREATE OR REPLACE FUNCTION public.vincular_nfe_origens(
  p_nfe_id bigint,
  p_origens jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_origem jsonb;
  v_tipo text;
  v_origem_id integer;
  v_nfe_os integer;
  v_nfe_venda integer;
  v_nfe_cliente integer;
  v_nfe_modelo text;
  v_nfe_excluida boolean;
  v_tipos integer;
  v_ancora_presente boolean;
BEGIN
  IF p_nfe_id IS NULL OR jsonb_typeof(p_origens) <> 'array' OR jsonb_array_length(p_origens) = 0 THEN
    RAISE EXCEPTION 'Informe a NF-e e ao menos uma origem.' USING ERRCODE = '22023';
  END IF;

  SELECT ordemservicoid, vendaid, clienteid, modelo::text, coalesce(is_deleted, false)
    INTO v_nfe_os, v_nfe_venda, v_nfe_cliente, v_nfe_modelo, v_nfe_excluida
    FROM public.nfe
   WHERE id = p_nfe_id
   FOR UPDATE;

  IF NOT FOUND OR v_nfe_excluida OR v_nfe_modelo <> 'NFE' THEN
    RAISE EXCEPTION 'NF-e invalida para vinculo com origens.' USING ERRCODE = '22023';
  END IF;

  -- Misturar OS e venda na mesma nota não é suportado: as duas origens têm
  -- naturezas de operação e âncoras distintas.
  SELECT count(DISTINCT origem->>'tipo')
    INTO v_tipos
    FROM jsonb_array_elements(p_origens) origem;

  IF v_tipos <> 1 THEN
    RAISE EXCEPTION 'Uma NF-e agrupada nao pode misturar OS e vendas.' USING ERRCODE = '22023';
  END IF;

  SELECT origem->>'tipo' INTO v_tipo
    FROM jsonb_array_elements(p_origens) origem LIMIT 1;

  IF v_tipo NOT IN ('OS', 'VENDA') THEN
    RAISE EXCEPTION 'Tipo de origem invalido: %.', v_tipo USING ERRCODE = '22023';
  END IF;

  -- A âncora é a origem que abriu a emissão e continua nas colunas escalares.
  -- Ela não pode sair do grupo, senão a nota passaria a apontar para uma
  -- origem que não documenta mais.
  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_origens) origem
     WHERE nullif(origem->>'origem_id', '')::integer
           = CASE WHEN v_tipo = 'OS' THEN v_nfe_os ELSE v_nfe_venda END
  ) INTO v_ancora_presente;

  IF NOT v_ancora_presente THEN
    RAISE EXCEPTION 'A origem principal da NF-e precisa permanecer no grupo.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(format('nfe:origem:%s:%s:%s', v_tipo, ids.origem_id, v_nfe_modelo), 0)
  )
  FROM (
    SELECT DISTINCT nullif(origem->>'origem_id', '')::integer AS origem_id
      FROM jsonb_array_elements(p_origens) origem
     ORDER BY 1
  ) ids;

  DELETE FROM public.nfe_origem_vinculo WHERE nfe_id = p_nfe_id;

  FOR v_origem IN SELECT value FROM jsonb_array_elements(p_origens) LOOP
    v_origem_id := nullif(v_origem->>'origem_id', '')::integer;

    INSERT INTO public.nfe_origem_vinculo (
      nfe_id, tipo, ordemservico_id, venda_id, origem_id, modelo, cliente_id
    ) VALUES (
      p_nfe_id,
      v_tipo,
      CASE WHEN v_tipo = 'OS' THEN v_origem_id END,
      CASE WHEN v_tipo = 'VENDA' THEN v_origem_id END,
      v_origem_id,
      v_nfe_modelo,
      v_nfe_cliente
    );
  END LOOP;

  RETURN jsonb_build_object(
    'nfe_id', p_nfe_id,
    'tipo', v_tipo,
    'origens', (SELECT count(*) FROM public.nfe_origem_vinculo WHERE nfe_id = p_nfe_id)
  );
END;
$fn$;

ALTER TABLE public.nfe_origem_vinculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nfe_origem_vinculo FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.nfe_origem_vinculo TO service_role;
REVOKE ALL ON FUNCTION public.vincular_nfe_origens(bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_nfe_origens(bigint, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.nfe_status_ocupa_origem(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nfe_status_ocupa_origem(text, boolean) TO service_role;

COMMENT ON TABLE public.nfe_origem_vinculo IS
  'Elo fiscal entre uma NF-e e cada OS/venda que ela documenta. As colunas escalares de nfe seguem como ancora; esta tabela e aditiva e e quem trava a concorrencia por origem.';

COMMIT;
