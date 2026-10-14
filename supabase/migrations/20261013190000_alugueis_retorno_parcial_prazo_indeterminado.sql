-- Alugueis: retorno por item e prazo indeterminado.
--
-- 1) RETORNO POR ITEM
--    Ao encerrar, a tela informa quanto de cada item voltou (padrao: tudo). A
--    parte que voltou entra no estoque pelo estorno da saida, como antes. A que
--    nao voltou continua fora: a saida original e estornada inteira e uma saida
--    nova, so com a falta, fica ligada ao aluguel (motivo ALUGUEL). O item
--    aponta para ela, entao excluir o aluguel depois ainda devolve tudo.
--    `aluguel_item.quantidade_devolvida` guarda o que voltou; nulo e aluguel
--    ainda aberto ou encerrado antes desta migration (voltou tudo).
--
-- 2) PRAZO INDETERMINADO
--    `data_limite` passa a aceitar nulo, so com `indeterminado: true` no payload.
--    Sem limite nao ha atraso nem "vence hoje"; a tela conta os dias em aberto.
--    Reiniciar mantem o limite nulo (hoje + nulo = nulo).
--
-- O `aluguel_encerrar` de 4 argumentos continua existindo e devolve tudo: o
-- codigo anterior chama essa assinatura ate o deploy do novo.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Colunas
-- ---------------------------------------------------------------------------
ALTER TABLE public.aluguel ALTER COLUMN data_limite DROP NOT NULL;
COMMENT ON COLUMN public.aluguel.data_limite IS
  'Ultimo dia combinado. Nulo: prazo indeterminado (sem atraso).';

ALTER TABLE public.aluguel_item ADD COLUMN IF NOT EXISTS quantidade_devolvida integer;
ALTER TABLE public.aluguel_item DROP CONSTRAINT IF EXISTS aluguel_item_quantidade_devolvida_check;
ALTER TABLE public.aluguel_item ADD CONSTRAINT aluguel_item_quantidade_devolvida_check
  CHECK (quantidade_devolvida IS NULL OR quantidade_devolvida BETWEEN 0 AND quantidade);
COMMENT ON COLUMN public.aluguel_item.quantidade_devolvida IS
  'Quanto voltou no encerramento. Menor que a quantidade: a falta segue fora do estoque na saida apontada pelo item.';

