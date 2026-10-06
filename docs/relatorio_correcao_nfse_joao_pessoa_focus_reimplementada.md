# Correção da NFS-e de João Pessoa via Focus — 05/10/2026

A emissão nova de João Pessoa, CRT 3 / item 14.01 desde 01/10/2026, usa DPS nacional via Focus em ambiente municipal próprio. O transporte está disponível e não depende de flag temporária. PIS/COFINS foi acrescentado como campo configurável, sem valor automático.

## Branch e estado analisado

- Workspace inicialmente em `main`, HEAD `b6741bd37b7c013e32cea72e2f64e605c3b7783e`.
- HEAD inicial de `feature/nfsjp`: `5ab66c5ea862977428b7afbea094afcfcef5788e`.
- A comparação `develop...feature/nfsjp` não tinha alterações exclusivas da feature: ela já estava incorporada à develop, que continha alterações posteriores de vendas/site.
- `feature/nfsjp` foi avançada por fast-forward até `develop`, HEAD `22c42615bad27cad8d58cc1ff68a06864acc4514`.
- Branch final: `feature/nfsjp`. `git merge-base --is-ancestor develop HEAD` passou. As correções estão no working tree, sem commit ou push.
- `main` manteve o HEAD original; nenhum merge foi feito nela. Os arquivos preexistentes não rastreados `.claude/` e o prompt desta tarefa foram preservados.
- Não havia `AGENTS.md` no workspace.

## Layout, autorizador e endpoints

| Cenário | Modelo / layout | Autorizador | Família Focus |
| --- | --- | --- | --- |
| João Pessoa CRT 3 / 14.01 desde 01/10/2026 | `NACIONAL` / `DPS_NACIONAL` | `FOCUS_FORMATO_NACIONAL_MUNICIPAL` | `/v2/nfsen` |
| João Pessoa municipal legado / exceções | `MUNICIPAL_JOAO_PESSOA` / `MUNICIPAL_LEGADO` | `FOCUS_MUNICIPAL` | `/v2/nfse` |
| MEI / política própria do Emissor Público Nacional | `NACIONAL` / `DPS_NACIONAL` | `FOCUS_NACIONAL` | `/v2/nfsen` |

A regra nova é `JOAO_PESSOA_FORMATO_NACIONAL_2026`, com `usaDps=true` e `exigeRtc=true` no caso CRT 3. O transporte específico reutiliza emissão, consulta e cancelamento da infraestrutura DPS já existente, alterando a identidade do autorizador.

| Operação da nova nota João Pessoa | Endpoint |
| --- | --- |
| Emissão | `POST /v2/nfsen?ref=...` |
| Consulta | `GET /v2/nfsen/{referencia}` |
| Cancelamento | `DELETE /v2/nfsen/{referencia}` |

`modelo_emissao=NACIONAL` permanece como família de layout/endpoint, sem presumir o Emissor Público Nacional. Consulta e cancelamento usam o modelo gravado: notas antigas municipais continuam em `/v2/nfse/{referencia}`, independentemente da política atual.

