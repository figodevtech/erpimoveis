-- Trocar o vendedor de uma venda passa a exigir permissao propria.
--
-- O PROBLEMA
-- `vendas:editar` abria tudo: quem podia corrigir uma descricao podia tambem
-- trocar o beneficiario da comissao. Sao atos de peso diferente e estavam na
-- mesma chave.
--
-- POR QUE E ATO DE PESO
-- `venda.vendedor` nao e rotulo: `reconciliar_comissao_venda` le
-- `coalesce(venda.vendedor, venda.created_by)` como beneficiario e, quando o
-- nome muda, reapura a comissao pela taxa de quem entrou (20260909125000).
-- Trocar o vendedor move dinheiro de uma pessoa para outra.
--
-- SEM BACKFILL, COMO `ordens:alterar_criador`
-- Mesma natureza, mesma politica: a permissao nasce sem ninguem, e e concedida
-- a dedo em Configuracoes > Cargos. Copiar de `vendas:editar` devolveria no
-- mesmo instante o acesso que esta separacao existe para tirar.
--
-- O QUE NAO MUDA
-- Definir o vendedor quando a venda nasce continua livre: o POST ja preenche
-- com quem esta logado, e isso nao e transferencia. A trava e so para alterar
-- depois, e so quando o valor muda de verdade -- o dialog reenvia o campo
-- inalterado em toda gravacao, e recusar isso barraria a edicao inteira.

insert into public.permissao (nome, descricao)
values ('vendas:alterar_vendedor',
        'Alterar o vendedor de uma venda e transferir a comissao')
on conflict (nome) do update
set descricao = excluded.descricao;