-- ---------------------------------------------------------------------------
-- 2) Criar / editar: prazo indeterminado
-- ---------------------------------------------------------------------------
create or replace function public.aluguel_salvar(p_payload jsonb, p_usuario uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id bigint := nullif(p_payload->>'id', '')::bigint;
  v_atual public.aluguel%rowtype;
  v_inicio date := nullif(p_payload->>'data_inicio', '')::date;
  v_indeterminado boolean := coalesce(nullif(p_payload->>'indeterminado', '')::boolean, false);
  v_limite date := case when coalesce(nullif(p_payload->>'indeterminado', '')::boolean, false)
                        then null else nullif(p_payload->>'data_limite', '')::date end;
  v_cliente_id integer := nullif(p_payload->>'cliente_id', '')::integer;
  v_cliente jsonb := coalesce(p_payload->'cliente', '{}'::jsonb);
  v_cliente_nome text;
  v_observacao text := nullif(btrim(coalesce(p_payload->>'observacao', '')), '');
  v_itens jsonb := coalesce(p_payload->'itens', '[]'::jsonb);
  v_json jsonb;
  v_item_id bigint;
  v_existente public.aluguel_item%rowtype;
  v_tipo text;
  v_produto integer;
  v_usoconsumo integer;
  v_veiculo integer;
  v_descricao text;
  v_identificacao text;
  v_quantidade integer;
  v_valor numeric(14,2);
  v_mantidos bigint[] := '{}';
  v_adicionados integer := 0;
  v_removidos integer := 0;
  v_desc_adicionados text[] := '{}';
  v_desc_removidos text[] := '{}';
  v_desc_trocados text[] := '{}';
  v_linha record;
  v_conflito bigint;
begin
  if v_inicio is null then
    raise exception 'Informe a data de inicio.' using errcode = '22023';
  end if;
  if v_limite is null and not v_indeterminado then
    raise exception 'Informe a data limite ou marque o prazo indeterminado.' using errcode = '22023';
  end if;
  if v_limite < v_inicio then
    raise exception 'A data limite nao pode ser anterior a data de inicio.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then
    raise exception 'Adicione ao menos um item ao aluguel.' using errcode = '22023';
  end if;

  if v_cliente_id is null then
    v_cliente_nome := nullif(btrim(coalesce(v_cliente->>'nome', '')), '');
    if v_cliente_nome is null then
      raise exception 'Selecione um cliente ou informe o nome do cliente avulso.' using errcode = '22023';
    end if;
  elsif not exists (select 1 from public.cliente where id = v_cliente_id) then
    raise exception 'Cliente nao encontrado.' using errcode = 'P0002';
  end if;

  if v_id is null then
    insert into public.aluguel (
      status, data_inicio, data_limite, cliente_id,
      cliente_nome, cliente_documento, cliente_telefone, cliente_email,
      observacao, created_by, updated_by
    ) values (
      'ATIVO', v_inicio, v_limite, v_cliente_id,
      case when v_cliente_id is null then v_cliente_nome end,
      case when v_cliente_id is null then nullif(upper(regexp_replace(coalesce(v_cliente->>'documento', ''), '[^0-9A-Za-z]', '', 'g')), '') end,
      case when v_cliente_id is null then nullif(btrim(coalesce(v_cliente->>'telefone', '')), '') end,
      case when v_cliente_id is null then nullif(btrim(coalesce(v_cliente->>'email', '')), '') end,
      v_observacao, p_usuario, p_usuario
    )
    returning id into v_id;
  else
    select * into v_atual from public.aluguel where id = v_id and not is_deleted for update;
    if not found then
      raise exception 'Aluguel nao encontrado.' using errcode = 'P0002';
    end if;
    if v_atual.status = 'ENCERRADO' then
      raise exception 'Aluguel encerrado nao pode ser editado.' using errcode = '22023';
    end if;

    update public.aluguel
       set data_inicio = v_inicio,
           data_limite = v_limite,
           cliente_id = v_cliente_id,
           cliente_nome = case when v_cliente_id is null then v_cliente_nome end,
           cliente_documento = case when v_cliente_id is null then nullif(upper(regexp_replace(coalesce(v_cliente->>'documento', ''), '[^0-9A-Za-z]', '', 'g')), '') end,
           cliente_telefone = case when v_cliente_id is null then nullif(btrim(coalesce(v_cliente->>'telefone', '')), '') end,
           cliente_email = case when v_cliente_id is null then nullif(btrim(coalesce(v_cliente->>'email', '')), '') end,
           observacao = v_observacao,
           updated_by = p_usuario
     where id = v_id;

    -- Itens que sairam do payload: devolve e apaga. A descricao fica no evento.
    for v_linha in
      select ai.id, ai.descricao, ai.quantidade
        from public.aluguel_item ai
       where ai.aluguel_id = v_id
         and ai.id not in (
           select nullif(x->>'id', '')::bigint
             from jsonb_array_elements(v_itens) x
            where nullif(x->>'id', '') is not null
         )
       order by ai.id
    loop
      perform public.aluguel_devolver_item(v_linha.id, 'Item retirado do aluguel #' || v_id, p_usuario);
      delete from public.aluguel_item where id = v_linha.id;
      v_removidos := v_removidos + 1;
      v_desc_removidos := v_desc_removidos || (v_linha.quantidade || 'x ' || v_linha.descricao);
    end loop;
  end if;

  for v_json in select value from jsonb_array_elements(v_itens) loop
    v_tipo := upper(btrim(coalesce(v_json->>'tipo', '')));
    v_produto := null; v_usoconsumo := null; v_veiculo := null;
    v_quantidade := coalesce(nullif(v_json->>'quantidade', '')::integer, 1);
    v_valor := coalesce(nullif(v_json->>'valor', '')::numeric, 0);
    v_descricao := nullif(btrim(coalesce(v_json->>'descricao', '')), '');
    v_identificacao := nullif(btrim(coalesce(v_json->>'identificacao', '')), '');

    if v_quantidade <= 0 then
      raise exception 'A quantidade deve ser maior que zero.' using errcode = '22023';
    end if;
    if v_valor < 0 then
      raise exception 'O valor do item nao pode ser negativo.' using errcode = '22023';
    end if;

    if v_tipo = 'PRODUTO' then
      v_produto := nullif(v_json->>'produto_id', '')::integer;
      select coalesce(v_descricao, p.titulo) into v_descricao from public.produto p where p.id = v_produto;
      if not found then raise exception 'Produto nao encontrado.' using errcode = 'P0002'; end if;
    elsif v_tipo in ('USOCONSUMO', 'GERAL') then
      v_usoconsumo := nullif(v_json->>'usoconsumo_item_id', '')::integer;
      select coalesce(v_descricao, i.titulo) into v_descricao
        from public.usoconsumo_item i where i.id = v_usoconsumo and i.escopo = v_tipo;
      if not found then raise exception 'Item nao encontrado neste estoque.' using errcode = 'P0002'; end if;
    elsif v_tipo = 'VEICULO' then
      v_veiculo := nullif(v_json->>'veiculo_id', '')::integer;
      v_quantidade := 1;
      select coalesce(v_descricao, nullif(btrim(concat_ws(' ', v.marca, v.modelo)), ''), 'Veiculo'),
             coalesce(v_identificacao, v.placa)
        into v_descricao, v_identificacao
        from public.veiculo v where v.id = v_veiculo
        for update;
      if not found then raise exception 'Veiculo nao encontrado.' using errcode = 'P0002'; end if;

      select a.id into v_conflito
        from public.aluguel_item ai
        join public.aluguel a on a.id = ai.aluguel_id
       where ai.veiculo_id = v_veiculo
         and a.id <> v_id
         and a.status <> 'ENCERRADO'
         and not a.is_deleted
       limit 1;
      if v_conflito is not null then
        raise exception 'Este veiculo ja esta no aluguel #%, que nao foi encerrado.', v_conflito using errcode = '23505';
      end if;
    elsif v_tipo = 'AVULSO' then
      if v_descricao is null then
        raise exception 'Informe a descricao do item avulso.' using errcode = '22023';
      end if;
    else
      raise exception 'Tipo de item invalido: %.', v_tipo using errcode = '22023';
    end if;

    v_item_id := nullif(v_json->>'id', '')::bigint;

    if v_item_id is not null then
      select * into v_existente from public.aluguel_item where id = v_item_id and aluguel_id = v_id for update;
      if not found then
        raise exception 'Item % nao pertence a este aluguel.', v_item_id using errcode = 'P0002';
      end if;

      if v_existente.tipo is distinct from v_tipo
         or v_existente.produto_id is distinct from v_produto
         or v_existente.usoconsumo_item_id is distinct from v_usoconsumo
         or v_existente.veiculo_id is distinct from v_veiculo
         or v_existente.quantidade is distinct from v_quantidade then
        -- Troca de bem ou de quantidade: devolve o que saiu e baixa de novo.
        perform public.aluguel_devolver_item(v_item_id, 'Item alterado no aluguel #' || v_id, p_usuario);
        update public.aluguel_item
           set tipo = v_tipo, produto_id = v_produto, usoconsumo_item_id = v_usoconsumo,
               veiculo_id = v_veiculo, quantidade = v_quantidade, valor = v_valor,
               descricao = v_descricao, identificacao = v_identificacao,
               estoque_saida_id = null, usoconsumo_saida_id = null, devolvido_em = null
         where id = v_item_id;
        perform public.aluguel_baixar_item(v_item_id, p_usuario);
        v_desc_trocados := v_desc_trocados || (
          v_existente.quantidade || 'x ' || v_existente.descricao || ' -> ' || v_quantidade || 'x ' || v_descricao
        );
      else
        update public.aluguel_item
           set valor = v_valor, descricao = v_descricao, identificacao = v_identificacao
         where id = v_item_id;
      end if;
      v_mantidos := v_mantidos || v_item_id;
    else
      insert into public.aluguel_item (
        aluguel_id, tipo, produto_id, usoconsumo_item_id, veiculo_id,
        descricao, identificacao, quantidade, valor
      ) values (
        v_id, v_tipo, v_produto, v_usoconsumo, v_veiculo,
        v_descricao, v_identificacao, v_quantidade, v_valor
      )
      returning id into v_item_id;
      perform public.aluguel_baixar_item(v_item_id, p_usuario);
      v_mantidos := v_mantidos || v_item_id;
      v_adicionados := v_adicionados + 1;
      v_desc_adicionados := v_desc_adicionados || (v_quantidade || 'x ' || v_descricao);
    end if;
  end loop;

  update public.aluguel
     set valor_total = coalesce((
           select sum(ai.valor * ai.quantidade) from public.aluguel_item ai where ai.aluguel_id = v_id
         ), 0)
   where id = v_id;

  if v_atual.id is null then
    insert into public.aluguel_evento (aluguel_id, tipo, dados, usuario_id)
    values (v_id, 'CRIADO', jsonb_build_object(
      'data_inicio', v_inicio, 'data_limite', v_limite, 'itens', jsonb_array_length(v_itens)
    ), p_usuario);
  else
    insert into public.aluguel_evento (aluguel_id, tipo, dados, usuario_id)
    values (v_id, 'EDITADO', jsonb_build_object(
      'antes', jsonb_build_object('data_inicio', v_atual.data_inicio, 'data_limite', v_atual.data_limite),
      'depois', jsonb_build_object('data_inicio', v_inicio, 'data_limite', v_limite),
      'itens_adicionados', v_adicionados,
      'itens_removidos', v_removidos,
      'descricao_adicionados', to_jsonb(v_desc_adicionados),
      'descricao_removidos', to_jsonb(v_desc_removidos),
      'descricao_trocados', to_jsonb(v_desc_trocados)
    ), p_usuario);
  end if;

  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3) Falta no retorno: estorna a saida inteira e tira de novo so o que faltou
