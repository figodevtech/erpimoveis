# Atualização dos motores fiscais — 31/10/2026 (ERP Imóveis)

Branch: `fix/atualizacao-motores-fiscais-20261031`, criada de `39e2d0bc`. Alterações locais para revisão, sem commit, push ou implantação.

Esta entrega replica no ERP Imóveis a atualização feita no ERP Oficina na mesma data. As regras, fontes oficiais e limites são os mesmos. Este relatório registra apenas o que difere entre os dois projetos; o detalhamento por área está nos relatórios complementares:

| Área | Relatório |
| --- | --- |
| NFS-e, Focus, competência e migração | [Auditoria NFS-e](auditoria-fiscal-20261031-nfse.md) |
| Motor NF-e/NFC-e, devoluções e totalização | [Auditoria do motor](auditoria-fiscal-20261031-motor-nfe.md) |
| Schemas, catálogo oficial e importação | [Auditoria de schemas e catálogos](auditoria-fiscal-20261031-schemas-catalogos.md) |
| DANFE, autorização, inutilização e split payment | [Auditoria DANFE e serviços](auditoria-fiscal-20261031-danfe-autorizacao.md) |

Os relatórios complementares foram escritos para o ERP Oficina e citam as rotas de emissão por OS (`/api/nfse/de-os`, `servicos-de-os`, `contexto-emissao`), que não existem neste projeto. Aqui, a emissão nova acontece pelo fluxo imobiliário descrito abaixo.

## A. Resumo

- **Igual ao ERP Oficina (arquivos idênticos):** motor NF-e/NFC-e (referências de devolução, `vItem`, `vNFTot`, IPI, precisão), DANFE RTC (NT 2026.010), catálogo IT 2025.002 v1.71, retorno da autorização síncrona, política de inutilização por UF/modelo/ambiente/data, política NFS-e do Simples (CGSN 191/2026), conferência do destino Focus, seleção de leiaute NT 004/007 × NT 009 e reenvio NFS-e genérico (`/api/nfse/[id]/reemitir`).
- **Adaptado ao fluxo imobiliário** (`src/lib/imobiliario/nfse.ts`, taxas de administração e comissões):
  - O cadastro da empresa na Focus e o leiaute da DPS são conferidos **antes** da reserva (`imob_reservar_nfse`). Uma configuração incompatível não cria NFS-e, não vincula as receitas e não arquiva a tentativa anterior.
  - Autorizador e competência são gravados na nota no momento da reserva.
  - A correção de NFS-e rejeitada mantém a competência original. O diálogo envia sempre a data do dia; sem o ajuste, uma nota rejeitada de 30/10 corrigida em novembro passaria para o Emissor Nacional, com outro autorizador.
- **Não aplicável:** os testes `nfseSelecaoAgrupada` e `nfseTransicao2026` do ERP Oficina exercitam rotas de OS ausentes aqui; a cobertura equivalente está em `src/lib/imobiliario/nfse.test.ts`.

Não houve alteração de banco remoto, emissão real, alteração de certificado/token, renumeração ou reescrita de documento autorizado.

## B. Arquivos específicos deste projeto

| Arquivo | Alteração |
| --- | --- |
| [src/lib/imobiliario/nfse.ts](../src/lib/imobiliario/nfse.ts) | Competência original na correção; `transport.preparar` antes da reserva; autorizador e competência enviados à RPC. |
| [src/lib/imobiliario/nfse.test.ts](../src/lib/imobiliario/nfse.test.ts) | 4 regressões: bloqueio sem Ambiente Nacional na Focus (sem reserva nem POST), snapshot na reserva com GET antes do POST, correção em Cabedelo mantendo 30/10 e o emissor municipal, nota legada sem coluna de competência. Os 4 falham no código anterior. |
| [supabase/migrations/20261031142934_nfse_contexto_fiscal_imobiliario.sql](../supabase/migrations/20261031142934_nfse_contexto_fiscal_imobiliario.sql) | Colunas da NFS-e (igual ao ERP Oficina) e nova versão de `imob_reservar_nfse`. |
| [supabase/migrations/20261031142806_atualizar_catalogo_rtc_it_2025_002_v171.sql](../supabase/migrations/20261031142806_atualizar_catalogo_rtc_it_2025_002_v171.sql) | Idêntica à do ERP Oficina; muda só o timestamp do arquivo. |
| [src/services/fiscal/nfseTransporte.test.ts](../src/services/fiscal/nfseTransporte.test.ts), [src/lib/nfe/danfePdf.test.ts](../src/lib/nfe/danfePdf.test.ts), [src/lib/nfe/catalogoRtc.test.ts](../src/lib/nfe/catalogoRtc.test.ts) | Mesmas asserções do ERP Oficina, ajustadas à base deste projeto (produtor do PDF “ERP Imóveis”, nome da migração). |

