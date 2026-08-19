-- "Impostos" como tipo de acrescimo lancavel na transacao.
--
-- Ate aqui, tributo dentro de um recebimento so cabia em "Outro acrescimo", que
-- nao diz nada a quem le o extrato depois. Com linha propria, a aba Acrescimos e
-- descontos passa a separar imposto de juros e de multa, e o relatorio consegue
-- somar o que foi tributo sem alguem ter de ler descricao por descricao.
--
-- Nao e de sistema (`codigo_sistema` fica nulo): quem lanca e a pessoa, pela
-- aba. So a taxa de recebimento e a de antecipacao sao inseridas pelo proprio
-- ERP, e e isso que aquela coluna marca.
--
-- ONDE ELE VAI APARECER
-- Acrescimo mexe no valor BRUTO, e a trava de 20260806120000_travar_valor_apos_baixa
-- recusa isso depois da baixa. Por isso a aba so oferece acrescimos em transacao
-- PENDENTE — `tiposDisponiveis` em ajustes-tab.tsx filtra por natureza quando o
-- titulo ja foi baixado. Em titulo liquidado, "Impostos" nao vai aparecer na
-- lista, e nao e defeito: e a mesma regra que ja vale para Juros e Multa.
BEGIN;

INSERT INTO public.tipos_ajuste_transacao (codigo, nome, natureza, codigo_sistema, descricao)
VALUES ('IMPOSTOS', 'Impostos', 'ACRESCIMO', NULL,
        'Tributos cobrados dentro do valor da transação.')
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
