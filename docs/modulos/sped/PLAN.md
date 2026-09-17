# Plano de execução — SPED Fiscal (EFD ICMS/IPI)

## Projeto

- Tipo: WEB full-stack (Next.js App Router + Supabase + Vercel Functions).
- Competência piloto: agosto de 2026.
- Leiaute inicial: EFD ICMS/IPI 020.
- Entrega desta implementação: migrations versionadas, domínio, serviços, APIs, UI e testes. Não inclui transmitir a EFD.

## Estado em 17/09/2026

| # | Marco | Estado Detalhado |
|---|-------|------------------|
| 1 | CNPJ alfanumérico, preservando os numéricos (0000, 0100, 0150, NF-e, DF-e) | **IMPLEMENTADO**, **TESTADO UNITARIAMENTE**, **TESTADO NO BANCO** (já na main) |
| 2 | Data fiscal civil, offset e timezone IANA por estabelecimento | **IMPLEMENTADO**, **TESTADO UNITARIAMENTE**, **TESTADO NO BANCO** |
| 3 | Estruturas de configuração, competência, versão, snapshots, apuração, diagnósticos, arquivos, 1601, inventário e PVA | **IMPLEMENTADO**, **TESTADO NO BANCO** (285 migrations aplicadas em demo/demir/garage, RLS estrita nas 23 tabelas, bucket privado) |
| 4 | Motor do leiaute 020 (Blocos 0, C, E, H, 1 e 9)<br>• Bloco 0: 0000, 0001, 0005, 0100, 0150, 0190, 0200, 0220, 0221, 0990 (**IMPLEMENTADO**, **TESTADO UNITARIAMENTE**); 0205 (**PARCIAL**: motor de projeção implementado e testado unitariamente; integração histórica real no piloto indisponível por ausência de rastreamento prévio no ERP — sem histórico confiável não gera 0205)<br>• Bloco C: C001, C100, C101, C170, C190, C191, C990 (**IMPLEMENTADO**, **TESTADO UNITARIAMENTE**)<br>• Bloco E: E001, E100, E110, E111, E112, E113, E115, E116, E300, E310, E311, E312, E313, E316, E990 (**IMPLEMENTADO**, **TESTADO UNITARIAMENTE**; hierarquia blindada para múltiplos ajustes E111/E311 sem duplicação ou orfandade de filhos)<br>• Bloco H: H001, H005, H010, H990 (**IMPLEMENTADO**, **TESTADO UNITARIAMENTE**)<br>• Bloco 1: 1001, 1601, 1990 (**IMPLEMENTADO**, **TESTADO UNITARIAMENTE**); 1010 (**IMPLEMENTADO**, **TESTADO UNITARIAMENTE**: obrigatoriamente gerado no leiaute 020 mesmo quando 1001.IND_MOV = 1, com determinação auditável dos 13 indicadores fiscais; dados desconhecidos podem ser serializados provisoriamente como N somente em PREVIA, permanecendo PENDENTE e impedindo fechamento/FINAL); 1400 (**PARCIAL**: definição de leiaute e gate implementados; gerador condicionado à aplicabilidade, sendo inaplicável para a Demir Diesel por decisão fiscal)<br>• Bloco 9: 9001, 9900, 9990, 9999 (**IMPLEMENTADO**, **TESTADO UNITARIAMENTE**)<br>• Situação PVA: **AGUARDANDO HOMOLOGAÇÃO MANUAL NO PVA** | **IMPLEMENTADO**, **TESTADO UNITARIAMENTE** (suíte de negócio com 1603 testes passando). **AGUARDANDO HOMOLOGAÇÃO MANUAL NO PVA** |
| 5 | Gates de Perfil, Bloco K, 1400, C176/C179, IPI e Contribuições | **IMPLEMENTADO**, **TESTADO NO BANCO** (recusa de fechamento se PENDENTE comprovada em teste automatizado) |
| 6 | Importações, validação, fechamento/reabertura, geração concorrente blindada, Storage real e PVA | **IMPLEMENTADO**, **TESTADO NO BANCO**, **TESTADO EM AMBIENTE REAL** (Storage `fiscal-sped` validado e2e com SHA-256; fluxo de concorrência com RPC PostgreSQL transacional `fiscal_sped_registrar_arquivo`, advisory lock por versão, classificação estrita de erro 23505 e compensação contra órfãos no Storage; concorrência protegida no desenho transacional e coberta por testes unitários/simulados; RPC e constraints verificadas em banco real; proteção de PREVIA vs FINAL blindada no backend) |
| 7 | Área `/fiscal/sped`, permissões, rastreabilidade e histórico de PVA | **IMPLEMENTADO**, **TESTADO NO BUILD** (Next.js 15 compilando 210 páginas sem erros) |
| 8 | Testes e regressão | **TESTADO UNITARIAMENTE** (`npm run test:negocio` com 1603 testes), `npx tsc --noEmit` (100% verde sem erros), **TESTADO NO BANCO** (`npm run db:test:sped-fiscal -- demo/demir/garage` com 0 pendências) e `npm run build` passando |

