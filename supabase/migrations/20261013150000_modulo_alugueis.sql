-- Modulo Alugueis.
--
-- O PROBLEMA
-- A oficina aluga bens -- produto de revenda, item de uso e consumo, item do
-- estoque geral, veiculo do cadastro ou algo que nem esta cadastrado -- e o ERP
-- nao tinha onde registrar isso. O item saia pela porta sem rastro, e o saldo
-- do estoque continuava contando com ele.
--
-- A REGRA
-- 1) Item de estoque alugado BAIXA o saldo e volta pelo ESTORNO (decisao de
--    negocio de 13/10/2026). O aluguel vira uma origem legitima de movimento,
--    com caminho de volta -- a regra do estoque absoluto continua valendo.
--
-- 2) O documento da baixa e uma SAIDA de verdade (`estoque_saida` ou
--    `usoconsumo_saida`) com motivo `ALUGUEL` e a coluna nova `aluguel_id`, o
--    mesmo desenho do consumo em OS (20260903120000). Reusar as RPCs de saida
--    traz de graca a trava de linha, a checagem de saldo, o carimbo no razao e
--    a linha no historico de estoque (que ja mostra e busca pelo motivo).
--
-- 3) O cancelamento dessa saida pelo Estoque fica FECHADO: devolveria o saldo
--    com o aluguel ainda ativo. So o modulo abre o portao
--    (`app.aluguel_estorno`), ao encerrar, excluir ou tirar o item na edicao.
--
-- 4) Status gravados: ATIVO, PAUSADO, ENCERRADO. "Agendado", "vence hoje" e
--    "atrasado" sao derivados das datas na aplicacao (src/lib/alugueis/status.ts).
--    "Hoje" e o dia em America/Fortaleza, o mesmo fuso do resto do sistema.
--
-- 5) Cliente avulso fica inline no aluguel e nunca vira vinculo automatico com
--    o cadastro.
--
-- 6) Checklist de saida e de retorno em tabelas proprias, no desenho de
--    `os_saida_checklist_*`. Os modelos (`checklist_modelo`) sao os mesmos da OS.
--
-- 7) Valor e informativo: nao gera titulo, evento financeiro nem lancamento.
--
-- ORDEM DO DEPLOY
-- Esta migration antes do codigo. O codigo antigo ignora tudo o que esta aqui.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Permissoes
-- ---------------------------------------------------------------------------
insert into public.permissao (nome, descricao)
values
  ('alugueis:visualizar', 'Visualizar alugueis'),
  ('alugueis:criar', 'Criar alugueis'),
  ('alugueis:editar', 'Editar, pausar, reiniciar e encerrar alugueis'),
  ('alugueis:excluir', 'Excluir alugueis')
on conflict (nome) do update
set descricao = excluded.descricao;

