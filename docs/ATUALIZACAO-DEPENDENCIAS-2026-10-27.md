# Atualizacao de dependencias — 27/10/2026

Atualizacao de correcao, mantendo Next 15.5 e React 19.2. Nenhuma migracao de banco ou deploy foi executado.

| Pacote | Instalado antes | Atualizado |
| --- | --- | --- |
| next | 15.5.14 | 15.5.28 |
| react / react-dom | 19.2.1 | 19.2.9 |
| sharp | 0.34.5 | 0.35.5 |
| eslint-config-next | linha 16 | 15.5.28 |

As versoes foram confirmadas no registro npm. Manifesto e lockfile foram atualizados com versoes exatas. A configuracao ESLint usa FlatCompat para carregar os presets da linha 15. O tipo OutputInfo de sharp passou a ser importado explicitamente; o processamento de assinaturas permanece igual.

Referencias oficiais:

- https://nextjs.org/blog/nextjs-security-update-october-14-2026
- https://react.dev/versions

## Validacao

- npm run build: sucesso, 2.824 testes de negocio passaram, zero falhas; 222 paginas geradas.
- TypeScript: zero erros com configuracao isolada cobrindo src/**/*.ts, src/**/*.tsx e os tipos de rota do build. A primeira execucao identificou a importacao de OutputInfo, corrigida antes da repeticao.
- ESLint: configuracao e arquivos ajustados passaram.
- npm run perf:test: quatro testes passaram.
- sharp: leitura, conversao para pixels e recriacao de PNG sintetico passaram sem gravacoes externas.
- Build iniciado em localhost:3001: as seis suites existentes passaram, considerando as repeticoes abaixo. Consultas e abertura/cancelamento de formularios, incluindo desktop/mobile; nenhuma gravacao de negocio, emissao fiscal ou pagamento real.

A primeira execucao integrada passou em quatro suites e falhou em duas por problemas nos testes: operational-smoke ainda apontava uma navegacao para localhost:3000; customers-smoke tentava editar o primeiro cliente, que era um cadastro protegido do sistema. O primeiro agora usa PERF_BASE_URL em todas as navegacoes, e o segundo seleciona uma linha sem a marca Sistema. Ambas as suites passaram na repeticao completa individual. Os criterios de resposta e abertura dos formularios foram mantidos.

Logs locais, ignorados pelo Git: artifacts/performance/upgrade/. O servidor de teste foi encerrado e os arquivos gerados public/sw.js e next-env.d.ts foram restaurados a partir de copias feitas antes do build.

## Pendencias

A auditoria npm apos esta atualizacao ainda informa 35 vulnerabilidades (1 baixa, 8 moderadas, 21 altas, 5 criticas), incluindo dependencias de autenticacao, XML e sanitizacao. A atualizacao de Next/React nao constitui uma auditoria de seguranca completa. O alerta restante atribuido a Next nesta auditoria vem de postcss transitivo; nao e o aviso critico corrigido por 15.5.28.

Revisar os demais alertas em uma etapa dedicada, com analise das versoes e validacao dos fluxos afetados. Nao foi usado npm audit fix --force nem foram realizadas migracoes gerais de dependencias. A instalacao tambem avisou sobre conflitos de peers Tiptap 3.31.3/3.32.0 e scripts de instalacao bloqueados pela politica npm; os checks acima passaram com o ambiente instalado.

Depois da atualizacao, reiniciar o servidor de desenvolvimento para carregar as novas versoes. Next 16 e React 19.3 ficam para uma migracao separada, com validacao de PWA, build e autenticacao.

## Segunda etapa: correcoes menores

Aplicadas, a pedido do usuario, somente estas correcoes adicionais:

- DOMPurify 3.4.15 → 3.4.17.
- node-forge 1.4.0 → 1.4.1.
- @xmldom/xmldom 0.8.11 → 0.8.15.

Manifesto e lockfile atualizados. Nenhuma alteracao adicional nas regras do ERP. Auth.js, Axios, fast-xml-parser, PWA, CLI e Zod permanecem para etapas separadas.

Validacao desta etapa:

