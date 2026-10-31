# ERP Imóveis — motor NF-e/NFC-e em 31/10/2026

## Resultado implementado

As correções verificadas no ERP Oficina foram portadas ao ERP Imóveis, na branch `fix/atualizacao-motores-fiscais-20261031`, criada da `main` local (`39e2d0bc`). O motor preserva a emissão no pacote PL_010f existente e corrige a composição dos valores já suportados. Nenhum XML autorizado, protocolo, certificado, número fiscal ou registro de produção foi alterado. Não houve transmissão à SEFAZ, acesso a arquivos ou serviços de logs nem execução de migração nesta frente.

Antes da aplicação, cada arquivo foi comparado com a base do ERP Oficina. Os arquivos compartilhados eram iguais, exceto o identificador de aplicação `verProc` em `buildNFe.ts`. A aplicação foi feita por patch previamente validado com `git apply --check`, preservando `ERPImoveis 2026.1`. Não foram recriadas rotas removidas nem alterados os fluxos imobiliários.

- **Devoluções:** ambas as alternativas continuam disponíveis: `NFref/refNFe` no cabeçalho ou `DFeReferenciado` no item. Foi removida a documentação incorreta que dizia que a referência por item seria sempre obrigatória. `nItem` permanece opcional. A repetição da mesma origem nos dois níveis de rascunhos legados é normalizada; origens distintas passam a produzir erro, em vez de perder uma referência silenciosamente.
- **Validação de referências:** uma única origem nos itens (VC02-30); uma ocorrência de `NFref` em devolução a partir de 16/11/2026 em produção e 09/11/2026 em homologação (B25-40). Sem cabeçalho, os itens da devolução devem conter referência, respeitando a exceção para CFOP 5921/6921 (VC02-14). As regras futuras de duplicidade e obrigatoriedade de `nItem` não foram ativadas.
- **Total por item:** `vItem` inclui desconto, frete, ICMS-ST, FCP-ST, IPI efetivamente serializado e IPI devolvido. Antes, continha somente produto menos desconto. `vNFTot` passa a ser a soma dos valores de `vItem`. Em 2026 IBS/CBS/IS continuam excluídos desses acréscimos, conforme a exceção da VB01-10.
- **IPI:** o cálculo percentual/por quantidade agora é compartilhado entre o XML e os totais. Antes, quando o IPI era calculado sem `valorIpi` explícito, aparecia no item e não aparecia no total da nota.
- **Arredondamento:** produto, desconto, frete, IPI, PIS/COFINS e RTC são somados com a precisão dos valores serializados. Desconto/frete que arredondam para zero são omitidos do produto: o XSD exige valores estritamente positivos nessas tags opcionais.
- **Diferimento RTC:** os totais `gIBSUF/vDif`, `gIBSMun/vDif` e `gCBS/vDif` passam a somar o diferimento dos itens. Antes eram sempre zero.

## Fontes oficiais e vigência

A apuração normativa original, realizada nesta mesma sessão para o ERP Oficina em 31/10/2026, baixou os PDFs oficiais da SVRS e extraiu seu conteúdo localmente com `pypdf`. Este porte reutiliza aquela apuração, sem introduzir regra ou cronograma adicional. A lista e os PDFs oficiais são:

