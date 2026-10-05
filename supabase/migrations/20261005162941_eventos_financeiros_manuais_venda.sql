begin;

-- Eventos do operador pertencem ao documento, mas não ao seu orçamento/status.
create or replace function public.criar_evento_financeiro_manual_venda(
  p_venda_id bigint, p_natureza text, p_tipo text, p_descricao text,
  p_detalhe text, p_valor numeric, p_usuario uuid
)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_venda public.venda%rowtype;
  v_evento public.eventos_financeiros%rowtype;
begin
  if p_natureza is null or p_natureza not in ('RECEITA','DESPESA')
     or p_tipo is null or p_tipo not in ('PRODUTO','SERVICO','CONSUMO')
     or (p_tipo = 'CONSUMO' and p_natureza <> 'DESPESA')
     or nullif(btrim(p_descricao),'') is null or p_valor is null
     or p_valor::text in ('NaN','Infinity','-Infinity') or round(p_valor,2) <= 0
     or p_usuario is null then
    raise exception 'Informe natureza, tipo, título e valor positivo válidos.' using errcode = '22023';
  end if;
  select * into v_venda from public.venda where id = p_venda_id for update;
  if not found then raise exception 'Venda não encontrada.' using errcode = 'P0002'; end if;
  perform set_config('app.audit_user_id', p_usuario::text, true);
  insert into public.eventos_financeiros
    (ordemservicoid,source_type,source_id,origem,natureza,natureza_dre,
     chave_origem,descricao,detalhe,valor,competencia_em,is_manual,
     pode_gerar_transacao,created_by,status,dados_snapshot)
  values (null,'VENDA',p_venda_id,p_tipo,p_natureza,
    public.natureza_dre_de_evento(p_tipo,p_natureza),'MANUAL:' || gen_random_uuid(),
    btrim(p_descricao),nullif(btrim(p_detalhe),''),round(p_valor,2),
    coalesce(v_venda.datavenda,v_venda.createdat,now()),true,true,p_usuario,'ATIVO',
    jsonb_build_object('lancamento_avulso_manual',true,'tipo_informado',p_tipo,
      'consumo_de_estoque',false,'criado_em',now())) returning * into v_evento;
  return to_jsonb(v_evento);
end;
$fn$;

-- Releitura sob lock: nunca edita/exclui dinheiro que outra tela acabou de vincular.
create or replace function public.alterar_evento_financeiro_manual_venda(
  p_venda_id bigint, p_evento_id bigint, p_operacao text, p_payload jsonb, p_usuario uuid
)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_evento public.eventos_financeiros%rowtype;
  v_valor numeric;
  v_descricao text;
  v_detalhe text;
begin
  if p_usuario is null or p_operacao is null or p_operacao not in ('EDITAR','EXCLUIR') then
    raise exception 'Operação inválida.' using errcode = '22023';
  end if;
  perform 1 from public.venda where id = p_venda_id for update;
  if not found then raise exception 'Venda não encontrada.' using errcode = 'P0002'; end if;
  select * into v_evento from public.eventos_financeiros
   where id = p_evento_id and source_type = 'VENDA' and source_id = p_venda_id
     and ordemservicoid is null for update;
  if not found then raise exception 'Evento financeiro não encontrado nesta venda.' using errcode = 'P0002'; end if;
  if not coalesce(v_evento.is_manual,false) or coalesce(v_evento.chave_origem,'') not like 'MANUAL:%'
     or v_evento.origem = 'COMISSAO' or (v_evento.origem = 'FRETE' and v_evento.natureza = 'RECEITA')
     or v_evento.consumo_saida_id is not null or v_evento.consumo_usoconsumo_saida_id is not null then
    raise exception 'Este evento deve ser corrigido na origem que o criou.' using errcode = 'P0001';
  end if;
  if v_evento.status = 'CONVERTIDO' or v_evento.transacaoid is not null or v_evento.lancamento_id is not null then
    raise exception 'Exclua primeiro a transação ou o lançamento financeiro vinculado.' using errcode = 'P0001';
  end if;
  if v_evento.status <> 'ATIVO' then
    raise exception 'Somente eventos ativos podem ser alterados.' using errcode = 'P0001';
  end if;
  perform set_config('app.audit_user_id',p_usuario::text,true);
  if p_operacao = 'EXCLUIR' then
    delete from public.eventos_financeiros where id = v_evento.id;
    return jsonb_build_object('evento_id',v_evento.id,'excluido',true,'estoque_devolvido',false);
  end if;
  v_valor := (p_payload->>'valor')::numeric;
  v_descricao := btrim(coalesce(p_payload->>'descricao',v_evento.descricao));
  v_detalhe := case when p_payload ? 'detalhe' then nullif(btrim(p_payload->>'detalhe'),'') else v_evento.detalhe end;
  if v_valor is null or v_valor::text in ('NaN','Infinity','-Infinity') or round(v_valor,2) < 0
     or nullif(v_descricao,'') is null then
    raise exception 'Informe título e valor válidos.' using errcode = '22023';
  end if;
  update public.eventos_financeiros set descricao = v_descricao, detalhe = v_detalhe,
    valor = round(v_valor,2),updated_at = now(),dados_snapshot = coalesce(dados_snapshot,'{}'::jsonb)
      || jsonb_build_object('ajuste_manual',true,'ajustado_em',now(),'ajustado_por',p_usuario)
    where id = v_evento.id returning * into v_evento;
  return to_jsonb(v_evento);
end;
$fn$;

