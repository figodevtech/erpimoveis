# Diagnóstico do Supabase — Demir Diesel — 08/09/2026

## Resultado

O recorte mostra degradação generalizada do banco e dos serviços dependentes. Sobrecarga de recursos ou problema de infraestrutura são hipóteses prioritárias; o arquivo não permite confirmar CPU, memória, disco, limite de conexões ou bloqueios como causa raiz.

## Evidências do arquivo

Fonte: `supabase_logs (6).json`, projeto `lkpwaiynvnfedvxcjmrp`.
Intervalo: 08/09/2026, 17:38:42 a 19:08:21, horário de Brasília (20:38:42 a 22:08:21 UTC).

São 1.000 registros: 702 de HTTP/edge e 298 de PostgreSQL. Dos 702 registros HTTP, 629 têm status 5xx (89,6% deste recorte; não representa necessariamente a taxa global do projeto).

| Evento | Quantidade |
| --- | ---: |
| HTTP 503 | 347 |
| HTTP 504 | 140 |
| HTTP 522 | 134 |
| Outros HTTP 5xx | 8 |
| Cancelamento por statement timeout | 87 |
| Falha de inicialização do cron job 1 por timeout | 15 |
| Falha do comando de arquivamento WAL | 1 |

A rota `/rest/v1/usuario` concentra 497 falhas em 531 registros. Também falham preferências, configurações gerais, consultas financeiras, renovação de tokens e Storage. A concentração em usuários não prova que essa tabela seja a origem: autenticação e verificações de acesso dependem dela em várias rotas.

Consultas internas também ficaram lentas:

- Leitura de uma configuração em `pg_settings`: 10,64 segundos.
- Leitura das versões de migrations com índice: 10,08 segundos.
- Listagem de extensões pelo dashboard: 45,58 segundos.
- Leitura de alterações pelo Realtime: 13,64 segundos.

O agendador de resumo financeiro do Telegram falhou ao iniciar. Isso não demonstra que a função do Telegram causou o incidente. O código local agenda a chamada a cada cinco minutos e utiliza `pg_net`.

Há um `archive command failed with exit code 1` às 19:05:31 de Brasília. É necessário verificar se o arquivamento voltou a funcionar; esse evento isolado não comprova perda de dados ou falha definitiva de backup.

## Verificação ao vivo

Foi tentado um diagnóstico somente de leitura usando a configuração existente do Demir. O pooler aceitou a conexão inicial, mas, antes das consultas de diagnóstico, retornou:

`Failed to connect to database: authentication did not complete within 15000ms`

A tentativa pelo endpoint direto também expirou. Esse endpoint resolveu apenas para IPv6; sem confirmar a conectividade IPv6 local, esse segundo teste não isola a causa da falha.

Não foi possível obter sessões, bloqueios ou métricas do banco. Não foram alterados dados, configurações persistentes, migrations ou código da aplicação.

## Verificação após o reinício informado pelo usuário

Nova coleta em 08/09/2026 às 19:33:43 de Brasília (22:33:43 UTC). O PostgreSQL informa início às 19:23:30 de Brasília.

- Conexão estabelecida em aproximadamente 2 segundos; consultas de diagnóstico responderam entre 72 e 209 ms.
- Leitura de `config_geral` concluída em 78 ms.
- Nenhuma sessão bloqueada na coleta.
- 21 conexões de clientes ociosas, excluindo a conexão de diagnóstico; `max_connections` configurado em 60. Processos internos e replicação aparecem separadamente e não devem ser somados indiscriminadamente a esse limite.
- Job 1 concluído com sucesso às 19:25 e 19:30, após falhas até 19:20. Isso confirma a execução do agendador, sem verificar a entrega da mensagem no Telegram.
- Arquivamento WAL voltou a registrar sucesso: último sucesso às 19:32:33, posterior à última falha às 19:21:13. As quatro falhas acumuladas são históricas desde o reset das estatísticas, não quatro falhas após o reinício.

O banco respondeu normalmente nesta coleta. O reinício recuperou a disponibilidade observada, mas a causa do incidente anterior permanece sem confirmação. O teste foi feito via PostgreSQL; não incluiu validação completa dos fluxos HTTP da aplicação. Os dados históricos de CPU, memória e disco ainda são necessários para investigar a origem e o risco de recorrência.

## Próximas verificações

1. No painel do Demir, conferir CPU, memória, Disk IO/budget, espaço em disco e conexões durante o intervalo e no momento atual, além do tamanho do Compute.
2. Quando a conexão responder, inspecionar `pg_stat_activity`, sessões bloqueadoras e consultas longas. Correlacionar com o horário do incidente antes de atribuir a causa a uma consulta.
3. Conferir o estado atual do arquivamento em `pg_stat_archiver` e as execuções do job 1 em `cron.job_run_details`.
4. Se a instância continuar inacessível, encaminhar ao suporte do Supabase o projeto, o intervalo UTC, o timeout de autenticação pelo pooler e os exemplos de consultas internas lentas.
5. Ajustar carga, consultas ou capacidade conforme as métricas. Aumentar somente `statement_timeout` não estabelece nem resolve a causa observada. Reiniciar pode aliviar cargas presas temporariamente, mas exige avaliar o impacto operacional e não substitui o diagnóstico.

No código local, chat e notificações consultam `usuario` para validar o acesso. A central de notificações já possui espera progressiva após falhas. Há também atualização periódica de telas em `src/hooks/use-realtime-tabelas.ts`. Esses pontos merecem revisão de carga se as métricas indicarem excesso de requisições, mas os logs disponíveis não demonstram que iniciaram a degradação.

## Limitações da exportação

Os campos de metadados detalhados estão vazios. Onze registros PostgreSQL têm um valor que não corresponde ao formato SQLSTATE no campo `status`, sugerindo problema na exportação ou transformação. Alguns eventos de conexão aparecem como `success` apesar de descreverem falhas. A análise considera mensagens e códigos HTTP, sem tratar todos os 1.000 registros como erros nem deduzir o início exato do incidente a partir do primeiro registro.

## Referências oficiais

- [Diagnóstico de problemas HTTP da API](https://supabase.com/docs/guides/troubleshooting/http-api-issues): relaciona timeouts/5xx a recursos insuficientes e orienta conferir métricas; reinício é mitigação temporária.
- [Uso elevado de CPU](https://supabase.com/docs/guides/troubleshooting/high-cpu-usage): descreve lentidão e possível indisponibilidade e orienta medir CPU.
- [Diagnóstico do pg_cron](https://supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz): orienta verificar execuções, concorrência e pressão sobre recursos.
