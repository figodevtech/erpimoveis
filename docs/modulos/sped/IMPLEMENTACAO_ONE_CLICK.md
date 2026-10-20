# SPED Fiscal: geração em um clique

Branch `feat/sped-fiscal-one-click`, a partir de `main` (231dd87f). Estado em 15/10/2026.

**Situação:** implementação concluída e coberta por testes automatizados. **Pendentes:** aplicação das migrations nos bancos, execução do teste de banco (`db:test:sped-fiscal`) e homologação no PVA. Nenhum desses três passos foi executado, porque todos dependem de acesso autorizado aos bancos dos clientes.

## 1. O que muda para o usuário

```text
Selecionar competência → Gerar SPED Fiscal → Baixar TXT
```

- `/fiscal/sped` agora é a tela simples: mês/ano, botão **Gerar SPED Fiscal**, progresso por etapa e resultado.
- Com tudo resolvido, o backend valida, fecha a competência e gera o arquivo **FINAL**. A tela mostra competência, empresa, documentos, registros, data, leiaute e status, com o botão **Baixar SPED Fiscal (.txt)**.
- Com pendências, a tela mostra *"Precisamos resolver algumas informações antes de gerar o arquivo final."* As pendências vêm agrupadas em Cadastro, Documentos fiscais, Tributação, Apuração e Configuração contábil. Cada uma traz o motivo, a ação de correção, os documentos afetados e um link para a tela onde se corrige. Daí é possível gerar uma **prévia para conferência**, marcada como PRÉVIA.
- A tela anterior foi para `/fiscal/sped/avancado` (configuração, decisões por item, inconsistências, arquivos, PVA, reabertura e retificação). Ela aceita `?competencia=<id>&aba=<aba>`, que os links das pendências usam.

## 2. Arquitetura final

```text
UI /fiscal/sped (sped-one-click.tsx)
  POST /api/fiscal/sped/geracao-automatica          → pedido (202), execução via after()
  GET  /api/fiscal/sped/geracao-automatica/[id]     → progresso; retoma pedido interrompido
  GET  /api/fiscal/sped/geracao-automatica?competencia=AAAA-MM
        │
        ▼
automaticGenerationService.ts  (concessão, heartbeat, persistência do pedido)
        │
        ▼
automaticGeneration.ts  runSpedGeneration(ports)   ← núcleo puro, testado sem banco
  PREPARANDO → COLETANDO_DOCUMENTOS → RESOLVENDO_CADASTROS → CALCULANDO_APURACAO
  → MONTANDO_REGISTROS → VALIDANDO → (pendências: para aqui) → FECHANDO → GERANDO_ARQUIVO
        │
        ▼
competenciaService.ts  (validar, fechar, gerar: as operações que já existiam)
  sourceContext.ts      coleta paginada e reconciliável
  autoResolution.ts     planos de 0200 e de crédito (puros)
  documentProjection.ts C100/C101/C170/C190/C191 e Bloco 0 por documento
  conditionalEvidence.ts, reconciliation.ts, pendencies.ts, configPolicies.ts, entryCfop.ts
  lib/sped/efd-icms-ipi: leiaute por vigência, serializador, validador, validação cruzada
```

### Fluxo de um pedido

1. `POST` chama `fiscal_sped_geracao_solicitar`. Enquanto houver um pedido ativo para a competência, a RPC devolve esse mesmo pedido; o índice único parcial garante isso também contra corrida. Clique duplo e requisição repetida, portanto, não criam um segundo pedido.
2. A resposta sai em seguida (202), e o processamento roda em `after()` (`maxDuration = 300`).
3. O executor pede a concessão (`fiscal_sped_geracao_reivindicar`, 180 s) e a renova a cada 30 s. Cada etapa grava `etapa` + `etapas[]` com horário, e só grava se o token ainda for o dele.
4. O fluxo executa, nesta ordem: competência (criação idempotente), configuração inteligente, resolução automática, validação, fechamento e FINAL.
5. Ao final, `fiscal_sped_geracao_concluir` grava `CONCLUIDA`, `PENDENCIAS` ou `FALHOU`, com o resultado.

Se o processo morrer (timeout, deploy, queda), a concessão vence. O próximo `GET` de acompanhamento vê o pedido "interrompido" e o retoma em nome de quem pediu. Todas as etapas são idempotentes:

- competência fechada vai direto para a geração;
- a validação refaz a projeção;
- a geração devolve o mesmo arquivo pelo hash.

Um executor que perdeu a concessão para no próximo passo, sem gravar nada.

O cliente consulta o andamento a cada 1,5 s nas primeiras 20 consultas, depois a cada 4 s e por fim a cada 10 s, e para quando o pedido termina. O progresso exibido é a etapa gravada pelo backend, não um temporizador.

## 3. Correções do motor (Fase 1)

| Problema encontrado | Correção |
|---|---|
| Nenhuma consulta de `sourceContext()` era paginada; o PostgREST corta em 1000 linhas sem avisar | `sourcePagination.ts`: páginas de 1000 ordenadas por `id`, `count: "exact"` na primeira página, recusa (`COLETA_INCOMPLETA`) se a soma não bater e (`COLETA_DUPLICADA`) se uma linha se repetir. `.in()` em lotes de 200, cada lote paginado. |
| Entradas sem data com `limit(2000)` | Removido. A consulta passa a ser paginada e filtrada a partir da competência. |
| Sem conferência entre banco e arquivo | `reconciliation.ts`: notas elegíveis + entradas = escriturados + rejeitados com bloqueio + duplicados. C100 = projetados. Diferença bloqueia. |
| Recuperação de DF-e pela chave podia pegar o resumo (`resNFe`) | `preferCompleteDfe` escolhe o XML com `infNFe`, preferindo `procNFe`. |
| NF-e recebida pela SEFAZ e sem entrada no ERP passava em silêncio | Aviso `NFE_RECEBIDA_SEM_ENTRADA` (não bloqueia: a mercadoria pode não ter chegado). |
| Entrada emitida no mês e registrada depois, sem data, sumia | Aviso `ENTRADA_EMITIDA_NA_COMPETENCIA_SEM_DATA`. A data de emissão continua sem decidir a competência. |
| C100 cancelado levava `COD_PART` e `DT_DOC` e gerava 0150 | Cancelada (02) e denegada (04) levam só REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC e CHV_NFE. Sem 0150. |
| NF-e denegada bloqueava ("motor não gera COD_SIT 04") | Agora é escriturada como COD_SIT 04. Enviada, contingência e resultado incerto continuam bloqueando. |
| NFC-e com participante | COD_PART vazio, sem 0150, sem ST/IPI/PIS/COFINS no C100. |
| NF-e própria de entrada (devolução, `tpNF=0`) tratada como saída | A direção sai do `tpNF`: IND_OPER 0, IND_EMIT 0, e o ICMS vira crédito. |
| C170/C190 de entrada com o CFOP do fornecedor (5xxx/6xxx), que o PVA recusa | `entryCfop.ts` converte para 1xxx/2xxx/3xxx conforme a destinação (revenda, uso e consumo, ativo). Sem regra ou sem destinação, bloqueia (`CFOP_ENTRADA_NAO_RESOLVIDO`). |
| ICMS informado em entrada sem direito a crédito | Base/alíquota/ICMS só com `CREDITAVEL`; nos demais casos ficam zerados no C170/C190/C100. |
| C100 com `vICMS` do XML e C190 com ICMS + FCP | Tributos do C100 = soma dos C190. E110 soma os C190 (saídas = débito, entradas = crédito). |
| 0200 montado com a descrição/alíquota de cada XML, gerando `CADASTRO_FISCAL_DIVERGENTE` entre fornecedores; `COD_BARRA` "SEM GTIN" | 0200 sai do cadastro do produto (título, unidade, NCM, CEST, código de barras válido, alíquota interna). XML só como reserva. |
| C176/C179 disparado por qualquer CFOP 2xxx/6xxx | `conditionalEvidence.ts`: exige no mesmo item mercadoria com ST retida (CST 60, CSOSN 500, `vICMSSTRet`/`vBCSTRet`) **e** saída que pode gerar ressarcimento (6xxx, 7xxx ou devolução `finNFe=4`), em NF-e própria de saída e não cancelada. |
| Leiaute fixo em 2026 e `COD_VER` "020" no código | `layout.ts`: registro de leiautes por vigência; competência fora de qualquer leiaute é recusada (`LEIAUTE_NAO_CONFIGURADO`). Versão fechada mantém o leiaute com que foi montada. |
| `COD_FIN` sempre 0 | Retificadora gera `COD_FIN = 1`. |
| Inconsistências, documentos e 1601 do detalhe sem paginação | Paginados. Diagnósticos gravados em lotes de 500. |
| — | Validação cruzada nova: C170×0200 (item e unidade/0220), C100×0150, C100×C190, E110×C190. |

