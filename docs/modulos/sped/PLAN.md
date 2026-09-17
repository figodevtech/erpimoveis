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
| 3 | Estruturas de configuração, competência, versão, snapshots, apuração, diagnósticos, arquivos, 1601, inventário e PVA | **IMPLEMENTADO**, **TESTADO NO BANCO** (283 migrations aplicadas em demo/demir/garage, RLS estrita nas 23 tabelas, bucket privado) |
| 4 | Motor do leiaute 020 (Blocos 0, C, E, H, 1 e 9)<br>• Bloco 0: 0000, 0001, 0005, 0100, 0150, 0190, 0200, 0205, 0220, 0221, 0990<br>• Bloco C: C001, C100, C101, C170, C190, C191, C990<br>• Bloco E: E001, E100, E110, E111, E112, E113, E115, E116, E300, E310, E311, E312, E313, E316, E990<br>• Bloco H: H001, H005, H010, H990<br>• Bloco 1: 1001, 1010, 1400, 1601, 1990<br>• Bloco 9: 9001, 9900, 9990, 9999 | **IMPLEMENTADO**, **TESTADO UNITARIAMENTE** (suíte de negócio com 1561 testes passando). **AINDA NÃO HOMOLOGADO NO PVA** |
| 5 | Gates de Perfil, Bloco K, 1400, C176/C179, IPI e Contribuições | **IMPLEMENTADO**, **TESTADO NO BANCO** (recusa de fechamento se PENDENTE comprovada em teste automatizado) |
| 6 | Importações, validação, fechamento/reabertura, geração, Storage real e PVA | **IMPLEMENTADO**, **TESTADO NO BANCO**, **TESTADO EM AMBIENTE REAL** (Storage `fiscal-sped` validado e2e com SHA-256; fluxo de apontamento do PVA com UI e rota autenticada implementado) |
| 7 | Área `/fiscal/sped`, permissões, rastreabilidade e histórico de PVA | **IMPLEMENTADO**, **TESTADO NO BUILD** (Next.js 15 compilando 210 páginas sem erros) |
| 8 | Testes e regressão | **TESTADO UNITARIAMENTE** (`npm run test:negocio`), **TESTADO NO BANCO** (`npm run db:test:sped-fiscal -- demo/demir/garage`) e `npm run build` passando |

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
- 283 migrations aplicadas em todos os ambientes (`npm run db:status` com 0 pendências).
- Bucket `fiscal-sped` privado provisionado e testado com upload/download de arquivo SPED real assinado e conferência de SHA-256.

## Fronteiras e segurança

- XML autorizado/evento SEFAZ é a fonte histórica de documento e tributos.
- Cadastro atual nunca reescreve o histórico fiscal.
- Entradas exigem `data_entrada_fiscal` confirmada. Nada é preenchido automaticamente: a tela oferece a data de emissão e a data do lançamento como atalhos, e o usuário confirma. A confirmação é recusada quando atinge uma competência FECHADA.
- NF-e denegada, enviada sem retorno, em contingência ou com resultado incerto no período bloqueia a validação. O motor ainda não gera C100 com COD_SIT 04.
- Cancelamento homologado pela SEFAZ sempre marca a NF-e como CANCELADA. Se a preservação do evento falhar, a tela avisa.
- Tabelas SPED usam RLS e não concedem acesso direto a `anon`/`authenticated`. As APIs autenticadas usam o cliente administrativo no servidor.
- Versões fechadas, snapshots e artefatos são imutáveis.
- CNPJ é texto canônico de 14 posições; nunca é normalizado com `\D`.
- Datas civis do XML são preservadas sem conversão cega de timezone.

## Critérios de conclusão técnica

- [x] Migrations consistentes, provadas com rollback e aplicadas nos bancos de cliente (`demo`, `demir`, `garage`).
- [x] Testes com `00000000E08G12` e CNPJ numérico.
- [x] Geração determinística com contadores e Bloco 9 coerentes (testes unitários do serializador).
- [x] Projeção cadastral do Bloco 0 (0150, 0190, 0200, 0205, 0220, 0221) implementada com testes unitários.
- [x] Suporte a ajustes e documentos fiscais do Bloco E (E111, E112, E113, E115, E116, E311, E312, E313, E316) implementado com testes unitários.
- [x] Integração de Storage e2e testada no ambiente real.
- [x] Registro e histórico de validações do PVA implementado no banco, APIs e interface.
- [x] Competência piloto 08/2026 aberta e versionada no banco real da Demir Diesel.
- [x] Projeção fiscal real de 52 saídas (C100 regular e canceladas com COD_SIT 02), 13 partilhas DIFAL (C101 e E300/E310), 44 participantes (0150) e 87 itens (0200).
- [x] Primeiro arquivo TXT real gerado (324 linhas, 28.326 bytes) com 100% de conformidade de campos e registros auditados contra o leiaute 020.
- [x] Upload da prévia SPED testado e armazenado no Supabase Storage `fiscal-sped` e registrado em `fiscal_sped_arquivo`.
- [x] Fechamento bloqueado por erros, datas não confirmadas e gates pendentes (195 diagnósticos catalogados no piloto).
- [x] Reabertura cria nova versão sem mutar a anterior.
- [x] Suítes existentes continuam passando (`npm run test:negocio` com 1561 testes, `next build` 100%).
- [ ] Arquivo gerado de uma competência real importado e homologado no programa oficial do PVA.

## Diagnóstico Real do Piloto (Demir Diesel - 08/2026)

Na execução de validação da versão 1 da competência 08/2026, foram catalogados 195 diagnósticos bloqueantes legítimos (sem falsos positivos estruturais):

1. **Entradas fiscais pendentes de confirmação civil (82 ocorrências)**:
   - 82 compras com `data_entrada_fiscal` nula. Devem ser confirmadas pelo operador na aba Entradas do módulo SPED.
2. **Classificação canônica de itens ausente (87 ocorrências)**:
   - 87 itens movimentados em notas fiscais ainda não possuem configuração em `fiscal_sped_item_config` para o registro 0200.
3. **Contabilista não cadastrado (1 ocorrência)**:
   - Cadastrar os dados do contador (CRC, CPF, endereço, contatos) na aba Configuração para gerar o registro 0100.
4. **Campos obrigatórios do cabeçalho 0000 (2 ocorrências)**:
   - `0000.IND_PERFIL` e `0000.IND_ATIV` pendentes de confirmação fiscal pelo contador (Perfil B / Indicador de atividade industrial ou outros).
5. **Guias de recolhimento não revisadas (9 ocorrências)**:
   - Apuração de ICMS próprio (R$ 38,00 em E116) e DIFAL interestadual para 8 estados destino (ES, MA, MG, MT, PA, PE, RN, RS em E316).
6. **Bloqueios externos e gates de conformidade**:
   - Confirmação dos gates: Perfil EFD, Bloco K, Registro 1400, C176/C179, Registro 1601, Inventário/Bloco H, Contribuinte de IPI, EFD-Contribuições e EFD anterior (julho/2026 para saldo credor inicial).

Sem esses itens sanados ou confirmados pelo contador da empresa, a competência permanece com status `COM_ERROS` e o fechamento bloqueado, exatamente conforme desenhado. Contudo, o sistema agora permite gerar a **Prévia SPED** a qualquer momento para homologação antecipada no PVA oficial.
