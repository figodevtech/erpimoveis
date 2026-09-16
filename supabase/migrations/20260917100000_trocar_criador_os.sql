-- Trocar o criador da OS, levando junto a comissão de criação.
--
-- O PROBLEMA
-- O criador da OS só mudava por script. Um UPDATE em `usuariocriadorid` não
-- basta, e é por isso que a troca virou operação própria:
--   - nenhum gatilho olha essa coluna;
--   - `os_comissao_criacao` carimba o dono na primeira apuração e o ON CONFLICT
--     de `recalcular_comissao_criacao_os` deixa `usuarioid` de fora de
--     propósito, então a comissão ficaria no nome de quem saiu;
--   - OS encerrada e nunca apurada não ganha comissão sem `p_forcar`
--     (20260904140000), então quem entra ficaria sem nada.
-- Medido nas OS #411 e #412 do Demir, trocadas em 16/09/2026 por
-- `scripts/migracao/demir-trocar-criador-os.ts`, cuja lógica passa a morar aqui.
--
-- A REGRA É A DA VENDA (20260909125000)
-- Trocar o beneficiário é ato explícito de quem opera, não deriva de cadastro:
-- a comissão vai junto e é reapurada pela taxa de quem entrou, lida do cadastro
-- de hoje — inclusive em OS encerrada. A taxa congelada pertencia a quem saiu.
-- `p_forcar` existe para uma pessoa decidir OS a OS, e é exatamente o caso.
--
-- O QUE FICA BARRADO
--   - OS cancelada, como na troca de cliente;
--   - comissão de criação de quem saiu já lançada no financeiro ou corrigida à
--     mão. A reconciliação não toca nessas linhas (I8): seguir em frente
--     deixaria as duas comissões ativas;
--   - OS histórica migrada, pelo gatilho que já a torna somente leitura.
--
-- QUEM PODE
-- A permissão `ordens:alterar_criador`, sem backfill: move comissão entre
-- pessoas, e precisa ser concedida a dedo, como `ordens:excluir_checklist_assinado`.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) A permissão
-- ---------------------------------------------------------------------------
INSERT INTO public.permissao (nome, descricao)
VALUES ('ordens:alterar_criador', 'Alterar o criador da OS e transferir a comissao de criacao')
ON CONFLICT (nome) DO UPDATE
SET descricao = excluded.descricao;