## 4. Resolução automática (Fase 2)

### 4.1 Itens (0200): `planSpedItemResolution`

Para cada produto movimentado na competência sem configuração vigente:

| Situação | Ação |
|---|---|
| Configuração vigente | Nada muda. |
| Configuração só em meses seguintes | Cria vigência `[início da competência, véspera da seguinte]` com o mesmo código e tipo. |
| Configuração encerrada antes | Pendência `CONFIG_ITEM_ENCERRADA` (alguém encerrou; não reabre sozinho). |
| Produto excluído | Pendência `PRODUTO_DOCUMENTO_INEXISTENTE`. |
| Saída própria com CFOP de revenda (x102, x106, x108, x110, x115, x117, x120, x202, x403, x404, x405, x411) | Tipo **00**. |
| Saída de produção própria (x101, x103, x105…, x401, x402) | Pendência: o tipo (produto acabado etc.) é decisão fiscal. |
| Só comprado (CFOP de venda do fornecedor) e com preço de venda no estoque | Tipo **00**. |
| Outros casos | Pendência `TIPO_ITEM_NAO_DERIVAVEL`, uma por produto. |

- **Código:** o `id` do produto, que é estável e nunca reutilizado. Se estiver ocupado, `PROD<id>`; se os dois estiverem ocupados, vira pendência.
- **Código compartilhado:** dois produtos com o mesmo código vigente geram `CODIGO_ITEM_COMPARTILHADO`.
- **Rastreabilidade:** a evidência gravada cita o documento e o item que justificaram a decisão. A gravação usa `fonte = 'RESOLUCAO_AUTOMATICA'`.
- **Histórico:** configurações existentes não são alteradas e notas emitidas não são tocadas. Competências fechadas mantêm seus snapshots.

### 4.2 Crédito das entradas: `planSpedCreditResolution`

| Situação | Decisão |
|---|---|
| XML sem ICMS destacado e sem `vCredICMSSN` | `SEM_CREDITO` (não há o que creditar). |
| Item tipo 07 | `USO_CONSUMO`. |
| Item tipo 00, ICMS destacado, CST ≠ 60 **e política de crédito confirmada** | `CREDITAVEL`. |
| Mesmo caso sem política confirmada | Uma pendência agregada: `POLITICA_CREDITO_REVENDA_PENDENTE`. |
| CST 60, ativo (08), crédito do Simples, sem classificação | `TRATAMENTO_CREDITO_PENDENTE`. |

### 4.3 Gravação

`fiscal_sped_aplicar_resolucao_automatica` grava tudo numa transação. Ela trava a competência, recusa competência fechada e revalida cada item contra o estado do banco: ignora produto já configurado ou código já ocupado e recusa DF-e de outro estabelecimento. Repetir a chamada não duplica nada.

## 5. Configuração inteligente e vigência (Fase 2)

- **Fuso:** derivado da UF quando a UF tem um único fuso. PE usa o código IBGE para Fernando de Noronha. AM fica pendente. É o único gate confirmado automaticamente, e leva evidência.
- **Políticas confirmadas uma vez pelo contador** (aba Configuração da área avançada, componente `policy-editor.tsx`), que ficam em `evidencias`:
  - `politica_credito_revenda`: se o ICMS destacado nas compras para revenda gera crédito;
  - `politica_csosn_entrada`: de-para CSOSN → CST para entradas de fornecedores do Simples. Os valores iniciais da tela são só uma sugestão e valem depois de confirmados.
- **Vigência histórica** (`fiscal_sped_config_vigencia`):
  - cada competência usa a configuração vigente no seu primeiro dia;
  - salvar sem data corrige a vigência mais recente;
  - salvar com "Aplicar a partir de" abre uma vigência nova, e uma data anterior à última vigência é recusada;
  - o fechamento (`fiscal_sped_fechar_versao`) confere os gates na configuração vigente da competência (`fiscal_sped_config_efetiva`).
