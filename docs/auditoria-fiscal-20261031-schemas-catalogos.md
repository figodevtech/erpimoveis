# Catálogo RTC do ERP Imóveis — 31/10/2026

## Resultado

Portadas as correções verificadas no ERP Oficina, preservando as diferenças do repositório `erpimoveis`. O [Portal da Conformidade Fácil/SVRS](https://dfe-portal.svrs.rs.gov.br/CFF/Documentos), consultado novamente nesta execução, publica o IT 2025.002 v1.71 e sua tabela em 30/10/2026. A [planilha oficial](https://dfe-portal.svrs.rs.gov.br/DFE/DownloadArquivoEstatico/?sistema=DFE&tipoArquivo=12&nomeArquivo=Tabela%20IT%202025.002%20v.1.71%20-%20cClassTrib.xlsx) foi copiada byte a byte da fonte já verificada e conferida pelo SHA-256 `d104ce4df4d2fd8ea6329ce794d8d8ce03855f3adc1692b99f5446d87c4c71f8`.

A edição contém 18 CST e 173 classificações. A migração conserva a edição v1.60 com seus 18 CST e 164 classificações, sem atualizar documentos ou snapshots. Datas de vigência, descrições, percentuais e indicadores são preservados, incluindo `indDIR`, `indDUIMP`, `indNFe`, `indNFCe`, doação, regimes, crédito presumido, monofasia, diferimento e tributação regular. O catálogo não ativa cálculos ou benefícios ainda não suportados pelo motor.

O código anterior misturava cClassTrib de todas as edições com CST fixo v1.60. A seleção agora escolhe uma edição publicada pela data de emissão e usa a mesma edição para CST, classificação e validação do padrão fiscal. A vigência de cada classificação continua independente da data de publicação. Um código ausente na edição atual não é recuperado de uma edição anterior. NFC-e consulta seu indicador próprio, `indNFCe`.

## Arquivos

| Arquivo | Alteração |
| --- | --- |
| `schemas/fiscal/IT2025.002-v1.71-2026-10-30/cClassTrib.xlsx` | Fonte oficial congelada, sem alteração dos bytes. |
| `schemas/fiscal/IT2025.002-v1.71-2026-10-30/manifest.json` | URL, publicação, consulta, hash, abas e contagens. As abas originais mantêm o nome `2026-09-01`; a versão vem do arquivo oficial publicado em outubro. |
| `scripts/fiscal/gerar-migracao-catalogo-rtc.ts` | Gerador local que valida hash, contagens, códigos, CST, indicadores, percentuais e intervalos de vigência antes de escrever SQL. Não se conecta ao banco. |
| `supabase/migrations/20261031142806_atualizar_catalogo_rtc_it_2025_002_v171.sql` | Criada pelo CLI `supabase migration new`; INSERTs por versão com `ON CONFLICT DO NOTHING`, em transação. |
| `src/lib/nfe/catalogoRtc.ts` | Escolha da edição publicada e aplicabilidade por modelo 55/65. |
| `src/services/fiscal/catalogoRtcService.ts` | Carrega CST da edição escolhida e seus indicadores, sem hardcode v1.60. |
| `src/services/fiscal/nfeAvulsaService.ts` | Classificação e CST selecionados na mesma edição, com vigência e indicador do modelo. |
| `src/services/fiscal/padraoFiscalConfigService.ts` | Validação do padrão fiscal usando a mesma seleção de edição. |
| `src/lib/nfe/taxRules.ts` | Versão da capacidade fiscal atualizada e identificação correta do pacote PL_010f. |
| `src/lib/nfe/catalogoRtc.test.ts` | Fonte, hash, contagens, indicadores, publicação e reprodução exata da migração com seu nome no ERP Imóveis. |
| `src/services/fiscal/catalogoRtcService.test.ts` | Seleção consistente dos indicadores CST pela edição publicada. |
| `src/services/fiscal/nfeEmissaoIcms.test.ts` | Dois testes de emissão adicionados: escolha independente da ordem das linhas e ausência de fallback histórico. As diferenças preexistentes do arquivo do ERP Imóveis foram preservadas. |

Os três serviços/regras portados integralmente tinham conteúdo idêntico ao HEAD base do ERP Oficina antes da correção. O arquivo de teste divergente recebeu apenas os casos novos, sem substituição do conteúdo imobiliário.

## Verificação no ERP Imóveis

- `node --import tsx --test --test-reporter=spec src/lib/nfe/catalogoRtc.test.ts src/services/fiscal/catalogoRtcService.test.ts src/services/fiscal/nfeEmissaoIcms.test.ts`: **68 testes aprovados, zero falhas**.
- ESLint dos nove arquivos TypeScript desta frente: **aprovado**.
- SHA-256 da planilha copiada: **idêntico ao manifesto oficial congelado**.
- PostgreSQL PGlite 0.5.14 reaproveitado em diretório temporário externo: schema fiscal e nove seeds do próprio `erpimoveis` carregados em memória; migração nova executada duas vezes. Resultado: v1.60 permanece com 18 CST/164 classes e v1.71 fica com 18/173; todas as 173 classes têm `indDIR` e `indNFCe`. XML, `decisao_fiscal` e `tributacao_snapshot` sintéticos permaneceram idênticos antes/depois. Nenhuma conexão remota foi feita.
- TypeScript, build, suíte global e validação XSD são consolidados pelo responsável principal, sem atribuir ao ERP Imóveis os resultados da execução anterior do ERP Oficina.

## Schemas e limites

O pacote NF-e `PL_010f_NT2025_002_v1.50` continua preservado. As correções portadas não inventam XSD nem enviam campos novos somente porque uma NT foi publicada. A obtenção de eventual pacote oficial posterior compatível com as NTs 2026.005/008 e a homologação externa permanecem pendentes conforme a auditoria de origem. Validação local contra o pacote existente não comprova compatibilidade dos novos campos de novembro nem homologação SEFAZ.

Nenhum log local ou remoto foi consultado nesta frente. Não foram acessadas credenciais, certificados ou dados produtivos. A inspeção de banco utilizou apenas migrations/seeds locais e tabelas descartáveis com dados sintéticos.

## Implantação e rollback

Nenhuma migração foi aplicada remotamente. Antes da implantação, revisar/aplicar a migração pelo processo autorizado e conferir versões, contagens e indicadores. O serviço mantém a edição disponível e publicada quando a v1.71 ainda não estiver instalada; porém, uma edição legada sem `indNFCe` não comprova aplicabilidade ao modelo 65. Implantar a migração antes de usar RTC nesse modelo.

Rollback recomendado: manter edições e snapshots e fixar de forma controlada a seleção da edição anterior, após revisão contábil. Não executar DELETE de classificações usadas. Reverter cegamente o seletor antigo com várias edições no banco reintroduz a mistura de versões corrigida. Não há rollback destrutivo automático.

Contabilidade deve revisar o enquadramento concreto de cada empresa imobiliária; disponibilizar 173 códigos não os torna aplicáveis às suas operações. Tratamentos especiais e crédito presumido dependem de dados e suporte explícitos do motor.
