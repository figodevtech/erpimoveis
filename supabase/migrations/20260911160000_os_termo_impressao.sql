BEGIN;

-- Os dizeres do rodapé da ordem de serviço (o termo de aceite que o cliente
-- assina) eram constantes de código: mudar uma vírgula, um prazo ou o valor da
-- diária exigia deploy, e cada oficina tem a sua redação. Agora são cadastro.
--
-- Cada linha é um bloco de dizeres e escolhe sozinha quando aparece: `status`
-- diz em quais status da OS ele imprime e `alvos` em quais tipos de objeto
-- (veículo, peça, máquina). Dois blocos podem cair na mesma impressão — saem
-- na ordem de `ordem`.
--
-- A tabela nasce com os cinco blocos que já vinham sendo impressos, para que no
-- dia da subida nada mude no papel e a oficina encontre o texto atual pronto
-- para editar. Eles são cópia do que `getTermoAceiteOS` produzia, e o mesmo
-- conteúdo vive em src/lib/ordens/termos-impressao-padrao.ts — de onde a tela
-- restaura o padrão e para onde a impressão cai se o banco falhar.
-- `termos-impressao.test.ts` compara os dois e acusa qualquer divergência.
CREATE TABLE IF NOT EXISTS public.os_termo_impressao (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo     text NOT NULL,
  intro      text NOT NULL DEFAULT '',
  itens      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status     public.enum_status_os[] NOT NULL DEFAULT '{}',
  alvos      text[] NOT NULL DEFAULT '{}',
  ordem      integer NOT NULL DEFAULT 0,
  createdat  timestamp with time zone NOT NULL DEFAULT now(),
  updatedat  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT os_termo_impressao_titulo_chk CHECK (btrim(titulo) <> ''),
  CONSTRAINT os_termo_impressao_itens_chk CHECK (jsonb_typeof(itens) = 'array'),
  CONSTRAINT os_termo_impressao_alvos_chk
    CHECK (alvos <@ ARRAY['VEICULO', 'PECA', 'EQUIPAMENTO']::text[]),
  CONSTRAINT os_termo_impressao_ordem_chk CHECK (ordem >= 0)
);

COMMENT ON TABLE public.os_termo_impressao IS
  'Blocos de dizeres impressos no rodapé da OS. Vazia = a OS imprime sem termo de aceite.';
COMMENT ON COLUMN public.os_termo_impressao.status IS
  'Status da OS em que o bloco imprime. Vazio nunca casa — é o jeito de guardar um texto desligado.';
COMMENT ON COLUMN public.os_termo_impressao.alvos IS
  'Alvos em que o bloco imprime: VEICULO, PECA ou EQUIPAMENTO.';

CREATE INDEX IF NOT EXISTS os_termo_impressao_ordem_idx
  ON public.os_termo_impressao (ordem, id);

