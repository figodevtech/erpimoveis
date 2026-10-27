# Analise das dependencias restantes — 27/10/2026

Analise estatica dos usos em src/scripts, auditoria registrada apos a atualizacao de Next/React e consulta de versoes no registro npm. Nenhuma dependencia foi instalada nesta analise. As versoes candidatas abaixo ainda nao foram validadas no ERP.

## Decisao recomendada

Atualizar em grupos pequenos. Priorizar autenticacao e sanitizacao, depois bibliotecas fiscais e HTTP, ferramentas de build/PWA e por fim a migracao de Zod. Manter a linha de versao principal quando houver correcao disponivel. Nao executar audit fix --force.

| Biblioteca | Atual → candidata | Uso e risco de regressao | Verificacao necessaria |
| --- | --- | --- | --- |
| next-auth | 5.0.0-beta.30 → beta.32 | Login Credentials, JWT, renovacao de token Supabase, permissoes e middleware. Compativel por peer com Next 15 e React 19, mas ainda beta: risco moderado. | Login correto/incorreto, logout, sessao expirada/renovada, usuario sem permissao, API sem autenticacao e erro de configuracao negando acesso. |
| @auth/supabase-adapter | 1.10.0 → remover se confirmado sem consumidores | Nao ha imports em src/scripts; auth usa Credentials e estrategia JWT sem adapter configurado. Remocao parece preferivel a manter uma dependencia inutilizada. | Conferir consumidores restantes e lockfile, repetir testes de autenticacao. Se mantido, candidata 1.11.3. |
| dompurify | 3.4.15 → 3.4.17 | Texto rico e folha de documentos. Correcao patch; risco relativamente baixo, mas sanitizacao mais estrita pode alterar HTML aceito. | Texto formatado, listas, tabelas, imagens, modelos, paginacao e impressao; garantir bloqueio de HTML perigoso. |
| @xmldom/xmldom | 0.8.11 → 0.8.15 | Assinatura de NF-e/eventos e leitura de DANFE. Mesmo ramo, mas sensivel a namespaces, XML malformado e canonicalizacao. Risco moderado. | XMLs sinteticos/anonimizados: assinatura e verificacao criptografica offline, namespaces, eventos e DANFE. Nao basta abrir a tela fiscal. |
| node-forge | 1.4.0 → 1.4.1 | Extracao de certificado/chave do PFX. Correcao patch, fluxo fiscal sensivel. | PFX sintetico protegido por senha, senha incorreta, certificado/chave correspondentes e assinatura verificavel. |
| fast-xml-parser | 5.5.9 → 5.11.2 | DF-e, totais, duplicatas, consulta/cancelamento/inutilizacao e outras respostas fiscais. Mesmo major; risco moderado. | Manter tipos, arrays, namespaces, zeros iniciais, decimais e campos opcionais nos XMLs existentes; testes de parser e servicos. |
| axios | 1.14.0 → 1.21.0 | Muitas telas e chamadas HTTP; consulta SEFAZ usa httpsAgent com certificado. Mesmo major, alcance amplo: risco moderado. | Consultas/pesquisas, cancelamento, uploads, erros HTTP e SOAP/TLS com certificado em homologacao. |
| @ducanh2912/next-pwa | 10.2.6 → 10.2.9 | Service worker e Workbox. Risco moderado; pode mudar cache e atualizacao do cliente. | Build, primeira visita, recarregamento, atualizacao com SW antigo, radio, paginas autenticadas/API sem cache e comportamento offline previsto. |
| zod | 3.25.76 → 4.6.7 | Validacao em chat, ordens, documentos, financeiro/estoque e integracoes. Migracao de major: risco mais alto. | Adaptar mensagens/opcoes de erro e tipos; entradas validas/invalidas, limites de colecoes e respostas de erro por modulo. |
| supabase (CLI) | 2.84.5 → avaliar 2.122.0 | Ferramenta de desenvolvimento, distinta de @supabase/supabase-js usado pelo app. | Comandos locais de versao/status e scripts dependentes. Nao aplicar migracoes como parte da atualizacao. |

Zod tem incompatibilidades concretas no codigo: required_error em src/app/api/tarefas/route.ts e invalid_type_error em src/lib/usoconsumo/schemas.ts. A migracao oficial muda a personalizacao de erros. Nao basta trocar a versao no manifesto. O checkout tem limites max(100), mas isso nao comprova que todas as entradas dos demais modulos estao protegidas de consumo excessivo de recursos.

Auth usa Credentials, nao OAuth/email; alguns avisos especificos desses provedores nao correspondem ao fluxo ativo. Isso nao dispensa atualizar: getToken e session/auth sao usados. O middleware verifica session.user, o que e mais restritivo que apenas testar a existencia do objeto auth; nao foi realizada auditoria completa de todas as rotas para concluir ausencia de exploracao.

DOMPurify e usado com listas de tags/atributos no texto rico e sanitizacao de documento inteiro em iframe sandbox. Nao foram encontrados os modos IN_PLACE/SAFE_FOR_TEMPLATES nos dois consumidores. As condicoes de exploracao variam por aviso; manter o patch continua recomendado.

## Dependencias transitivas

Os 35 alertas nao representam 35 falhas independentes comprovadamente exploraveis no ERP: alguns repetem a cadeia pai/filho. Ha alertas de ferramentas de build/lint (Babel, terser, Workbox, ajv, js-yaml), CLI (tar) e runtime (Auth, HTTP, XML, ws). Preferir atualizar o pacote pai, conferir o novo lockfile e repetir a auditoria; nao forcar versoes transitivas incompatíveis para zerar a contagem.

O alerta de Next apos 15.5.28 vem de PostCSS transitivo. A sugestao automatica e Next 16.4.3, uma migracao de major. Avaliar a cadeia e uma eventual correcao compativel antes de migrar apenas por essa sugestao. ws deve ser atualizado pela cadeia responsavel e validado com chat/ordens em tempo real.

## Limite da conclusao de estabilidade

A analise indica viabilidade e prioridades, nao certifica as versoes ainda nao instaladas. Os 2.824 testes e o build anteriores validam o estado atual, nao estes candidatos. Depois de cada grupo: testes relevantes, TypeScript, build e navegacao. Para fiscal, usar certificados sinteticos e homologacao; para gravacoes reais, ambiente separado. Nao emitir notas, pagar ou alterar dados produtivos como teste.

## Fontes

- Auth.js corrigido: https://github.com/advisories/GHSA-8fpg-xm3f-6cx3
- Release Auth.js: https://github.com/nextauthjs/next-auth/releases/tag/next-auth@5.0.0-beta.32
- DOMPurify: https://github.com/cure53/DOMPurify/releases
- xmldom: https://github.com/xmldom/xmldom/releases/tag/0.8.15
- node-forge: https://github.com/digitalbazaar/forge/releases/tag/v1.4.1
- fast-xml-parser: https://github.com/NaturalIntelligence/fast-xml-parser/releases
- Axios: https://github.com/axios/axios/releases/tag/v1.21.0
- Migracao Zod: https://zod.dev/v4/changelog
- Aviso Zod: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5

Versoes candidatas e peers foram consultados com npm view; versoes atuais conferidas no package-lock.json. A consulta nao altera dependencias.
