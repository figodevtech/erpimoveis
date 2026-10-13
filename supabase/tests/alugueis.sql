-- Modulo Alugueis: estoque, transicoes e travas.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado:
--   1) criar baixa o saldo de produto e de uso e consumo, com saida de motivo
--      ALUGUEL ligada ao aluguel, e o razao de produto carimba a saida;
--   2) editar aplica a diferenca: quantidade nova devolve e baixa de novo, item
--      retirado volta ao estoque;
--   3) cancelar a saida pelo Estoque e recusado;
--   4) o mesmo veiculo nao entra em dois alugueis abertos;
--   5) pausar e reiniciar: datas novas a partir de hoje, mesma duracao;
--   6) encerrar devolve tudo; excluir um aluguel ativo tambem.
begin;

do $test$
declare
  v_usuario uuid;
  v_cliente integer;
  v_produto integer;
  v_item integer;
  v_veiculo integer;
  v_aluguel bigint;
  v_outro bigint;
  v_saldo integer;
  v_saida bigint;
  v_item_produto bigint;
  v_item_uso bigint;
  v_linha public.aluguel%rowtype;
  v_mensagem text;
  v_resultado jsonb;
  v_hoje date := public.aluguel_hoje();
begin
  select id into v_usuario from public.usuario order by id limit 1;
  select id into v_cliente from public.cliente order by id limit 1;

  -- Clone so de estrutura (Jean Car, HG) nao tem os catalogos que um produto
  -- exige; ali so a aplicacao da migration e provada.
  if not exists (select 1 from public.produto) or v_cliente is null or v_usuario is null then
    raise notice 'Banco sem cadastros: testes de comportamento pulados.';
    return;
  end if;

  insert into public.produto (titulo, precovenda, estoque, grupo_produto_id, tipo_unidade_id)
  select 'Produto de teste do aluguel', 10, 10, p.grupo_produto_id, p.tipo_unidade_id
    from public.produto p order by p.id limit 1
  returning id into v_produto;

  perform set_config('app.usoconsumo_movimento', 'permitido', true);
  insert into public.usoconsumo_item (titulo, escopo, estoque)
  values ('Furadeira de teste do aluguel', 'GERAL', 5)
  returning id into v_item;

  insert into public.veiculo (placa, modelo, marca)
  values ('ALG' || lpad((floor(random() * 9999))::int::text, 4, '0'), 'Modelo teste', 'Marca teste')
  returning id into v_veiculo;

  -- 1) Criar
  v_aluguel := public.aluguel_salvar(jsonb_build_object(
    'data_inicio', v_hoje - 2,
    'data_limite', v_hoje + 8,
    'cliente_id', v_cliente,
    'itens', jsonb_build_array(
      jsonb_build_object('tipo', 'PRODUTO', 'produto_id', v_produto, 'quantidade', 3, 'valor', 50),
      jsonb_build_object('tipo', 'GERAL', 'usoconsumo_item_id', v_item, 'quantidade', 2, 'valor', 30),
      jsonb_build_object('tipo', 'VEICULO', 'veiculo_id', v_veiculo, 'valor', 200),
      jsonb_build_object('tipo', 'AVULSO', 'descricao', 'Andaime emprestado', 'identificacao', 'PAT-01', 'quantidade', 4)
    )
  ), v_usuario);

  select estoque into v_saldo from public.produto where id = v_produto;
  if v_saldo <> 7 then raise exception '1) saldo do produto esperado 7, veio %', v_saldo; end if;
  select estoque into v_saldo from public.usoconsumo_item where id = v_item;
  if v_saldo <> 3 then raise exception '1) saldo do item geral esperado 3, veio %', v_saldo; end if;

  select ai.id, ai.estoque_saida_id into v_item_produto, v_saida
    from public.aluguel_item ai where ai.aluguel_id = v_aluguel and ai.tipo = 'PRODUTO';
  if not exists (
    select 1 from public.estoque_saida s
     where s.id = v_saida and s.aluguel_id = v_aluguel and s.motivo = 'ALUGUEL' and s.status <> 'CANCELADA'
  ) then raise exception '1) saida de produto sem motivo ALUGUEL ou sem vinculo'; end if;
  if not exists (
    select 1 from public.estoque_movimento m
     where m.produto_id = v_produto and m.saida_id = v_saida and m.sentido = 'SAIDA' and m.quantidade = 3
  ) then raise exception '1) razao de produto sem a saida do aluguel'; end if;
  select id into v_item_uso from public.aluguel_item where aluguel_id = v_aluguel and tipo = 'GERAL';
  if not exists (
    select 1 from public.usoconsumo_saida s join public.aluguel_item ai on ai.usoconsumo_saida_id = s.id
     where ai.id = v_item_uso and s.aluguel_id = v_aluguel and s.escopo = 'GERAL'
  ) then raise exception '1) saida do estoque geral sem vinculo'; end if;
  select * into v_linha from public.aluguel where id = v_aluguel;
  if v_linha.valor_total <> 3 * 50 + 2 * 30 + 200 then
    raise exception '1) valor total esperado 410, veio %', v_linha.valor_total;
  end if;
  raise notice '1) criar: saldos 7 e 3, saidas ligadas, total %', v_linha.valor_total;

  -- 3) Cancelar pelo Estoque e recusado
  begin
    perform public.cancelar_saida_estoque(v_saida, 'teste', v_usuario);
    raise exception '3) cancelamento pelo Estoque deveria ser recusado';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_mensagem = message_text;
    if v_mensagem not like '%Aluguel #%' then raise; end if;
  end;
  begin
    perform public.cancelar_saida_usoconsumo(
      (select usoconsumo_saida_id from public.aluguel_item where id = v_item_uso), 'teste', v_usuario);
    raise exception '3) cancelamento do geral pelo Estoque deveria ser recusado';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_mensagem = message_text;
    if v_mensagem not like '%Aluguel #%' then raise; end if;
  end;
  raise notice '3) cancelamento pelo Estoque recusado nos dois estoques';

  -- 4) Veiculo em dois alugueis abertos
  begin
    perform public.aluguel_salvar(jsonb_build_object(
      'data_inicio', v_hoje, 'data_limite', v_hoje + 1,
      'cliente', jsonb_build_object('nome', 'Cliente avulso'),
      'itens', jsonb_build_array(jsonb_build_object('tipo', 'VEICULO', 'veiculo_id', v_veiculo))
    ), v_usuario);
    raise exception '4) veiculo duplicado deveria ser recusado';
  exception when unique_violation then
    null;
  end;
  raise notice '4) veiculo duplicado recusado';

  -- 2) Editar: produto de 3 para 5, item geral retirado, avulso mantido
  perform public.aluguel_salvar(jsonb_build_object(
    'id', v_aluguel,
    'data_inicio', v_hoje - 2,
    'data_limite', v_hoje + 8,
    'cliente', jsonb_build_object('nome', 'Fulano Avulso', 'documento', '123.456.789-09'),
    'itens', (
      select jsonb_agg(case
        when ai.tipo = 'PRODUTO' then jsonb_build_object('id', ai.id, 'tipo', 'PRODUTO', 'produto_id', v_produto, 'quantidade', 5, 'valor', 50)
        else jsonb_build_object('id', ai.id, 'tipo', ai.tipo, 'veiculo_id', ai.veiculo_id, 'descricao', ai.descricao,
                                'identificacao', ai.identificacao, 'quantidade', ai.quantidade, 'valor', ai.valor)
      end)
      from public.aluguel_item ai where ai.aluguel_id = v_aluguel and ai.tipo <> 'GERAL'
    )
  ), v_usuario);

  select estoque into v_saldo from public.produto where id = v_produto;
  if v_saldo <> 5 then raise exception '2) saldo do produto esperado 5, veio %', v_saldo; end if;
  select estoque into v_saldo from public.usoconsumo_item where id = v_item;
  if v_saldo <> 5 then raise exception '2) item geral retirado deveria voltar a 5, veio %', v_saldo; end if;
  if (select status from public.estoque_saida where id = v_saida) <> 'CANCELADA' then
    raise exception '2) a saida antiga do produto deveria estar cancelada';
  end if;
  select * into v_linha from public.aluguel where id = v_aluguel;
  if v_linha.cliente_id is not null or v_linha.cliente_documento <> '12345678909' then
    raise exception '2) cliente avulso nao gravado: % %', v_linha.cliente_id, v_linha.cliente_documento;
  end if;
  raise notice '2) editar: produto 5, geral devolvido, cliente avulso %', v_linha.cliente_nome;

  -- 5) Pausar e reiniciar
  perform public.aluguel_pausar(v_aluguel, v_usuario);
  if (select status from public.aluguel where id = v_aluguel) <> 'PAUSADO' then
    raise exception '5) deveria estar pausado';
  end if;
  begin
    perform public.aluguel_pausar(v_aluguel, v_usuario);
    raise exception '5) pausar duas vezes deveria ser recusado';
  exception when sqlstate '22023' then null;
  end;
  perform public.aluguel_reiniciar(v_aluguel, v_usuario);
  select * into v_linha from public.aluguel where id = v_aluguel;
  if v_linha.status <> 'ATIVO' or v_linha.data_inicio <> v_hoje or v_linha.data_limite <> v_hoje + 10
     or v_linha.pausado_em is not null then
    raise exception '5) reiniciar: % % % %', v_linha.status, v_linha.data_inicio, v_linha.data_limite, v_linha.pausado_em;
  end if;
  raise notice '5) reiniciar: % a % (10 dias)', v_linha.data_inicio, v_linha.data_limite;

  -- 7) Checklist: regravar mantem as fotos do item de mesmo titulo
  v_resultado := public.aluguel_salvar_checklist(v_aluguel, 'SAIDA', jsonb_build_object(
    'itens', jsonb_build_array(
      jsonb_build_object('titulo', 'Pintura', 'status', 'OK'),
      jsonb_build_object('titulo', 'Pneus', 'status', 'ALERTA', 'observacao', 'Dianteiro gasto')
    )
  ), v_usuario);
  insert into public.aluguel_checklist_imagem (checklist_item_id, url)
  select (x->>'id')::bigint, 'https://exemplo/foto.jpg'
    from jsonb_array_elements(v_resultado->'itens') x where x->>'titulo' = 'Pneus';
  v_resultado := public.aluguel_salvar_checklist(v_aluguel, 'SAIDA', jsonb_build_object(
    'itens', jsonb_build_array(
      jsonb_build_object('titulo', 'Pneus', 'status', 'FALHA'),
      jsonb_build_object('titulo', 'Nivel de oleo')
    )
  ), v_usuario);
  if jsonb_array_length(v_resultado->'itens') <> 2 then
    raise exception '7) checklist deveria ter 2 itens, veio %', v_resultado->'itens';
  end if;
  if not exists (
    select 1 from public.aluguel_checklist_imagem im
      join public.aluguel_checklist_item i on i.id = im.checklist_item_id
     where i.titulo = 'Pneus' and i.status = 'FALHA'
       and i.checklist_id = (v_resultado->>'checklist_id')::bigint
  ) then raise exception '7) a foto do item mantido se perdeu'; end if;
  if exists (
    select 1 from public.aluguel_checklist_item
     where checklist_id = (v_resultado->>'checklist_id')::bigint and titulo = 'Pintura'
  ) then raise exception '7) item retirado continuou no checklist'; end if;
  raise notice '7) checklist regravado: foto mantida, item retirado saiu, item sem status aceito';

  -- 6) Encerrar devolve tudo
  perform public.aluguel_encerrar(v_aluguel, null, 'Voltou sem avarias', v_usuario);
  select estoque into v_saldo from public.produto where id = v_produto;
  if v_saldo <> 10 then raise exception '6) produto deveria voltar a 10, veio %', v_saldo; end if;
  if exists (select 1 from public.aluguel_item where aluguel_id = v_aluguel and devolvido_em is null) then
    raise exception '6) itens sem marca de devolvido';
  end if;
  begin
    perform public.aluguel_salvar(jsonb_build_object(
      'id', v_aluguel, 'data_inicio', v_hoje, 'data_limite', v_hoje,
      'cliente_id', v_cliente,
      'itens', jsonb_build_array(jsonb_build_object('tipo', 'AVULSO', 'descricao', 'x'))
    ), v_usuario);
    raise exception '6) editar encerrado deveria ser recusado';
  exception when sqlstate '22023' then null;
  end;

  -- Encerrado, o veiculo fica livre para outro aluguel; excluir esse devolve o saldo.
  v_outro := public.aluguel_salvar(jsonb_build_object(
    'data_inicio', v_hoje, 'data_limite', v_hoje + 3,
    'cliente', jsonb_build_object('nome', 'Outro avulso'),
    'itens', jsonb_build_array(
      jsonb_build_object('tipo', 'VEICULO', 'veiculo_id', v_veiculo),
      jsonb_build_object('tipo', 'PRODUTO', 'produto_id', v_produto, 'quantidade', 4)
    )
  ), v_usuario);
  select estoque into v_saldo from public.produto where id = v_produto;
  if v_saldo <> 6 then raise exception '6) segundo aluguel deveria deixar 6, veio %', v_saldo; end if;
  perform public.aluguel_excluir(v_outro, 'Lancado por engano', v_usuario);
  select estoque into v_saldo from public.produto where id = v_produto;
  if v_saldo <> 10 then raise exception '6) exclusao deveria devolver a 10, veio %', v_saldo; end if;
  if not (select is_deleted from public.aluguel where id = v_outro) then
    raise exception '6) exclusao deveria ser logica';
  end if;

  if (select count(*) from public.aluguel_evento where aluguel_id = v_aluguel) <> 7 then
    raise exception '6) eventos do primeiro aluguel: esperado 7 (criado, editado, pausado, reiniciado, 2 checklists, encerrado), veio %',
      (select count(*) from public.aluguel_evento where aluguel_id = v_aluguel);
  end if;
  raise notice '6) encerrar e excluir devolvem o saldo; linha do tempo completa';
end;
$test$;

rollback;