-- Quem ja opera ordens de servico recebe a acao equivalente em alugueis.
insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, nova.id
from public.perfilpermissao pp
join public.permissao base on base.id = pp.permissaoid
join public.permissao nova on nova.nome = 'alugueis:' || split_part(base.nome, ':', 2)
where base.nome in ('ordens:visualizar', 'ordens:criar', 'ordens:editar', 'ordens:excluir')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2) Aluguel
-- ---------------------------------------------------------------------------
create table if not exists public.aluguel (
  id bigint generated always as identity primary key,
  status text not null default 'ATIVO',
  data_inicio date not null,
  data_limite date not null,
  pausado_em timestamptz,
  encerrado_em timestamptz,
  encerrado_por uuid references public.usuario(id),
  observacao_encerramento text,
  cliente_id integer references public.cliente(id),
  cliente_nome text,
  cliente_documento text,
  cliente_telefone text,
  cliente_email text,
  observacao text,
  valor_total numeric(14,2) not null default 0,
  motivo_exclusao text,
  is_deleted boolean not null default false,
  created_by uuid references public.usuario(id),
  updated_by uuid references public.usuario(id),
  deleted_by uuid references public.usuario(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint aluguel_status_check check (status in ('ATIVO', 'PAUSADO', 'ENCERRADO')),
  constraint aluguel_periodo_check check (data_limite >= data_inicio),
  constraint aluguel_cliente_check check (
    cliente_id is not null or nullif(btrim(coalesce(cliente_nome, '')), '') is not null
  ),
  constraint aluguel_pausa_check check (status <> 'PAUSADO' or pausado_em is not null),
  constraint aluguel_encerramento_check check ((status = 'ENCERRADO') = (encerrado_em is not null)),
  constraint aluguel_valor_total_check check (valor_total >= 0)
);

create index if not exists aluguel_status_idx
  on public.aluguel(status, data_limite) where not is_deleted;
create index if not exists aluguel_cliente_idx
  on public.aluguel(cliente_id) where cliente_id is not null;

comment on table public.aluguel is
  'Aluguel de bens: produto, item de uso e consumo, item do estoque geral, veiculo ou item avulso. Status ATIVO/PAUSADO/ENCERRADO; agendado e atrasado sao derivados das datas.';
comment on column public.aluguel.cliente_nome is
  'Cliente avulso. Preenchido so quando cliente_id e nulo; nunca vira vinculo com o cadastro.';
comment on column public.aluguel.pausado_em is
  'Momento da pausa. Enquanto pausado, a contagem de dias fica congelada nesta data.';

-- ---------------------------------------------------------------------------
-- 3) Itens do aluguel
-- ---------------------------------------------------------------------------
create table if not exists public.aluguel_item (
  id bigint generated always as identity primary key,
  aluguel_id bigint not null references public.aluguel(id) on delete cascade,
  tipo text not null,
  produto_id integer references public.produto(id),
  usoconsumo_item_id integer references public.usoconsumo_item(id),
  veiculo_id integer references public.veiculo(id),
  descricao text not null,
  identificacao text,
  quantidade integer not null default 1,
  valor numeric(14,2) not null default 0,
  estoque_saida_id bigint references public.estoque_saida(id),
  usoconsumo_saida_id bigint references public.usoconsumo_saida(id),
  devolvido_em timestamptz,
  created_at timestamptz not null default now(),
  constraint aluguel_item_tipo_check check (tipo in ('PRODUTO', 'USOCONSUMO', 'GERAL', 'VEICULO', 'AVULSO')),
  constraint aluguel_item_descricao_check check (length(btrim(descricao)) between 1 and 255),
  constraint aluguel_item_quantidade_check check (quantidade > 0),
  constraint aluguel_item_valor_check check (valor >= 0),
  constraint aluguel_item_bem_check check (
    case tipo
      when 'PRODUTO' then produto_id is not null and usoconsumo_item_id is null and veiculo_id is null
      when 'USOCONSUMO' then usoconsumo_item_id is not null and produto_id is null and veiculo_id is null
      when 'GERAL' then usoconsumo_item_id is not null and produto_id is null and veiculo_id is null
      when 'VEICULO' then veiculo_id is not null and produto_id is null and usoconsumo_item_id is null and quantidade = 1
      else produto_id is null and usoconsumo_item_id is null and veiculo_id is null
    end
  )
);

create index if not exists aluguel_item_aluguel_idx on public.aluguel_item(aluguel_id);
create index if not exists aluguel_item_veiculo_idx on public.aluguel_item(veiculo_id) where veiculo_id is not null;
create index if not exists aluguel_item_produto_idx on public.aluguel_item(produto_id) where produto_id is not null;
create index if not exists aluguel_item_usoconsumo_idx on public.aluguel_item(usoconsumo_item_id) where usoconsumo_item_id is not null;

comment on column public.aluguel_item.descricao is
  'Nome do bem no momento do aluguel (snapshot do cadastro) ou o texto do item avulso.';
comment on column public.aluguel_item.devolvido_em is
  'Quando a saida de estoque do item foi estornada (encerramento, exclusao ou remocao na edicao).';

-- ---------------------------------------------------------------------------
-- 4) Vinculo do documento de saida com o aluguel
-- ---------------------------------------------------------------------------
INSERT INTO public.tipos_motivo_saida (codigo, nome, descricao, escopo) VALUES
  ('ALUGUEL', 'Aluguel',
   'Item que saiu em aluguel. Volta ao estoque quando o aluguel e encerrado ou excluido.', 'AMBOS')
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE public.estoque_saida
  ADD COLUMN IF NOT EXISTS aluguel_id bigint REFERENCES public.aluguel(id);
ALTER TABLE public.usoconsumo_saida
  ADD COLUMN IF NOT EXISTS aluguel_id bigint REFERENCES public.aluguel(id);

