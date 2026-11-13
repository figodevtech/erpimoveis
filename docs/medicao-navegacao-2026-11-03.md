# Medição autenticada de navegação — 03/11/2026

Execução local em `http://localhost:3000`, com a sessão de teste salva pelo usuário e duas rodadas pelo Playwright. Foram realizadas apenas navegações e consultas; não foram testadas gravações, cancelamentos, pagamentos ou repasses.

## Resultado

As 22 navegações concluíram com estado `ok` e sem erros HTTP reportados pelo medidor. O comando encerrou com código 1 porque cinco medições ultrapassaram o orçamento de 5.000 ms na primeira rodada; não foi falha de login ou de abertura de módulos. Na segunda rodada, todas ficaram abaixo do orçamento.

| Tela | Rodada 1 (ms) | Rodada 2 (ms) |
| --- | ---: | ---: |
| Dashboard | 4226 | 2980 |
| Imóveis | 3543 | 3353 |
| Proprietários | 4995 | 3109 |
| Reservas | 6376 | 4125 |
| Locações imobiliárias | 5028 | 3076 |
| Vendas imobiliárias | 4994 | 3076 |
| Clientes | 5228 | 3726 |
| Fluxo de caixa | 5910 | 3343 |
| Bancos | 3611 | 3009 |
| Fiscal | 5910 | 3076 |
| Relatórios | 1629 | 1827 |

O tempo corresponde à tela pronta segundo o medidor e inclui uma janela de estabilidade de pelo menos 700 ms. Não é somente tempo de resposta da API nem uma métrica de Core Web Vitals. A primeira rodada não garante cache frio. As duas rodadas usam o mesmo código; sua diferença não comprova ganho antes/depois das alterações. Tampouco certifica a performance de um build de produção.

## Consultas a priorizar

Na segunda rodada:

- `/api/reservas`: 1882 ms; contador: 1548 ms. A tela ficou pronta em 4125 ms, o maior tempo entre os módulos imobiliários.
- `/api/customers`: 1884 ms; contador: 1117 ms.
- `/api/transaction/kpis`: 1429 ms; listagem: 1119 ms.
- `/api/imoveis`: 1386 ms; contador: 1062 ms.
- Consultas de seleção (`/api/imobiliario/lookup`) em locações/vendas ficaram próximas de 1200 ms.
- No dashboard, a lista de requisições contém duas leituras de `/api/dashboard/financeiro` (1043 e 948 ms); confirmar os parâmetros/consumidores antes de concluir duplicidade, pois o relatório remove as consultas das URLs para preservar dados.

Próxima investigação: decompor autenticação/acesso, consulta principal, contagens e enriquecimento de reservas/clientes. Medir planos SQL e volume em homologação antes de alterar índices ou substituir consultas por agregações. Os problemas de projeção financeira e de extratos acima de 1.000 registros continuam pendentes; a navegação bem-sucedida não os elimina.

## Artefatos

Relatório detalhado com tempos e caminhos de requisições:

- [navigation.md](../artifacts/performance/2026-11-03T14-07-34-755Z/navigation.md)
- [navigation.json](../artifacts/performance/2026-11-03T14-07-34-755Z/navigation.json)

Os artefatos ficam no diretório local ignorado pelo Git. O arquivo de sessão em `playwright/.auth` também permanece local e não deve ser publicado.