- [Documentos NF-e — SVRS](https://dfe-portal.svrs.rs.gov.br/Nfe/Documentos).
- [NT 2025.002 v1.53 — PDF oficial](https://dfe-portal.svrs.rs.gov.br/NFE/DownloadArquivoEstatico/?sistema=NFE&tipoArquivo=3&nomeArquivo=NT_2025.002_v1.53_RTC_NF-e_IBS_CBS_IS.pdf).
- [NT 2026.008 v1.01 — PDF oficial](https://dfe-portal.svrs.rs.gov.br/NFE/DownloadArquivoEstatico/?sistema=NFE&tipoArquivo=3&nomeArquivo=NT_2026.008_v1.01_RTC_ValorLiquido.pdf).
- [NT 2026.005 v1.00 — PDF oficial](https://dfe-portal.svrs.rs.gov.br/NFE/DownloadArquivoEstatico/?sistema=NFE&tipoArquivo=3&nomeArquivo=NT_2026.005_v1.00_RTC_SimplesNacional.pdf).

| Documento / regra | Constatação | Tratamento no código |
| --- | --- | --- |
| NT 2025.002 v1.53, cronograma p. 6; B25-40; VC02-14/30; VC03-20 | Devolução admite cabeçalho ou item; produção em 16/11/2026; homologação até 09/11/2026, com implantação podendo variar por UF. `nItem` e duplicidade possuem RVs de implementação futura. | `referencias-nfe.ts`, `buildNFe.ts`, `xmlIde.ts`. O marco final de homologação não representa confirmação de implantação antecipada por UF. |
| NT 2025.002 v1.53, VB01-10 e W60-10; NT 2026.008 v1.01, introdução e VB01-10 | `vItem` representa participação no valor total; `vNFTot` soma os itens. A exceção de 2025/2026 exclui RTC. As RVs VB01 e W60 continuam descritas como implementação futura. | `fiscal.ts`, `xmlItem.ts`, `buildNFe.ts`. Corrige a definição dos campos já emitidos, sem afirmar ativação das rejeições futuras. |
| NT 2025.002 v1.53, grupo W03 | Totalizadores devem somar os valores correspondentes dos itens. | `buildNFe.ts`: totalização dos diferimentos. |
| NT 2026.008 v1.01, cronograma p. 3, leiaute p. 5 e regras p. 6–8 | `vUnComLiq`, `vProdLiq` e `vProdLiqTot` são campos novos, inicialmente opcionais; produção 16/11/2026. `NB01-30`: homologação 01/02/2027, produção 01/03/2027. | Nenhuma tag nova foi enviada sem XSD oficial compatível. Pendente obter/validar pacote correspondente. |
| NT 2026.005 v1.00, pp. 3–8 e evento pp. 11–12 | `tpRegimeIBSCBS` identifica situações específicas e não pode ser inferido apenas do CRT. `cAtivSN` é por item. Campos com produção 16/11/2026; evento 412140 é gerado pela Administração Tributária e tem implantação futura. | Não há emissor de evento 412140 no ERP. Não foram inferidos regimes nem ativadas obrigações materiais de 2027 em 2026. Novos campos aguardam XSD e integração completa. |

## Arquivos

| Arquivo | Alteração |
| --- | --- |
| `src/lib/nfe/referencias-nfe.ts` | Decisão e validação pura das referências, com data/ambiente explícitos. |
| `src/lib/nfe/buildNFe.ts` | Usa validação central; total por item; soma de `vNFTot`; frete arredondado; totais de diferimento. |
| `src/lib/nfe/xmlIde.ts` | Corrige comentário de obrigatoriedade granular; impede descarte de referência conflitante no reparo de rascunho. |
| `src/lib/nfe/xmlItem.ts` | `vItem` pela composição do item; evita tags positivas emitidas como zero. |
| `src/lib/nfe/fiscal.ts` | Cálculo de IPI compartilhado; composição de `vItem`; somas segundo valores serializados. |
| `src/lib/nfe/types.ts` | Tipo explícito para versão da fórmula de totalização. |
| `src/lib/nfe/buildNFe.test.ts` | Corrige a expectativa do item com IPI devolvido. |
| `src/lib/nfe/atualizacao-rtc-20261031.test.ts` | Regressões de referências, transição, totalizadores, precisão, diferimento e XSD 55/65. |
| `src/lib/nfe/icms/xsd.test.ts` | Acrescenta conformidade de NFC-e com consumidor identificado e não identificado no pacote oficial já existente. |

## Testes reais

- No diretório `erpimoveis`, `node --import tsx --test --test-reporter=spec src/lib/nfe/atualizacao-rtc-20261031.test.ts src/lib/nfe/buildNFe.test.ts src/lib/nfe/icms/xsd.test.ts`: **111 testes, 111 aprovados**.
- No mesmo diretório, `npm run test:nfe`: **812 testes, 812 aprovados**, zero falhas e zero ignorados, incluindo ICMS/CRT, XML, NFC-e, QR Code, contingência, assinatura de teste, documentos referenciados, totalizadores e validação no XSD versionado. Esse total pode aumentar conforme as demais frentes acrescentem testes. Uma primeira tentativa coincidiu com a criação da migração do catálogo e falhou por arquivo de migração ainda ausente no teste dessa outra frente; após a criação e ajuste do nome, a suíte completa passou.
- ESLint dos nove arquivos TypeScript do motor alterados/novos: **aprovado**, exit 0.
- TypeScript, build e suíte global do ERP Imóveis são consolidados separadamente no relatório principal.

Os exemplos usam dados sintéticos, assinatura de fixture e validação local. Não representam homologação SEFAZ.

## Pendências e limites

1. **Schemas / NT 2026.005 e 2026.008:** não foi confirmado pacote oficial novo acessível que suporte as tags dessas NTs. O PL_010f atual não contém os novos campos. Não se alterou XSD manualmente. A implementação completa dos campos líquidos, ICMS previsto e grupos do Simples exige o pacote oficial, confirmação de suporte, persistência e interface para os dados necessários.
2. **Transição de 2027:** a fórmula que soma IBS/CBS/IS está preparada no helper somente com versão explícita `RTC_2027` e data de emissão em 2027 ou posterior. A passagem do calendário sozinha não a ativa. O `buildNFePreviewXml` continua com `RTC_2026`. Antes de ativar a versão nova no fluxo completo, revisar pagamentos, parcelas, financeiro, bases tributárias e leitura dos totais em todos os consumidores, além de homologar. O teste isolado da fórmula não comprova conformidade integral para 2027.
3. **Seguro, outras despesas, II, serviços, ICMS monofásico e PIS/COFINS-ST:** o leitor de XML tem testes para essas composições, mas nem todos são capturados/persistidos/serializados pelo emissor atual. A fórmula nova do emissor usa somente os componentes efetivamente suportados; não cria valores presumidos. PIS/COFINS-ST permanecem explicitamente bloqueados na emissão. Suporte completo exige captura e persistência antes de habilitar novos grupos.
4. **CRT e regime IBS/CBS:** manter a distinção entre ICMS/CSOSN e o regime de IBS/CBS. Informar CRT não equivale a conhecer opção por regime regular, opção pendente ou atividade do Simples. Contabilidade e configuração explícita serão necessárias para os novos casos.
5. **Histórico:** `totais-nfe.ts` mantém sua referência histórica `ICMSTot/vNF`; não foi substituída globalmente por `vNFTot`. A política de consumo do novo total precisa de versionamento antes da ativação de 2027.
6. **Banco:** esta frente não cria migrações. O rollback de código deve ocorrer sem tocar XMLs autorizados ou snapshots tributários. Rascunhos afetados pela nova versão fiscal devem seguir o fluxo existente de revisão/regeneração antes de transmitir.