No painel da Focus, o cenário municipal de João Pessoa requer **NFSe padrão habilitada e Ambiente da NFSe Nacional desabilitado**, conforme o [guia oficial atualizado](https://focusnfe.com.br/guides/nfse/municipios-integrados/joao-pessoa-pb/). O painel não foi alterado durante esta tarefa.

A política preserva as exceções 01.03, 01.05, 01.09 e 16.01. Também preserva o cronograma vigente de Simples ME/EPP e a distinção de MEI, coerente com a [documentação do Ambiente Nacional](https://focusnfe.com.br/guides/nfse/municipios-integrados/municipios-da-nfse-nacional/#mei-e-simples-nacional).

## Limpeza e histórico E0039

Removidos do código executável: `JoaoPessoaDpsTransport`, `JOAO_PESSOA_DSF_DPS`, `MOTIVO_JOAO_PESSOA_SEM_INTEGRACAO`, `NFSeTransporteIndisponivelError`, `JOAO_PESSOA_ENVIA_PELA_FOCUS_NACIONAL` e a opção de ligar/desligar esse transporte.

Os rótulos passaram a indicar **João Pessoa · Formato Nacional via Focus**. O aviso de ausência de integração foi substituído pela explicação do ambiente municipal próprio e da configuração correta no painel.

E0039 continua reconhecido por código/mensagem, mostrado no resumo de erros e preservado nos diagnósticos históricos. A mensagem agora descreve a tentativa rejeitada e orienta nova emissão pela tela atual. `motivoParaNaoReenviar()` e `reenvioExigeNovoModelo()` mantêm o bloqueio do reenvio exato de uma tentativa com E0039; não concluem que João Pessoa esteja sem integração. Tentativas nacionais sem E0039 não são bloqueadas apenas porque a política usa o autorizador municipal com formato nacional.

`tentativas`, `retorno_bruto`, `payload_enviado` e `erros` foram preservados. Os testes conferem EMISSAO, CONSULTA e CANCELAMENTO, e os testes existentes continuam cobrindo REENVIO e arquivamento. Nenhum token aparece no diagnóstico simulado.

## PIS/COFINS e código municipal

Suporte completo a `situacao_tributaria_pis_cofins` implementado nas duas interfaces TypeScript do serviço, no formulário, no padrão fiscal, na API de configuração, na API de emissão, na validação e no mapper. A propriedade do formulário/padrão é `situacaoTributariaPisCofins`.

A [tabela Focus da DPS](https://campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html#situacao_tributaria_pis_cofins) identifica a tag XML CST, lista os valores permitidos e não marca obrigatoriedade geral nem define defaults por regime. A representação como string de duas posições preserva os zeros dos códigos publicados: `00–09`, `49`, `50–56`, `60–67`, `70–75`, `98` e `99`.

O campo é opcional e enviado somente quando preenchido com um código permitido. Regime Normal, Simples e MEI não recebem CST automaticamente; a classificação deve ser configurada pela empresa conforme a contabilidade. A documentação consultada não estabelece um CST obrigatório específico de João Pessoa para cada regime; o exemplo com `00` não fundamenta um default. Valores inválidos são recusados antes de salvar/enviar.

`codigo_tributacao_municipal_iss` continua configurável e opcional, com validação de três dígitos quando informado, conforme a mesma tabela. Não há hardcode de `007` nem reaproveitamento automático do código municipal antigo. A persistência continua no jsonb existente, sem migration.

## Leitura real da Demir

O script `scripts/db/auditar-nfse-joao-pessoa.ts` usa transação `READ ONLY`, consultas SELECT e ROLLBACK. Não lê token/certificado nem chama a Focus.

A leitura confirmou município 2507507, CRT 3, IM 1094653, PRODUCAO, ambos os padrões fiscais, notas municipais autorizadas em 30/09/2026 e nota 139 da OS 525 como `NACIONAL`, `REJEITADA`, E0039, valor R$ 3.609,04. Essa nota possui retorno bruto de GET e array de tentativas vazio; nada foi retroativamente preenchido.

O hash dos campos fiscais/diagnósticos selecionados da nota 139 foi idêntico antes/depois:

`03175f3b8c18c45dc278ad883799b43aa9d211201f073a38d32c8944833aebd1`

Os padrões `NACIONAL` e `MUNICIPAL_JOAO_PESSOA` permaneceram intactos. A comparação das migrations locais com as aplicadas na Demir retornou **zero pendentes**. Nenhuma migration foi criada ou aplicada nesta tarefa; outros bancos não foram auditados.

## Testes e verificações

| Verificação | Resultado |
| --- | --- |
| NFS-e antes da correção | 132 testes passaram |
| NFS-e após a correção | 140 testes passaram, 31 suítes |
| Pré-build `test:negocio` | 2.446 testes passaram, 216 suítes |
| Typecheck `tsc --noEmit` | Passou |
| ESLint dos 17 arquivos TypeScript alterados/adicionados | Passou, sem avisos |
| Lint completo `npm.cmd run lint` | Falhou: 70 erros e 1.557 avisos em arquivos fora desta correção |
| Build Next.js | Passou, 217 páginas estáticas geradas |
| `git diff --check` | Passou |
| Migrations Demir / ancestralidade develop | Zero pendentes / passou |

O lint completo encontra 50 dos 70 erros no bundle preexistente `artifacts/ofx-ui/app.js`, além de arquivos de captura, scripts antigos, configuração Next e componentes/hooks não alterados. Nenhum arquivo desta correção aparece na lista de erros. Esses problemas não foram modificados para evitar ampliar o escopo para outras áreas do ERP.

A primeira tentativa de lint/build terminou com encerramento nativo no sandbox. A repetição fora do sandbox concluiu os comandos. O build passou após o pré-build, executando `node --max-old-space-size=6144 --use-system-ca node_modules/next/dist/bin/next build`; registrou avisos de Browserslist desatualizado e de chunk de 3 MB não precacheado pelo PWA. Typecheck e lint foram executados separadamente, pois a configuração existente os pula no build. O `public/sw.js` regenerado foi restaurado ao estado inicial.

Os testes cobrem os critérios A–I: política Demir, POST correto, PROCESSANDO → AUTORIZADA, histórico 139 intacto, endpoints antigo/novo, padrão nacional carregado, CST persistido/pré-preenchido/enviado/validado sem default e exceções municipais preservadas. Os testes de mapper também verificam CST opcional/configurado em CRT 1, 2, 3 e 4.

## Payload simulado OS 525

O [JSON gerado](payload_simulado_nfse_os525_focus_reimplementada.json) passou pelo mapper e pelo transporte novos com `fetch` interceptado, competência/emissão em 05/10/2026 e tomador anonimizado. Os serviços usam os valores auditados da tentativa histórica: R$ 284,93 e R$ 3.324,11, total R$ 3.609,04.

O padrão real não contém CST PIS/COFINS nem cTribMun: ambos ficam omitidos nesse JSON. Os testes usam códigos configurados alternativos para provar o envio desses campos. A simulação não é uma emissão, e nenhum dos valores de exemplo foi aplicado à configuração real da Demir.

## Arquivos alterados/adicionados

- `src/lib/services/fiscais/nfse-politica.ts`
- `src/lib/services/fiscais/nfse-transport.ts`
- `src/lib/services/fiscais/nfse-service.ts`
- `src/lib/services/fiscais/nfse-pis-cofins.ts` (novo)
- `src/lib/services/fiscais/nfse-politica.test.ts`
- `src/lib/services/fiscais/nfse-service.test.ts`
- `src/services/fiscal/nfseTransporte.test.ts`
- `src/services/fiscal/nfsePadraoEmissao.test.ts`
- `src/app/api/nfse/de-os/[id]/route.ts`
- `src/app/api/nfse/[id]/reemitir/route.ts`
- `src/app/api/config/nfse/route.ts`
- `src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog.tsx`
- `src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types.ts`
- `src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/emissao-nfse-dialog.tsx`
- `src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/nfse-fiscal-form.tsx`
- `src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/components/padrao-nfse-fields.tsx`
- `scripts/db/auditar-nfse-joao-pessoa.ts` (novo)
- `docs/documentacao_nfse_joao_pessoa_focusnfe.md`
- `docs/manual_tecnico_nfse.md`
- `docs/payload_simulado_nfse_os525_focus_reimplementada.json` (novo)
- Este relatório (novo).

Também foram revisados o registro/sync, contexto/listagem de serviços, cancelamento e tipos da configuração fiscal. Eles já delegavam corretamente a política/transporte ou compartilhavam o tipo do formulário e não precisaram de mudanças adicionais.

**Nenhuma emissão, consulta fiscal, reenvio ou cancelamento real foi feito na Focus. Nenhuma nota histórica ou configuração fiscal real foi alterada. Não houve integração direta DSF, mudança no painel Focus, alteração de NF-e/NFC-e, deployment ou merge em main.** A validação real se limitou à leitura do banco; a autorização externa foi simulada.