-- ---------------------------------------------------------------------------
create or replace function public.aluguel_reter_falta(p_item_id bigint, p_falta integer, p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_item public.aluguel_item%rowtype;
  v_saida jsonb;
  v_saida_id bigint;
  v_rotulo text;
begin
  select * into v_item from public.aluguel_item where id = p_item_id for update;
  if not found then
    raise exception 'Item do aluguel nao encontrado.' using errcode = 'P0002';
  end if;
  if p_falta <= 0 or v_item.tipo not in ('PRODUTO', 'USOCONSUMO', 'GERAL') then
    return;
  end if;

  v_rotulo := 'Aluguel #' || v_item.aluguel_id || ' - nao retornou';

  if v_item.tipo = 'PRODUTO' then
    v_saida := public.registrar_saida_estoque(v_item.produto_id, p_falta, 'ALUGUEL', v_rotulo, p_usuario);
    v_saida_id := (v_saida->>'saida_id')::bigint;
    update public.estoque_saida set aluguel_id = v_item.aluguel_id where id = v_saida_id;
    update public.aluguel_item set estoque_saida_id = v_saida_id where id = p_item_id;
  else
    v_saida := public.registrar_saida_usoconsumo(
      jsonb_build_object('escopo', v_item.tipo, 'motivo', 'ALUGUEL', 'observacao', v_rotulo, 'created_by', p_usuario),
      jsonb_build_array(jsonb_build_object('item_id', v_item.usoconsumo_item_id, 'quantidade', p_falta))
    );
    v_saida_id := (v_saida->>'saida_id')::bigint;
    update public.usoconsumo_saida set aluguel_id = v_item.aluguel_id where id = v_saida_id;
    update public.aluguel_item set usoconsumo_saida_id = v_saida_id where id = p_item_id;
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4) Encerrar com o retorno de cada item
-- ---------------------------------------------------------------------------
-- p_itens: [{ id, quantidade_devolvida }]. Item fora da lista voltou inteiro;
-- lista nula, tudo voltou.
create or replace function public.aluguel_encerrar(
  p_id bigint, p_encerrado_em timestamptz, p_observacao text, p_itens jsonb, p_usuario uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_atual public.aluguel%rowtype;
  v_linha public.aluguel_item%rowtype;
  v_json jsonb;
  v_devolvidos integer := 0;
  v_voltou integer;
  v_nao_retornados text[] := '{}';
  v_retorno timestamptz := coalesce(p_encerrado_em, now());
  v_dia_retorno date := (coalesce(p_encerrado_em, now()) at time zone 'America/Fortaleza')::date;
  v_hoje date := public.aluguel_hoje();
  v_retornos jsonb := '{}'::jsonb;
begin
  select * into v_atual from public.aluguel where id = p_id and not is_deleted for update;
  if not found then raise exception 'Aluguel nao encontrado.' using errcode = 'P0002'; end if;
  if v_atual.status = 'ENCERRADO' then
    raise exception 'Este aluguel ja esta encerrado.' using errcode = '22023';
  end if;
  if v_dia_retorno > v_hoje then
    raise exception 'A data de retorno nao pode estar no futuro.' using errcode = '22023';
  end if;
  -- Agendado (inicio no futuro) encerra hoje; os demais, a partir do inicio.
  if v_dia_retorno < least(v_atual.data_inicio, v_hoje) then
    raise exception 'A data de retorno (%) nao pode ser anterior ao inicio do aluguel (%).',
      to_char(v_dia_retorno, 'DD/MM/YYYY'), to_char(v_atual.data_inicio, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  if p_itens is not null and jsonb_typeof(p_itens) <> 'array' then
    raise exception 'Lista de itens do retorno invalida.' using errcode = '22023';
  end if;
  for v_json in select value from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    if not exists (
      select 1 from public.aluguel_item
       where id = nullif(v_json->>'id', '')::bigint and aluguel_id = p_id
    ) then
      raise exception 'Item % nao pertence a este aluguel.', v_json->>'id' using errcode = 'P0002';
    end if;
    v_retornos := v_retornos || jsonb_build_object(v_json->>'id', v_json->'quantidade_devolvida');
  end loop;

  for v_linha in select * from public.aluguel_item where aluguel_id = p_id order by id for update loop
    v_voltou := coalesce(nullif(v_retornos->>(v_linha.id::text), '')::integer, v_linha.quantidade);
    if v_voltou < 0 or v_voltou > v_linha.quantidade then
      raise exception 'Retorno de "%": informe de 0 a %.', v_linha.descricao, v_linha.quantidade
        using errcode = '22023';
    end if;

    perform public.aluguel_devolver_item(v_linha.id, 'Retorno do aluguel #' || p_id, p_usuario);
    perform public.aluguel_reter_falta(v_linha.id, v_linha.quantidade - v_voltou, p_usuario);
    update public.aluguel_item set quantidade_devolvida = v_voltou where id = v_linha.id;

    v_devolvidos := v_devolvidos + 1;
    if v_voltou < v_linha.quantidade then
      v_nao_retornados := v_nao_retornados || ((v_linha.quantidade - v_voltou) || 'x ' || v_linha.descricao);
    end if;
  end loop;

  update public.aluguel
     set status = 'ENCERRADO',
         encerrado_em = v_retorno,
         encerrado_por = p_usuario,
         observacao_encerramento = nullif(btrim(coalesce(p_observacao, '')), ''),
         updated_by = p_usuario
   where id = p_id;

  insert into public.aluguel_evento (aluguel_id, tipo, dados, usuario_id)
  values (p_id, 'ENCERRADO', jsonb_build_object(
    'status_anterior', v_atual.status,
    'encerrado_em', v_retorno,
    'itens_devolvidos', v_devolvidos,
    'nao_retornados', to_jsonb(v_nao_retornados),
    'observacao', nullif(btrim(coalesce(p_observacao, '')), '')
  ), p_usuario);
end;
$fn$;

-- Assinatura antiga: tudo voltou.
create or replace function public.aluguel_encerrar(
  p_id bigint, p_encerrado_em timestamptz, p_observacao text, p_usuario uuid
)
returns void
language sql
security definer
set search_path = public
as $fn$
  select public.aluguel_encerrar(p_id, p_encerrado_em, p_observacao, null::jsonb, p_usuario);
$fn$;

-- ---------------------------------------------------------------------------
-- 5) Acesso
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.aluguel_salvar(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aluguel_reter_falta(bigint, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aluguel_encerrar(bigint, timestamptz, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aluguel_encerrar(bigint, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aluguel_salvar(jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aluguel_reter_falta(bigint, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aluguel_encerrar(bigint, timestamptz, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.aluguel_encerrar(bigint, timestamptz, text, uuid) TO service_role;

COMMIT;
