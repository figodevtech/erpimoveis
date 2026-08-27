begin;

-- A Central Operacional e uma projecao visual. Esta tabela guarda somente o
-- log necessario para reconstruir o feed e nunca substitui o estado dos
-- modulos de origem.
create table if not exists public.central_evento_operacional (
  id uuid primary key default gen_random_uuid(),
  tenant_id integer not null references public.empresa(id) on delete restrict,
  tipo text not null check (tipo in (
    'OS_CRIADA',
    'OS_INICIO_EXECUCAO',
    'OS_FINALIZADA',
    'OS_CANCELADA',
    'OS_AGUARDANDO_PAGAMENTO',
    'VENDA_CRIADA',
    'VENDA_CONFIRMADA',
    'VENDA_CANCELADA',
    'PAGAMENTO_RECEBIDO',
    'TRANSACAO_CRIADA',
    'TRANSACAO_PAGA',
    'PIX_RECEBIDO',
    'ESTOQUE_ENTRADA',
    'ESTOQUE_SAIDA',
    'ESTOQUE_BAIXO',
    'NFE_EMISSAO_INICIADA',
    'NFE_AUTORIZADA',
    'NFE_REJEITADA',
    'NFSE_EMISSAO_INICIADA',
    'NFSE_AUTORIZADA',
    'NFSE_REJEITADA',
    'CONTA_CRIADA',
    'CONTA_PAGA',
    'CONTA_VENCIDA'
  )),
  modulo text not null check (modulo in (
    'VENDAS', 'ORDENS', 'FINANCEIRO', 'CONTAS_PAGAR', 'ESTOQUE', 'FISCAL'
  )),
  entidade_tipo text not null,
  entidade_id text,
  titulo text not null,
  descricao text,
  valor numeric(14,2),
  quantidade numeric(14,4),
  prioridade text not null default 'INFO' check (prioridade in ('INFO', 'ATENCAO', 'CRITICO')),
  metadata jsonb not null default '{}'::jsonb,
  event_key text not null,
  ocorrido_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint central_evento_operacional_tenant_event_key_uk unique (tenant_id, event_key)
);

create index if not exists central_evento_operacional_feed_idx
  on public.central_evento_operacional (tenant_id, ocorrido_em desc, id desc);
create index if not exists central_evento_operacional_modulo_idx
  on public.central_evento_operacional (tenant_id, modulo, ocorrido_em desc);
create index if not exists central_evento_operacional_retencao_idx
  on public.central_evento_operacional (created_at);

alter table public.central_evento_operacional enable row level security;
alter table public.central_evento_operacional no force row level security;
revoke all on table public.central_evento_operacional from public, anon, authenticated;
grant select, insert, update, delete on table public.central_evento_operacional to service_role;

-- O ERP usa um projeto/banco Supabase por instalacao e uma empresa ativa por
-- banco. Centralizar esta resolucao evita que triggers de tabelas antigas, que
-- nao possuem empresa_id, inventem um tenant proprio.
create or replace function public.central_operacional_tenant_id()
returns integer
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select id from public.empresa order by id asc limit 1
$$;

