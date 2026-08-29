-- Estoque Geral/Avulso: separacao por `escopo` dentro das tabelas usoconsumo_*.
--
-- Roda em transacao e desfaz tudo no fim. Valida que os dois estoques simples
-- compartilham tabela, rotas e cadastros sem misturar saldo, movimento nem
-- etiqueta — e que nada do que ja existia mudou de estoque.
begin;

do $$
declare
  v_item_geral integer;
  v_item_uso integer;
  v_item_geral_row public.usoconsumo_item%ROWTYPE;
  v_produto_id integer;
  v_entrada_id bigint;
  v_entrada_saldo_inicial bigint;
  v_escopo text;
  v_saldo integer;
  v_total bigint;
  v_aceitou boolean;
  v_entrada_mista bigint;
  v_etiqueta constant text := 'GERAL-TESTE-0001';
begin
  if to_regclass('public.usoconsumo_item') is null then
    raise exception 'As tabelas de uso e consumo nao foram criadas';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usoconsumo_item' and column_name = 'escopo'
  ) then
    raise exception 'A coluna escopo nao foi criada em usoconsumo_item';
  end if;

  -- -------------------------------------------------------------------------
  -- 9) Regressao: tudo que ja existia continua sendo uso e consumo.
  -- -------------------------------------------------------------------------
  select count(*) into v_total from public.usoconsumo_item where escopo not in ('USOCONSUMO', 'GERAL');
  if v_total <> 0 then
    raise exception 'Existem % itens com escopo invalido apos o backfill', v_total;
  end if;

  -- -------------------------------------------------------------------------
  -- 5) criar_item_usoconsumo grava o escopo e propaga para o SALDO_INICIAL.
  -- -------------------------------------------------------------------------
  select id into v_item_geral from public.criar_item_usoconsumo(
    jsonb_build_object('titulo', 'ITEM GERAL DE TESTE', 'escopo', 'GERAL', 'precocompra', 10),
    5,
    null
  );
  select id into v_item_uso from public.criar_item_usoconsumo(
    -- Sem `escopo` de proposito: o default precisa continuar caindo em uso e consumo.
    jsonb_build_object('titulo', 'ITEM USO DE TESTE', 'precocompra', 10),
    5,
    null
  );

  select escopo into v_escopo from public.usoconsumo_item where id = v_item_geral;
  if v_escopo <> 'GERAL' then
    raise exception 'Item criado como GERAL ficou com escopo %', v_escopo;
  end if;
  select escopo into v_escopo from public.usoconsumo_item where id = v_item_uso;
  if v_escopo <> 'USOCONSUMO' then
    raise exception 'Item sem escopo informado ficou com escopo % em vez do padrao', v_escopo;
  end if;

  select e.id, e.escopo into v_entrada_saldo_inicial, v_escopo
  from public.usoconsumo_entrada e
  join public.usoconsumo_entrada_item ei on ei.entrada_id = e.id
  where ei.item_id = v_item_geral and e.tipo = 'SALDO_INICIAL';
  if v_entrada_saldo_inicial is null then
    raise exception 'O estoque inicial do item GERAL nao gerou entrada SALDO_INICIAL';
  end if;
  if v_escopo <> 'GERAL' then
    raise exception 'A entrada de saldo inicial do item GERAL ficou com escopo %', v_escopo;
  end if;

  -- -------------------------------------------------------------------------
  -- 1) Um estoque nao enxerga o item do outro.
  -- -------------------------------------------------------------------------
  if exists (select 1 from public.usoconsumo_item where id = v_item_geral and escopo = 'USOCONSUMO') then
    raise exception 'Item do estoque geral apareceu na listagem de uso e consumo';
  end if;
  if exists (select 1 from public.usoconsumo_item where id = v_item_uso and escopo = 'GERAL') then
    raise exception 'Item de uso e consumo apareceu na listagem do estoque geral';
  end if;

  -- -------------------------------------------------------------------------
  -- 3) Movimento nao aceita item do outro estoque — pela RPC...
  -- -------------------------------------------------------------------------
  -- O flag separa "a operacao foi recusada" de "a operacao passou". Levantar a
  -- falha dentro do bloco faria o proprio handler engoli-la, e o teste passaria
  -- justamente no caso que ele existe para pegar.
  v_aceitou := false;
  begin
    perform public.registrar_entrada_usoconsumo(
      jsonb_build_object('escopo', 'GERAL', 'origem', 'MANUAL', 'tipo', 'COMPRA_FORNECEDOR'),
      jsonb_build_array(jsonb_build_object('item_id', v_item_uso, 'quantidade', 1, 'valor_unitario_compra', 5)),
      '[]'::jsonb
    );
    v_aceitou := true;
  exception
    when others then null;
  end;
  if v_aceitou then
    raise exception 'Entrada GERAL aceitou item de uso e consumo';
  end if;

  v_aceitou := false;
  begin
    perform public.registrar_saida_usoconsumo(
      jsonb_build_object('escopo', 'USOCONSUMO', 'motivo', 'CONSUMO_INTERNO'),
      jsonb_build_array(jsonb_build_object('item_id', v_item_geral, 'quantidade', 1))
    );
    v_aceitou := true;
  exception
    when others then null;
  end;
  if v_aceitou then
    raise exception 'Saida de uso e consumo aceitou item do estoque geral';
  end if;

  -- ...e pelo trigger, que e a rede de seguranca abaixo da RPC.
  insert into public.usoconsumo_entrada(escopo, tipo, origem, valor_total)
  values ('GERAL', 'COMPRA_FORNECEDOR', 'MANUAL', 0)
  returning id into v_entrada_id;
  v_aceitou := false;
  begin
    insert into public.usoconsumo_entrada_item(
      entrada_id, item_id, quantidade, unidade, valor_unitario_compra,
      valor_total, saldo_anterior, saldo_resultante
    ) values (v_entrada_id, v_item_uso, 1, 'UN', 1, 1, 0, 1);
    v_aceitou := true;
  exception
    when others then null;
  end;
  if v_aceitou then
    raise exception 'O trigger de coerencia deixou passar item de outro estoque';
  end if;

  -- -------------------------------------------------------------------------
  -- 2) Saldos independentes.
  -- -------------------------------------------------------------------------
  perform public.registrar_entrada_usoconsumo(
    jsonb_build_object('escopo', 'GERAL', 'origem', 'MANUAL', 'tipo', 'COMPRA_FORNECEDOR'),
    jsonb_build_array(jsonb_build_object('item_id', v_item_geral, 'quantidade', 7, 'valor_unitario_compra', 3)),
    '[]'::jsonb
  );

  select estoque into v_saldo from public.usoconsumo_item where id = v_item_geral;
  if v_saldo <> 12 then
    raise exception 'Saldo do item GERAL deveria ser 12 e ficou %', v_saldo;
  end if;
  select estoque into v_saldo from public.usoconsumo_item where id = v_item_uso;
  if v_saldo <> 5 then
    raise exception 'Entrada no estoque geral mexeu no saldo de uso e consumo: %', v_saldo;
  end if;

  perform public.registrar_saida_usoconsumo(
    jsonb_build_object('escopo', 'USOCONSUMO', 'motivo', 'CONSUMO_INTERNO'),
    jsonb_build_array(jsonb_build_object('item_id', v_item_uso, 'quantidade', 2))
  );
  select estoque into v_saldo from public.usoconsumo_item where id = v_item_geral;
  if v_saldo <> 12 then
    raise exception 'Saida de uso e consumo mexeu no saldo do estoque geral: %', v_saldo;
  end if;

  -- -------------------------------------------------------------------------
  -- 6) O ajuste de inventario segue o escopo do proprio item.
  -- -------------------------------------------------------------------------
  perform public.ajustar_inventario_usoconsumo(v_item_geral, 20, 'Inventario de teste', null);
  select escopo into v_escopo
  from public.usoconsumo_entrada
  where origem = 'INVENTARIO'
    and id in (select entrada_id from public.usoconsumo_entrada_item where item_id = v_item_geral)
  order by id desc limit 1;
  if v_escopo is distinct from 'GERAL' then
    raise exception 'O ajuste de inventario do item GERAL gerou entrada com escopo %', v_escopo;
  end if;

  -- -------------------------------------------------------------------------
  -- 4) Etiqueta continua unica entre os TRES estoques.
  -- -------------------------------------------------------------------------
  update public.usoconsumo_item set etiqueta = v_etiqueta where id = v_item_geral;
  v_aceitou := false;
  begin
    update public.usoconsumo_item set etiqueta = v_etiqueta where id = v_item_uso;
    v_aceitou := true;
  exception
    when others then null;
  end;
  if v_aceitou then
    raise exception 'Etiqueta repetida entre o estoque geral e o de uso e consumo foi aceita';
  end if;

  insert into public.produto (titulo, precovenda)
  values ('PRODUTO DE TESTE GERAL', 1)
  returning id into v_produto_id;
  v_aceitou := false;
  begin
    update public.produto set etiqueta = v_etiqueta where id = v_produto_id;
    v_aceitou := true;
  exception
    when others then null;
  end;
  if v_aceitou then
    raise exception 'Etiqueta do estoque geral foi aceita tambem em um produto';
  end if;

  -- -------------------------------------------------------------------------
  -- 7) Cancelamento de entrada do estoque geral estorna o saldo certo.
  -- -------------------------------------------------------------------------
  select id into v_entrada_id
  from public.usoconsumo_entrada e
  where e.escopo = 'GERAL' and e.origem = 'MANUAL' and e.status = 'CONFIRMADA'
    and exists (select 1 from public.usoconsumo_entrada_item ei
                where ei.entrada_id = e.id and ei.item_id = v_item_geral and ei.quantidade = 7)
  order by id desc limit 1;

  select estoque into v_saldo from public.usoconsumo_item where id = v_item_geral;
  perform public.cancelar_entrada_usoconsumo(v_entrada_id, 'Cancelamento de teste', null);

  select estoque into v_item_geral_row.estoque from public.usoconsumo_item where id = v_item_geral;
  if v_item_geral_row.estoque <> v_saldo - 7 then
    raise exception 'Cancelamento devolveu % em vez de %', v_item_geral_row.estoque, v_saldo - 7;
  end if;
  select estoque into v_saldo from public.usoconsumo_item where id = v_item_uso;
  if v_saldo <> 3 then
    raise exception 'Cancelamento no estoque geral mexeu no saldo de uso e consumo: %', v_saldo;
  end if;

  -- -------------------------------------------------------------------------
  -- 10) Entrada MISTO: uma NF-e com item dos DOIS estoques simples.
  --
  -- Uma nota nao pode virar duas entradas — `usoconsumo_entrada_chave_uk` e unico
  -- por chave globalmente. Entao o cabecalho vem MISTO e cada item credita o saldo
  -- no seu proprio estoque.
  -- -------------------------------------------------------------------------
  select estoque into v_saldo from public.usoconsumo_item where id = v_item_geral;

  select (public.registrar_entrada_usoconsumo(
    jsonb_build_object(
      'escopo', 'MISTO', 'origem', 'NFE_TERCEIRO', 'tipo', 'COMPRA_FORNECEDOR',
      'fiscal', false, 'numero_nota', '900001'
    ),
    jsonb_build_array(
      jsonb_build_object('item_id', v_item_geral, 'quantidade', 4, 'valor_unitario_compra', 2),
      jsonb_build_object('item_id', v_item_uso, 'quantidade', 6, 'valor_unitario_compra', 2)
    ),
    '[]'::jsonb
  )->>'entrada_id')::bigint into v_entrada_mista;

  select escopo into v_escopo from public.usoconsumo_entrada where id = v_entrada_mista;
  if v_escopo <> 'MISTO' then
    raise exception 'A entrada com os dois estoques ficou com escopo %', v_escopo;
  end if;

  select estoque into v_total from public.usoconsumo_item where id = v_item_geral;
  if v_total <> v_saldo + 4 then
    raise exception 'A metade GERAL da nota mista creditou % em vez de %', v_total, v_saldo + 4;
  end if;
  select estoque into v_total from public.usoconsumo_item where id = v_item_uso;
  if v_total <> 9 then
    raise exception 'A metade USOCONSUMO da nota mista creditou saldo errado: %', v_total;
  end if;

  -- A nota mista fica visivel para as DUAS abas do historico.
  if not exists (
    select 1 from public.usoconsumo_movimento_historico
    where id = v_entrada_mista and sentido = 'entrada' and escopo = 'MISTO'
  ) then
    raise exception 'A entrada mista nao apareceu no historico';
  end if;

  -- -------------------------------------------------------------------------
  -- 11) Escopo unico continua recusando item do outro estoque.
  --
  -- O MISTO afrouxou a checagem so onde ela nao faz sentido: uma entrada de
  -- escopo unico segue barrando item de fora.
  -- -------------------------------------------------------------------------
  v_aceitou := false;
  begin
    perform public.registrar_entrada_usoconsumo(
      jsonb_build_object('escopo', 'USOCONSUMO', 'origem', 'MANUAL', 'tipo', 'COMPRA_FORNECEDOR'),
      jsonb_build_array(jsonb_build_object('item_id', v_item_geral, 'quantidade', 1, 'valor_unitario_compra', 1)),
      '[]'::jsonb
    );
    v_aceitou := true;
  exception
    when others then null;
  end;
  if v_aceitou then
    raise exception 'Entrada de escopo unico aceitou item do outro estoque depois do MISTO';
  end if;

  -- -------------------------------------------------------------------------
  -- 8) As visoes expoem e respeitam o escopo.
  -- -------------------------------------------------------------------------
  if not exists (
    select 1 from public.usoconsumo_movimento_historico
    where escopo = 'GERAL' and itens_resumo like '%ITEM GERAL DE TESTE%'
  ) then
    raise exception 'O historico nao devolveu os movimentos do estoque geral';
  end if;
  if exists (
    select 1 from public.usoconsumo_movimento_historico
    where escopo = 'USOCONSUMO' and itens_resumo like '%ITEM GERAL DE TESTE%'
  ) then
    raise exception 'Movimento do estoque geral vazou para o historico de uso e consumo';
  end if;
  if not exists (
    select 1 from public.usoconsumo_movimento_financeiro_historico
    where escopo = 'GERAL' and itens_resumo like '%ITEM GERAL DE TESTE%'
  ) then
    raise exception 'A visao financeira nao devolveu os movimentos do estoque geral';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'usoconsumo_movimento_autor' and column_name = 'escopo'
  ) then
    raise exception 'A visao de autores nao expoe o escopo';
  end if;

  raise notice 'Estoque geral/avulso: escopo, isolamento de saldo, coerencia de movimento, etiqueta global, inventario, cancelamento e visoes validados.';
end;
$$;

rollback;