Os demais arquivos são cópias exatas dos arquivos do ERP Oficina, cuja base (`HEAD`) também era idêntica. Exceções: `src/lib/nfe/buildNFe.ts`, `src/lib/nfe/danfePdf.ts` e `src/services/fiscal/nfeEmissaoIcms.test.ts` têm base diferente entre os projetos e receberam o mesmo diff, linha a linha.

## C. Banco de dados

| Migração | Conteúdo | Validação local |
| --- | --- | --- |
| `20261031142806_atualizar_catalogo_rtc_it_2025_002_v171.sql` | 18 CST e 173 cClassTrib v1.71, aditiva e idempotente; preserva a v1.60. | Mesmo conteúdo validado no ERP Oficina. |
| `20261031142934_nfse_contexto_fiscal_imobiliario.sql` | `nfse.autorizador_emissao` (CHECK) e `nfse.data_competencia`, nullable e sem backfill. `imob_reservar_nfse` ganha `p_autorizador` e `p_data_competencia` com `DEFAULT NULL`, grava o snapshot e recusa reemissão que troque uma competência já gravada. Permissões: só `service_role`. | PGlite: aplicada duas vezes; assinatura única; `anon`/`authenticated` sem EXECUTE; nota anterior permanece com nulos; chamada no formato antigo (8 parâmetros) continua funcionando; reemissão com outra competência recusada; com a original, arquiva a tentativa; valor de autorizador inválido recusado pela constraint. |

**Aplicação em produção (31/10/2026, autorizada pelo responsável):** as duas migrações foram aplicadas e registradas em `supabase_migrations.schema_migrations`. Conferência posterior: v1.71 18/173, v1.60 preservada 18/164, colunas criadas, nenhuma nota histórica preenchida, `imob_reservar_nfse` com assinatura única de 10 parâmetros e EXECUTE somente para `service_role`.

**Ajuste pós-auditoria na conferência Focus:** a API de empresas da Focus exige o token principal da conta; o token de emissão recebe 401 e o host de homologação responde 404. Nesses casos, e quando o cadastro não é localizado, a DPS não é mais bloqueada: a conferência é ignorada com aviso no log e a Focus recusa envio incompatível.

Ordem de implantação: aplicar as migrações **antes** do código. Como os parâmetros novos têm default, o código atual continua funcionando com a função nova; o inverso (código novo com a função antiga) falharia a emissão antes de qualquer envio.

Rollback: recriar `imob_reservar_nfse` com a assinatura de `20261029173114_dominio_imobiliario.sql`; a remoção das colunas exige arquivar antes os snapshots criados após o deploy (comandos comentados no fim da migração).

## D. Testes

| Verificação | Resultado |
| --- | --- |
| `npm run test:negocio -- --test-reporter=spec` | **2.757 aprovados, zero falhas** (inclui XSD, NF-e, DANFE, NFS-e e imobiliário). |
| `npx tsc --noEmit --incremental false` | Aprovado. |
| `npx next build` | Aprovado. O `public/sw.js` regenerado pelo build foi restaurado. |
| ESLint dos 46 arquivos TypeScript alterados/novos | Aprovado. |
| Migração NFS-e imobiliária em PGlite | Aprovada (cenários da seção C). |

Não houve homologação SEFAZ ou Focus.

## E. Pendências

As mesmas do ERP Oficina (SEFAZ/XSD posterior, regulamentação de 2027, release produtiva da NT 009, contratos Focus, revisão contábil, split payment e homologação externa); ver os relatórios complementares. Específicas deste projeto:

- **Focus:** a conferência prévia de habilitação só acontece se o token tiver acesso a `GET /v2/empresas?cnpj=` (token principal). Com token de emissão, ela é ignorada e quem valida o destino é a própria Focus.
- **Interface:** o diálogo de NFS-e imobiliária continua enviando a data do dia; a competência original é imposta pelo servidor na correção e aparece na conferência. Não há campo para emissão retroativa de competência anterior.

## F. Próximos passos

1. Revisar o diff da branch.
2. Aplicar as duas migrações pelo processo autorizado, antes do código.
3. Conferir o cadastro Focus (habilitação Nacional por ambiente) e a permissão do token de cada empresa.
4. Revisar o padrão fiscal NACIONAL das empresas do Simples que migram em 01/11/2026.
5. Homologar emissão, rejeição, correção e consulta com dados sintéticos.