CREATE INDEX IF NOT EXISTS estoque_saida_aluguel_idx
  ON public.estoque_saida(aluguel_id) WHERE aluguel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usoconsumo_saida_aluguel_idx
  ON public.usoconsumo_saida(aluguel_id) WHERE aluguel_id IS NOT NULL;

COMMENT ON COLUMN public.estoque_saida.aluguel_id IS
  'Aluguel que tirou o item. Preenchida, a saida so pode ser cancelada pelo modulo Alugueis.';
COMMENT ON COLUMN public.usoconsumo_saida.aluguel_id IS
  'Aluguel que tirou o item. Preenchida, a saida so pode ser cancelada pelo modulo Alugueis.';

-- Portao do cancelamento pelo Estoque. Corpo de 20260903120000 com a checagem
-- do aluguel acrescentada, e nada mais.
CREATE OR REPLACE FUNCTION public.cancelar_saida_estoque(
  p_saida_id bigint,
  p_motivo text,
  p_cancelada_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_os integer;
  v_aluguel bigint;
BEGIN
  SELECT ordemservicoid, aluguel_id INTO v_os, v_aluguel FROM public.estoque_saida WHERE id = p_saida_id;
  IF v_os IS NOT NULL
     AND coalesce(nullif(current_setting('app.consumo_os_estorno', true), ''), '') <> 'permitido' THEN
    RAISE EXCEPTION 'Esta saida foi gerada pelo consumo registrado na OS #%. Cancele a despesa na ordem de servico para devolver o item ao estoque.',
      v_os USING ERRCODE = 'P0001';
  END IF;
  IF v_aluguel IS NOT NULL
     AND coalesce(nullif(current_setting('app.aluguel_estorno', true), ''), '') <> 'permitido' THEN
    RAISE EXCEPTION 'Esta saida foi gerada pelo Aluguel #%. Encerre, edite ou exclua o aluguel para devolver o item ao estoque.',
      v_aluguel USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.estoque_definir_contexto(
    'SAIDA_MANUAL', p_saida_id, 'Saida #' || p_saida_id || ' - cancelada', p_cancelada_by
  );
  RETURN public.cancelar_saida_estoque_interna(p_saida_id, p_motivo, p_cancelada_by);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancelar_saida_usoconsumo(
  p_saida_id bigint, p_motivo text, p_cancelada_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_saida public.usoconsumo_saida%ROWTYPE; v_linha record;
  v_motivo text := nullif(btrim(p_motivo), '');
BEGIN
  IF v_motivo IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_saida FROM public.usoconsumo_saida WHERE id=p_saida_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saida nao encontrada.' USING ERRCODE='P0002'; END IF;
  IF v_saida.status='CANCELADA' THEN RAISE EXCEPTION 'Saida ja cancelada.' USING ERRCODE='22023'; END IF;
  IF v_saida.ordemservicoid IS NOT NULL
     AND coalesce(nullif(current_setting('app.consumo_os_estorno', true), ''), '') <> 'permitido' THEN
    RAISE EXCEPTION 'Esta saida foi gerada pelo consumo registrado na OS #%. Cancele a despesa na ordem de servico para devolver o item ao estoque.',
      v_saida.ordemservicoid USING ERRCODE='P0001';
  END IF;
  IF v_saida.aluguel_id IS NOT NULL
     AND coalesce(nullif(current_setting('app.aluguel_estorno', true), ''), '') <> 'permitido' THEN
    RAISE EXCEPTION 'Esta saida foi gerada pelo Aluguel #%. Encerre, edite ou exclua o aluguel para devolver o item ao estoque.',
      v_saida.aluguel_id USING ERRCODE='P0001';
  END IF;
  FOR v_linha IN SELECT * FROM public.usoconsumo_saida_item WHERE saida_id=p_saida_id ORDER BY id FOR UPDATE LOOP
    PERFORM 1 FROM public.usoconsumo_item WHERE id=v_linha.item_id FOR UPDATE;
    PERFORM set_config('app.usoconsumo_movimento','permitido',true);
    UPDATE public.usoconsumo_item SET estoque=estoque+v_linha.quantidade,updated_by=p_cancelada_by WHERE id=v_linha.item_id;
  END LOOP;
  UPDATE public.usoconsumo_saida
    SET status='CANCELADA',cancelada_at=now(),cancelada_by=p_cancelada_by,motivo_cancelamento=v_motivo
    WHERE id=p_saida_id;
  RETURN jsonb_build_object('saida_id',p_saida_id,'status','CANCELADA');
END $fn$;

-- ---------------------------------------------------------------------------
-- 5) Checklist de saida e de retorno
-- ---------------------------------------------------------------------------
create table if not exists public.aluguel_checklist (
  id bigint generated always as identity primary key,
  aluguel_id bigint not null references public.aluguel(id) on delete cascade,
  tipo text not null,
  checklist_modelo_id integer references public.checklist_modelo(id) on delete set null,
  observacao text,
  realizado_em timestamptz not null default now(),
  realizado_por uuid references public.usuario(id),
  updated_at timestamptz not null default now(),
  constraint aluguel_checklist_tipo_check check (tipo in ('SAIDA', 'RETORNO')),
  constraint aluguel_checklist_unico unique (aluguel_id, tipo)
);

create table if not exists public.aluguel_checklist_item (
  id bigint generated always as identity primary key,
  checklist_id bigint not null references public.aluguel_checklist(id) on delete cascade,
  modelo_item_id integer references public.checklist_modelo_item(id) on delete set null,
  titulo text not null,
  descricao text,
  status text,
  observacao text,
  ordem integer not null default 0,
  constraint aluguel_checklist_item_status_check check (status is null or status in ('OK', 'ALERTA', 'FALHA')),
  constraint aluguel_checklist_item_titulo_check check (length(btrim(titulo)) between 1 and 255)
);

create index if not exists aluguel_checklist_item_checklist_idx
  on public.aluguel_checklist_item(checklist_id);

create table if not exists public.aluguel_checklist_imagem (
  id bigint generated always as identity primary key,
  checklist_item_id bigint not null references public.aluguel_checklist_item(id) on delete cascade,
  url text not null,
  descricao text,
  created_by uuid references public.usuario(id),
  created_at timestamptz not null default now()
);

create index if not exists aluguel_checklist_imagem_item_idx
  on public.aluguel_checklist_imagem(checklist_item_id);

comment on table public.aluguel_checklist is
  'Checklist de saida (entrega ao cliente) e de retorno de um aluguel. Nenhum dos dois e obrigatorio.';

-- ---------------------------------------------------------------------------
-- 6) Linha do tempo
-- ---------------------------------------------------------------------------
create table if not exists public.aluguel_evento (
  id bigint generated always as identity primary key,
  aluguel_id bigint not null references public.aluguel(id) on delete cascade,
  tipo text not null,
  dados jsonb not null default '{}'::jsonb,
  usuario_id uuid references public.usuario(id),
  created_at timestamptz not null default now(),
  constraint aluguel_evento_tipo_check check (tipo in (
    'CRIADO', 'EDITADO', 'PAUSADO', 'REINICIADO', 'ENCERRADO', 'EXCLUIDO',
    'CHECKLIST_SAIDA', 'CHECKLIST_RETORNO'
  ))
);

