-- Uma permissao de acesso para cada tela do menu Financeiro.
--
-- O PROBLEMA
-- `financeiro:visualizar` abria o menu inteiro: Fluxo de Caixa, Bancos, Eventos
-- de Ordens, Pagamento de Ordens, Pagamento de Vendas, Acompanhamento e DRE.
-- Nao havia como dar a uma pessoa so Bancos, ou so o Pagamento de Ordens. Fiscal
-- e SPED ja tinham a sua (`financeiro:notas_fiscais`, `fiscal:sped`).
--
-- A REGRA
-- Cada tela ganha a sua permissao, e a tela so abre com ela. Cada uma inclui
-- `financeiro:visualizar` (IMPLIED_PERMISSIONS em permission-constants.ts):
-- marcar "Bancos" basta. `financeiro:visualizar` continua existindo como acesso
-- base -- o financeiro dentro da OS e da venda, e as APIs que as telas
-- compartilham (transacao, lista de contas, eventos) -- mas sozinha nao abre
-- nenhuma tela do menu.
--
-- Criar, editar e excluir seguem valendo para o financeiro inteiro
-- (`financeiro:criar`, `:editar`, `:excluir`).
--
-- BACKFILL: NINGUEM PERDE ACESSO
-- Quem ja tinha `financeiro:visualizar` via todas essas telas, e continua vendo:
-- o perfil recebe as sete. `financeiro:notas_fiscais` tambem inclui
-- `financeiro:visualizar`, entao quem so tinha a fiscal tambem abria essas
-- telas -- e tambem as recebe. Perfis novos nascem sem nenhuma, e as telas sao
-- marcadas uma a uma em Configuracoes > Cargos.
--
-- ORDEM DO DEPLOY
-- Esta migration antes do codigo. O codigo antigo ignora as permissoes novas;
-- o novo, sem o backfill, tiraria o financeiro de quem entrasse depois dele.

insert into public.permissao (nome, descricao)
values
  ('financeiro:fluxo_de_caixa',
   'Abrir o Fluxo de Caixa, com a conciliacao bancaria'),
  ('financeiro:bancos',
   'Abrir a tela de Bancos, com saldos e movimentacao por conta'),
  ('financeiro:eventos_de_ordens',
   'Abrir a lista de Eventos de Ordens do financeiro'),
  ('financeiro:pagamento_de_ordens',
   'Abrir a tela de Pagamento de Ordens'),
  ('financeiro:pagamento_de_vendas',
   'Abrir a tela de Pagamento de Vendas'),
  ('financeiro:acompanhamento',
   'Abrir o painel de Acompanhamento financeiro'),
  ('financeiro:dre',
   'Abrir a DRE')
on conflict (nome) do update
set descricao = excluded.descricao;

update public.permissao
   set descricao = 'Acesso base: ver o financeiro dentro da OS e da venda. '
                || 'As telas do menu Financeiro tem permissao propria.'
 where nome = 'financeiro:visualizar';

insert into public.perfilpermissao (perfilid, permissaoid)
select distinct pp.perfilid, nova.id
from public.perfilpermissao pp
join public.permissao base on base.id = pp.permissaoid
                          and base.nome in ('financeiro:visualizar', 'financeiro:notas_fiscais')
join public.permissao nova on nova.nome in (
  'financeiro:fluxo_de_caixa',
  'financeiro:bancos',
  'financeiro:eventos_de_ordens',
  'financeiro:pagamento_de_ordens',
  'financeiro:pagamento_de_vendas',
  'financeiro:acompanhamento',
  'financeiro:dre'
)
on conflict do nothing;