- **Configuração por perguntas** (aba Configuração, `company-questions.tsx`; regras em `src/lib/sped/configuracao-empresa.ts`, compartilhadas entre tela e servidor). Cada pergunta grava os mesmos campos de `fiscal_sped_config`; a evidência é escrita pelo sistema e leva `origem` (`AUTOMATICA`, `RESPOSTA` ou `CONTADOR`). A dedução só preenche o que está pendente e nunca troca uma resposta já dada:

  | Pergunta | Deduzida de |
  |---|---|
  | Atividade industrial e IPI | CNAE (divisões 05–33) ou NF-e de importação emitida (equiparado) |
  | Perfil | PB e PE: B; A para energia elétrica e comunicação (CNAE 351, 60, 61). Demais UFs: pergunta ao contador |
  | EFD-Contribuições | Regime 3 entrega; Simples e MEI não |
  | Bloco K | Simples dispensado; regime normal exige de indústria e atacado (divisão 46) |
  | Crédito nas compras para revenda | Simples e MEI não creditam (LC 123, art. 23); regime normal e excesso de sublimite creditam (LC 87, art. 20) |
  | CSOSN → CST | Correspondência usual, ajustável pelo contador |
  | 1601 | Recebimento por PIX, crédito ou débito no financeiro. Sem recebimento lançado, pergunta |
  | Inventário | Modo automático: fevereiro leva o inventário aprovado de 31/12; demais meses, sem inventário |
  | C176/C179 | Sem pedido de ressarcimento; venda que permitiria o pedido vira aviso, não bloqueio |
  | 1010 (combustíveis, energia, usina, aéreo) | CNAE; exportação e FS-DA começam em N e a exportação vira S pelas notas do mês |
  | 1400, crédito acumulado (regime normal), GIAF (PE) | Sem dedução: pergunta ao contador |

- **Uso dos produtos** (aba "Uso dos produtos", `product-use-panel.tsx`): quem opera responde por produto se é revenda, uso e consumo ou bem da empresa (e matéria-prima/produto acabado na indústria). Vira o tipo do 0200 (00, 07, 08, 01, 04) pela `fiscal_sped_configurar_item_competencia`; o crédito sai da resolução automática: Simples sem crédito, tipo 07 uso e consumo, tipo 08 ativo imobilizado (CIAP não calculado).
- As telas em linguagem do SPED (gates, 1010, políticas e decisões por item) ficaram recolhidas em "Ajustes técnicos do contador".

## 6. Arquivos modificados e criados

**Novos (serviços):** `sourceContext.ts`, `sourcePagination.ts`, `reconciliation.ts`, `autoResolution.ts`, `automaticGeneration.ts`, `automaticGenerationService.ts`, `conditionalEvidence.ts`, `configPolicies.ts`, `entryCfop.ts`, `pendencies.ts`, `lib/sped/efd-icms-ipi/cross-validation.ts`.

**Alterados:**

- `competenciaService.ts`: coleta extraída; projeção compartilhada; resolução automática; operações expostas ao orquestrador; vigência e políticas; detalhe paginado e modo leve.
- `documentProjection.ts`, `assessmentProjection.ts`, `projection.ts`.
- `lib/sped/efd-icms-ipi/layout.ts`, `validator.ts`, `index.ts`.

**API:** `src/app/api/fiscal/sped/geracao-automatica/route.ts` e `[id]/route.ts`.

**UI:**

- novos: `sped-one-click.tsx`, `avancado/page.tsx`, `components/policy-editor.tsx`;
- `page.tsx` agora usa a tela nova;
- `sped-workspace.tsx`, `competencia-detail.tsx` e `competencia-tabs.tsx` aceitam competência e aba iniciais;
- `api.ts` e `types.ts` do cliente.

**Banco:** `supabase/migrations/20261018120000_sped_fiscal_geracao_automatica.sql`, com os testes correspondentes em `supabase/tests/sped_fiscal.sql`.

## 7. Migration `20261018120000_sped_fiscal_geracao_automatica.sql`