create index if not exists aluguel_evento_aluguel_idx
  on public.aluguel_evento(aluguel_id, created_at);

-- ---------------------------------------------------------------------------
-- 7) updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_aluguel_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_aluguel_updated_at() from public, anon, authenticated;

drop trigger if exists trg_aluguel_updated_at on public.aluguel;
create trigger trg_aluguel_updated_at
before update on public.aluguel
for each row execute function public.set_aluguel_updated_at();

drop trigger if exists trg_aluguel_checklist_updated_at on public.aluguel_checklist;
create trigger trg_aluguel_checklist_updated_at
before update on public.aluguel_checklist
for each row execute function public.set_aluguel_updated_at();

-- ---------------------------------------------------------------------------
-- 8) Funcoes de estoque do aluguel
-- ---------------------------------------------------------------------------
-- "Hoje" do aluguel: o dia em Fortaleza, nao o do servidor (UTC).
create or replace function public.aluguel_hoje()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'America/Fortaleza')::date;
$$;

-- Tira o item do estoque. Veiculo e avulso nao tem saldo e passam direto.
create or replace function public.aluguel_baixar_item(p_item_id bigint, p_usuario uuid)
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
  if v_item.estoque_saida_id is not null or v_item.usoconsumo_saida_id is not null then
    return;
  end if;

  v_rotulo := 'Aluguel #' || v_item.aluguel_id;

  if v_item.tipo = 'PRODUTO' then
    v_saida := public.registrar_saida_estoque(
      v_item.produto_id, v_item.quantidade, 'ALUGUEL', v_rotulo, p_usuario
    );
    v_saida_id := (v_saida->>'saida_id')::bigint;
    update public.estoque_saida set aluguel_id = v_item.aluguel_id where id = v_saida_id;
    update public.aluguel_item set estoque_saida_id = v_saida_id, devolvido_em = null where id = p_item_id;
  elsif v_item.tipo in ('USOCONSUMO', 'GERAL') then
    v_saida := public.registrar_saida_usoconsumo(
      jsonb_build_object(
        'escopo', v_item.tipo,
        'motivo', 'ALUGUEL',
        'observacao', v_rotulo,
        'created_by', p_usuario
      ),
      jsonb_build_array(jsonb_build_object('item_id', v_item.usoconsumo_item_id, 'quantidade', v_item.quantidade))
    );
    v_saida_id := (v_saida->>'saida_id')::bigint;
    update public.usoconsumo_saida set aluguel_id = v_item.aluguel_id where id = v_saida_id;
    update public.aluguel_item set usoconsumo_saida_id = v_saida_id, devolvido_em = null where id = p_item_id;
  end if;
