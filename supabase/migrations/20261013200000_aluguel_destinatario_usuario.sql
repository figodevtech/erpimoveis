-- Alugueis: usuario do sistema como destinatario.
--
-- Alem do cliente do cadastro e do cliente avulso, o aluguel pode ir para um
-- usuario do sistema (ex.: ferramenta emprestada a um funcionario). Os tres sao
-- exclusivos: com cliente ou usuario, os campos do avulso ficam nulos.
--
-- Corpo de `aluguel_salvar` de 20261013190000 com o destinatario, e nada mais.
BEGIN;

ALTER TABLE public.aluguel ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES public.usuario(id);
CREATE INDEX IF NOT EXISTS aluguel_usuario_idx ON public.aluguel(usuario_id) WHERE usuario_id IS NOT NULL;
COMMENT ON COLUMN public.aluguel.usuario_id IS
  'Usuario do sistema que recebeu o aluguel. Exclusivo com cliente_id e com o cliente avulso.';

ALTER TABLE public.aluguel DROP CONSTRAINT IF EXISTS aluguel_cliente_check;
ALTER TABLE public.aluguel ADD CONSTRAINT aluguel_cliente_check CHECK (
  num_nonnulls(cliente_id, usuario_id) <= 1
  AND (
    cliente_id IS NOT NULL
    OR usuario_id IS NOT NULL
    OR nullif(btrim(coalesce(cliente_nome, '')), '') IS NOT NULL
  )
);

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
  v_destinatario uuid := nullif(p_payload->>'usuario_id', '')::uuid;
  v_avulso boolean;
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

  -- Destinatario: cliente do cadastro, usuario do sistema ou avulso; so um.
  if v_cliente_id is not null and v_destinatario is not null then
    raise exception 'Escolha um cliente ou um usuario como destinatario, nao os dois.' using errcode = '22023';
  end if;
  v_avulso := v_cliente_id is null and v_destinatario is null;
  if v_avulso then
    v_cliente_nome := nullif(btrim(coalesce(v_cliente->>'nome', '')), '');
    if v_cliente_nome is null then
      raise exception 'Selecione um cliente, um usuario ou informe o nome do cliente avulso.' using errcode = '22023';
    end if;
  elsif v_cliente_id is not null and not exists (select 1 from public.cliente where id = v_cliente_id) then
    raise exception 'Cliente nao encontrado.' using errcode = 'P0002';
  elsif v_destinatario is not null and not exists (select 1 from public.usuario where id = v_destinatario) then
    raise exception 'Usuario nao encontrado.' using errcode = 'P0002';
  end if;

  if v_id is null then
    insert into public.aluguel (
      status, data_inicio, data_limite, cliente_id, usuario_id,
      cliente_nome, cliente_documento, cliente_telefone, cliente_email,
      observacao, created_by, updated_by
    ) values (
      'ATIVO', v_inicio, v_limite, v_cliente_id, v_destinatario,
      case when v_avulso then v_cliente_nome end,
      case when v_avulso then nullif(upper(regexp_replace(coalesce(v_cliente->>'documento', ''), '[^0-9A-Za-z]', '', 'g')), '') end,
      case when v_avulso then nullif(btrim(coalesce(v_cliente->>'telefone', '')), '') end,
      case when v_avulso then nullif(btrim(coalesce(v_cliente->>'email', '')), '') end,
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
           usuario_id = v_destinatario,
           cliente_nome = case when v_avulso then v_cliente_nome end,
           cliente_documento = case when v_avulso then nullif(upper(regexp_replace(coalesce(v_cliente->>'documento', ''), '[^0-9A-Za-z]', '', 'g')), '') end,
           cliente_telefone = case when v_avulso then nullif(btrim(coalesce(v_cliente->>'telefone', '')), '') end,
           cliente_email = case when v_avulso then nullif(btrim(coalesce(v_cliente->>'email', '')), '') end,
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

REVOKE ALL ON FUNCTION public.aluguel_salvar(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aluguel_salvar(jsonb, uuid) TO service_role;

COMMIT;