- 2.824 testes de negocio passaram, zero falhas.
- TypeScript cobrindo src e tipos de rota: zero erros.
- next build: sucesso, 222 paginas geradas. Checagem de tipos executada separadamente pois o projeto a desliga no build.
- ESLint do novo script e git diff --check passaram.
- Novo comando npm run test:dependencies:simple: cinco cenarios passaram. PFX sintetico aceita senha correta/rejeita incorreta, chave corresponde ao certificado; assinadores reais de NF-e, evento e inutilizacao produzem assinaturas verificaveis e detectam adulteracao; DOMPurify no Edge preserva formatacao/tabelas/estilos e remove scripts/eventos usando as opcoes dos consumidores. Todos os materiais sao sinteticos em memoria.
- Auditoria nova: 32 alertas (1 baixo, 8 moderados, 19 altos, 4 criticos), contra 35 antes. Nenhum alerta npm restante atribuido a essas tres bibliotecas. Isso nao equivale a certificacao de seguranca do sistema inteiro.

Logs desta etapa em artifacts/performance/upgrade/simple-*. Os arquivos gerados public/sw.js e next-env.d.ts foram restaurados a partir de snapshots feitos antes desta compilacao. Nao houve deploy, emissao fiscal, uso de certificados reais ou gravacao no banco. Os testes offline nao substituem homologacao de comunicacao com SEFAZ nem comprovam todos os modelos de impressao reais.

## Terceira etapa: Auth.js

- next-auth 5.0.0-beta.30 → 5.0.0-beta.32, com @auth/core 0.41.3 no lockfile.
- Removido @auth/supabase-adapter: busca em src/scripts/configuracao confirmou ausencia de consumidores; a configuracao ativa usa Credentials e JWT, sem adapter. Nenhuma alteracao em tabelas, credenciais ou callbacks do ERP.
- Auditoria: 29 alertas (1 baixo, 8 moderados, 19 altos, 1 critico); nenhuma entrada restante de Auth.js/core/adapter. As demais dependencias ainda precisam de etapas proprias.

Validacao:

- 2.824 testes de negocio passaram; zero falhas.
- TypeScript em src e tipos de rota: zero erros. ESLint dos dois scripts novos passou.
- Build de producao: sucesso, 222 paginas geradas.
- npm run test:dependencies:auth: seis cenarios offline com NextAuth instalado, provider Credentials sintetico, CSRF e cookies. Ausencia de sessao; senha incorreta; login com id/permissoes preservados; JWT adulterado/expirado recusado; logout; configuracao invalida sem usuario no guard. Esse teste usa configuracao sintetica e nao substitui o authorize real com Supabase.
- PERF_BASE_URL=http://localhost:3001 npm run perf:smoke:auth: tres cenarios reais no build atualizado. Anonimo redirecionado ao login e API de clientes bloqueada; sessao salva reconhecida e pagina/API protegidas acessiveis; logout apenas no contexto descartavel bloqueia novamente a API. O arquivo de sessao salvo nao foi alterado pelo script.

O login novo com credenciais reais e a renovacao real de um refresh token expirado nao foram exercitados nesta rodada. Politica de renovacao/permissoes foi coberta pelos testes existentes; sessao de teste existente foi preparada e usada no servidor real. Sem promessa de cobertura completa de todos os perfis e provedores.

Logs locais em artifacts/performance/upgrade/auth-*. Servidor de teste encerrado e public/sw.js/next-env.d.ts restaurados dos snapshots desta etapa. Sem deploy, alteracao de senha, gravacao de negocio ou mudanca das regras de acesso. Reiniciar npm run dev para carregar a biblioteca atualizada.

## Quarta etapa: HTTP e parser XML

- Axios 1.14.0 → 1.21.0.
- fast-xml-parser 5.5.9 → 5.11.2.
- Mantidas as versoes principais e as regras/opcoes dos consumidores do ERP. Manifesto e lockfile atualizados.
- Auditoria: 24 alertas (1 baixo, 6 moderados, 16 altos, 1 critico), contra 29 antes. Sem entradas restantes para Axios, fast-xml-parser, fast-xml-builder, follow-redirects e form-data. A contagem nao e certificacao de seguranca completa.