end;
$fn$;

-- Devolve o item ao estoque pelo estorno da saida. Idempotente: item sem saida
-- confirmada so recebe a marca de devolvido.
create or replace function public.aluguel_devolver_item(p_item_id bigint, p_motivo text, p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_item public.aluguel_item%rowtype;
  v_status text;
begin
  select * into v_item from public.aluguel_item where id = p_item_id for update;
  if not found then
    raise exception 'Item do aluguel nao encontrado.' using errcode = 'P0002';
  end if;

  perform set_config('app.aluguel_estorno', 'permitido', true);

  if v_item.estoque_saida_id is not null then
    select status into v_status from public.estoque_saida where id = v_item.estoque_saida_id;
    if v_status is distinct from 'CANCELADA' then
      perform public.cancelar_saida_estoque(v_item.estoque_saida_id, p_motivo, p_usuario);
    end if;
  elsif v_item.usoconsumo_saida_id is not null then
    select status into v_status from public.usoconsumo_saida where id = v_item.usoconsumo_saida_id;
    if v_status is distinct from 'CANCELADA' then
      perform public.cancelar_saida_usoconsumo(v_item.usoconsumo_saida_id, p_motivo, p_usuario);
    end if;
  end if;

  perform set_config('app.aluguel_estorno', '', true);

  update public.aluguel_item set devolvido_em = coalesce(devolvido_em, now()) where id = p_item_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 9) Criar / editar
-- ---------------------------------------------------------------------------
-- Payload:
-- { id?, data_inicio, data_limite, cliente_id?, cliente: {nome, documento,
--   telefone, email}?, observacao?, itens: [{ id?, tipo, produto_id?,
--   usoconsumo_item_id?, veiculo_id?, descricao?, identificacao?, quantidade,
--   valor }] }
--
-- Na edicao, item que some do payload e devolvido e apagado; item novo e
-- baixado; item existente que troca de bem ou de quantidade e devolvido e
-- baixado de novo. Mudanca so de valor ou texto nao mexe no estoque.
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
  v_limite date := nullif(p_payload->>'data_limite', '')::date;
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
  v_linha record;
  v_conflito bigint;
begin
  if v_inicio is null or v_limite is null then
    raise exception 'Informe a data de inicio e a data limite.' using errcode = '22023';
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

    -- Itens que sairam do payload: devolve e apaga.
    for v_linha in
      select ai.id
        from public.aluguel_item ai
       where ai.aluguel_id = v_id
         and ai.id not in (
           select nullif(x->>'id', '')::bigint
             from jsonb_array_elements(v_itens) x
            where nullif(x->>'id', '') is not null
         )
    loop
      perform public.aluguel_devolver_item(v_linha.id, 'Item retirado do aluguel #' || v_id, p_usuario);
      delete from public.aluguel_item where id = v_linha.id;
      v_removidos := v_removidos + 1;
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
      'itens_removidos', v_removidos
    ), p_usuario);
  end if;

  return v_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10) Transicoes
