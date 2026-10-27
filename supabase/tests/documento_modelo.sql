-- Documentos dinamicos: tabela, seed e travas.
--
-- Roda em transacao e desfaz tudo no fim. O que esta sendo provado:
--   1) os tres modelos de fabrica estao la, cada um no seu modulo;
--   2) modulo fora de venda/os/aluguel, nome vazio e html vazio sao recusados;
--   3) nome repetido no mesmo modulo e recusado (sem diferenciar maiuscula nem
--      espaco nas pontas); em outro modulo passa; o excluido libera o nome;
--   4) o gatilho carimba updated_at na edicao;
--   5) o seed nao ressuscita um padrao que a oficina excluiu;
--   6) anon e authenticated nao enxergam a tabela;
--   7) a auditoria classifica a tabela em configuracoes.
begin;

do $test$
declare
  v_id bigint;
  v_atualizado timestamptz;
begin
  -- 1) seed
  if (
    select count(*) from public.documento_modelo
    where (codigo_padrao, modulo) in (('venda_contrato', 'venda'), ('os_recibo', 'os'), ('aluguel_contrato', 'aluguel'))
  ) <> 3 then
    raise exception 'seed: os tres modelos de fabrica deveriam existir, cada um no seu modulo';
  end if;
  -- O cupom so fica de fora quando a oficina ja tinha um documento de venda
  -- com o mesmo nome.
  if not exists (
    select 1 from public.documento_modelo
    where modulo = 'venda' and not is_deleted
      and (codigo_padrao = 'venda_cupom' or lower(btrim(nome)) = 'cupom de venda')
  ) then
    raise exception 'seed: o cupom de venda deveria existir no modulo venda';
  end if;

  -- 2) checks
  begin
    insert into public.documento_modelo (modulo, nome, html) values ('compra', 'X', '<p>x</p>');
    raise exception 'modulo invalido foi aceito';
  exception when check_violation then null;
  end;

  begin
    insert into public.documento_modelo (modulo, nome, html) values ('venda', '   ', '<p>x</p>');
    raise exception 'nome vazio foi aceito';
  exception when check_violation then null;
  end;

  begin
    insert into public.documento_modelo (modulo, nome, html) values ('venda', 'Sem corpo', '  ');
    raise exception 'html vazio foi aceito';
  exception when check_violation then null;
  end;

  -- 3) nome unico por modulo, entre os nao excluidos
  insert into public.documento_modelo (modulo, nome, html, updated_at)
  values ('venda', 'Recibo de teste', '<p>a</p>', '2000-01-01')
  returning id into v_id;

  begin
    insert into public.documento_modelo (modulo, nome, html) values ('venda', ' recibo DE TESTE ', '<p>b</p>');
    raise exception 'nome repetido no mesmo modulo foi aceito';
  exception when unique_violation then null;
  end;

  insert into public.documento_modelo (modulo, nome, html) values ('os', 'Recibo de teste', '<p>c</p>');

  -- 4) updated_at
  update public.documento_modelo set html = '<p>a2</p>' where id = v_id
  returning updated_at into v_atualizado;
  if v_atualizado <> now() then
    raise exception 'updated_at nao foi carimbado na edicao: %', v_atualizado;
  end if;

  update public.documento_modelo set is_deleted = true where id = v_id;
  insert into public.documento_modelo (modulo, nome, html) values ('venda', 'Recibo de teste', '<p>d</p>');

  -- 5) padrao excluido nao volta com o seed
  update public.documento_modelo set is_deleted = true where codigo_padrao = 'os_recibo';
  insert into public.documento_modelo (codigo_padrao, modulo, nome, ordem, html)
  values ('os_recibo', 'os', 'Recibo de servico prestado', 1, '<p>de novo</p>')
  on conflict (codigo_padrao) do nothing;
  if (select count(*) from public.documento_modelo where codigo_padrao = 'os_recibo') <> 1
     or exists (select 1 from public.documento_modelo where codigo_padrao = 'os_recibo' and not is_deleted) then
    raise exception 'o seed ressuscitou um padrao excluido';
  end if;

  -- 6) acesso
  if has_table_privilege('anon', 'public.documento_modelo', 'SELECT')
     or has_table_privilege('authenticated', 'public.documento_modelo', 'SELECT') then
    raise exception 'anon/authenticated nao deveriam ler documento_modelo';
  end if;

  -- 7) auditoria
  if public.auditoria_modulo_tabela('documento_modelo') <> 'configuracoes' then
    raise exception 'auditoria: documento_modelo deveria cair em configuracoes, caiu em %',
      public.auditoria_modulo_tabela('documento_modelo');
  end if;

  raise notice 'documento_modelo: OK';
end;
$test$;

rollback;