-- Insercao idempotente + Broadcast privado. O payload e deliberadamente opaco:
-- permissoes por modulo sao aplicadas pela API de snapshot antes de qualquer
-- titulo, valor ou metadata chegar ao navegador.
create or replace function public.central_emitir_evento_operacional(
  p_tenant_id integer,
  p_tipo text,
  p_modulo text,
  p_entidade_tipo text,
  p_entidade_id text,
  p_titulo text,
  p_descricao text,
  p_valor numeric,
  p_quantidade numeric,
  p_prioridade text,
  p_metadata jsonb,
  p_event_key text,
  p_ocorrido_em timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
  v_id uuid;
  v_criado_em timestamptz;
begin
  if p_tenant_id is null then
    return null;
  end if;

  -- Retencao oportunista: o indice torna a limpeza barata e evita depender de
  -- pg_cron, que nao esta habilitado em todas as instalacoes.
  delete from public.central_evento_operacional
  where tenant_id = p_tenant_id
    and created_at < now() - interval '90 days';

  insert into public.central_evento_operacional (
    tenant_id, tipo, modulo, entidade_tipo, entidade_id, titulo, descricao,
    valor, quantidade, prioridade, metadata, event_key, ocorrido_em
  ) values (
    p_tenant_id,
    p_tipo,
    p_modulo,
    p_entidade_tipo,
    nullif(p_entidade_id, ''),
    p_titulo,
    nullif(p_descricao, ''),
    p_valor,
    p_quantidade,
    coalesce(p_prioridade, 'INFO'),
    coalesce(p_metadata, '{}'::jsonb),
    p_event_key,
    coalesce(p_ocorrido_em, now())
  )
  on conflict (tenant_id, event_key) do nothing
  returning id, created_at into v_id, v_criado_em;

  if v_id is not null then
    perform realtime.send(
      jsonb_build_object(
        'eventId', v_id,
        'createdAt', v_criado_em
      ),
      'operational_changed',
      'operational:tenant:' || p_tenant_id::text,
      true
    );
  end if;

  return v_id;
end;
$$;

create or replace function public.central_evento_ordemservico()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant integer := public.central_operacional_tenant_id();
  v_tipo text;
  v_titulo text;
  v_prioridade text := 'INFO';
begin
  if new.is_deleted or new.migracao_referencia is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_tipo := 'OS_CRIADA';
    v_titulo := 'OS #' || new.id::text || ' criada';
  elsif old.status is distinct from new.status then
    case new.status::text
      when 'EM_ANDAMENTO' then
        v_tipo := 'OS_INICIO_EXECUCAO';
        v_titulo := 'OS #' || new.id::text || ' iniciou execucao';
      when 'PAGAMENTO' then
        v_tipo := 'OS_AGUARDANDO_PAGAMENTO';
        v_titulo := 'OS #' || new.id::text || ' aguarda pagamento';
      when 'CONCLUIDO' then
        v_tipo := 'OS_FINALIZADA';
        v_titulo := 'OS #' || new.id::text || ' finalizada';
      when 'CANCELADO' then
        v_tipo := 'OS_CANCELADA';
        v_titulo := 'OS #' || new.id::text || ' cancelada';
        v_prioridade := 'ATENCAO';
      else
        return new;
    end case;
  else
    return new;
  end if;

  perform public.central_emitir_evento_operacional(
    v_tenant,
    v_tipo,
    'ORDENS',
    'ORDEM_SERVICO',
    new.id::text,
    v_titulo,
    null,
    null,
    null,
    v_prioridade,
    jsonb_build_object('status', new.status::text),
    case when tg_op = 'INSERT'
      then 'OS_CRIADA:' || new.id::text
      else v_tipo || ':' || new.id::text || ':' || txid_current()::text
    end,
    coalesce(new.updatedat, new.createdat, now())
  );
  return new;
exception when others then
  raise warning '[central] evento de OS ignorado: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists central_evento_ordemservico_trg on public.ordemservico;
create trigger central_evento_ordemservico_trg
after insert or update of status on public.ordemservico
for each row execute function public.central_evento_ordemservico();

create or replace function public.central_evento_venda()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant integer := public.central_operacional_tenant_id();
  v_tipo text;
  v_titulo text;
  v_prioridade text := 'INFO';
begin
  if tg_op = 'INSERT' then
    if new.status::text in ('PAGAMENTO', 'PAGO', 'FINALIZADA', 'AUTORIZADO') then
      v_tipo := 'VENDA_CONFIRMADA';
      v_titulo := 'Venda #' || new.id::text || ' confirmada';
    else
      v_tipo := 'VENDA_CRIADA';
      v_titulo := 'Venda #' || new.id::text || ' criada';
    end if;
  elsif old.status is distinct from new.status then
    if new.status::text in ('PAGAMENTO', 'PAGO', 'FINALIZADA', 'AUTORIZADO') then
      v_tipo := 'VENDA_CONFIRMADA';
      v_titulo := 'Venda #' || new.id::text || ' confirmada';
    elsif new.status::text in ('CANCELADA', 'CANCELADO') then
      v_tipo := 'VENDA_CANCELADA';
      v_titulo := 'Venda #' || new.id::text || ' cancelada';
      v_prioridade := 'ATENCAO';
    else
      return new;
    end if;
  else
    return new;
  end if;

  perform public.central_emitir_evento_operacional(
    v_tenant,
    v_tipo,
    'VENDAS',
    'VENDA',
    new.id::text,
    v_titulo,
    null,
    new.valortotal,
    null,
    v_prioridade,
    jsonb_build_object('status', new.status::text),
    case when tg_op = 'INSERT'
      then v_tipo || ':' || new.id::text
      else v_tipo || ':' || new.id::text || ':' || txid_current()::text
    end,
    coalesce(new.updatedat, new.datavenda, new.createdat, now())
  );
  return new;
exception when others then
  raise warning '[central] evento de venda ignorado: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists central_evento_venda_trg on public.venda;
create trigger central_evento_venda_trg
after insert or update of status on public.venda
for each row execute function public.central_evento_venda();

create or replace function public.central_evento_transacao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant integer := public.central_operacional_tenant_id();
  v_tipo text;
  v_modulo text := 'FINANCEIRO';
  v_titulo text;
  v_valor numeric := coalesce(new."valorLiquido", new.valor, 0);
  v_documento text;
begin
  if new.is_deleted then
    return new;
  end if;

  v_documento := case
    when new.ordemservicoid is not null then 'OS #' || new.ordemservicoid::text
    when new.vendaid is not null then 'Venda #' || new.vendaid::text
    else 'Transacao #' || new.id::text
  end;

  if tg_op = 'INSERT' then
    if new.tipo::text = 'DESPESA' and new.pendente then
      v_tipo := 'CONTA_CRIADA';
      v_modulo := 'CONTAS_PAGAR';
      v_titulo := 'Conta a pagar criada · #' || new.id::text;
    elsif new.tipo::text = 'RECEITA' and not new.pendente then
      v_tipo := case when new.metodopagamento::text = 'PIX' then 'PIX_RECEBIDO' else 'PAGAMENTO_RECEBIDO' end;
      v_titulo := case when v_tipo = 'PIX_RECEBIDO' then 'PIX recebido · ' else 'Pagamento recebido · ' end || v_documento;
    elsif new.tipo::text = 'DESPESA' and not new.pendente then
      v_tipo := 'TRANSACAO_PAGA';
      v_titulo := 'Transacao paga · #' || new.id::text;
    else
      v_tipo := 'TRANSACAO_CRIADA';
      v_titulo := 'Movimentacao financeira · #' || new.id::text;
    end if;
  elsif old.pendente is true and new.pendente is false then
    if new.tipo::text = 'DESPESA' then
      v_tipo := 'CONTA_PAGA';
      v_modulo := 'CONTAS_PAGAR';
      v_titulo := 'Conta paga · #' || new.id::text;
    elsif new.tipo::text = 'RECEITA' then
      v_tipo := case when new.metodopagamento::text = 'PIX' then 'PIX_RECEBIDO' else 'PAGAMENTO_RECEBIDO' end;
      v_titulo := case when v_tipo = 'PIX_RECEBIDO' then 'PIX recebido · ' else 'Pagamento recebido · ' end || v_documento;
    else
      v_tipo := 'TRANSACAO_PAGA';
      v_titulo := 'Transacao paga · #' || new.id::text;
    end if;
  else
    return new;
  end if;

  perform public.central_emitir_evento_operacional(
    v_tenant,
    v_tipo,
    v_modulo,
    'TRANSACAO',
    new.id::text,
    v_titulo,
    new.metodopagamento::text,
    v_valor,
    null,
    'INFO',
    jsonb_strip_nulls(jsonb_build_object(
      'ordemServicoId', new.ordemservicoid,
      'vendaId', new.vendaid,
      'tipo', new.tipo::text
    )),
    case when tg_op = 'INSERT'
      then v_tipo || ':' || new.id::text
      else v_tipo || ':' || new.id::text || ':' || txid_current()::text
    end,
    coalesce(new.pago_em, new.updated_at, new.created_at, now())
  );
  return new;
exception when others then
  raise warning '[central] evento de transacao ignorado: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists central_evento_transacao_trg on public.transacao;
create trigger central_evento_transacao_trg
after insert or update of pendente on public.transacao
for each row execute function public.central_evento_transacao();

create or replace function public.central_evento_produto_estoque()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant integer := public.central_operacional_tenant_id();
  v_diferenca integer := new.estoque - old.estoque;
begin
  if new.is_deleted or new.estoque is not distinct from old.estoque then
    return new;
  end if;

  perform public.central_emitir_evento_operacional(
    v_tenant,
    case when v_diferenca > 0 then 'ESTOQUE_ENTRADA' else 'ESTOQUE_SAIDA' end,
    'ESTOQUE',
    'PRODUTO',
    new.id::text,
    case when v_diferenca > 0 then 'Entrada de estoque · ' else 'Saida de estoque · ' end || new.titulo,
    new.titulo,
    null,
    abs(v_diferenca),
    'INFO',
    jsonb_build_object('estoqueAtual', new.estoque, 'estoqueMinimo', new.estoqueminimo),
    (case when v_diferenca > 0 then 'ESTOQUE_ENTRADA:' else 'ESTOQUE_SAIDA:' end)
      || new.id::text || ':' || txid_current()::text,
    coalesce(new.updatedat, now())
  );

  if new.estoque <= new.estoqueminimo
    and (old.estoque > old.estoqueminimo or new.estoque = 0)
  then
    perform public.central_emitir_evento_operacional(
      v_tenant,
      'ESTOQUE_BAIXO',
      'ESTOQUE',
      'PRODUTO',
      new.id::text,
      case when new.estoque <= 0 then 'Estoque zerado · ' else 'Estoque baixo · ' end || new.titulo,
      new.titulo,
      null,
      new.estoque,
      case when new.estoque <= 0 then 'CRITICO' else 'ATENCAO' end,
      jsonb_build_object('estoqueAtual', new.estoque, 'estoqueMinimo', new.estoqueminimo),
      'ESTOQUE_BAIXO:' || new.id::text || ':' || txid_current()::text,
      coalesce(new.updatedat, now())
    );
  end if;

  return new;
exception when others then
  raise warning '[central] evento de estoque ignorado: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists central_evento_produto_estoque_trg on public.produto;
create trigger central_evento_produto_estoque_trg
after update of estoque on public.produto
for each row execute function public.central_evento_produto_estoque();

create or replace function public.central_evento_nfe()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant integer := coalesce(new.empresaid, public.central_operacional_tenant_id());
  v_tipo text;
  v_titulo text;
  v_prioridade text := 'INFO';
  v_numero text := coalesce(nullif(new.numero::text, '0'), new.id::text);
begin
  if new.is_deleted or tg_op <> 'UPDATE' or old.status is not distinct from new.status then
    return new;
  end if;

  if new.status::text in ('ASSINADA', 'ENVIADA', 'PENDENTE_ENVIO') then
    v_tipo := 'NFE_EMISSAO_INICIADA';
    v_titulo := 'NF-e #' || v_numero || ' em emissao';
  elsif new.status::text = 'AUTORIZADA' then
    v_tipo := 'NFE_AUTORIZADA';
    v_titulo := 'NF-e #' || v_numero || ' autorizada';
  elsif new.status::text in ('REJEITADA', 'DENEGADA') then
    v_tipo := 'NFE_REJEITADA';
    v_titulo := 'NF-e #' || v_numero || ' rejeitada';
    v_prioridade := 'CRITICO';
  else
    return new;
  end if;

  perform public.central_emitir_evento_operacional(
    v_tenant,
    v_tipo,
    'FISCAL',
    'NFE',
    new.id::text,
    v_titulo,
    case when v_tipo = 'NFE_REJEITADA' then 'Consulte o documento fiscal' else null end,
    new.total_nfe,
    null,
    v_prioridade,
    jsonb_strip_nulls(jsonb_build_object(
      'numero', new.numero,
      'ordemServicoId', new.ordemservicoid,
      'vendaId', new.vendaid,
      'status', new.status::text
    )),
    v_tipo || ':' || new.id::text || ':' || txid_current()::text,
    coalesce(new.dataautorizacao, new.updatedat, now())
  );
  return new;
exception when others then
  raise warning '[central] evento de NF-e ignorado: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists central_evento_nfe_trg on public.nfe;
create trigger central_evento_nfe_trg
after update of status on public.nfe
for each row execute function public.central_evento_nfe();

create or replace function public.central_evento_nfse()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant integer := coalesce(new.empresaid, public.central_operacional_tenant_id());
  v_tipo text;
  v_titulo text;
  v_prioridade text := 'INFO';
  v_status text := upper(coalesce(new.status, ''));
  v_numero text := coalesce(nullif(new.numero, ''), new.id::text);
begin
  if tg_op = 'INSERT' and v_status = 'PROCESSANDO' then
    v_tipo := 'NFSE_EMISSAO_INICIADA';
    v_titulo := 'NFS-e #' || v_numero || ' em emissao';
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    if v_status in ('AUTORIZADA', 'AUTORIZADO', 'EMITIDA', 'EMITIDO') then
      v_tipo := 'NFSE_AUTORIZADA';
      v_titulo := 'NFS-e #' || v_numero || ' autorizada';
    elsif v_status in ('REJEITADA', 'REJEITADO', 'ERRO_AUTORIZACAO') then
      v_tipo := 'NFSE_REJEITADA';
      v_titulo := 'NFS-e #' || v_numero || ' rejeitada';
      v_prioridade := 'CRITICO';
    elsif v_status in ('PROCESSANDO', 'PROCESSANDO_AUTORIZACAO') then
      v_tipo := 'NFSE_EMISSAO_INICIADA';
      v_titulo := 'NFS-e #' || v_numero || ' em emissao';
    else
      return new;
    end if;
  else
    return new;
  end if;

  perform public.central_emitir_evento_operacional(
    v_tenant,
    v_tipo,
    'FISCAL',
    'NFSE',
    new.id::text,
    v_titulo,
    case when v_tipo = 'NFSE_REJEITADA' then 'Consulte o documento fiscal' else null end,
    new.valor_total,
    null,
    v_prioridade,
    jsonb_strip_nulls(jsonb_build_object(
      'numero', new.numero,
      'ordemServicoId', new.ordemservicoid,
      'status', new.status
    )),
    v_tipo || ':' || new.id::text || ':' || txid_current()::text,
    coalesce(new.updatedat, new.dataemissao, now())
  );
  return new;
exception when others then
  raise warning '[central] evento de NFS-e ignorado: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists central_evento_nfse_trg on public.nfse;
create trigger central_evento_nfse_trg
after insert or update of status on public.nfse
for each row execute function public.central_evento_nfse();

-- O Realtime valida a sessao curta emitida pela API e autoriza somente o topico
-- da instalacao atual para usuarios ativos com a permissao de acompanhamento.
create or replace function public.central_realtime_topic_allowed(p_topic text)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.usuario u
    where u.id = auth.uid()
      and u.ativo = true
      and p_topic = 'operational:tenant:' || public.central_operacional_tenant_id()::text
      and (
        coalesce(u.is_root, false)
        or exists (
          select 1
          from public.perfilpermissao pp
          join public.permissao p on p.id = pp.permissaoid
          where pp.perfilid = u.perfilid
            and upper(trim(p.nome)) = upper('acompanhamento:visualizar')
        )
      )
  )
$$;

drop policy if exists central_operacional_realtime_receive on realtime.messages;
create policy central_operacional_realtime_receive
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.central_realtime_topic_allowed((select realtime.topic()))
);

revoke all on function public.central_operacional_tenant_id() from public, anon, authenticated;
revoke all on function public.central_emitir_evento_operacional(integer, text, text, text, text, text, text, numeric, numeric, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.central_evento_ordemservico() from public, anon, authenticated;
revoke all on function public.central_evento_venda() from public, anon, authenticated;
revoke all on function public.central_evento_transacao() from public, anon, authenticated;
revoke all on function public.central_evento_produto_estoque() from public, anon, authenticated;
revoke all on function public.central_evento_nfe() from public, anon, authenticated;
revoke all on function public.central_evento_nfse() from public, anon, authenticated;
revoke all on function public.central_realtime_topic_allowed(text) from public, anon;

grant execute on function public.central_operacional_tenant_id() to service_role;
grant execute on function public.central_emitir_evento_operacional(integer, text, text, text, text, text, text, numeric, numeric, text, jsonb, text, timestamptz) to service_role;
grant execute on function public.central_realtime_topic_allowed(text) to authenticated, service_role;

commit;
