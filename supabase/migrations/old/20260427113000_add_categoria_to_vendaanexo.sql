alter table public.vendaanexo
add column if not exists categoria text;

update public.vendaanexo
set categoria = 'OUTROS'
where categoria is null;

alter table public.vendaanexo
alter column categoria set default 'OUTROS';

alter table public.vendaanexo
alter column categoria set not null;

alter table public.vendaanexo
drop constraint if exists vendaanexo_categoria_check;

alter table public.vendaanexo
add constraint vendaanexo_categoria_check
check (
  categoria in (
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