-- ---------------------------------------------------------------------------
create or replace function public.aluguel_pausar(p_id bigint, p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_atual public.aluguel%rowtype;
begin
  select * into v_atual from public.aluguel where id = p_id and not is_deleted for update;
  if not found then raise exception 'Aluguel nao encontrado.' using errcode = 'P0002'; end if;
  if v_atual.status <> 'ATIVO' then
    raise exception 'So um aluguel ativo pode ser pausado.' using errcode = '22023';
  end if;

  update public.aluguel
     set status = 'PAUSADO', pausado_em = now(), updated_by = p_usuario
   where id = p_id;

  insert into public.aluguel_evento (aluguel_id, tipo, dados, usuario_id)
  values (p_id, 'PAUSADO', jsonb_build_object(
    'dias_restantes', v_atual.data_limite - public.aluguel_hoje()
  ), p_usuario);
end;
$fn$;

-- A contagem volta a correr a partir de hoje, com a mesma duracao contratada.
create or replace function public.aluguel_reiniciar(p_id bigint, p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_atual public.aluguel%rowtype;
  v_hoje date := public.aluguel_hoje();
  v_duracao integer;
begin
  select * into v_atual from public.aluguel where id = p_id and not is_deleted for update;
  if not found then raise exception 'Aluguel nao encontrado.' using errcode = 'P0002'; end if;
  if v_atual.status not in ('ATIVO', 'PAUSADO') then
    raise exception 'Aluguel encerrado nao pode ser reiniciado.' using errcode = '22023';
  end if;

  v_duracao := v_atual.data_limite - v_atual.data_inicio;

  update public.aluguel
     set status = 'ATIVO',
         pausado_em = null,
         data_inicio = v_hoje,
         data_limite = v_hoje + v_duracao,
         updated_by = p_usuario
   where id = p_id;

  insert into public.aluguel_evento (aluguel_id, tipo, dados, usuario_id)
  values (p_id, 'REINICIADO', jsonb_build_object(
    'status_anterior', v_atual.status,
    'antes', jsonb_build_object('data_inicio', v_atual.data_inicio, 'data_limite', v_atual.data_limite),
    'depois', jsonb_build_object('data_inicio', v_hoje, 'data_limite', v_hoje + v_duracao),
    'duracao_dias', v_duracao
  ), p_usuario);
end;
$fn$;

create or replace function public.aluguel_encerrar(
  p_id bigint, p_encerrado_em timestamptz, p_observacao text, p_usuario uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_atual public.aluguel%rowtype;
  v_linha record;
  v_devolvidos integer := 0;
begin
  select * into v_atual from public.aluguel where id = p_id and not is_deleted for update;
  if not found then raise exception 'Aluguel nao encontrado.' using errcode = 'P0002'; end if;
  if v_atual.status = 'ENCERRADO' then
    raise exception 'Este aluguel ja esta encerrado.' using errcode = '22023';
  end if;

  for v_linha in select id from public.aluguel_item where aluguel_id = p_id order by id loop
    perform public.aluguel_devolver_item(v_linha.id, 'Retorno do aluguel #' || p_id, p_usuario);
    v_devolvidos := v_devolvidos + 1;
  end loop;

  update public.aluguel
     set status = 'ENCERRADO',
         encerrado_em = coalesce(p_encerrado_em, now()),
         encerrado_por = p_usuario,
         observacao_encerramento = nullif(btrim(coalesce(p_observacao, '')), ''),
         updated_by = p_usuario
   where id = p_id;

  insert into public.aluguel_evento (aluguel_id, tipo, dados, usuario_id)
  values (p_id, 'ENCERRADO', jsonb_build_object(
    'status_anterior', v_atual.status,
    'encerrado_em', coalesce(p_encerrado_em, now()),
    'itens_devolvidos', v_devolvidos,
    'observacao', nullif(btrim(coalesce(p_observacao, '')), '')
  ), p_usuario);
end;
$fn$;

create or replace function public.aluguel_excluir(p_id bigint, p_motivo text, p_usuario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_atual public.aluguel%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_linha record;
begin
  if v_motivo is null then
    raise exception 'Informe o motivo da exclusao.' using errcode = '22023';
  end if;
  select * into v_atual from public.aluguel where id = p_id and not is_deleted for update;
  if not found then raise exception 'Aluguel nao encontrado.' using errcode = 'P0002'; end if;

  for v_linha in select id from public.aluguel_item where aluguel_id = p_id order by id loop
    perform public.aluguel_devolver_item(v_linha.id, 'Aluguel #' || p_id || ' excluido: ' || v_motivo, p_usuario);
  end loop;

  update public.aluguel
     set is_deleted = true,
         deleted_at = now(),
         deleted_by = p_usuario,
         motivo_exclusao = v_motivo,
         updated_by = p_usuario
   where id = p_id;

  insert into public.aluguel_evento (aluguel_id, tipo, dados, usuario_id)
  values (p_id, 'EXCLUIDO', jsonb_build_object('status_anterior', v_atual.status, 'motivo', v_motivo), p_usuario);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 10b) Checklist
-- ---------------------------------------------------------------------------
-- Payload: { modelo_id?, observacao?, itens: [{ titulo, descricao?, status?,
-- observacao?, modelo_item_id?, ordem? }] }
--
-- Regravar nao apaga o que ficou: item com o mesmo titulo e atualizado no
-- lugar e mantem as fotos. So o item que sumiu do payload sai (com as fotos).
-- Devolve os itens gravados, para a tela enviar as fotos novas a cada um.
create or replace function public.aluguel_salvar_checklist(
  p_aluguel_id bigint, p_tipo text, p_payload jsonb, p_usuario uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_tipo text := upper(btrim(coalesce(p_tipo, '')));
  v_itens jsonb := coalesce(p_payload->'itens', '[]'::jsonb);
  v_checklist_id bigint;
  v_json jsonb;
  v_titulo text;
  v_status text;
  v_ordem integer := 0;
  v_existente bigint;
begin
  if v_tipo not in ('SAIDA', 'RETORNO') then
    raise exception 'Tipo de checklist invalido: %.', p_tipo using errcode = '22023';
  end if;
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then
    raise exception 'O checklist precisa de ao menos um item.' using errcode = '22023';
  end if;
  perform 1 from public.aluguel where id = p_aluguel_id and not is_deleted for update;
  if not found then raise exception 'Aluguel nao encontrado.' using errcode = 'P0002'; end if;

  insert into public.aluguel_checklist (aluguel_id, tipo, checklist_modelo_id, observacao, realizado_em, realizado_por)
  values (
    p_aluguel_id, v_tipo, nullif(p_payload->>'modelo_id', '')::integer,
    nullif(btrim(coalesce(p_payload->>'observacao', '')), ''), now(), p_usuario
  )
  on conflict (aluguel_id, tipo) do update
    set checklist_modelo_id = excluded.checklist_modelo_id,
        observacao = excluded.observacao,
        realizado_em = now(),
        realizado_por = excluded.realizado_por
  returning id into v_checklist_id;

  delete from public.aluguel_checklist_item
   where checklist_id = v_checklist_id
     and btrim(titulo) not in (
       select btrim(coalesce(x->>'titulo', '')) from jsonb_array_elements(v_itens) x
     );

  for v_json in select value from jsonb_array_elements(v_itens) loop
    v_titulo := nullif(btrim(coalesce(v_json->>'titulo', '')), '');
    if v_titulo is null then
      raise exception 'Item do checklist sem titulo.' using errcode = '22023';
    end if;
    v_status := nullif(upper(btrim(coalesce(v_json->>'status', ''))), '');
    v_ordem := coalesce(nullif(v_json->>'ordem', '')::integer, v_ordem + 1);

    select id into v_existente from public.aluguel_checklist_item
     where checklist_id = v_checklist_id and btrim(titulo) = v_titulo
     order by id limit 1;

    if v_existente is null then
      insert into public.aluguel_checklist_item (checklist_id, modelo_item_id, titulo, descricao, status, observacao, ordem)
      values (
        v_checklist_id, nullif(v_json->>'modelo_item_id', '')::integer, v_titulo,
        nullif(btrim(coalesce(v_json->>'descricao', '')), ''), v_status,
        nullif(btrim(coalesce(v_json->>'observacao', '')), ''), v_ordem
      );
    else
      update public.aluguel_checklist_item
         set modelo_item_id = nullif(v_json->>'modelo_item_id', '')::integer,
             descricao = nullif(btrim(coalesce(v_json->>'descricao', '')), ''),
             status = v_status,
             observacao = nullif(btrim(coalesce(v_json->>'observacao', '')), ''),
             ordem = v_ordem
       where id = v_existente;
    end if;
  end loop;

  insert into public.aluguel_evento (aluguel_id, tipo, dados, usuario_id)
  values (p_aluguel_id, 'CHECKLIST_' || v_tipo, jsonb_build_object(
    'itens', jsonb_array_length(v_itens),
    'alertas', (select count(*) from public.aluguel_checklist_item where checklist_id = v_checklist_id and status = 'ALERTA'),
    'falhas', (select count(*) from public.aluguel_checklist_item where checklist_id = v_checklist_id and status = 'FALHA')
  ), p_usuario);

  return jsonb_build_object(
    'checklist_id', v_checklist_id,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'titulo', i.titulo) order by i.ordem, i.id)
        from public.aluguel_checklist_item i where i.checklist_id = v_checklist_id
    ), '[]'::jsonb)
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 11) Acesso
-- ---------------------------------------------------------------------------
-- As rotas usam o service_role; nada para anon/authenticated.
DO $acesso$
DECLARE
  v_tabela text;
  v_funcao text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY[
    'public.aluguel',
    'public.aluguel_item',
    'public.aluguel_checklist',
    'public.aluguel_checklist_item',
    'public.aluguel_checklist_imagem',
    'public.aluguel_evento'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_tabela);
    EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', v_tabela);
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', v_tabela);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO service_role', v_tabela);
  END LOOP;

  FOREACH v_funcao IN ARRAY ARRAY[
    'public.aluguel_hoje()',
    'public.aluguel_baixar_item(bigint, uuid)',
    'public.aluguel_devolver_item(bigint, text, uuid)',
    'public.aluguel_salvar(jsonb, uuid)',
    'public.aluguel_pausar(bigint, uuid)',
    'public.aluguel_reiniciar(bigint, uuid)',
    'public.aluguel_encerrar(bigint, timestamptz, text, uuid)',
    'public.aluguel_excluir(bigint, text, uuid)',
    'public.aluguel_salvar_checklist(bigint, text, jsonb, uuid)',
    'public.cancelar_saida_estoque(bigint, text, uuid)',
    'public.cancelar_saida_usoconsumo(bigint, text, uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_funcao);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_funcao);
  END LOOP;
END;
$acesso$;

-- ---------------------------------------------------------------------------
-- 12) Auditoria
-- ---------------------------------------------------------------------------
-- Corpo vivo de auditoria_modulo_tabela com `^aluguel` -> 'alugueis'.
CREATE OR REPLACE FUNCTION public.auditoria_modulo_tabela(nome_tabela text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when nome_tabela ~* '^(mercadolivre|marketplace)' then 'marketplace'
    when nome_tabela ~* '^desmanche' then 'desmanche'
    when nome_tabela ~* '^(agendamento)' then 'agendamentos'
    when nome_tabela ~* '^aluguel' then 'alugueis'
    when nome_tabela ~* '^(ordemservico|os|checklist|imagemvistoria)' then 'ordens'
    when nome_tabela ~* '^(venda|categoria_venda)' then 'vendas'
    when nome_tabela ~* '^(produto|fornecedor|peca|unidademedida|produtogrupo)' then 'estoque'
    when nome_tabela ~* '^(pagamento|transacao|bancoconta|categoriatransacao)' then 'financeiro'
    when nome_tabela ~* '^(nfe|nfse|notafiscal|fiscal)' then 'fiscal'
    when nome_tabela ~* '^(veiculo|transferencias_veiculos|cores_veiculos)' then 'veiculos'
    when nome_tabela ~* '^cliente' then 'clientes'
    when nome_tabela ~* '^(usuario|perfil|permissao|perfilpermissao|setor)' then 'usuarios'
    when nome_tabela ~* '^(config|empresa|categoriaservico|tiposervico|servico)' then 'configuracoes'
    else 'outros'
  end;
$function$;

DO $auditoria$
BEGIN
  IF to_regprocedure('public.habilitar_auditoria_tabela(regclass)') IS NOT NULL THEN
    PERFORM public.habilitar_auditoria_tabela('public.aluguel'::regclass);
    PERFORM public.habilitar_auditoria_tabela('public.aluguel_item'::regclass);
    PERFORM public.habilitar_auditoria_tabela('public.aluguel_checklist'::regclass);
    PERFORM public.habilitar_auditoria_tabela('public.aluguel_checklist_item'::regclass);
  END IF;
END;
$auditoria$;

COMMIT;
