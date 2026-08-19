-- Alvo do orcamento avulso: veiculo, peca ou equipamento.
--
-- Ate aqui o orcamento so sabia "para quem"; o "sobre o que" era perguntado de
-- novo na hora de gerar a OS, mesmo quando o atendente ja sabia disso ao cotar.
-- Agora o orcamento carrega o mesmo alvo da OS e a conversao apenas o repassa.
--
-- Peca e equipamento ficam em colunas proprias, e nao em public.peca como na OS:
-- um orcamento pode nunca virar OS, e criar a peca no cadastro ao cotar deixaria
-- registro orfao para cada proposta recusada. A linha de public.peca continua
-- nascendo so na conversao, a partir do que esta gravado aqui.

alter table public.orcamento
  add column if not exists alvo_tipo text not null default 'VEICULO',
  add column if not exists peca_titulo text,
  add column if not exists peca_descricao text,
  add column if not exists peca_lacre text,
  add column if not exists equipamento_nome text,
  add column if not exists equipamento_patrimonio text,
  add column if not exists equipamento_ano integer,
  add column if not exists equipamento_horimetro numeric;

alter table public.orcamento
  drop constraint if exists orcamento_alvo_tipo_check;
alter table public.orcamento
  add constraint orcamento_alvo_tipo_check
  check (alvo_tipo in ('VEICULO', 'PECA', 'EQUIPAMENTO'));

-- O alvo e exclusivo: trocar de tipo tem que limpar o anterior, senao a
-- conversao teria dois candidatos e a impressao mostraria o alvo errado.
-- Como a API e a unica escritora (RLS revogada para anon/authenticated), a
-- constraint aqui e o que garante que nenhum caminho novo esqueca de limpar.
alter table public.orcamento
  drop constraint if exists orcamento_alvo_coerente_check;
alter table public.orcamento
  add constraint orcamento_alvo_coerente_check
  check (
    case alvo_tipo
      when 'VEICULO' then peca_titulo is null and equipamento_nome is null
      when 'PECA' then veiculoid is null and equipamento_nome is null
      else veiculoid is null and peca_titulo is null
    end
  );

alter table public.orcamento
  drop constraint if exists orcamento_equipamento_ano_check;
alter table public.orcamento
  add constraint orcamento_equipamento_ano_check
  check (equipamento_ano is null or equipamento_ano between 1900 and 3000);

alter table public.orcamento
  drop constraint if exists orcamento_equipamento_horimetro_check;
alter table public.orcamento
  add constraint orcamento_equipamento_horimetro_check
  check (equipamento_horimetro is null or equipamento_horimetro >= 0);

comment on column public.orcamento.alvo_tipo is
  'O que sera atendido: VEICULO, PECA ou EQUIPAMENTO. Espelha ordemservico.alvo_tipo.';
comment on column public.orcamento.peca_titulo is
  'Peca cotada, ainda sem linha em public.peca — ela so e criada quando o orcamento vira OS.';
comment on column public.orcamento.equipamento_nome is
  'Maquina/equipamento cotado, no mesmo formato inline de ordemservico.';