### O que o teste de banco prova

`npm run db:test:sped-fiscal -- <demo|demir|garage>` aplica todas as migrations pendentes do banco numa transação revertida e verifica:

- as migrations aplicam sobre os dados reais;
- o ciclo completo da competência, com as travas:
  - não abre duas versões editáveis;
  - recusa hash divergente;
  - bloqueio impede APTA;
  - gate pendente impede o fechamento;
  - lock antigo é recusado;
  - versão fechada, snapshots, ajustes e competência são imutáveis;
  - reabrir exige motivo e cria a versão 2 retificadora sem tocar na 1;
  - fechar a 2 substitui a 1;
- cancelamento de NF-e sobre uma nota real: evento preservado, idempotente, divergência recusada, evento imutável;
- RLS ligada nas 23 tabelas, sem acesso para `anon`/`authenticated`, nenhuma função nova executável por `anon` e bucket `fiscal-sped` privado.

O teste separa cada migration com um port fiel do parser da CLI do Supabase (`scripts/db/supabase-splitter.ts`) e executa cada comando como prepared statement, como o `db push` faz. Assim ele quebra onde o deploy quebraria. Um `COMMIT` fora do envelope é recusado antes de executar.

Um nome não reservado com as letras de `ATOMIC` fora de aspas faz a CLI juntar o resto do arquivo num comando só. Foi o que derrubou o primeiro deploy no Demir em 17/09/2026, por causa da coluna do item componente em `fiscal_sped_item_correlacao`. A correção pôs o identificador entre aspas, o que não muda nada no banco.

## Publicação e Status de Migrations

Todas as migrations SPED foram aplicadas nos três ambientes (`demo`, `demir` e `garage`):
- 285 migrations aplicadas em todos os ambientes (`npm run db:status` com 0 pendências comprovado nos 3 bancos).
- Índices de idempotência (`fiscal_sped_arquivo_versao_tipo_hash_uk`) e concorrência RPC (`fiscal_sped_registrar_arquivo`) reconciliados fisicamente e no histórico `supabase_migrations.schema_migrations`.
- Bucket `fiscal-sped` privado provisionado e testado com upload/download de arquivo SPED real assinado e conferência de SHA-256.

## Fronteiras e segurança