ALTER TABLE public.os_termo_impressao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_termo_impressao NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.os_termo_impressao FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.os_termo_impressao TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Só semeia numa tabela virgem: rodar a migration de novo (ou num banco que já
-- personalizou os dizeres) não pode ressuscitar o texto de fábrica.
INSERT INTO public.os_termo_impressao (titulo, intro, itens, status, alvos, ordem)
SELECT * FROM (
  VALUES
    (
      'Termo de aceite do orçamento',
      'Declaro estar ciente de que:',
      '[
        "Li e concordo com os serviços, peças e valores descritos nesta Ordem de Serviço, autorizando a execução dos serviços no veículo acima identificado.",
        "Serviços ou peças adicionais identificados durante a execução serão comunicados previamente e dependerão de nova autorização.",
        "O prazo de conclusão pode variar conforme a disponibilidade das peças, e os valores apresentados podem sofrer alteração caso a aprovação não ocorra na data de emissão deste documento.",
        "Após a comunicação da criação, atualização ou conclusão da Ordem de Serviço, tenho o prazo de 72 (setenta e duas) horas para retirar o veículo da oficina. Após esse período, poderá ser cobrada diária pela utilização do espaço, no valor de R$ 50,00 para veículos pesados e R$ 20,00 para veículos leves."
      ]'::jsonb,
      ARRAY['AGUARDANDO_CHECKLIST', 'ORCAMENTO', 'APROVACAO_ORCAMENTO', 'ORCAMENTO_APROVADO', 'ORCAMENTO_RECUSADO', 'EM_ANDAMENTO']::public.enum_status_os[],
      ARRAY['VEICULO']::text[],
      0
    ),
    (
      'Termo de aceite do orçamento',
      'Declaro estar ciente de que:',
      '[
        "Li e concordo com os serviços, peças e valores descritos nesta Ordem de Serviço, autorizando a execução dos serviços na {{alvo}} acima identificada.",
        "Serviços ou peças adicionais identificados durante a execução serão comunicados previamente e dependerão de nova autorização.",
        "O prazo de conclusão pode variar conforme a disponibilidade das peças, e os valores apresentados podem sofrer alteração caso a aprovação não ocorra na data de emissão deste documento.",
        "Após a comunicação da criação, atualização ou conclusão da Ordem de Serviço, tenho o prazo de 72 (setenta e duas) horas para retirar a {{alvo}} da oficina. Após esse período, poderá ser cobrada diária pela utilização do espaço, conforme os valores praticados pela empresa."
      ]'::jsonb,
      ARRAY['AGUARDANDO_CHECKLIST', 'ORCAMENTO', 'APROVACAO_ORCAMENTO', 'ORCAMENTO_APROVADO', 'ORCAMENTO_RECUSADO', 'EM_ANDAMENTO']::public.enum_status_os[],
      ARRAY['PECA', 'EQUIPAMENTO']::text[],
      10
    ),
    (
      'Termo de aceite e saída do veículo',
      'Declaro estar ciente de que:',
      '[
        "Testei o veículo e confirmo que o problema informado foi devidamente resolvido, tendo conferido os serviços executados e as peças aplicadas.",
        "Estou retirando meu veículo da oficina nas mesmas condições de conservação em que o entreguei, ressalvadas as alterações decorrentes dos serviços executados.",
        "Estou de acordo com todas as observações, informações e condições de garantia constantes nesta Ordem de Serviço, nada mais tendo a reclamar quanto aos itens aqui relacionados.",
        "Após a comunicação da criação, atualização ou conclusão da Ordem de Serviço, tenho o prazo de 72 (setenta e duas) horas para retirar o veículo da oficina. Após esse período, poderá ser cobrada diária pela utilização do espaço, no valor de R$ 50,00 para veículos pesados e R$ 20,00 para veículos leves."
      ]'::jsonb,
      ARRAY['PAGAMENTO', 'FATURAMENTO', 'SEM_COBRANCA', 'CONCLUIDO']::public.enum_status_os[],
      ARRAY['VEICULO']::text[],
      20
    ),
    (
      'Termo de aceite e retirada da peça/componente',
      'Declaro estar ciente de que:',
      '[
        "Conferi a peça/componente e confirmo que o problema informado foi devidamente resolvido, tendo conferido os serviços executados e as peças aplicadas.",
        "Estou retirando a peça/componente da oficina nas mesmas condições de conservação em que a entreguei, ressalvadas as alterações decorrentes dos serviços executados.",
        "Estou de acordo com todas as observações, informações e condições de garantia constantes nesta Ordem de Serviço, nada mais tendo a reclamar quanto aos itens aqui relacionados.",
        "Após a comunicação da criação, atualização ou conclusão da Ordem de Serviço, tenho o prazo de 72 (setenta e duas) horas para retirar a {{alvo}} da oficina. Após esse período, poderá ser cobrada diária pela utilização do espaço, conforme os valores praticados pela empresa."
      ]'::jsonb,
      ARRAY['PAGAMENTO', 'FATURAMENTO', 'SEM_COBRANCA', 'CONCLUIDO']::public.enum_status_os[],
      ARRAY['PECA']::text[],
      30
    ),
    (
      'Termo de aceite e retirada da máquina/equipamento',
      'Declaro estar ciente de que:',
      '[
        "Testei a máquina/equipamento e confirmo que o problema informado foi devidamente resolvido, tendo conferido os serviços executados e as peças aplicadas.",
        "Estou retirando a máquina/equipamento da oficina nas mesmas condições de conservação em que a entreguei, ressalvadas as alterações decorrentes dos serviços executados.",
        "Estou de acordo com todas as observações, informações e condições de garantia constantes nesta Ordem de Serviço, nada mais tendo a reclamar quanto aos itens aqui relacionados.",
        "Após a comunicação da criação, atualização ou conclusão da Ordem de Serviço, tenho o prazo de 72 (setenta e duas) horas para retirar a {{alvo}} da oficina. Após esse período, poderá ser cobrada diária pela utilização do espaço, conforme os valores praticados pela empresa."
      ]'::jsonb,
      ARRAY['PAGAMENTO', 'FATURAMENTO', 'SEM_COBRANCA', 'CONCLUIDO']::public.enum_status_os[],
      ARRAY['EQUIPAMENTO']::text[],
      40
    )
) AS padrao(titulo, intro, itens, status, alvos, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.os_termo_impressao);

-- A tela salva a lista inteira de uma vez. Trocar linha a linha deixaria a
-- impressão sem termo nenhum no meio do caminho (e a aplicação cairia no texto
-- padrão, desfazendo a personalização em silêncio), então apagar e reinserir
-- acontece dentro da mesma transação. A ordem é a da lista recebida.
CREATE OR REPLACE FUNCTION public.salvar_os_termos_impressao(p_termos jsonb)
RETURNS SETOF public.os_termo_impressao
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF p_termos IS NULL OR jsonb_typeof(p_termos) <> 'array' THEN
    RAISE EXCEPTION 'Os dizeres devem vir como uma lista.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.os_termo_impressao;

  RETURN QUERY
  WITH inseridos AS (
    INSERT INTO public.os_termo_impressao (titulo, intro, itens, status, alvos, ordem)
    SELECT
      btrim(termo->>'titulo'),
      coalesce(btrim(termo->>'intro'), ''),
      CASE WHEN jsonb_typeof(termo->'itens') = 'array' THEN termo->'itens' ELSE '[]'::jsonb END,
      ARRAY(SELECT jsonb_array_elements_text(termo->'status'))::public.enum_status_os[],
      ARRAY(SELECT jsonb_array_elements_text(termo->'alvos')),
      (posicao - 1) * 10
    FROM jsonb_array_elements(p_termos) WITH ORDINALITY AS entrada(termo, posicao)
    RETURNING *
  )
  SELECT * FROM inseridos ORDER BY ordem, id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.salvar_os_termos_impressao(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_os_termos_impressao(jsonb) TO service_role;

COMMIT;
