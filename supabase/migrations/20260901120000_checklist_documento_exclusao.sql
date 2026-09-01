-- Exclusao de versoes do checklist impresso.
--
-- O desenho original tornava toda versao indelevel: sem grant de delete e com
-- gatilhos que recusavam a operacao. A operacao precisa apagar uma impressao
-- feita por engano, e uma versao assinada so com permissao dedicada.
--
-- A porta de entrada e uma unica funcao security definer. A tabela continua sem
-- grant de delete para o service_role, entao nao existe caminho alternativo.

begin;

-- Permissao dedicada. De proposito sem backfill: apagar um checklist que o
-- cliente assinou e excecao, nao rotina, e precisa ser concedida a dedo.
insert into public.permissao (nome, descricao)
values ('ordens:excluir_checklist_assinado', 'Excluir versoes assinadas do checklist da OS')
on conflict (nome) do update
set descricao = excluded.descricao;

-- A cadeia de versoes precisa poder ser religada quando um elo sai, senao o
-- `on delete restrict` de versao_anterior_id impede a exclusao.
create or replace function public.proteger_checklist_documento()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- Unico campo mutavel: o elo com a versao anterior. Comparar o resto como
    -- jsonb mantem a trava valida quando novas colunas forem adicionadas.
    if to_jsonb(new) - 'versao_anterior_id' is distinct from to_jsonb(old) - 'versao_anterior_id' then
      raise exception 'Versoes de checklist sao imutaveis.' using errcode = '55000';
    end if;
    return new;
  end if;

  -- Segunda barreira para o documento assinado: mesmo chamando a funcao de
  -- exclusao, ela precisa ter declarado a intencao na mesma transacao.
  if exists (
    select 1 from public.checklist_documento_assinatura a where a.documento_id = old.id
  ) and coalesce(current_setting('app.checklist_exclusao_assinada', true), 'off') <> 'on' then
    raise exception 'Documento assinado nao pode ser excluido.' using errcode = '55000';
  end if;

  return old;
end;
$$;

-- Assinatura e PDF continuam imutaveis, mas agora podem sair em cascata quando
-- o documento e apagado. A guarda de quem pode apagar vive no documento.
create or replace function public.proteger_registro_documental_assinado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Registro documental imutavel.' using errcode = '55000';
  end if;
  return old;
end;
$$;

/**
 * Apaga uma versao do checklist e devolve o que a aplicacao precisa saber para
 * limpar o storage. `p_permitir_assinado` e a intencao explicita de quem tem a
 * permissao 'ordens:excluir_checklist_assinado'.
 */
create or replace function public.excluir_checklist_documento(
  p_public_id uuid,
  p_permitir_assinado boolean default false
)
returns table (
  documento_id bigint,
  codigo text,
  versao integer,
  tipo text,
  ordemservico_id bigint,
  assinado boolean,
  arquivo_path text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  doc public.checklist_documento%rowtype;
  v_assinado boolean;
  v_arquivo text;
begin
  select * into doc
  from public.checklist_documento
  where public_id = p_public_id;

  if not found then
    raise exception 'Versao de checklist nao encontrada.' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.checklist_documento_assinatura a where a.documento_id = doc.id
  ) into v_assinado;

  if v_assinado and not coalesce(p_permitir_assinado, false) then
    raise exception 'Documento assinado nao pode ser excluido.' using errcode = '55000';
  end if;

  select f.storage_path into v_arquivo
  from public.checklist_documento_arquivo f
  where f.documento_id = doc.id;

  -- Quem apontava para esta versao passa a apontar para a anterior dela: o
  -- historico continua encadeado sem o elo removido.
  update public.checklist_documento
     set versao_anterior_id = doc.versao_anterior_id
   where versao_anterior_id = doc.id;

  if v_assinado then
    perform set_config('app.checklist_exclusao_assinada', 'on', true);
  end if;

  delete from public.checklist_documento where id = doc.id;

  perform set_config('app.checklist_exclusao_assinada', 'off', true);

  documento_id := doc.id;
  codigo := doc.codigo;
  versao := doc.versao;
  tipo := doc.tipo;
  ordemservico_id := doc.ordemservico_id;
  assinado := v_assinado;
  arquivo_path := v_arquivo;
  return next;
end;
$$;

revoke all on function public.excluir_checklist_documento(uuid, boolean) from public, anon, authenticated;
grant execute on function public.excluir_checklist_documento(uuid, boolean) to service_role;

commit;