revoke all on function public.criar_evento_financeiro_manual_venda(bigint,text,text,text,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.criar_evento_financeiro_manual_venda(bigint,text,text,text,text,numeric,uuid) to service_role;
revoke all on function public.alterar_evento_financeiro_manual_venda(bigint,bigint,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.alterar_evento_financeiro_manual_venda(bigint,bigint,text,jsonb,uuid) to service_role;

-- Patch genérico da versão vigente: preserva comissão, frete e overrides.
-- Toda seleção da sincronização exclui a proveniência MANUAL, inclusive PRODUTO.
do $patch$
declare v_sql text; v_antigo text; v_novo text;
begin
  select pg_get_functiondef('public.sincronizar_eventos_financeiros_venda(bigint)'::regprocedure) into v_sql;
  v_antigo := 'source_id = p_vendaid';
  v_novo := $new$source_id = p_vendaid AND NOT (coalesce(is_manual,false) AND coalesce(chave_origem,'') LIKE 'MANUAL:%')$new$;
  -- Também corresponde a e.source_id; qualifica as colunas nesse trecho.
  if strpos(v_sql, 'AND NOT (coalesce(is_manual,false)') = 0 then
    if strpos(v_sql,v_antigo) = 0 then raise exception 'Escopo da sincronização da venda não encontrado.'; end if;
    v_sql := replace(v_sql,'e.' || v_antigo,
      $new$e.source_id = p_vendaid AND NOT (coalesce(e.is_manual,false) AND coalesce(e.chave_origem,'') LIKE 'MANUAL:%')$new$);
    -- Os demais UPDATEs não usam alias. Evita aplicar novamente ao trecho e.source_id.
    v_sql := replace(v_sql,'where source_type = ''VENDA'' and ' || v_antigo,
      'where source_type = ''VENDA'' and ' || v_novo);
    execute v_sql;
  end if;

  select pg_get_functiondef('public.registrar_lancamento_de_eventos(jsonb)'::regprocedure) into v_sql;
  v_antigo := $old$(e.origem = 'COMISSAO' OR (e.origem = 'FRETE' AND e.is_manual))$old$;
  v_novo := $new$(e.origem = 'COMISSAO' OR (e.is_manual AND coalesce(e.chave_origem,'') LIKE 'MANUAL:%'))$new$;
  if strpos(v_sql,v_novo) = 0 then
    if strpos(v_sql,v_antigo) = 0 then raise exception 'Validação de origem do lançamento não encontrada.'; end if;
    v_sql := replace(v_sql,v_antigo,v_novo);
    v_sql := replace(v_sql,'OS, comissao ou despesa de frete de venda','OS, comissao ou despesa manual de venda');
    v_sql := replace(v_sql,'Comissões de ','Despesas de ');
    execute v_sql;
  end if;
end;
$patch$;

-- Mantém as colunas/ACLs da fila e acrescenta receitas e despesas do operador.
create or replace view public.eventos_financeiros_fila with (security_invoker=true) as
select e.*, case when o.id is not null then 'OS' else 'VENDA' end as documento_tipo,
       coalesce(o.id,v.id) as documento_id,coalesce(o.clienteid,v.clienteid) as cliente_id,
       case when o.id is not null then jsonb_build_object('id',o.id,'status',o.status,'dataentrada',o.dataentrada,
         'cliente',jsonb_build_object('id',c.id,'nomerazaosocial',c.nomerazaosocial)) end as ordem,
       case when v.id is not null then jsonb_build_object('id',v.id,'status',v.status,
         'cliente',jsonb_build_object('id',c.id,'nomerazaosocial',c.nomerazaosocial)) end as venda
 from public.eventos_financeiros e
 left join public.ordemservico o on o.id=e.ordemservicoid
 left join public.venda v on e.source_type='VENDA' and e.source_id=v.id
   and (e.origem='COMISSAO' or (e.is_manual and coalesce(e.chave_origem,'') like 'MANUAL:%'))
 left join public.cliente c on c.id=coalesce(o.clienteid,v.clienteid)
 where (o.id is not null and not o.is_deleted) or (e.ordemservicoid is null and v.id is not null);

-- Vínculo pelo evento, sem vendaid comercial: não abate pagamento do cliente.
create or replace function public.tg_vincular_transacao_evento_financeiro()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_evento public.eventos_financeiros%rowtype;
begin
  if new.evento_financeiro_id is null then return new; end if;
  select * into v_evento from public.eventos_financeiros where id=new.evento_financeiro_id for update;
  if not found then raise exception 'Evento financeiro não encontrado.'; end if;
  if v_evento.status <> 'ATIVO' or v_evento.transacaoid is not null or v_evento.lancamento_id is not null then
    raise exception 'Este evento já foi convertido ou cancelado.';
  end if;
  if not v_evento.pode_gerar_transacao then raise exception 'Este evento não pode gerar uma transação.'; end if;
  if v_evento.ordemservicoid is distinct from new.ordemservicoid or v_evento.natureza <> new.tipo::text then
    raise exception 'A transação não corresponde ao documento ou à natureza do evento financeiro.';
  end if;
  if v_evento.source_type = 'VENDA' and (new.vendaid is not null
     or not exists(select 1 from public.venda where id=v_evento.source_id)) then
    raise exception 'Use apenas o vínculo do evento para este fato complementar da venda.';
  end if;
  if round(v_evento.valor,2) <> round(new.valor,2) then
    raise exception 'O valor da transação deve ser igual ao valor do evento financeiro.';
  end if;
  return new;
end;
$fn$;

revoke all on function public.tg_vincular_transacao_evento_financeiro() from public,anon,authenticated;

notify pgrst, 'reload schema';

commit;
