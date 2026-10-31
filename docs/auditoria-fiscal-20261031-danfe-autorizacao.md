# ERP Imóveis — DANFE, autorização e inutilização em 31/10/2026

## Resultado implementado

As correções verificadas no ERP Oficina foram adaptadas ao `erpimoveis` na branch `fix/atualizacao-motores-fiscais-20261031`. A comparação com a base anterior confirmou igualdade dos módulos desta área, com uma diferença local no PDF: os metadados identificam o **ERP Imóveis**. Essa identificação foi preservada e passou a ser verificada no teste do PDF.

A rota `src/app/api/nfe/autorizar/[id]/route.ts` já existe no ERP Imóveis. A autorização fiscal avulsa chama essa rota, portanto as proteções foram aplicadas no fluxo efetivo sem recriar endpoints de oficina nem alterar o serviço avulso nesta frente.

Foram portados:

- DANFE HTML/PDF conforme diferenças confirmadas da NT 2026.010 v1.00, selecionadas pela data de emissão a partir de 01/12/2026. Documentos anteriores mantêm sua visualização histórica.
- CRT lido do XML, alíquotas efetivas de IBS/CBS inclusive zero, base e alíquota do IS, totais monofásicos presentes no documento e `vNFTot` separado do `vNF`. A visualização não recalcula nem reescreve o XML autorizado.
- Medição das linhas RTC, valores completos e repetição de cabeçalhos nas páginas seguintes do PDF.
- Política de inutilização por UF, modelo, ambiente e data da solicitação: AC/BA/SP a partir de 11/11/2026, sem estender o bloqueio a PB. O fuso da UF determina a fronteira da data; o ano da faixa não altera essa decisão.
- Preservação de autorização síncrona `indSinc=1`; retorno ilegível ou inconclusivo permanece incerto. Autorização exige protocolo e chave correspondente à chave transmitida. Duplicidade não reconciliada não libera numeração.
- Proteção de retransmissão e de atualizações concorrentes: documentos autorizados, cancelados ou denegados não são retransmitidos por essa ação, e o XML autorizado só é gravado após confirmação efetiva.

## Fontes oficiais e vigência