- XML autorizado/evento SEFAZ é a fonte histórica de documento e tributos.
- Cadastro atual nunca reescreve o histórico fiscal.
- Entradas exigem `data_entrada_fiscal` confirmada. Nada é preenchido automaticamente: a tela oferece a data de emissão e a data do lançamento como atalhos, e o usuário confirma. A confirmação é recusada quando atinge uma competência FECHADA.
- NF-e denegada, enviada sem retorno, em contingência ou com resultado incerto no período bloqueia a validação. O motor ainda não gera C100 com COD_SIT 04.
- Cancelamento homologado pela SEFAZ sempre marca a NF-e como CANCELADA. Se a preservação do evento falhar, a tela avisa.
- Tabelas SPED usam RLS e não concedem acesso direto a `anon`/`authenticated`. As APIs autenticadas usam o cliente administrativo no servidor.
- Versões fechadas, snapshots e artefatos são imutáveis.
- O TXT final exige estritamente competência e versão fechadas no backend (rejeição 422 VERSION_NOT_CLOSED caso forçado). A prévia pode ser gerada com marcação explícita para validação antecipada.
- Concorrência de arquivos blindada no banco com advisory lock por versão e RPC transacional idempotente.
- CNPJ é texto canônico de 14 posições; nunca é normalizado com `\D`.
- Datas civis do XML são preservadas sem conversão cega de timezone.

## Critérios de conclusão técnica

- [x] Migrations consistentes, provadas com rollback e aplicadas nos bancos de cliente (`demo`, `demir`, `garage`). 285 migrations com 0 pendências.
- [x] Testes com `00000000E08G12` e CNPJ numérico.
- [x] Geração determinística com contadores e Bloco 9 coerentes (testes unitários do serializador).
- [x] Projeção cadastral do Bloco 0 (0150, 0190, 0200, 0220, 0221) implementada com testes unitários.
- [x] Motor de projeção do 0205 preparado para histórico com testes unitários; documentado que sua geração no piloto depende de histórico cadastral auditável no ERP.
- [x] Suporte a ajustes e documentos fiscais do Bloco E (E111, E112, E113, E115, E116, E311, E312, E313, E316) implementado com hierarquia estrita para múltiplos pais e testes unitários dedicados.
- [x] Registro 1010 implementado no leiaute 020 e emitido obrigatoriamente em conformidade com o Guia Prático da EFD ICMS/IPI (mesmo com 1001.IND_MOV = 1, gerando |1001|1|, |1010|N...| e |1990|3|; e com IND_CART=S e 4 linhas quando houver 1601).
- [x] Fonte de verdade fiscal auditável para os 13 indicadores do 1010 (`REGRA_UF`, `FONTES_MOVIMENTO`, `CONFIGURACAO`, `PADRAO_PROVISORIO`), com interface dedicada no ERP, validação server-side estrita de S/N e diagnóstico bloqueante (`INDICADORES_1010_PENDENTES`) impedindo fechamento até confirmação do contador. Dados desconhecidos podem receber valor provisório apenas na PREVIA, sempre marcados como PENDENTE e bloqueando fechamento/FINAL.
- [x] Registro 1400 classificado corretamente: definição de leiaute e gate implementados; geração condicionada à aplicabilidade (confirmada inaplicabilidade para Demir Diesel).
- [x] Idempotência de arquivos SPED por `(versao_id, tipo, arquivo_sha256)` implementada com migration de índice único (`20260917120000_sped_fiscal_arquivo_idempotencia.sql`), permitindo coexistência de PREVIA e FINAL com mesmo hash.
- [x] Blindagem contra condições de corrida de alocação de sequência através de advisory lock (`pg_advisory_xact_lock`) e RPC transacional (`20260917140000_sped_fiscal_arquivo_concorrencia.sql`), separação estrita de violação de sequência vs duplicidade de hash, e compensação automática no Storage contra arquivos órfãos. Concorrência protegida no desenho transacional e coberta por testes unitários/simulados (Casos F a J) e verificada no banco real.
- [x] Testes obrigatórios de geração e concorrência (Casos A, B, C, D, E, F, G, H, I, J) implementados e 100% aprovados (`src/services/fiscal/sped/fileGeneration.test.ts`).
- [x] Proteção backend PREVIA vs FINAL implementada e blindada contra bypass de API.
- [x] Integração de Storage e2e testada no ambiente real com caminhos determinísticos.
- [x] Registro e histórico de validações do PVA implementado no banco, APIs e interface.
- [x] Competência piloto 08/2026 aberta e versionada no banco real da Demir Diesel.
- [x] Projeção fiscal real de 52 saídas (C100 regular e canceladas com COD_SIT 02), 13 partilhas DIFAL (C101 e E300/E310), 44 participantes (0150) e 87 itens (0200).
- [x] Nova Prévia SPED oficial gerada e auditada com 326 linhas e 28.375 bytes (SHA-256: `621e90d4f3c74e7d7ba26f34f57a43b934f80d3d7edcf830f9017d7c844c5b7a`), armazenada no bucket `fiscal-sped` no Storage (path: `1/2026-08/v1/2-621e90d4f3c74e7d7ba26f34f57a43b934f80d3d7edcf830f9017d7c844c5b7a.txt`).
- [x] Auditoria de conformidade com 100% de aprovação (CRLF, Latin-1, delimitação de pipes, 1001 seguido de 1010, 1990 contando 3 linhas, 9900 totalizando 35 registros incluindo o 1010, 9990 e 9999 com 326 linhas).
- [x] Fechamento bloqueado por erros, datas não confirmadas e gates pendentes (198 diagnósticos auditados no banco atual, incluindo bloqueio de indicadores 1010 pendentes de confirmação contábil).
- [x] Reabertura cria nova versão sem mutar a anterior.
- [x] Suítes existentes continuam passando (`npm run test:negocio` com 1603 testes, `npx tsc --noEmit` 100% verde sem erros, `next build` 100%).
- [ ] **AGUARDANDO HOMOLOGAÇÃO MANUAL NO PVA** (Arquivo TXT pronto para download e importação oficial no PVA).

