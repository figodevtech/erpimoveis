-- Corrige o retroativo para considerar somente a auditoria que efetivamente
-- mudou o status. Uma edicao posterior mantem o status no snapshot, mas nao
-- representa uma nova finalizacao da OS.

select set_config('app.permitir_alterar_os_migrada', 'on', false);

with datas_finais_precisas as (
  select os.id,
    coalesce(
      os.pagamento_concluido_em,
      (select max(a.ocorrido_em)
         from public.auditoria_evento a
        where a.tabela = 'ordemservico'
          and a.registro_id = os.id::text
          and a.dados_novos ->> 'status' = os.status::text
          and a.campos_alterados @> array['status']::text[]),
      (select max(e.created_at)
         from public.os_notificacao_evento e
        where e.ordemservico_id = os.id
          and e.status_novo = os.status::text),
      os.updatedat,
      os.dataentrada,
      now()
    ) finalizado_em
  from public.ordemservico os
  where os.status::text in ('CONCLUIDO', 'SEM_COBRANCA', 'CANCELADO')
)
update public.ordemservico os
   set finalizado_em = datas.finalizado_em
  from datas_finais_precisas datas
 where os.id = datas.id
   and os.finalizado_em is distinct from datas.finalizado_em;

select set_config('app.permitir_alterar_os_migrada', '', false);