-- ---------------------------------------------------------------------------
-- 2) A troca
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trocar_criador_os(
  p_ordemservicoid integer,
  p_usuarioid uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_os record;
  v_novo record;
  v_nome_anterior text;
  v_comprometidas integer;
  v_comissao_anterior numeric;
  v_comissao_nova numeric;
  v_publica boolean;
BEGIN
  SELECT o.id, o.status::text AS status, o.is_deleted, o.usuariocriadorid
    INTO v_os
    FROM public.ordemservico o
   WHERE o.id = p_ordemservicoid
   FOR UPDATE;

  IF NOT FOUND OR coalesce(v_os.is_deleted, false) THEN
    RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0001';
  END IF;
  IF v_os.status = 'CANCELADO' THEN
    RAISE EXCEPTION 'Uma OS cancelada não muda de criador.' USING ERRCODE = 'P0001';
  END IF;

  SELECT u.id, coalesce(nullif(btrim(u.nome), ''), u.email) AS nome, coalesce(u.ativo, false) AS ativo
    INTO v_novo
    FROM public.usuario u
   WHERE u.id = p_usuarioid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_novo.ativo THEN
    RAISE EXCEPTION '% está inativo e não pode ser o criador da OS.', v_novo.nome USING ERRCODE = 'P0001';
  END IF;
  IF v_os.usuariocriadorid IS NOT DISTINCT FROM p_usuarioid THEN
    RAISE EXCEPTION 'A OS já foi criada por %.', v_novo.nome USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(nullif(btrim(u.nome), ''), u.email)
    INTO v_nome_anterior
    FROM public.usuario u
   WHERE u.id = v_os.usuariocriadorid;

  -- Comissão de quem saiu que já virou dinheiro, ou foi escrita à mão.
  SELECT count(*)
    INTO v_comprometidas
    FROM public.eventos_financeiros e
   WHERE e.ordemservicoid = p_ordemservicoid
     AND e.origem = 'COMISSAO'
     AND e.chave_origem LIKE 'CRIACAO:%'
     AND e.usuarioid IS DISTINCT FROM p_usuarioid
     AND e.status <> 'CANCELADO'
     AND (e.status = 'CONVERTIDO' OR e.transacaoid IS NOT NULL
          OR e.lancamento_id IS NOT NULL OR coalesce(e.is_manual, false));

  IF v_comprometidas > 0 THEN
    RAISE EXCEPTION 'A comissão de criação desta OS já foi lançada no financeiro ou corrigida à mão. Desfaça isso antes de trocar o criador.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(sum(c.valor_comissao), 0)
    INTO v_comissao_anterior
    FROM public.os_comissao_criacao c
   WHERE c.ordemservicoid = p_ordemservicoid;

  UPDATE public.ordemservico
     SET usuariocriadorid = p_usuarioid
   WHERE id = p_ordemservicoid;

  -- O snapshot sai inteiro: sem isso o ON CONFLICT do recálculo manteria o
  -- dono antigo nas linhas que já existiam.
  DELETE FROM public.os_comissao_criacao WHERE ordemservicoid = p_ordemservicoid;

  -- Sem cobrança não comissiona.
  IF v_os.status <> 'SEM_COBRANCA' THEN
    PERFORM public.recalcular_comissao_criacao_os(p_ordemservicoid, true);
  END IF;

  SELECT coalesce(sum(c.valor_comissao), 0)
    INTO v_comissao_nova
    FROM public.os_comissao_criacao c
   WHERE c.ordemservicoid = p_ordemservicoid;

  -- Os status em que a comissão já está no livro, mais a OS que já tem comissão
  -- ativa por outro caminho — a reiniciada mantém os eventos (20260916180000).
  -- A chave `CRIACAO:<uuid>:...` muda junto com o dono: a reconciliação cancela
  -- a de quem saiu e publica a de quem entrou.
  v_publica := v_os.status IN ('EM_ANDAMENTO', 'PAGAMENTO', 'FATURAMENTO', 'CONCLUIDO')
    OR EXISTS (
      SELECT 1 FROM public.eventos_financeiros e
       WHERE e.ordemservicoid = p_ordemservicoid
         AND e.origem = 'COMISSAO'
         AND e.status = 'ATIVO'
    );

  IF v_publica THEN
    PERFORM public.reconciliar_eventos_financeiros_os(p_ordemservicoid, true);
  END IF;

  RETURN jsonb_build_object(
    'criador_anterior', CASE WHEN v_os.usuariocriadorid IS NULL THEN NULL
                             ELSE jsonb_build_object('id', v_os.usuariocriadorid, 'nome', v_nome_anterior) END,
    'criador_novo', jsonb_build_object('id', p_usuarioid, 'nome', v_novo.nome),
    'comissao_anterior', round(v_comissao_anterior, 2),
    'comissao_nova', round(v_comissao_nova, 2),
    'eventos_publicados', v_publica
  );
END;
$function$;

ALTER FUNCTION public.trocar_criador_os(integer, uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.trocar_criador_os(integer, uuid) IS
  'Troca o criador da OS e reapura a comissão de criação pela taxa de quem entrou, republicando os eventos quando a OS já os tem. Recusa OS cancelada e comissão de criação já lançada no financeiro ou corrigida à mão.';

REVOKE ALL ON FUNCTION public.trocar_criador_os(integer, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trocar_criador_os(integer, uuid) TO service_role;

COMMIT;