| Objeto | Função |
|---|---|
| `fiscal_sped_config_vigencia` + carga inicial (`2000-01-01`) | Histórico da configuração |
| `fiscal_sped_config_efetiva(empresa, competência)` | Configuração vigente |
| `fiscal_sped_fechar_versao` (substituída) | Gates pela configuração vigente |
| `fiscal_sped_aplicar_resolucao_automatica` | Itens e créditos automáticos, transacional e idempotente |
| `fiscal_sped_geracao` + índice único parcial de pedido ativo | Processamento persistente |
| `fiscal_sped_geracao_solicitar / _reivindicar / _avancar / _renovar / _concluir` | Pedido, concessão, etapa, heartbeat e conclusão |

Todas as tabelas têm RLS e nenhum privilégio para `anon`/`authenticated`; as funções são executáveis só por `service_role`, e a vigência tem auditoria. Os corpos foram conferidos com o separador da CLI (`scripts/db/supabase-splitter.ts`): 47 comandos, nenhum corpo de função fundido.

**Não aplicada em nenhum banco.** Para validar antes de publicar:

```bash
npm run db:test:sped-fiscal -- demo     # transação revertida; depois demir e garage
npm run db:deploy:demo                  # só com autorização
```

## 8. O que continua exigindo confirmação fiscal

- O que a seção 5 não deduz: perfil fora de PB/PE, 1400, crédito acumulado no regime normal, GIAF em PE, cartão/PIX sem recebimentos lançados, e tudo o que falta no cadastro da empresa (UF, regime, CNAE).
- O CSV do 1601 (o ERP ainda não monta o registro a partir do financeiro).
- O inventário de 31/12: não há tela para registrar e aprovar `fiscal_inventario_fechamento`, então o SPED de fevereiro bloqueia.
- C176/C179 quando o contador decide pedir ressarcimento: o motor **não gera** esses registros e a competência fica bloqueada.
- Item de compra que não foi vinculado a nenhum dos três estoques na entrada. O estoque define o tipo do 0200: Produtos é revenda (00), Uso e consumo é 07 e Geral (peça de terceiro guardada, como a que vem para conserto) é 99; só produto com saída de produção própria pede classificação. Notas que foram só para Uso e consumo/Geral entram no SPED pela `usoconsumo_entrada`, com data fiscal própria.
- Crédito de ICMS-ST com ICMS próprio destacado, crédito do Simples (vCredICMSSN) e o CIAP do ativo imobilizado.
- Fator de conversão de unidade (0220) quando a nota entra em unidade diferente da de estoque.
- Guias de recolhimento (E116/E316) e a EFD do mês anterior (saldo credor).
- Data de entrada de cada nota de compra (não é preenchida automaticamente).

## 9. Testes executados

| Comando | Resultado |
|---|---|
| `npx tsx --test src/services/fiscal/sped/*.test.ts src/lib/sped/efd-icms-ipi/*.test.ts` | 179 testes, 0 falhas (antes: 91) |
| `npm run test:negocio` | 2735 testes, 0 falhas |
| `npx tsc --noEmit` | sem erros |
| `npm run build` | sem erros; rotas `/fiscal/sped`, `/fiscal/sped/avancado` e `/api/fiscal/sped/geracao-automatica[/id]` geradas |
| `npm run db:test:sped-fiscal` | **não executado**: conecta nos bancos dos clientes; aguarda autorização |

Cobertura dos 25 casos pedidos:

| # | Caso | Onde |
|---|---|---|
| 1, 16 | Geração completa, apta para fechamento | `automaticGeneration.test.ts`, `pipeline.test.ts` |
| 2 | Sem movimento | `pipeline.test.ts` |
| 3, 24 | Milhares de documentos (1.800), reconciliação | `pipeline.test.ts`, `pendencies.test.ts` |
| 4 | Paginação acima de 1000 | `sourcePagination.test.ts` |
| 5–8, 10–12 | Autorizada, cancelada, denegada, NFC-e, devolução, ICMS-ST, DIFAL/FCP | `documentProjection.guide.test.ts`, `conditionalEvidence.test.ts`, testes existentes |
| 9 | Entradas: CFOP, crédito, CSOSN | `documentProjection.guide.test.ts`, `entryCfop.test.ts` |
| 13, 14 | Produto sem configuração; códigos repetidos/divergentes | `autoResolution.test.ts`, `documentProjection.guide.test.ts` |
| 15, 23 | Pendências; FINAL proibido com bloqueio | `automaticGeneration.test.ts`, `pendencies.test.ts`, `fileGeneration.test.ts` |
| 17 | Geração repetida | `automaticGeneration.test.ts` |
| 18, 19 | Simultânea; interrupção e retomada | `automaticGeneration.test.ts` (fluxo) e `supabase/tests/sped_fiscal.sql` (concessão real, a executar) |
| 20 | Reabertura e retificação | `pipeline.test.ts` (COD_FIN) e teste de banco existente |
| 21 | Proteção entre empresas | `sped_fiscal.sql` (DF-e alheio recusado), checagem `COMPANY_MISMATCH` no executor |
| 22 | Totalizadores, CRLF e Latin-1 | `pipeline.test.ts` |
| 25 | Leiautes e configuração históricos | `layout.test.ts`, `entryCfop.test.ts` (vigência) |

## 10. Limitações remanescentes

1. **Leiaute só para 2026 (020).** Competências de 2025 (019) e 2027 em diante são recusadas com mensagem clara. Para incluir um ano, crie `layouts/vNNN` a partir do Ato COTEPE e registre em `SPED_LAYOUT_REGISTRY`.
2. **Registros não gerados:** C176/C179, Bloco K com movimento, 1400, Bloco G (CIAP), Bloco D e C500 e afins. O motor bloqueia quando eles são exigidos; nunca os omite em silêncio.
3. **Regras a confirmar no PVA**, implementadas conforme a leitura do Guia Prático e ainda não homologadas:
   - CST do fornecedor mantido com valores zerados na entrada sem crédito;
   - FCP próprio somado ao `VL_ICMS` do C190/C100;
   - campos omitidos da NFC-e;
   - tabela de conversão de CFOP de entrada.
4. **Isolamento por empresa:**
   - cada banco atende um estabelecimento (`resolveCompanyId`);
   - a tabela `entrada` não tem coluna de empresa;
   - o isolamento das entradas depende do DF-e vinculado, cuja empresa é conferida;
   - notas, configurações, pedidos e decisões são filtrados por empresa.
5. **Duração na Vercel:** uma execução contínua cabe em `maxDuration = 300`. Competências maiores que isso dependem da retomada, que recomeça o fluxo inteiro. Se o volume real exigir, o próximo passo é retomar por etapa.
6. **Mudança de comportamento para a competência piloto (Demir 08/2026):** canceladas sem participante, entradas com CFOP 1xxx/2xxx, E110 pelos C190 e 0200 pelo cadastro. A prévia antiga (SHA `621e90d4…`) deixa de ser reproduzível; gere uma nova.
7. Aviso de NF-e recebida sem entrada depende da sincronização de DF-e estar em dia.

## 11. Homologação no PVA

**Status: PENDENTE.** Nenhum arquivo deste motor foi validado no PVA, e passar nos testes internos não equivale a homologação.

1. Aplique a migration no banco de homologação (`demo`), com autorização.
2. Num estabelecimento com dados reais autorizados, preencha uma vez a configuração (aba Configuração), o contador e as políticas.
3. Em `/fiscal/sped`, escolha a competência e clique em **Gerar SPED Fiscal**:
   - com pendências, use **Gerar prévia para conferência**;
   - sem pendências, baixe o FINAL.
4. No PVA EFD ICMS/IPI (versão mais recente para o leiaute 020), importe o TXT e execute **Validar**.
5. Registre o resultado em `/fiscal/sped/avancado` → Arquivos → Validação PVA: versão do PVA, status (APROVADO, REJEITADO ou COM_AVISOS), relatório e observações. Isso fica em `fiscal_sped_arquivo_validacao_pva`.
6. Anote cada erro real do PVA na tabela abaixo, com o registro e o campo, e corrija no motor antes da próxima tentativa.

| Data | Arquivo (SHA-256) | Versão PVA | Resultado | Erros |
|---|---|---|---|---|
| — | — | — | pendente | — |

A aceitação fiscal de produção exige, além disso, a conciliação da competência pelo responsável contábil.