Validacao:

- 2.824 testes de negocio passaram, zero falhas, incluindo parsers e calculos fiscais existentes.
- TypeScript de src/tipos de rota: zero erros. ESLint do script novo e git diff --check passaram.
- Build de producao concluido, 222 paginas geradas.
- Novo comando npm run test:dependencies:http-xml: cinco cenarios locais passaram. Parametros/JSON com zeros iniciais; HTTP 422/cancelamento/timeout; arquivo multipart; SOAP em HTTPS com autenticacao mutua usando PFX sintetico e verificacao de CA ativa; XML com CNPJ de zero inicial, decimais, atributos, namespace e elementos repetidos.
- As seis suites de npm run perf:smoke:integrated passaram no build atualizado em localhost:3001. Consultas, pesquisas, filtros e abertura/cancelamento de formularios desktop/mobile em Financeiro, Relatorios, Agenda, PDV, Historico, Alugueis, Veiculos, Bancos, Fiscal, Ordens e Clientes; comparacao do resumo de vendas com quatro consultas do contrato completo. Sem salvar registros de negocio. O cenario de confirmacao de OS usa status simulado apenas na interface, como documentado nas etapas anteriores.

Logs em artifacts/performance/upgrade/http-xml-*. Servidor de teste encerrado. public/sw.js e next-env.d.ts restaurados aos snapshots feitos no inicio desta etapa, preservando eventuais alteracoes anteriores. Nenhum certificado real foi lido, nenhuma SEFAZ foi acessada pelo teste sintetico, nenhuma nota foi emitida e nenhum deploy foi feito. O teste local de TLS nao substitui a homologacao real com o provedor fiscal.

Proximas etapas separadas: PWA/Workbox e demais transitivas; migracao de Zod 3 para 4. Reiniciar npm run dev para carregar as dependencias atualizadas.

## Quinta etapa: PWA e correcoes transitivas compativeis

next-pwa 10.2.6 → 10.2.9. O plugin passa a usar Workbox 7.1.x, preservando a configuracao do ERP. Depois de revisar npm audit fix --dry-run, aplicado npm audit fix sem --force. O comando terminou com codigo 1 por alertas restantes, mas aplicou as correcoes compativeis; nao representa falha de instalacao. Nenhuma alteracao nas regras de negocio, autenticacao ou cache do next.config.ts.

Principais atualizacoes de lockfile desta rodada:

| Dependencia | Antes | Depois |
| --- | --- | --- |
| ws | 8.18.3 | 8.22.0 |
| Supabase CLI | 2.84.5 | 2.122.0 |
| @babel/core | 7.28.5 | 7.29.7 |
| @babel/plugin-transform-modules-systemjs | 7.29.0 | 7.29.8 |
| PostCSS na raiz | 8.5.6 | 8.5.32 |
| nanoid | 3.3.11 | 3.3.20 |
| lodash | 4.17.23 | 4.18.1 |
| js-yaml | 4.1.1 | 4.3.2 |
| ajv | 6.12.6 | 6.15.0 |
| brace-expansion | 1.1.13 | 1.1.21 |
| @humanfs/node | 0.16.6 | 0.16.8 |
| browserslist | 4.28.1 | 4.29.5 |
| baseline-browser-mapping | 2.9.6 | 2.11.33 |
| source-map-js | 1.2.1 | 1.2.2 |
| fast-uri | 3.1.0 | 3.1.9 |
| jose | 6.1.0 | 6.2.13 |

A CLI nova elimina a antiga cadeia de instalacao que incluia tar vulneravel. Confirmado supabase --version = 2.122.0; sem comandos de banco. O primeiro comando usava o caminho antigo da CLI e foi corrigido para npm exec. A primeira execucao sandboxada encontrou restricao de escrita em arquivo local de telemetria; --version passou com acesso autorizado e DO_NOT_TRACK=1.

Validacao:

- 2.824 testes de negocio passaram, zero falhas.
- TypeScript de src/tipos de rota sem erros; ESLint dos scripts novos passou.
- Build concluido com 222 paginas.
- test:dependencies:pwa verifica a configuracao real com as regras padrao do plugin instalado: APIs, navegacao e RSC continuam NetworkOnly; audio/streams externos excluidos; paginas iniciais sem cache. WebSocket local verifica conexao, mensagem, ping/pong e encerramento normal.
- test:dependencies:auth repetido devido a atualizacao de jose: seis cenarios passaram.
- perf:smoke:pwa no build da porta 3001 confirmou worker ativo, verificacao de atualizacao e cache de estaticos sem paginas/API privadas. Offline, estatico continuou acessivel e fetch de API/RSC nao devolveu dados antigos; apos reconexao, pagina recarregou. O primeiro teste tentou buscar a chave interna __WB_REVISION__ em vez da URL publica; corrigido o script, repeticao completa passou.
- Seis suites de perf:smoke:integrated passaram: consultas, filtros e abertura/cancelamento de formularios sem salvar registros de negocio.

Limitacoes: regras de exclusao do radio verificadas na configuracao, sem reproduzir uma emissora externa ao vivo. A verificacao de registration.update ocorre com o mesmo build; nao houve teste de migracao de um PWA instalado antigo. Notificacoes push reais e todos os navegadores nao foram exercitados.

Auditoria final: 8 alertas, 5 moderados e 3 altos; zero criticos. Os oito nomes repetem tres cadeias:

- Zod 3: requer migracao de major com adaptacao do codigo.
- PostCSS 8.4.31 interno do Next: permanece fixado pelo Next, embora a versao da raiz tenha sido corrigida. Sem override forcado.
- Workbox → @rollup/plugin-terser → serialize-javascript 6.0.2: sem correcao compativel resolvida pelo npm. O downgrade sugerido automaticamente para next-pwa 10.2.6 nao foi aplicado, pois reintroduziria a cadeia anterior. Reavaliar atualizacao/migracao do plugin pai; nao forcar serialize-javascript 7 sobre consumidores que pedem 6.

Referencia do aviso de serializacao: https://github.com/advisories/GHSA-m5mm-p8h7-m29v. Os alertas transitivos nao comprovam exploracao no fluxo atual do ERP, mas continuam registrados e precisam de acompanhamento.

Logs pwa-* em artifacts/performance/upgrade/. Servidor de teste encerrado; public/sw.js e next-env.d.ts restaurados exatamente dos snapshots anteriores ao build. O build de deploy volta a gerar o worker correspondente. Sem deploy ou alteracao de dados. Reiniciar npm run dev para usar as bibliotecas novas.

## Sexta etapa: Zod 3 para 4

Zod 3.25.76 → 4.6.7. Migracao baseada em https://zod.dev/v4/changelog, com manifesto e lockfile atualizados.

Adaptacoes:

- Tarefas: required_error substituido por error condicional, preservando a mensagem de titulo obrigatorio quando ausente.
- Uso/consumo: invalid_type_error substituido pela API error, mantendo mensagens de quantidade, item e valores.
- Chat e Documentos: errorMap substituido por error, preservando os codigos/mensagens personalizados.
- Radio: removido acesso privado radioCreateSchema._def.schema. Os campos compartilhados agora usam API publica; criacao aplica defaults e PATCH deriva dos campos sem defaults, para nao sobrescrever dados omitidos. URL malformada agora retorna erro de validacao sem lancar excecao dentro do refinamento.
- Revisados defaults, transforms, opcionais, registros e UUIDs nos consumidores. As regras mais estritas do Zod 4 para identificadores/formatos invalidos permanecem; nao foram relaxadas para aceitar entradas malformadas.

Validacao:

