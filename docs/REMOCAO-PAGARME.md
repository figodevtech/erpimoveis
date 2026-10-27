# Remocao da integracao Pagar.me / Stone Connect

Em 26/10/2026 foi removida a cobranca por pedido enviado a maquineta via
Pagar.me / Stone Connect, por descontinuacao desse modo de integracao.

Removidos:

- Cliente HTTP `pagarme-connect` e processador exclusivo dos pagamentos POS.
- Rotas `/api/pagamentos/stone/{pedido,webhook,simular,pendencias}`.
- Rota de conciliacao especifica `/api/pagamentos/[id]/conciliar`.
- Dialogo `OsStonePaymentDialog`, estado, propriedades e acao antiga de Ordens.
- Variaveis `PAGARME_API_BASE`, `PAGARME_SECRET_KEY`, `PAGARME_PUBLIC_KEY` e
  `STONE_POS_SERIAL` do arquivo de exemplo de ambiente.
- Dois testes exclusivos do parser do webhook removido, junto com o parser.

Preservados:

- Registro de pagamentos pelo financeiro e os outros meios de recebimento.
- Consulta historica `/api/pagamentos/[id]`, que nao chama o provedor externo.
- Registros, tabelas, funcoes SQL e migrations historicas do banco. Nenhuma
  migration, alteracao de schema ou exclusao de pagamentos foi executada.
- Integracoes independentes de TEF e demais provedores.

Arquivos de ambiente reais nao foram editados nem expostos. O codigo de
execucao nao depende mais das variaveis Pagar.me. Configuracoes externas no
painel do provedor ou da hospedagem nao foram modificadas.

Verificacao: 2.800 testes de negocio aprovados, ESLint sem erros nos tres
componentes/helpers de Ordens alterados e nenhum diagnostico TypeScript
nesses arquivos (um diagnostico em dependencia fora deles).

A build completa de producao terminou com sucesso, incluindo a geracao de
222 paginas. Foi usado `npm run build` com saida `.next-perf-production` e
configuracao TypeScript temporaria para preservar o servidor de desenvolvimento.
O manifesto gerado confirmou ausencia das rotas Stone e preservacao da consulta
historica. O erro de variaveis Pagar.me que bloqueava a build foi eliminado.
Log local: `artifacts/performance/build-without-pagarme.log`.
