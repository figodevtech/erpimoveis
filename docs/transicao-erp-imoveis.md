# Transição para o ERP Imóveis — 29/10/2026

## Base atual e ajuste do banco

O ERP usa exclusivamente o projeto Supabase `hchntifztkbopchpvstd`
(Cespedes Living). O diff desta etapa já retirava telas, APIs e bibliotecas de
ordens de serviço, veículos, desmanche, orçamentos de oficina e aluguel de
veículos/bens. A etapa seguinte também retirou agendamentos. Estoque,
vendas/PDV, marketplace, fiscal, financeiro, clientes e administração continuam no código; sua permanência ou adaptação
será decidida nas próximas etapas.

A migration `20261029152806_desacoplar_modulos_oficina.sql`:

- Retira 32 permissões dos módulos excluídos e seus vínculos com perfis.
- Mantém as 117 permissões presentes no código atual.
- Retira `ordemservico`, `osservico` e `osservico_realizador` da publicação
  `supabase_realtime`; mantém notificações, transações e vendas.
- Atualiza a descrição dos acessos financeiros genéricos. O identificador
  `financeiro:eventos_de_ordens` permanece porque a tela de eventos financeiros
  ainda o utiliza.

Na primeira etapa, as tabelas foram preservadas para inventariar vínculos de OS
no financeiro, notas, estoque e vídeos. Após a autorização para exclusão física,
a migration `20261029154534_excluir_agendamentos_e_legado_oficina.sql`:

- Exclui **46 tabelas** de agendamentos, veículos, desmanche, orçamentos de oficina,
  aluguel de bens, OS e checklists, incluindo `nfse_os_servico_vinculo`.
- Remove **97 funções**, **96 gatilhos** (52 explicitamente e os demais junto com
  as tabelas excluídas) e **13 chaves estrangeiras** do legado.
- Reescreve **14 funções compartilhadas** e as views `eventos_financeiros_fila`
  e `transacao_cliente`, mantendo vendas e lançamentos financeiros avulsos.
- Retira quatro permissões de agenda, suas configurações em `config_geral` e o
  campo `servico.permite_agendamento`; o catálogo atual contém **113 permissões**.
- Recusa a execução se alguma tabela a excluir contiver registros; não utiliza
  `CASCADE` para esconder dependências.

Os campos escalares antigos, como `transacao.ordemservicoid`, ainda compõem
contratos de resposta. As FKs foram removidas e constraints exigem que esses
campos permaneçam nulos: não são mais vínculos válidos nem aceitam IDs órfãos.
Sua retirada dos contratos e do schema pode ocorrer numa etapa posterior.

As consultas diretas às tabelas excluídas foram retiradas do código atual,
incluindo ranking de produtos, recorrência de clientes, relatório diário, SPED,
detalhes financeiros, comissão de serviços, notificações de OS e vínculos de
produtos com lotes de desmanche. A comissão de venda foi preservada.

O catálogo de serviços (`servico`, `tiposervico`, `categoriaservico`) continua
sendo utilizado em Configurações > Tipos. Os enums antigos continuam no schema
para compatibilidade com tipos de colunas e registros de auditoria.

Um snapshot da estrutura e do catálogo anterior foi salvo localmente em
`artifacts/db/backups/cespedes-antes-adaptacao-imoveis-20261029.json`. Ele é um
registro da estrutura e das permissões, **não um backup completo do banco**, e
está ignorado pelo Git.

Antes da exclusão física, um segundo snapshot foi salvo em
`artifacts/db/backups/cespedes-antes-exclusao-legado-20261029.json`, com contagens
reais, definições das funções/views e metadados da estrutura. As 46 tabelas
excluídas estavam vazias. Os snapshots não substituem um backup completo.

## Administrador inicial

O acesso usa as tabelas existentes `usuario`, `perfil`, `permissao` e
`perfilpermissao`; não depende de uma autorização inventada em metadados do Auth.
O script `scripts/db/configurar-administrador-inicial.ts` cria/reutiliza o perfil
Administrador, concede o catálogo atual e vincula o único usuário ativo.

```powershell
# Primeiro simula e reverte; depois grava explicitamente.
npm.cmd run db:admin:inicial -- --email <email-do-unico-usuario>
npm.cmd run db:admin:inicial -- --email <email-do-unico-usuario> --aplicar
```

O script recusa e-mail diferente, múltiplos usuários, divergência entre Auth e
ERP, usuário inativo e catálogo de permissões incompatível. Não altera senha,
confirmação de e-mail ou o campo `is_root`. É um bootstrap da instalação, não um
mecanismo permanente de promoção automática de usuários.

Depois da aplicação, sair e entrar novamente no ERP carrega o perfil e as
permissões na sessão NextAuth.

## Contrato do site

Foi inspecionado o projeto irmão
`C:\Users\luc14\OneDrive\Documentos\WORK\site-cespedesliving`.
No código local, o site **ainda usa demonstração por padrão**:
`DATA_ADAPTER=mock`. O adaptador `api` usa chamadas de servidor ao ERP com
`ERP_API_BASE_URL` e, opcionalmente, `ERP_API_TOKEN`; não foi encontrada uma
integração direta com tabelas Supabase nesse adaptador. A configuração do site
publicado não foi verificada nesta etapa.

Contratos já esperados por `src/services/adapters/api.ts` do site:

