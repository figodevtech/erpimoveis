-- Motor versionado de regras de DIFAL (grupo ICMSUFDest da NF-e 4.00).
--
-- Até aqui a alíquota interna da UF de destino vinha de um objeto TypeScript
-- (ALIQUOTA_INTERNA_POR_UF) que não conhece NCM, CEST, benefício nem vigência,
-- e o FCP tinha que ser digitado item a item — inclusive o zero. Esta tabela
-- passa a ser a fonte fiscal: cada linha é uma regra publicada por uma UF, com
-- vigência, fonte e fundamento legal, e o resolvedor escolhe a que vale na data
-- de emissão do documento.
--
-- Três invariantes que o resto do motor depende:
--
--   1. NULL não é zero. aliquota_fcp NULL quer dizer "a fonte oficial não
--      determina o FCP desta regra"; 0 quer dizer "a fonte determina que não há
--      FCP". O primeiro bloqueia a emissão, o segundo preenche a tela com 0.
--      A mesma distinção vale para aliquota_icms_interna e reducao_base.
--
--   2. Regra antiga não é apagada nem sobrescrita. Uma alteração de alíquota
--      fecha a vigência da linha anterior (vigencia_fim) e insere outra. É o
--      que permite reemitir/auditar uma nota de 2024 com a regra de 2024.
--
--   3. A nota não depende desta tabela depois de decidida. O resolvedor grava
--      o snapshot (alíquotas, regra usada, vigência, fonte) dentro do item
--      fiscal; mudar uma regra aqui não altera nenhuma NF-e já gerada.
--
-- Acesso: a tabela é configuração fiscal da aplicação, como as do SPED. RLS
-- ligada, sem policy para anon/authenticated e GRANT só para service_role —
-- toda leitura e escrita passa pelo servidor, que confere a permissão
-- 'fiscal:difal' (ler) ou 'fiscal:difal_gerenciar' (alterar).
BEGIN;

