# NFS-e — atualização comprovada em 31/10/2026

## Regra confirmada e correções

A Resolução CGSN 191/2026 foi confirmada na [comunicação oficial da Receita Federal](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026). A [orientação do CGNFS-e de 29/10/2026](https://www.gov.br/nfse/pt-br/noticias/nfs-e-informa-diretrizes-sobre-a-obrigatoriedade-da-emissao-da-nfs-e-nacional-para-optantes-do-simples-nacional/) esclarece a transição: a competência do serviço determina o emissor; competências desde 01/11 exigem o Emissor Público Nacional para ME/EPP do Simples, inclusive em município com sistema próprio. Competências anteriores continuam no sistema municipal aplicável. Municípios que já utilizam o nacional mantêm seu fluxo.

O ERP aplicava a virada somente a João Pessoa e Lucena. Cabedelo permanecia municipal, municípios sem regra não eram atendidos e a exceção de itens de João Pessoa prevalecia sobre o Simples. A política agora dá precedência à obrigação nacional em todos os municípios para CRT 1/2 e preserva MEI nacional. CRT 3 mantém a política municipal; Lucro Presumido e Real não são diferenciados pelo CRT ICMS nem recebem opção IBS/CBS presumida. Competências inválidas são recusadas.

O reenvio passou a resolver a política pela competência da tentativa original, usando `data_competencia` da DPS ou a data original do RPS legado, sem substituí-la pelo dia do reenvio. A operação com resultado incerto permanece na mesma referência e dispensa recalcular a política. Nenhum documento autorizado é reemitido por esta alteração. A emissão nova da tela continua utilizando o dia corrente como competência: não foi criada uma interface de retroação do RPS municipal sem contrato confirmado da prefeitura/Focus.

O destaque de RTC permanece independente do emissor. A migração de novembro não exige IBS/CBS do Simples em 2026. O marco existente de 2027 foi preservado conforme a orientação da Receita; isso não comprova suporte integral a todas as situações tributárias de 2027 ou tratamento específico do MEI nesse ano, que exigem revisão contábil e contratual antes da ativação.

## Destino efetivo na Focus

A [documentação Focus de João Pessoa](https://focusnfe.com.br/guides/nfse/municipios-integrados/joao-pessoa-pb/) distingue DPS nacional transmitida ao autorizador municipal DSF e emissão Sefin. Ambos usam `/v2/nfsen`. Para DSF, o cadastro exige NFS-e padrão ativa e ambiente nacional desligado.

O transporte de novas DPS realiza consulta somente leitura a [`GET /v2/empresas?cnpj=...`](https://doc.focusnfe.com.br/reference/listar_empresas), confere um único cadastro correspondente e utiliza os campos documentados [`habilita_nfse`, `habilita_nfsen_producao`, `habilita_nfsen_homologacao`](https://doc.focusnfe.com.br/reference/consultar_empresa_por_id). Nacional exige o flag nacional do ambiente ativo; municipal no formato nacional exige padrão ativo e nacional explicitamente desligado. Ausência, divergência, erro ou falta de permissão bloqueiam o POST fiscal. Nenhuma configuração, token ou certificado é alterado. O conteúdo integral do cadastro consultado não é persistido nem devolvido ao cliente.

O destino escolhido e a competência são gravados em `nfse.autorizador_emissao` e `nfse.data_competencia` nas novas emissões e na reserva de reenvios rejeitados cuja origem possa ser determinada. A competência fica estável mesmo após várias recusas e mudanças da data de envio. O reenvio recusa trocar o autorizador quando o snapshot diverge da política; sem snapshot, usa a política da competência para conferir o cadastro antes da reserva. A recuperação incerta na mesma referência permanece preservada. Consulta/cancelamento de notas históricas mantêm sua família de endpoint. Não há backfill de documentos anteriores; não se infere Sefin apenas de `modelo_emissao=NACIONAL`.

A conferência de destino e leiaute ocorre antes do INSERT e da reserva de reenvio: falha de configuração retorna 400 sem criar NFSe/vínculo nem alterar referência, erros ou tentativas. A preparação é reutilizada no envio da mesma requisição, evitando uma segunda consulta de cadastro.

## Leiaute por ambiente

O [CGNFS-e, em 29/10](https://www.gov.br/nfse/pt-br/noticias/nfs-e-nacional-confira-oas-rientacoes-sobre-leiaute-em-producao-regras-de-preenchimento-de-ibs-cbs-e-status-da-nota-tecnica-009), informa produção NT 004 com domínio da NT 007; NT 009 v1.0 release 1 fica em produção restrita. Release 2/v1.01 e seguintes depende de liberação; há previsão de releases em dezembro, sem promover automaticamente o leiaute do ERP. Aceitação técnica pelo autorizador não substitui obrigação fiscal.

A seleção local explicita `NT004_NT007` em produção e `NT009_RELEASE1` em homologação, com opção explícita de testar o anterior. Solicitar NT 009 em produção é recusado. Campos exclusivos e códigos 99.02–99.04 não passam pelo transporte produtivo.

O contrato [`bens_moveis` da Focus em homologação](https://campos.focusnfe.com.br/nfse_nacional_homologacao/EmissaoDPSXml.html) está tipado e validado para envio pelo serviço: até 1.000 bens, NCM de oito posições, descrição até 150 caracteres e quantidade inteira até três posições. A tela de ordens de oficina não gera dados de locação presumidos. `gPgtoVinc`, `vAjusteBC` ou nomes JSON de pagamento não confirmados são recusados; não são copiados do XML para a API. Grupos de imóveis, pagamentos, eventos e release 2 completo permanecem pendentes de implementação contratual e testes externos.

## Arquivos e migração

| Arquivo | Alteração |
| --- | --- |
| `src/lib/services/fiscais/nfse-politica.ts` | Prioridade nacional global, validação de competência, competência original de reenvio, comparação de snapshot, diagnóstico E0039 atualizado. |
| `src/lib/services/fiscais/nfse-focus-destino.ts` | Validação pura das flags por destino/ambiente Focus. |
| `src/lib/services/fiscais/nfse-leiaute.ts` | Seleção de versão por ambiente e limites dos recursos NT 009 confirmados. |
| `src/lib/services/fiscais/nfse-service.ts` | Consulta de cadastro com timeout e sem dados sensíveis no retorno; validação antes do POST e tipo de bens móveis. |
| `src/lib/services/fiscais/nfse-transport.ts` | Conferência prévia do destino em novas DPS e reenvios com snapshot conhecido. |
| `src/app/api/nfse/de-os/[id]/route.ts` | Confere antes da reserva, grava destino/competência e aplica fuso da empresa no transporte. |
| `src/app/api/nfse/[id]/reemitir/route.ts` | Competência original e preservação de resultado incerto; utiliza snapshot e fuso. |
| `src/app/api/nfse/contexto-emissao/[id]/route.ts` | Expõe versão aplicável à revisão. |
| `src/app/api/nfse/servicos-de-os/[id]/route.ts` | Usa fuso da empresa na mesma política da revisão/emissão. |
| `src/lib/services/fiscais/nfse-politica.test.ts`, `nfse-lucena.test.ts` | Atualiza expectativas municipais obsoletas de novembro. |
| `src/lib/services/fiscais/nfse-transicao-2026.test.ts` | Matriz municipal/regime/transição; reenvio retroativo; destino, falhas de rede/permissão sem POST; seleção de leiaute. |
| `src/services/fiscal/nfseLucena.test.ts`, `nfseTransporte.test.ts`, `nfseSelecaoAgrupada.test.ts`, `nfsePadraoEmissao.test.ts` | Mocks distinguem a consulta de cadastro do envio fiscal, com habilitação coerente por ambiente/destino. |
| `src/services/fiscal/nfseTransicao2026.test.ts` | Integração da virada em Cabedelo/João Pessoa, ausência de mutações quando o cadastro diverge e dois reenvios municipais sem perder outubro. |
| `supabase/migrations/20261031140131_nfse_preservar_autorizador_emissao.sql` | Colunas nullable de autorizador (com CHECK) e competência, sem backfill ou alteração de XMLs. |

A migração foi aplicada duas vezes somente em PostgreSQL descartável em memória: preservou ambos os campos legados `null`, aceitou destino conhecido, recusou destino inválido (23514) e manteve competência 30/10 após atualizar dataemissao para novembro e reaplicar. Não foi aplicada remotamente. Antes do deploy, aplicar pelo processo autorizado e verificar permissões de consulta do token Focus. Rollback preferencial de aplicação mantém as colunas e os snapshots; a remoção estrutural comentada no SQL requer arquivamento prévio desses novos snapshots.

## Verificação e pendências

129 testes da biblioteca NFS-e passaram; 53 testes integrados de Lucena/transporte/seleção, 34 de padrão/reenvio e seis regressões integradas da transição passaram, com banco falso e fetch simulado. O relatório principal contém a execução global final. Não houve emissão fiscal nem homologação externa.

Antes de produção: aplicar migração, verificar configuração e permissão do token de cada empresa nos dois ambientes, revisar códigos fiscais nacionais específicos com contabilidade e homologar os destinos reais. A consulta das flags confirma o cadastro operacional da Focus, sem comprovar por si só autorização SEFIN/municipal ou ausência de corrida com alterações externas no cadastro. Campos não confirmados e a migração completa de 2027 continuam expressamente pendentes.

Nos RPS municipais legados, o snapshot congela a competência usada pela política do ERP; o transporte continua recalculando `data_emissao` como no fluxo existente. O contrato consultado não confirmou um campo independente de competência para esses RPS em Cabedelo/João Pessoa. Portanto, o teste de reenvio comprova política, endpoint e preservação local, mas não comprova a competência efetivamente assumida pelo autorizador municipal. Confirmar esse contrato e homologar o caso antes de liberar reenvios retroativos na transição; não foi inventado um atributo JSON para preencher a lacuna.