## Diagnóstico Real do Piloto (Demir Diesel - 08/2026)

Na auditoria detalhada dos diagnósticos bloqueantes gerados na validação da versão 1 da competência 08/2026 no banco de dados real da Demir Diesel, o estado atual auditado totaliza exatamente **198 bloqueios legítimos**, rigorosamente distribuídos em:

1. **Problemas cadastrais / operacionais do usuário (172 ocorrências atuais)**:
   - 84 compras com `data_entrada_fiscal` nula (`DATA_ENTRADA_FISCAL_NAO_CONFIRMADA`) na validação atual (com a entrada recente 1033). O operador deve confirmar as datas de entrada na aba Entradas do módulo SPED (o sistema sugere atalhos, mas não auto-preenche).
   - 87 itens movimentados em notas fiscais sem configuração canônica em `fiscal_sped_item_config` para o registro 0200 (`CODIGO_ITEM_CANONICO_AUSENTE`). O usuário deve cadastrar a classificação canônica na aba Itens.
   - 1 contabilista ausente (`CONTABILISTA_AUSENTE`). O usuário deve cadastrar o contador responsável na aba Configuração.
   *Subtotal: 84 + 87 + 1 = 172 (atual) | Comparativo histórico: 170 no baseline inicial de 82 entradas, 171 com entrada 1031.*
