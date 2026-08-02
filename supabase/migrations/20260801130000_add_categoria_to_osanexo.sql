-- Tipo de documento nos anexos: a OS ganha a coluna que a venda ja tinha e as
-- duas passam a aceitar NOTA_FISCAL, usada ao anexar o DANFE automaticamente.
alter table public.osanexo
add column if not exists categoria text;

update public.osanexo
set categoria = 'OUTROS'
where categoria is null;

alter table public.osanexo
alter column categoria set default 'OUTROS';

alter table public.osanexo
alter column categoria set not null;

alter table public.osanexo
drop constraint if exists osanexo_categoria_check;

alter table public.osanexo
add constraint osanexo_categoria_check
check (
  categoria in (
    'NOTA_FISCAL',
    'COMPROVANTE_PAGAMENTO',
    'DOCUMENTO_PESSOAL',
    'COMPROVANTE_ENTREGA',
    'COMPROVANTE_ENVIO',
    'COMUNICACAO_CLIENTE',
    'CANCELAMENTO_ESTORNO',
    'AUTORIZACAO_PROCURACAO',
    'OUTROS'
  )
);

alter table public.vendaanexo
drop constraint if exists vendaanexo_categoria_check;

alter table public.vendaanexo
add constraint vendaanexo_categoria_check
check (
  categoria in (
    'NOTA_FISCAL',
    'COMPROVANTE_PAGAMENTO',
    'DOCUMENTO_PESSOAL',
    'COMPROVANTE_ENTREGA',
    'COMPROVANTE_ENVIO',
    'COMUNICACAO_CLIENTE',
    'CANCELAMENTO_ESTORNO',
    'AUTORIZACAO_PROCURACAO',
    'OUTROS'
  )
);
