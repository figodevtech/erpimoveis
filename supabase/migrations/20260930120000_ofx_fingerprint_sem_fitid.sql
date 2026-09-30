begin;

-- O fingerprint do movimento de extrato deixou de usar o FITID: o C6 gera um
-- FITID novo a cada exportação, e o mesmo movimento em dois arquivos virava dois.
-- Os valores gravados são recalculados por scripts/db/recalcular-fingerprint-ofx.ts;
-- aqui só o comentário da coluna acompanha a regra.
comment on column public.ofx_movimento.fingerprint is
  'Identidade determinística da linha: conta, data, valor com sinal, tipo, CHECKNUM, REFNUM, NAME, MEMO e a ocorrência dentro do arquivo. Sem FITID — há banco que o repete em movimentos diferentes e banco que o regenera a cada exportação (C6).';

commit;
