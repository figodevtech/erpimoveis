-- Reaproveita a permissão e seus vínculos. O nome exibido passa a ser
-- Caixa administrativo; nenhuma transação ou perfil é reclassificado aqui.
-- A visibilidade será calculada pelo perfil ATUAL do criador nas APIs.
UPDATE public.permissao
SET descricao = 'Caixa administrativo: permite consultar todas as transações no Fluxo de Caixa e em Bancos. Os lançamentos de quem possui esta permissão ficam ocultos nessas telas para usuários sem ela. A classificação acompanha o perfil atual do criador; registros sem autor continuam compartilhados.'
WHERE lower(btrim(nome)) = 'financeiro:ver_todas_transacoes';