2. **Decisões fiscais do contador (16 ocorrências atuais)**:
   - 2 campos obrigatórios de cabeçalho do registro 0000 dependentes de definição contábil (`0000.IND_PERFIL` e `0000.IND_ATIV`).
   - 11 gates de decisão fiscal/configuração pendentes de confirmação do contador:
     - `TIMEZONE` (GATE_TIMEZONE_STATUS_NAO_CONFIRMADO)
     - `PERFIL_EFD_STATUS` (GATE_PERFIL_EFD_STATUS_NAO_CONFIRMADO)
     - `PERFIL_EFD_PENDENTE`
     - `IND_ATIV` (GATE_INDICADOR_ATIVIDADE_STATUS_NAO_CONFIRMADO)
     - `CONTRIB_IPI` (GATE_CONTRIBUINTE_IPI_STATUS_PENDENTE)
     - `EFD_CONTRIB` (GATE_ENTREGA_EFD_CONTRIBUICOES_STATUS_PENDENTE)
     - `BLOCO_K` (BLOCO_K_PENDENTE)
     - `INVENTARIO` (INVENTARIO_PENDENTE)
     - `C176_C179_PENDENTE` (REGISTROS_C176_C179_PENDENTES)
     - `1400` (REGISTRO_1400_PENDENTE)
     - `1601` (REGISTRO_1601_PENDENTE)
   - 1 decisão de aplicabilidade de ressarcimento de ICMS ST (`C176_C179_APLICABILIDADE_DETECTADA`).
   - 1 divergência cadastral histórica pontual em XMLs de fornecedor (`CADASTRO_FISCAL_DIVERGENTE` em `0150|P38168192000112`).
   - 1 bloqueio de indicadores setoriais do Bloco 1 pendentes de decisão fiscal (`INDICADORES_1010_PENDENTES`).
   *Subtotal: 2 + 11 + 1 + 1 + 1 = 16.*
3. **Decisões fiscais e dados externos (10 ocorrências)**:
   - 1 guia de recolhimento de ICMS próprio (`E116_RECOLHIMENTO_AUSENTE`: apuração própria gerou R$ 38,00 a recolher sem DAE informado).
   - 8 guias de recolhimento de DIFAL (`E316_RECOLHIMENTO_AUSENTE`: DIFAL para ES, MA, MG, MT, PA, PE, RN, RS sem GNRE informada).
   - 1 arquivo da EFD anterior (`EFD_ANTERIOR_AUSENTE`: para transporte de saldo credor inicial de julho/2026, se houver).
   *Subtotal: 1 + 8 + 1 = 10.*

**Fechamento Numérico da Auditoria:**
`172 (cadastrais/operacionais) + 16 (decisões contador) + 10 (dados externos) = 198 bloqueios auditados na validação atual.`
*(Comparativo com baselines anteriores: 195 no baseline inicial, 196 com a entrada 1031).*

Sem esses itens sanados ou confirmados pelo contador da empresa, a competência permanece com status `COM_ERROS` e o fechamento bloqueado, exatamente conforme desenhado. Contudo, o sistema permite gerar a **Prévia SPED** a qualquer momento para homologação antecipada no PVA oficial.

## Ficha Técnica da Nova Prévia Gerada para Homologação no PVA

- **Nome do Arquivo Local**: `tmp_sped_demir_202608.txt`
- **Registro no Banco**: Tabela `fiscal_sped_arquivo`, ID `2`, Sequência `2`
- **Storage Path**: `fiscal-sped/1/2026-08/v1/2-621e90d4f3c74e7d7ba26f34f57a43b934f80d3d7edcf830f9017d7c844c5b7a.txt`
- **Competência**: `08/2026`
- **Estabelecimento**: `AUTO ELETRICA DEMIR LTDA` (CNPJ: 12.260.723/0001-09, IE: 16.172.654-2, João Pessoa - PB)
- **Tipo de Artefato**: `PREVIA`
- **Leiaute EFD**: `020` (vigente a partir do ano-calendário 2026)
- **Quantidade de Registros/Linhas**: `326`
- **Tamanho**: `28.375 bytes`
- **Hash SHA-256**: `621e90d4f3c74e7d7ba26f34f57a43b934f80d3d7edcf830f9017d7c844c5b7a`
- **Codificação / Terminador**: Latin-1 (ISO-8859-1) / CRLF (`\r\n`)
- **Status do Módulo**: **AGUARDANDO HOMOLOGAÇÃO MANUAL NO PVA**
- **Versão Recomendada do PVA**: Versão mais recente disponibilizada pela Receita Federal compatível com a EFD ICMS/IPI leiaute 020 (guia prático EFD 2026).

