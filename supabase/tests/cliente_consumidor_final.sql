-- Consumidor Final: cadastro do sistema, sem documento e intocável.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado:
--   1) existe um so, sem documento, pessoa fisica e ativo;
--   2) a funcao devolve sempre o mesmo id;
--   3) alterar, excluir, excluir logicamente e dar credito sao recusados;
--   4) regravar so o carimbo de atualizacao passa (o recalculo do saldo faz isso);
--   5) cliente comum continua exigindo documento;
--   6) nao ha como criar um segundo cadastro do sistema;
--   7) a liberacao explicita de migration deixa mexer.
begin;

do $test$
declare
  v_id integer;
  v_cliente record;
begin
  -- 1) cadastro
  if (select count(*) from public.cliente where codigo_sistema = 'consumidor_final') <> 1 then
    raise exception 'deveria haver exatamente um Consumidor Final';
  end if;
  select * into v_cliente from public.cliente where codigo_sistema = 'consumidor_final';
  if v_cliente.cpfcnpj is not null or v_cliente.tipopessoa::text <> 'FISICA'
     or v_cliente.status::text <> 'ATIVO' or v_cliente.nomerazaosocial <> 'CONSUMIDOR FINAL' then
    raise exception 'Consumidor Final com dados inesperados: %', row_to_json(v_cliente);
  end if;

  -- 2) funcao idempotente
  v_id := public.cliente_consumidor_final_id();
  if v_id <> v_cliente.id or public.cliente_consumidor_final_id() <> v_id then
    raise exception 'a funcao deveria devolver sempre o id %', v_cliente.id;
  end if;

  -- 3) travas
  begin
    update public.cliente set nomerazaosocial = 'OUTRO NOME' where id = v_id;
    raise exception 'alterar o nome foi aceito';
  exception when raise_exception then
    if sqlerrm not like '%não pode ser alterado%' then raise; end if;
  end;

  begin
    update public.cliente set telefone = '83999999999' where id = v_id;
    raise exception 'alterar o telefone foi aceito';
  exception when raise_exception then
    if sqlerrm not like '%não pode ser alterado%' then raise; end if;
  end;

  begin
    update public.cliente set is_deleted = true where id = v_id;
    raise exception 'exclusao logica foi aceita';
  exception when raise_exception then
    if sqlerrm not like '%não pode ser alterado%' then raise; end if;
  end;

  begin
    update public.cliente set saldo_credito = 10 where id = v_id;
    raise exception 'credito foi aceito';
  exception when raise_exception then
    if sqlerrm not like '%não acumula crédito%' then raise; end if;
  end;

  begin
    delete from public.cliente where id = v_id;
    raise exception 'exclusao foi aceita';
  exception when raise_exception then
    if sqlerrm not like '%não pode ser excluído%' then raise; end if;
  end;

  -- 4) carimbo sozinho passa
  update public.cliente set updatedat = now() where id = v_id;

  -- 5) cliente comum sem documento
  begin
    insert into public.cliente (tipopessoa, cpfcnpj, nomerazaosocial)
    values ('FISICA', null, 'TESTE SEM DOCUMENTO');
    raise exception 'cliente comum sem documento foi aceito';
  exception when check_violation then null;
  end;

  -- 6) segundo cadastro do sistema
  begin
    insert into public.cliente (tipopessoa, cpfcnpj, nomerazaosocial, codigo_sistema)
    values ('FISICA', null, 'CONSUMIDOR FINAL 2', 'consumidor_final');
    raise exception 'segundo Consumidor Final foi aceito';
  exception when unique_violation then null;
  end;

  -- 7) liberacao de migration
  set local app.cliente_sistema_liberado = 'on';
  update public.cliente set telefone = '83999999999' where id = v_id;
  set local app.cliente_sistema_liberado = 'off';
end;
$test$;

rollback;
