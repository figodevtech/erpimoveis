begin;

-- Permissao dedicada para todo o modulo fiscal. Ela fica agrupada em
-- Financeiro pela propria convencao modulo:acao usada na tela de perfis.
insert into public.permissao (nome, descricao)
values ('financeiro:notas_fiscais', 'Acessar, emitir e gerenciar notas fiscais')
on conflict (nome) do update
set descricao = excluded.descricao;

-- Preserva o comportamento atual no primeiro deploy. Depois do rollout, a
-- permissao pode ser retirada dos perfis que nao devem operar notas fiscais.
insert into public.perfilpermissao (perfilid, permissaoid)
select distinct atual.perfilid, fiscal.id
from public.perfilpermissao atual
join public.permissao financeiro
  on financeiro.id = atual.permissaoid
 and financeiro.nome = 'financeiro:visualizar'
cross join public.permissao fiscal
where fiscal.nome = 'financeiro:notas_fiscais'
on conflict do nothing;

-- Responde o link de aprovacao da OS de forma atomica. O bloqueio das duas
-- linhas impede que aprovar e reprovar simultaneamente produzam dois sucessos.
create or replace function public.responder_aprovacao_os(
  p_token uuid,
  p_documento text,
  p_acao text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.osaprovacao%rowtype;
  v_os public.ordemservico%rowtype;
  v_documento_cliente text;
  v_documento text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  v_acao text := upper(btrim(coalesce(p_acao, '')));
  v_resultado public.enum_status_aprovacao;
  v_novo_status public.enum_status_os;
begin
  if v_acao not in ('APROVAR', 'REPROVAR') then
    raise exception 'Acao de aprovacao invalida.' using errcode = '22023';
  end if;

  select * into v_token
    from public.osaprovacao
   where token = p_token
   for update;

  if not found then
    raise exception 'Link de aprovacao invalido.' using errcode = 'P0002';
  end if;

  if v_token.usado_em is not null
     or (v_token.expira_em is not null and v_token.expira_em <= now()) then
    raise exception 'Este link nao esta mais disponivel para resposta.' using errcode = '22023';
  end if;

  select * into v_os
    from public.ordemservico
   where id = v_token.ordemservicoid
   for update;

  if not found then
    raise exception 'Ordem de servico nao encontrada.' using errcode = 'P0002';
  end if;

  if v_os.status::text <> 'APROVACAO_ORCAMENTO'
     or v_os.statusaprovacao::text is distinct from 'PENDENTE' then
    raise exception 'Este orcamento nao esta aguardando aprovacao.' using errcode = '22023';
  end if;

  select regexp_replace(coalesce(c.cpfcnpj, ''), '\D', '', 'g')
    into v_documento_cliente
    from public.cliente c
   where c.id = v_os.clienteid;

  if v_documento = '' or v_documento is distinct from v_documento_cliente then
    raise exception 'Documento nao confere para este orcamento.' using errcode = '22023';
  end if;

  v_resultado := case
    when v_acao = 'APROVAR' then 'APROVADA'::public.enum_status_aprovacao
    else 'REPROVADA'::public.enum_status_aprovacao
  end;
  v_novo_status := case
    when v_acao = 'APROVAR' then 'ORCAMENTO_APROVADO'::public.enum_status_os
    else 'ORCAMENTO_RECUSADO'::public.enum_status_os
  end;

  update public.osaprovacao
     set usado_em = now(),
         origem = 'LINK',
         resultado = v_resultado::text,
         aprovador_doc = v_documento,
         aprovador_usuario_id = null
   where id = v_token.id
     and usado_em is null;

  if not found then
    raise exception 'Este link ja foi respondido.' using errcode = '22023';
  end if;

  update public.ordemservico
     set status = v_novo_status,
         statusaprovacao = v_resultado,
         updatedat = now()
   where id = v_os.id;

  return jsonb_build_object(
    'ordemservicoid', v_os.id,
    'status', v_novo_status::text,
    'statusaprovacao', v_resultado::text
  );
end;
$$;

alter function public.responder_aprovacao_os(uuid, text, text) owner to postgres;
revoke all on function public.responder_aprovacao_os(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.responder_aprovacao_os(uuid, text, text)
  to service_role;

commit;