- Primeira checagem de tipos identificou as APIs removidas; corrigidas e checagens posteriores passaram. Log inicial preservado.
- Oito novos testes de regressao: defaults de criacao de radio, PATCH sem preenchimento indevido, PATCH vazio, fontes invalidas; codigo de reacao do Chat e normalizacao de mensagem; PATCH de item e coercao/defaults/mensagens da entrada.
- O novo teste de URL encontrou excecao no refinamento; corrigida antes da repeticao.
- Suíte completa: 2.832 testes passaram, zero falhas (antes: 2.824).
- TypeScript final em src/tipos de rota: zero erros; ESLint dos arquivos alterados passou.
- Build de producao concluido, 222 paginas geradas.
- Novo comando perf:smoke:zod no build em localhost:3001: dados invalidos recusados com 400 em Tarefas, Documentos, Radio e Uso/Consumo, antes dos pontos de escrita verificados no codigo. Mensagem de titulo obrigatorio preservada; consulta valida de radios retornou 200. Nenhum corpo valido de gravacao foi enviado.
- Seis suites integradas de consulta/abertura/cancelamento passaram; verificacao de acesso anonimo, sessao existente e logout em contexto descartavel tambem passou.
- Auditoria: 7 alertas (5 moderados, 2 altos, zero criticos), sem alerta de Zod. Restam as cadeias PostCSS interno do Next e minificacao do Workbox documentadas acima.

O build emitiu aviso de CompressionStream/DecompressionStream de jose no bundle Edge. A codificacao JWT do Auth.js instalado nao configura zip e as funcoes de compressao sao chamadas apenas no caminho correspondente; o teste local de middleware/sessao passou. O ambiente Edge de producao nao foi exercitado por deploy nesta rodada. Os avisos de snapshot do cache webpack e chunk maior que o limite de precache tambem permanecem.

Logs zod-* em artifacts/performance/upgrade/. Servidor de teste encerrado, public/sw.js e next-env.d.ts restaurados aos snapshots anteriores ao build. Sem deploy, migracao de banco ou gravacao de negocio. A validacao nao equivale a cobertura completa de todos os perfis, gravacoes reais ou integracoes externas. Reiniciar npm run dev para carregar Zod 4.

## Setima etapa: PostCSS e Workbox restantes

Os pacotes pais ainda fixam dependencias antigas. Foram adicionados overrides restritos, por versao do pai, em package.json:

- next@15.5.28 → postcss 8.5.32.
- @ducanh2912/next-pwa@10.2.9 → workbox-build, workbox-webpack-plugin, workbox-core e workbox-window 7.4.1.

As linhas principais de PostCSS (8) e Workbox (7) foram mantidas. Workbox 7.4.1 atualiza a cadeia de minificacao para @rollup/plugin-terser 1.0.2, que aceita serialize-javascript 7; a resolucao final ficou em serialize-javascript 7.1.4. Nao foi imposto serialize-javascript 7 ao consumidor antigo que exigia 6.

Fontes e requisitos consultados:

- https://github.com/GoogleChrome/workbox/releases
- https://github.com/postcss/postcss/releases
- npm view dos manifests/requisitos: Workbox requer Node >=20 e webpack ^4.4.0 ou ^5.91.0; o ambiente atual usa Node 24 e o build passou.

### Resolucao do PostCSS

A primeira instalacao e npm update postcss conservaram a copia antiga node_modules/next/node_modules/postcss 8.4.31, marcada como invalida por npm ls diante do override. Nao foi considerada correcao concluida nesse estado. A instalacao e somente a entrada de lock dessa copia foram removidas; npm install regenerou a resolucao. O destino de remocao foi validado dentro do workspace. A verificacao via createRequire a partir do pacote Next confirmou PostCSS 8.5.32 efetivamente carregado pelo Next, deduplicado com a raiz. A arvore relevante terminou sem entradas invalidas.

O build inicial validou Workbox, mas ainda usava PostCSS antigo. Depois da resolucao correta foi executado novo build completo, com resultado registrado em final-chains-build-result.json (status 0).

### Validacao final

