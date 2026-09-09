update public.mercadolivre_sync_run
set status = 'ERRO',
    error = coalesce(error, 'Execução antiga encerrada durante a atualização do agendador.'),
    completed_at = coalesce(completed_at, now())
where status = 'PROCESSANDO';

create unique index if not exists mercadolivre_sync_run_one_active_job_idx
  on public.mercadolivre_sync_run(job_name)
  where status = 'PROCESSANDO';

comment on index public.mercadolivre_sync_run_one_active_job_idx is
  'Impede duas execuções simultâneas da mesma etapa de sincronização Mercado Livre.';
