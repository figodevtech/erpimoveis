# Realtime de ordens de serviço

Correção de 08/10/2026. A migration `20261009020312_enable_ordens_realtime.sql` foi criada pelo Supabase CLI e aplicada em Demonstração, Demir e Garage Premium. O código da aplicação foi atualizado no workspace; a publicação da aplicação não foi executada.

## Comportamento

- Mudanças em qualquer um dos 11 status, criação, exclusão e edição de OS invalidam a lista e os contadores.
- Serviços e realizadores também geram avisos para o painel de execução e os detalhes abertos.
- O evento local `os:refresh` atualiza lista, contadores e detalhes imediatamente.
- Avisos em rajada são agrupados por 150 ms; mudanças recebidas com a aba oculta são buscadas ao retornar.
- O cliente renova o token antes do vencimento e busca novamente os dados após o join/reconexão. A consulta periódica de 60 segundos permanece como recuperação.
- Respostas antigas não sobrescrevem os dados mais recentes na lista, contadores e detalhes.

## Segurança e configuração

O banco envia broadcasts privados no tópico `ordens:tenant:<empresa>`, evento `ordens_changed`. O payload da aplicação contém apenas o nome da tabela (o Supabase acrescenta seu identificador de mensagem). Os dados das ordens continuam sendo lidos exclusivamente pelas APIs autenticadas.

A rota `/api/ordens/realtime-token` valida sessão, usuário ativo e uma das permissões de ordens, execução, acompanhamento ou acompanhamento financeiro. A política SQL confere o usuário ativo, as permissões e o tópico da empresa deste banco. A resolução da empresa segue a arquitetura existente: um banco por instalação, primeira empresa por ID.

O socket de ordens é compartilhado pelos componentes do mesmo usuário e separado do socket do chat. Usa o token Supabase da sessão; sessões antigas podem usar o segredo opcional `SUPABASE_CHAT_JWT_SECRET`, como já ocorre no chat.

Nenhum acesso SELECT a `ordemservico` foi concedido a `anon` ou `authenticated`. A função de emissão não é executável pelo navegador. Apenas a função que autoriza o tópico é executável por usuários autenticados.

## Validação realizada

| Verificação | Demonstração | Demir | Garage Premium |
|---|---|---|---|
| Migration registrada no histórico | OK | OK | OK |
| Três triggers ativos e política privada | OK | OK | OK |
| Todos os 11 status entregues a dois sockets | OK | OK | OK |
| Serviços, realizadores e reconexão | OK | OK | OK |
| Autorização de usuário existente e rejeição de outro tenant/usuário inexistente em SQL | OK | OK | OK |
| Leitura direta bloqueada para anon/authenticated | OK | OK | OK |
| Advisors de segurança, nível error | No issues found | No issues found | No issues found |

O teste de transmissão usa credenciais de servidor existentes, sem criar usuários. O teste SQL utiliza tabelas temporárias e termina com ROLLBACK. Nenhuma ordem real é modificada. O fluxo em navegador de produção não foi testado.

Também passaram os 8 testes locais de conexão, renovação, desmontagem, eventos locais, agrupamento de avisos e aba oculta, o lint dos arquivos novos e a checagem TypeScript do módulo com suas dependências.

## Reproduzir

```powershell
npm run test:ordens:realtime
node node_modules/typescript/bin/tsc --project scripts/tests/tsconfig.ordens-realtime.json --noEmit
npm run db:test:ordens-realtime
node scripts/db/dry-run-ordens-realtime.mjs supabase/migrations/20261009020312_enable_ordens_realtime.sql
```

Os scripts de banco leem as três conexões da `.env`, incluindo os blocos comentados de cada instalação. Não exibem URLs, senhas ou chaves. O teste de sockets aceita o nome de um banco como argumento para testar apenas aquela instalação.