- 2.832 testes de negocio passaram com a cadeia Workbox atualizada. A correcao posterior afetou somente a resolucao do PostCSS; nao alterou codigo de negocio.
- TypeScript de src/tipos de rota: zero erros.
- Build final concluido: 222 paginas; Next permaneceu em 15.5.28.
- Tres arquivos CSS gerados analisados sem erro pelo PostCSS carregado pelo Next. No navegador, CSS vinculado e estilos base do Tailwind aplicados (margem e box-sizing).
- perf:smoke:pwa passou: worker ativo, verificacao de atualizacao, estaticos em cache, ausencia de paginas/API privadas no cache, estatico acessivel offline e chamadas API/RSC sem resposta antiga; reconexao normal.
- Seis suites de perf:smoke:integrated passaram, mais teste de sessao/acesso anonimo/logout em contexto descartavel. Sem gravacoes de negocio.
- npm ci --ignore-scripts --dry-run passou com rede, validando aceitacao do lockfile pelo instalador. A tentativa offline nao tinha metadados Tiptap em cache. Nao foi feita reinstalacao limpa real de todo node_modules; permanecem os avisos anteriores de peers Tiptap.
- ESLint do script alterado e git diff --check passaram.
- npm audit final: zero vulnerabilidades conhecidas, em todas as severidades. Registro em final-chains-audit.json. Isso cobre a base de avisos do npm no momento da consulta, nao uma auditoria completa do codigo/aplicacao.

### Manutencao e limites

Essas combinacoes sao substituicoes locais das versoes fixadas pelos pais; os testes acima comprovam os cenarios locais exercitados, nao suporte oficial do next-pwa/Next a toda combinacao. Reavaliar e remover os overrides quando os pacotes pais incorporarem as correcoes, e revisar novamente ao atualizar Next ou next-pwa. Nao migrar de volta para os pacotes antigos apenas para remover overrides.

Mantidas as limitacoes anteriores: sem teste de migracao de PWA antigo instalado, push real, todos os navegadores, emissao fiscal ou gravacao real em banco de homologacao. O aviso de compressao de jose no bundle Edge permanece, conforme registrado na etapa anterior; o fluxo JWT/sessao local passou.

Logs final-chains-* em artifacts/performance/upgrade/. Servidor de teste encerrado; public/sw.js e next-env.d.ts restaurados exatamente aos snapshots do inicio desta etapa, preservando alteracoes anteriores do usuario. Um novo build gera o worker correspondente ao deploy. Nenhum deploy ou comando de migracao foi executado. Reiniciar npm run dev.

## Aviso de precache HEIC

O chunk 732b34ba.c2500ed74cbab914.js (~2.995.262 bytes) e o codec heic-to/csp/libheif, importado dinamicamente apenas ao preparar foto HEIC. O aviso original nao impedia o build; o arquivo continuava disponivel online.

next.config.ts agora exclui explicitamente do precache os chunks com modulo heic-to, consultando o grafo webpack em vez de fixar hash. O limite geral permanece. O codec continua no build e no cache de runtime apos o primeiro download.

O primeiro ajuste incluiu manifestos internos/server no precache, causando 404 e falha de instalacao no teste. Corrigidas as exclusoes de manifestos/server com prefixos de caminho, preservando mapas/fontes. Adicionado teste de regressao; nenhum worker intermediario foi publicado.

Validacao final:

- Politica PWA, ESLint e TypeScript da configuracao passaram.
- Build final: status 0, 222 paginas, sem aviso de tamanho/precache do HEIC.
- perf:smoke:heic-cache: manifesto sem arquivos internos; worker ativo; codec ausente do cache inicial, download sob demanda 200 e acesso offline 200 depois. Testa entrega/cache, nao conversao de foto HEIC real.
- perf:smoke:pwa: CSS, ativacao, verificacao de atualizacao e politica offline passaram.

Os testes exigem servidor de producao local; PERF_BASE_URL seleciona a origem e NEXT_DIST_DIR seleciona o build (padrao .next). PWA fica desabilitado em next dev.

Skipping validation of types e Skipping linting sao mensagens informativas: o projeto mantem essas checagens separadas do build. TypeScript tem workflow .github/workflows/typecheck.yml; ESLint pode ser executado com npm run lint. Outros avisos independentes de webpack/jose permanecem documentados acima.

Logs warning-* em artifacts/performance/upgrade/. Servidor de teste encerrado; public/sw.js e next-env.d.ts restaurados dos snapshots desta rodada. O proximo npm run build normal gera o worker com a nova politica. Sem deploy ou gravacao de negocio.