Esta portabilidade reutiliza as fontes primárias já conferidas nesta mesma tarefa de atualização do ERP Oficina, sem introduzir regra tributária adicional. O [Portal DF-e SVRS](https://dfe-portal.svrs.rs.gov.br/NFe/Documentos) publica os documentos abaixo.

| Documento | Fonte oficial | Regra e marco conferidos |
| --- | --- | --- |
| NT 2026.010 v1.00 | [PDF SVRS](https://dfe-portal.svrs.rs.gov.br/NFE/DownloadArquivoEstatico/?sistema=NFE&tipoArquivo=3&nomeArquivo=NFe_NT_2026.010_v1_00_DANFE_RTC.pdf) | Cronograma p.3 e seções 4.1–4.4: DANFE RTC em produção em 01/12/2026. |
| NT 2023.002 v1.02 | [PDF SVRS](https://dfe-portal.svrs.rs.gov.br/NFE/DownloadArquivoEstatico/?sistema=NFE&tipoArquivo=3&nomeArquivo=NFe_NT2023.002_v1.02%20%28Fim%20autoriza%C3%A7%C3%A3o%20ass%C3%ADncrona%20e%20inutiliza%C3%A7%C3%A3o%29.pdf) | Cronograma p.4 e I01a: inutilização AC/BA/SP em 11/11/2026. Sincronismo exclusivo: produção 05/04/2027, homologação até 01/02/2027. O ERP já usa o modo síncrono. |
| NT 2026.006 v1.01 | [PDF SVRS](https://dfe-portal.svrs.rs.gov.br/NFE/DownloadArquivoEstatico/?sistema=NFE&tipoArquivo=3&nomeArquivo=NT_2026.006_v1.01_RTC_VinculacaoPagamento.pdf) | Disponibilização prevista: homologação até 26/10/2026 e produção 16/11/2026. Grupo de vínculo e evento 110300 não ativam recolhimento automático em 2026. |

Hashes SHA-256 das fontes conferidas no trabalho de origem:

- NT 2026.010: `EADC5246235F37A55F8140DDCF84595C8CE77F2D760F111F7B85DDF389B8F484`.
- NT 2023.002: `E375B487FDB38C0F114DBC9FD4A0B109151D0A21E1770D738F5C5F9597758202`.
- NT 2026.006: `2C5770B54D19B66FF61200FAD20D1A4373B71A48D42F0EE5E005E808CE0EB206`.

## Arquivos desta área

| Arquivo | Alteração |
| --- | --- |
| `src/lib/nfe/danfeRtc.ts` | Seleção de leiaute por data e presença dos grupos RTC, inclusive com valores zero. |
| `src/lib/nfe/danfeParser.ts` | CRT, alíquotas efetivas, IS, totais monofásicos e presença dos dois totais. |
| `src/lib/nfe/danfeData.ts` | Entrega o CRT original do XML ao visualizador. |
| `src/lib/nfe/danfePdf.ts` | Apresentação RTC por vigência e paginação; preserva producer/creator ERP Imóveis. |
| `src/components/danfe/danfe-view.tsx` | Mesmas informações fiscais e seleção de vigência na apresentação HTML. |
| `src/lib/nfe/politicaServicosSefaz.ts` | Política pura da desativação de inutilização e fuso da UF. |
| `src/lib/nfe/webservices.ts` | Recusa endpoint de inutilização desativado; mantém UFs já suportadas. |
| `src/services/fiscal/nfeInutilizacaoService.ts` | Confere a política antes de registro, certificado e transmissão. |
| `src/lib/nfe/retornoAutorizacao.ts` | Classificação segura do retorno, protocolo/chave e bloqueio de retransmissão. |
| `src/app/api/nfe/autorizar/[id]/route.ts` | Retornos inconclusivos, duplicidade, gravação de XML somente autorizado e proteção de desfechos concorrentes. |
| `src/services/fiscal/nfeConsultaProtocoloService.ts` | Chave do protocolo mantida como texto e exposta ao fluxo de autorização. |
| `src/lib/nfe/danfeParser.test.ts` | Ausência de campos históricos, CRT, IS, efetiva zero, monofasia e totais do XML. |
| `src/lib/nfe/danfePdf.test.ts` | Paginação A4, conteúdo HTML/PDF, vigência e metadados ERP Imóveis. |
| `src/lib/nfe/politicaServicosSefaz.test.ts` | UFs, modelos, ambientes, data e fronteira de fuso. |
| `src/lib/nfe/retornoAutorizacao.test.ts` | Sincronismo, duplicidade, chave divergente, retorno incerto e retransmissão. |
| `src/services/fiscal/nfeConsultaProtocoloService.test.ts` | Preservação exata da chave do protocolo recebido. |

## Validação no ERP Imóveis

Comando executado no diretório alvo:

```powershell
node --import tsx --test --test-reporter=spec src/lib/nfe/danfeParser.test.ts src/lib/nfe/danfePdf.test.ts src/lib/nfe/politicaServicosSefaz.test.ts src/lib/nfe/retornoAutorizacao.test.ts src/services/fiscal/nfeConsultaProtocoloService.test.ts
```

Resultado final: **16 testes aprovados, zero falhas e zero ignorados**. O teste do PDF gera documentos em memória, verifica múltiplas páginas A4, conteúdo fiscal e escala de fonte. A leitura dos metadados usa `updateMetadata:false` para que a própria biblioteca de leitura não os substitua. O HTML é verificado por renderização estática e asserções. Não foi repetida inspeção visual independente de arquivo rasterizado nesta portabilidade.

ESLint direcionado aos 16 arquivos TypeScript/TSX: **aprovado**. `git diff --check`: aprovado, com aviso de normalização CRLF no PDF. TypeScript, build e suíte global são consolidados pelo relatório principal do ERP Imóveis.

## Split payment, banco e limitações

O grupo `gPgtoVinc` e o evento 110300 permanecem preparação futura. Disponibilidade de esquema não equivale à ativação do split. O ERP não copia automaticamente NSU, autorização ou identificador interno para o identificador fiscal da transação: é necessário confirmar contrato operacional do PSP, meio de pagamento e CNPJs pertinentes. A vinculação imobiliária deve preservar as origens de comissão, taxa de administração, venda ou locação; nenhuma relação financeira foi migrada por esta frente.

Não foram criadas migrações nesta área, nem houve alteração de banco remoto, consulta de logs, carregamento de certificado real ou transmissão fiscal. Os testes usam XMLs e dados sintéticos locais. Não se declara homologação SEFAZ ou Focus.

O rollback de aplicação consiste em reverter os arquivos desta frente, preservando os documentos, protocolos e pagamentos existentes. Antes da produção, concluir os checks globais, revisar os cenários com a contabilidade e homologar o fluxo externo e a impressão efetivamente utilizada. UFs adicionais dependem de confirmação do cronograma e dos autorizadores aplicáveis.