CREATE TABLE IF NOT EXISTS public.fiscal_difal_regra (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  uf                    text NOT NULL,
  tipo_regra            text NOT NULL,
  descricao             text NOT NULL,
  ncm                   text,
  ncm_prefixo           text,
  cest                  text,
  aliquota_icms_interna numeric(7,4),
  aliquota_fcp          numeric(7,4),
  reducao_base          numeric(7,4),
  vigencia_inicio       date NOT NULL,
  vigencia_fim          date,
  prioridade            integer NOT NULL DEFAULT 10,
  fonte                 text NOT NULL,
  fonte_url             text,
  fundamento_legal      text,
  data_fonte            date,
  ativo                 boolean NOT NULL DEFAULT true,
  nota_curadoria        text,
  importado_em          date,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fiscal_difal_regra IS
  'Regras versionadas de DIFAL/FCP por UF de destino. Fonte do grupo ICMSUFDest; ver docs/sefaz/difal-regras.md.';
COMMENT ON COLUMN public.fiscal_difal_regra.tipo_regra IS
  'GERAL, NCM, NCM_PREFIXO, CEST, NCM_CEST, BENEFICIO ou EXCECAO. Define a especificidade na disputa entre regras.';
COMMENT ON COLUMN public.fiscal_difal_regra.aliquota_icms_interna IS
  'pICMSUFDest em percentual. NULL = a fonte não determina a alíquota interna nesta regra.';
COMMENT ON COLUMN public.fiscal_difal_regra.aliquota_fcp IS
  'pFCPUFDest em percentual. NULL = não determinado (bloqueia). 0 = a fonte declara que não há FCP.';
COMMENT ON COLUMN public.fiscal_difal_regra.reducao_base IS
  'Percentual de redução da base, quando a regra a estabelece. NULL = sem redução determinada pela fonte.';
COMMENT ON COLUMN public.fiscal_difal_regra.vigencia_inicio IS
  'Primeiro dia em que a regra vale. A emissão usa a regra vigente na data do documento, não a mais recente.';
COMMENT ON COLUMN public.fiscal_difal_regra.vigencia_fim IS
  'Último dia de vigência, inclusive. NULL = ainda vigente.';
COMMENT ON COLUMN public.fiscal_difal_regra.prioridade IS
  'Desempate explícito dentro do mesmo tipo_regra. Maior vence; empate com valores diferentes é conflito e bloqueia.';
COMMENT ON COLUMN public.fiscal_difal_regra.ativo IS
  'false = carregada para histórico e auditoria, mas fora da resolução automática (fonte ambígua ou divergente).';
COMMENT ON COLUMN public.fiscal_difal_regra.nota_curadoria IS
  'Por que a regra está como está — em especial por que foi desativada.';

ALTER TABLE public.fiscal_difal_regra
  DROP CONSTRAINT IF EXISTS fiscal_difal_regra_uf_valida;
ALTER TABLE public.fiscal_difal_regra
  ADD CONSTRAINT fiscal_difal_regra_uf_valida CHECK (
    uf IN ('AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA',
           'PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO')
  );

ALTER TABLE public.fiscal_difal_regra
  DROP CONSTRAINT IF EXISTS fiscal_difal_regra_tipo_valido;
ALTER TABLE public.fiscal_difal_regra
  ADD CONSTRAINT fiscal_difal_regra_tipo_valido CHECK (
    tipo_regra IN ('GERAL','NCM','NCM_PREFIXO','CEST','NCM_CEST','BENEFICIO','EXCECAO')
  );

-- Cada tipo exige o identificador que lhe dá sentido. Uma regra de NCM sem NCM
-- casaria com tudo, que é justamente o erro que este motor existe para evitar.
ALTER TABLE public.fiscal_difal_regra
  DROP CONSTRAINT IF EXISTS fiscal_difal_regra_identificador_coerente;
ALTER TABLE public.fiscal_difal_regra
  ADD CONSTRAINT fiscal_difal_regra_identificador_coerente CHECK (
    CASE tipo_regra
      WHEN 'GERAL'       THEN ncm IS NULL AND ncm_prefixo IS NULL AND cest IS NULL
      WHEN 'NCM'         THEN ncm IS NOT NULL AND ncm_prefixo IS NULL
      WHEN 'NCM_PREFIXO' THEN ncm_prefixo IS NOT NULL AND ncm IS NULL
      WHEN 'CEST'        THEN cest IS NOT NULL AND ncm IS NULL
      WHEN 'NCM_CEST'    THEN ncm IS NOT NULL AND cest IS NOT NULL
      ELSE true
    END
  );

ALTER TABLE public.fiscal_difal_regra
  DROP CONSTRAINT IF EXISTS fiscal_difal_regra_codigos_bem_formados;
ALTER TABLE public.fiscal_difal_regra
  ADD CONSTRAINT fiscal_difal_regra_codigos_bem_formados CHECK (
    (ncm IS NULL OR ncm ~ '^[0-9]{8}$')
    AND (ncm_prefixo IS NULL OR ncm_prefixo ~ '^[0-9]{2,8}$')
    AND (cest IS NULL OR cest ~ '^[0-9]{7}$')
  );

ALTER TABLE public.fiscal_difal_regra
  DROP CONSTRAINT IF EXISTS fiscal_difal_regra_vigencia_coerente;
ALTER TABLE public.fiscal_difal_regra
  ADD CONSTRAINT fiscal_difal_regra_vigencia_coerente CHECK (
    vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio
  );

ALTER TABLE public.fiscal_difal_regra
  DROP CONSTRAINT IF EXISTS fiscal_difal_regra_percentuais_validos;
ALTER TABLE public.fiscal_difal_regra
  ADD CONSTRAINT fiscal_difal_regra_percentuais_validos CHECK (
    (aliquota_icms_interna IS NULL OR (aliquota_icms_interna >= 0 AND aliquota_icms_interna <= 100))
    AND (aliquota_fcp IS NULL OR (aliquota_fcp >= 0 AND aliquota_fcp <= 100))
    AND (reducao_base IS NULL OR (reducao_base >= 0 AND reducao_base <= 100))
  );

-- Uma regra que não determina nada não deveria existir: ela só produziria
-- bloqueio com aparência de configuração.
ALTER TABLE public.fiscal_difal_regra
  DROP CONSTRAINT IF EXISTS fiscal_difal_regra_determina_algo;
ALTER TABLE public.fiscal_difal_regra
  ADD CONSTRAINT fiscal_difal_regra_determina_algo CHECK (
    aliquota_icms_interna IS NOT NULL OR aliquota_fcp IS NOT NULL OR reducao_base IS NOT NULL
  );

ALTER TABLE public.fiscal_difal_regra
  DROP CONSTRAINT IF EXISTS fiscal_difal_regra_prioridade_positiva;
ALTER TABLE public.fiscal_difal_regra
  ADD CONSTRAINT fiscal_difal_regra_prioridade_positiva CHECK (prioridade > 0);

-- Duas linhas idênticas em UF, tipo, identificador e início de vigência seriam
-- conflito garantido em toda emissão. Barrar na escrita evita descobrir isso
-- na hora de emitir.
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_difal_regra_sem_duplicata
  ON public.fiscal_difal_regra (
    uf, tipo_regra, coalesce(ncm, ''), coalesce(ncm_prefixo, ''), coalesce(cest, ''), vigencia_inicio
  )
  WHERE ativo;

CREATE INDEX IF NOT EXISTS fiscal_difal_regra_busca
  ON public.fiscal_difal_regra (uf, vigencia_inicio DESC)
  WHERE ativo;

CREATE OR REPLACE FUNCTION public.fiscal_difal_regra_touch_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fiscal_difal_regra_atualizado_em ON public.fiscal_difal_regra;
CREATE TRIGGER fiscal_difal_regra_atualizado_em
  BEFORE UPDATE ON public.fiscal_difal_regra
  FOR EACH ROW EXECUTE FUNCTION public.fiscal_difal_regra_touch_atualizado_em();

-- Mesmo padrão das tabelas do SPED: nada de acesso direto pelo cliente.
ALTER TABLE public.fiscal_difal_regra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_difal_regra NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fiscal_difal_regra FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.fiscal_difal_regra TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_difal_regra_touch_atualizado_em() TO service_role;

INSERT INTO public.permissao(nome, descricao) VALUES
  ('fiscal:difal', 'Consultar as regras de DIFAL/FCP por UF'),
  ('fiscal:difal_gerenciar', 'Cadastrar, alterar e desativar regras de DIFAL/FCP')
ON CONFLICT(nome) DO UPDATE SET descricao = EXCLUDED.descricao;

-- Gerenciar regra fiscal muda o imposto de toda nota futura: nasce só no
-- perfil administrativo. A leitura acompanha quem já emite nota, porque a tela
-- de emissão precisa explicar de onde veio a alíquota.
INSERT INTO public.perfilpermissao(perfilid, permissaoid)
SELECT p.id, permissao.id
  FROM public.perfil p
  JOIN public.permissao permissao
    ON permissao.nome IN ('fiscal:difal', 'fiscal:difal_gerenciar')
 WHERE upper(p.nome) = 'ADMINISTRADOR'
ON CONFLICT DO NOTHING;

-- Carga inicial: tabela oficial do Portal Nacional do DIFAL (SVRS/ENCAT),
-- capturada em 22/09/2026. As linhas com ativo = false estão documentadas uma a
-- uma em nota_curadoria: a fonte oficial é ambígua ou diverge da referência
-- histórica do ERP, e escolher por conta própria seria inventar alíquota.
INSERT INTO public.fiscal_difal_regra (
  uf, tipo_regra, descricao,
  aliquota_icms_interna, aliquota_fcp,
  vigencia_inicio, vigencia_fim, prioridade,
  fonte, fonte_url, fundamento_legal, data_fonte, ativo, nota_curadoria, importado_em
) VALUES
  ('PI', 'GERAL', 'REGRA GERAL (MODAL): operações e prestações internas com mercadorias e serviços não relacionados nas demais faixas', 21, 0, '2023-03-08', '2025-03-31', 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 4.257/89 (art. 23, I, "c") e Decreto nº 21.866/2023 (art. 21, I, "c")', '2023-03-08', true, 'Portal declara Fundo de Combate à Pobreza = "Não" para a regra geral: FCP determinado como zero.', '2026-09-22'),
  ('PI', 'GERAL', 'REGRA GERAL (ALÍQUOTA MODAL 22,5%): operações e prestações internas com mercadorias e serviços não relacionados nas demais faixas', 22.5, 0, '2025-04-01', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 8.558/2024 (alíquota modal), alterando a Lei nº 4.257/89', '2025-04-01', true, 'Portal declara Fundo de Combate à Pobreza = "NÃO" para a regra geral: FCP determinado como zero. Confere com a legislação estadual (Lei nº 8.558/2024, efeitos a partir de 01/04/2025).', '2026-09-22'),
  ('RJ', 'GERAL', 'Alíquota padrão para operações ou prestações internas', 18, 2, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 2.657/96 (art. 14, I); FECP na forma da Lei nº 4.056/02', '2021-12-30', true, 'Interna e FCP vêm declarados e separados no portal. A referência histórica do ERP usava 20%, que é a soma 18 + 2 — no DIFAL os dois campos são distintos (pICMSUFDest e pFCPUFDest), então a separação é a forma correta.', '2026-09-22'),
  ('GO', 'GERAL', 'Regra Geral', 19, 0, '2024-04-01', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 27 do CTE (Lei nº 11.651/91)', '2024-04-01', true, 'Portal declara FCP = "0%" explicitamente para a regra geral.', '2026-09-22'),
  ('RR', 'GERAL', 'Demais mercadorias', 20, 0, '2023-03-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 32, I, "d" da Lei nº 059/93, com redação da Lei nº 1.767/2022', '2023-03-30', true, 'Portal declara FCP = "não se aplica" para a regra geral: FCP determinado como zero.', '2026-09-22'),
  ('AC', 'GERAL', 'Regra Geral', 19, NULL, '2023-04-01', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 18, I da Lei Complementar nº 055/97 e art. 17 do RICMS (Decreto nº 008/98)', '2023-04-01', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral: fica NULL e o FCP continua exigindo confirmação.', '2026-09-22'),
  ('AP', 'GERAL', 'Regra Geral', 18, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 37, III, "i" da Lei nº 400/97 (CTAP)', '2021-12-30', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral.', '2026-09-22'),
  ('BA', 'GERAL', 'Regra Geral', 20.5, NULL, '2024-02-07', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 7.014/96 (art. 16)', '2024-02-07', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral.', '2026-09-22'),
  ('DF', 'GERAL', 'Regra Geral', 20, NULL, '2024-01-22', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 1.254/96 (art. 18)', '2024-01-22', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral.', '2026-09-22'),
  ('ES', 'GERAL', 'Regra Geral', 17, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 20, I da Lei nº 7.000/01', '2021-12-30', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral.', '2026-09-22'),
  ('MG', 'GERAL', 'Demais operações e prestações de serviço', 18, NULL, '2023-07-01', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Decreto nº 48.589/2023 (Anexo I, Parte 1, item 7, subitem 7.1)', '2023-07-01', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral.', '2026-09-22'),
  ('MS', 'GERAL', 'Regra Geral', 17, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 1.810/97 (art. 41)', '2021-12-30', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral.', '2026-09-22'),
  ('MT', 'GERAL', 'Regra Geral', 17, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 7.098/98 (art. 14, I, "a", "c", "d")', '2021-12-30', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral.', '2026-09-22'),
  ('RS', 'GERAL', 'Regra Geral', 17, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 27, X, Livro I do RICMS/RS', '2021-12-30', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral.', '2026-09-22'),
  ('SC', 'GERAL', 'Regra Geral', 17, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'RICMS/SC (art. 26, I)', '2021-12-30', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral.', '2026-09-22'),
  ('SP', 'GERAL', 'Regra Geral', 18, NULL, '2023-02-03', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 52, I do RICMS/00', '2023-02-03', true, 'Interna confere com a referência histórica do ERP. Portal não declara FCP da regra geral.', '2026-09-22'),
  ('AL', 'GERAL', 'Regra Geral', 20.5, 1, '2023-04-01', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 17, I, "b" da Lei nº 5.900/1996 e art. 2º-A da Lei nº 6.558/2004', '2023-04-01', false, 'DESATIVADA: a própria observação do portal se contradiz — declara 20,5% na linha e, no texto, "a partir de 01/04/2023 a alíquota interna da regra geral é 19%, conforme Lei 8.779/2022". Referência histórica do ERP usava 20%. Três valores diferentes: exige confirmação humana.', '2026-09-22'),
  ('CE', 'GERAL', 'Regra Geral', 18, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 12.670/96', '2021-12-30', false, 'DESATIVADA: portal publica 18% com atualização de 30/12/2021; a referência histórica do ERP usa 20%. Divergência não resolvida pela fonte oficial consultada.', '2026-09-22'),
  ('MA', 'GERAL', 'Regra Geral', 18, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 23, III, "a" da Lei nº 7.799/02', '2021-12-30', false, 'DESATIVADA: portal publica 18% com atualização de 30/12/2021; a referência histórica do ERP usa 23%. Divergência não resolvida pela fonte oficial consultada.', '2026-09-22'),
  ('PA', 'GERAL', 'Regra Geral', 17, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 5.530/89', '2021-12-30', false, 'DESATIVADA: portal publica 17% com atualização de 30/12/2021; a referência histórica do ERP usa 19%. Divergência não resolvida pela fonte oficial consultada.', '2026-09-22'),
  ('PB', 'GERAL', 'Regra Geral', 20, NULL, '2024-01-01', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 6.379/96 (art. 13)', '2024-01-01', false, 'DESATIVADA: no portal a linha "Regra Geral" da PB traz 20% com FCP 2%, mas a observação da mesma linha lista bebidas alcoólicas, armas e embarcações — o FCP de 2% é dessas mercadorias, não da regra geral. A interna de 20% confere com a referência do ERP; o FCP da regra geral não é determinável pela linha publicada.', '2026-09-22'),
  ('PE', 'GERAL', 'Regra Geral', 18, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei nº 15.730/2016 (art. 15, VII, "a")', '2021-12-30', false, 'DESATIVADA: portal publica 18% com atualização de 30/12/2021; a referência histórica do ERP usa 20,5%. Divergência não resolvida pela fonte oficial consultada.', '2026-09-22'),
  ('PR', 'GERAL', 'Regra Geral', 18, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 14, VI da Lei nº 11.580/1996', '2021-12-30', false, 'DESATIVADA: portal publica 18% com atualização de 30/12/2021; a referência histórica do ERP usa 19,5%. Divergência não resolvida pela fonte oficial consultada.', '2026-09-22'),
  ('RN', 'GERAL', 'Regra Geral', 18, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 104, I, "a" do RICMS/RN', '2021-12-30', false, 'DESATIVADA: portal publica 18% com atualização de 30/12/2021; a referência histórica do ERP usa 20%. Divergência não resolvida pela fonte oficial consultada.', '2026-09-22'),
  ('SE', 'GERAL', 'Regra Geral', 19, NULL, '2024-08-28', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 18 da Lei nº 3.796/96 e art. 40 do RICMS/SE', '2024-08-28', false, 'DESATIVADA: portal declara FCP como "1% ou 2% — vide arts. 40-C e 40-D", que não é determinístico, e a interna de 19% diverge da referência histórica do ERP (20%).', '2026-09-22'),
  ('TO', 'GERAL', 'Regra Geral', 18, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 513-I do RICMS (Decreto nº 2.912/06)', '2021-12-30', false, 'DESATIVADA: o campo FCP do portal é um texto que lista mercadorias (comunicação, combustíveis, armas, joias, fumo) em vez de uma alíquota da regra geral, e a interna de 18% diverge da referência histórica do ERP (20%).', '2026-09-22'),
  ('AM', 'GERAL', 'Alíquota modal', 20, NULL, '2021-12-30', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Lei Complementar nº 19/97', '2021-12-30', false, 'DESATIVADA: o portal não publica uma linha de regra geral para mercadorias no AM — a linha de alíquota modal é qualificada como aplicável a GLP, GLGN, óleo diesel e serviços. Valor carregado é o da referência histórica do ERP, sem confirmação oficial.', '2026-09-22'),
  ('RO', 'GERAL', 'Regra Geral', 19.5, NULL, '2023-01-02', NULL, 10, 'Portal Nacional do DIFAL (SVRS/ENCAT) — aba Alíquotas', 'https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas', 'Art. 27 da Lei Complementar nº 688/96 (CTE-RO) e art. 12 do Decreto nº 22.721/18 (RICMS-RO)', '2023-01-02', false, 'DESATIVADA: a linha do portal é internamente inconsistente — o rótulo diz "17,5% - Regra Geral" e a célula de alíquota traz 7,5%. Valor carregado é o da referência histórica do ERP (19,5%), sem confirmação oficial.', '2026-09-22')
ON CONFLICT DO NOTHING;

COMMIT;