| Operação | Endpoint esperado |
| --- | --- |
| Catálogo publicado | `GET /public/flats` → `{ items: Flat[] }` |
| Detalhe público | `GET /public/flats/:slug` → `Flat` |
| Cotação e disponibilidade | `GET /public/flats/:id/quote?checkin=...&checkout=...&guests=...` |
| Solicitação de reserva | `POST /public/booking-requests` |
| Captação de proprietário | `POST /public/owner-leads` |

O site faz uma seleção explícita dos campos públicos. Proprietários,
documentos, contratos, dados de hóspedes, custos e repasses devem permanecer
privados. Os portais reais de hóspedes/proprietários e sua autenticação ainda
exigem implementação; o próprio adaptador do site sinaliza isso. Nenhum desses
endpoints imobiliários foi implementado nesta etapa.

## Sequência proposta para os módulos imobiliários

O escopo é administração de flats e hospedagens, conforme o projeto do site.
Os nomes abaixo são propostas para as próximas instruções, não tabelas ou telas
já criadas.

| Etapa | Módulo | Conteúdo e dependências |
| --- | --- | --- |
| 1 | Proprietários e imóveis | Proprietário vinculado a pessoa/cliente, edifício, unidade/flat, endereço privado, capacidade, fotos, comodidades, regras, situação e publicação no site. |
| 2 | Tarifas e disponibilidade | Calendário por imóvel, diária por período, taxas, estadia mínima e bloqueios. Fonte única para a cotação do site. |
| 3 | Hóspedes e reservas | Solicitação, confirmação, cancelamento, origem/canal, check-in/out e composição do preço registrada na reserva. Validação transacional para impedir períodos conflitantes. |
| 4 | Operação dos imóveis | Agenda de entradas/saídas, limpeza, vistoria, manutenção e consumo de materiais vinculados ao imóvel/reserva. |
| 5 | Financeiro e repasses | Receitas/despesas por imóvel e reserva, taxa de administração, contas a receber/pagar, conciliação e demonstrativo do proprietário. Adaptar o financeiro existente. |
| 6 | Site e portais | Publicar os endpoints acima, trocar o adaptador do site e implantar acesso restrito de hóspede e proprietário. O catálogo pode ser integrado assim que a etapa 1 estiver pronta. |

Não reaproveitar o aluguel de veículos/bens como reserva de hospedagem nem
renomear OS para reserva: calendário, hóspedes, estados e composição do preço
exigem regras próprias. O cadastro de imóvel deve separar o registro operacional
do anúncio público; uma unidade pode existir sem estar publicada.

A exclusão das tabelas do legado foi tratada separadamente da construção dos
novos módulos. As migrations anteriores permanecem imutáveis; a exclusão ocorre
somente na migration incremental de limpeza.

## Verificação

```powershell
npm.cmd run db:test:base-imoveis -- --email <email-do-unico-usuario>
npm.cmd run db:status
npm.cmd run test:negocio
npx tsc --noEmit --incremental false
```

O teste da base executa a migration duas vezes, confere o catálogo contra o
código, valida o Realtime e o administrador e testa a recusa de outro e-mail e
de múltiplos usuários. Todas as mudanças desse teste são revertidas; IDs de
sequências podem avançar durante a simulação. Ele também confere a presença das
ausência das tabelas excluídas, as views financeiras, a RPC do dashboard de
estoque e a DRE. Também executa uma regressão real de abono, baixa e estorno e
o teste existente de eventos manuais de vendas, com cadastros temporários.

### Resultado da primeira etapa

- Migration aplicada no banco Cespedes: 360 versões registradas, nenhuma pendente
  ou exclusiva do remoto.
- Administrador inicial vinculado ao único usuário ativo, com 117 permissões;
  confirmado pela consulta PostgREST usada no carregamento de acesso do NextAuth.
- Teste transacional da base aprovado; 2.692 testes de negócio aprovados;
  TypeScript e lint dos scripts novos aprovados.
- Advisors de segurança antes/depois: 68 avisos em ambos, nenhum introduzido pela
  alteração. São avisos anteriores de
  [search_path de funções](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
  e [extensão no schema public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public).
  Os relatórios completos estão em `artifacts/db/backups/`, ignorados pelo Git.
- O login com senha e a navegação no navegador não foram executados; a
  verificação de acesso foi feita pelo banco e pela API. Não houve deploy do
  aplicativo ou alteração no repositório irmão do site.

### Resultado da exclusão de agendamentos e tabelas legadas

- Migration de exclusão aplicada: **361 versões registradas e nenhuma pendente**.
- Confirmadas **183 tabelas públicas**, após a exclusão das 46 tabelas vazias.
- O único usuário permanece ativo como Administrador, com **113 permissões**;
  vínculo conferido novamente no banco e pelo join PostgREST usado no login.
- **2.689 testes de negócio**, TypeScript, lint e build de produção aprovados.
  As rotas excluídas não constam no manifesto do build.
- Testes PostgreSQL em rollback aprovados: reexecução da migration, catálogo,
  administrador, views, abono de cobrança de venda, baixa/estorno de despesa,
  rejeição de ID de OS, eventos manuais/automáticos de vendas e DRE. Nenhuma
  fixture de teste ficou persistida.
- Advisors de segurança: **68 → 46 avisos, nenhum novo**. Os avisos restantes
  são anteriores e estão descritos nos relatórios locais de antes/depois da
  exclusão, em `artifacts/db/backups/`.
- O banco foi atualizado; não houve publicação do aplicativo nem alteração no
  projeto independente do site. O login por senha e a navegação no navegador
  não fizeram parte desta verificação.
