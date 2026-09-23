-- Teste da migration 20260923030000_permissoes_telas_financeiro contra um banco real.
--
-- Como rodar:
--   npm run db:test:sql -- supabase/tests/permissoes_telas_financeiro.sql demo
--
-- Apaga as permissoes novas (se ja existirem) e reaplica a migration dentro da
-- transacao, para testar o backfill mesmo depois do deploy. Termina em ROLLBACK.

BEGIN;

DELETE FROM public.perfilpermissao
 WHERE permissaoid IN (
   SELECT id FROM public.permissao
    WHERE nome IN ('financeiro:fluxo_de_caixa', 'financeiro:bancos',
                   'financeiro:eventos_de_ordens', 'financeiro:pagamento_de_ordens',
                   'financeiro:pagamento_de_vendas', 'financeiro:acompanhamento',
                   'financeiro:dre'));
DELETE FROM public.permissao
 WHERE nome IN ('financeiro:fluxo_de_caixa', 'financeiro:bancos',
                'financeiro:eventos_de_ordens', 'financeiro:pagamento_de_ordens',
                'financeiro:pagamento_de_vendas', 'financeiro:acompanhamento',
                'financeiro:dre');

-- Quem abria o financeiro antes: pela base ou pela fiscal, que a inclui.
CREATE TEMP TABLE _antes ON COMMIT DROP AS
SELECT DISTINCT pp.perfilid
  FROM public.perfilpermissao pp
  JOIN public.permissao p ON p.id = pp.permissaoid
 WHERE p.nome IN ('financeiro:visualizar', 'financeiro:notas_fiscais');

-- Corpo da migration.
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

-- Verificacoes.
DO $$
DECLARE
  v_perms int;
  v_perfis_antes int;
  v_incompletos int;
  v_intrusos int;
BEGIN
  SELECT count(*) INTO v_perms
    FROM public.permissao
   WHERE nome LIKE 'financeiro:%'
     AND nome IN ('financeiro:fluxo_de_caixa', 'financeiro:bancos',
                  'financeiro:eventos_de_ordens', 'financeiro:pagamento_de_ordens',
                  'financeiro:pagamento_de_vendas', 'financeiro:acompanhamento',
                  'financeiro:dre');
  IF v_perms <> 7 THEN
    RAISE EXCEPTION 'esperava 7 permissoes novas, achei %', v_perms;
  END IF;

  SELECT count(*) INTO v_perfis_antes FROM _antes;

  -- Todo perfil que abria o financeiro ganhou as sete.
  SELECT count(*) INTO v_incompletos
    FROM _antes a
   WHERE (SELECT count(*)
            FROM public.perfilpermissao pp
            JOIN public.permissao p ON p.id = pp.permissaoid
           WHERE pp.perfilid = a.perfilid
             AND p.nome IN ('financeiro:fluxo_de_caixa', 'financeiro:bancos',
                            'financeiro:eventos_de_ordens', 'financeiro:pagamento_de_ordens',
                            'financeiro:pagamento_de_vendas', 'financeiro:acompanhamento',
                            'financeiro:dre')) <> 7;
  IF v_incompletos > 0 THEN
    RAISE EXCEPTION '% perfil(is) com financeiro ficaram sem alguma tela', v_incompletos;
  END IF;

  -- E nenhum perfil sem financeiro ganhou tela nenhuma.
  SELECT count(DISTINCT pp.perfilid) INTO v_intrusos
    FROM public.perfilpermissao pp
    JOIN public.permissao p ON p.id = pp.permissaoid
   WHERE p.nome IN ('financeiro:fluxo_de_caixa', 'financeiro:bancos',
                    'financeiro:eventos_de_ordens', 'financeiro:pagamento_de_ordens',
                    'financeiro:pagamento_de_vendas', 'financeiro:acompanhamento',
                    'financeiro:dre')
     AND pp.perfilid NOT IN (SELECT perfilid FROM _antes);
  IF v_intrusos > 0 THEN
    RAISE EXCEPTION '% perfil(is) sem financeiro ganharam tela do financeiro', v_intrusos;
  END IF;

  RAISE NOTICE 'OK: 7 permissoes; % perfil(is) com financeiro receberam as sete; nenhum outro.', v_perfis_antes;
END $$;

ROLLBACK;
