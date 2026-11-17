-- Retira do ERP os módulos de locações e vendas imobiliárias: o escopo passa a ser só
-- reservas por diária (temporada).
--
-- Esta etapa só desacopla, como 20261029152806_desacoplar_modulos_oficina:
-- - retira as 14 permissões locacoes_imobiliarias:* e vendas_imobiliarias:* e os vínculos
--   delas com perfis; o catálogo volta a bater com permission-constants.ts;
-- - desagenda o cron diário imob-cobrancas-locacao, que gerava as cobranças de aluguel;
-- - deixa todo imóvel só com a modalidade TEMPORADA, a única que o ERP grava daqui em diante.
--
-- Tabelas (locacao_imovel, venda_imovel), colunas (imovel.valor_locacao, imovel.valor_venda,
-- imovel.vendido_em, transacao.locacao_imovel_id, transacao.venda_imovel_id, locacao_id e
-- venda_id de imovel_ocupacao, imovel_movimento e imovel_arquivo) e funções
-- (imob_salvar_locacao, imob_acao_locacao, imob_gerar_cobrancas_locacao, imob_salvar_venda,
-- imob_acao_venda) continuam no banco: rotinas compartilhadas ainda as citam (imob_criar_titulo,
-- imob_tratar_cancelamento, gatilhos de transacao, imovel_resumo, imob_excluir_imovel,
-- imob_trocar_proprietario). A exclusão física fica para uma migration própria.
--
-- Recusa rodar com locação ou venda registrada: sem tela, elas ficariam sem gestão.
BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.locacao_imovel') IS NULL
     OR to_regclass('public.venda_imovel') IS NULL
     OR to_regclass('public.perfilpermissao') IS NULL THEN
    RAISE EXCEPTION 'Esta migration exige o banco do ERP imobiliário.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_imovel) OR EXISTS (SELECT 1 FROM public.venda_imovel) THEN
    RAISE EXCEPTION 'Há locações ou vendas imobiliárias registradas. Trate esses registros antes de retirar os módulos.';
  END IF;
END $$;

-- Lista fechada: não toca em permissões de outros módulos.
DO $$
DECLARE
  removidas constant text[] := array[
    'locacoes_imobiliarias:visualizar', 'locacoes_imobiliarias:criar', 'locacoes_imobiliarias:editar',
    'locacoes_imobiliarias:excluir', 'locacoes_imobiliarias:confirmar', 'locacoes_imobiliarias:cancelar',
    'locacoes_imobiliarias:financeiro',
    'vendas_imobiliarias:visualizar', 'vendas_imobiliarias:criar', 'vendas_imobiliarias:editar',
    'vendas_imobiliarias:excluir', 'vendas_imobiliarias:concluir', 'vendas_imobiliarias:cancelar',
    'vendas_imobiliarias:financeiro'
  ];
BEGIN
  DELETE FROM public.perfilpermissao pp USING public.permissao p
  WHERE pp.permissaoid = p.id AND lower(btrim(p.nome)) = any(removidas);

  DELETE FROM public.permissao WHERE lower(btrim(nome)) = any(removidas);
END $$;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR v_job_id IN SELECT jobid FROM cron.job WHERE jobname = 'imob-cobrancas-locacao'
    LOOP
      PERFORM cron.unschedule(v_job_id);
    END LOOP;
  END IF;
END $$;

-- Em 17/11/2026 todos os imóveis já eram só de temporada; garante o mesmo até a aplicação.
UPDATE public.imovel
SET modalidades = ARRAY['TEMPORADA']::text[], updated_at = now()
WHERE modalidades IS DISTINCT FROM ARRAY['TEMPORADA']::text[];

COMMIT;
