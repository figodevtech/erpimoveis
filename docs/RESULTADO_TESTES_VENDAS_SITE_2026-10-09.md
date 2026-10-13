# Resultados dos testes de vendas do site — 09/10/2026

## Testes automatizados

Executar novamente: `node scripts/tests/run-storefront.cjs`.

O conjunto cobre regras nas rotas com serviços simulados e SQL em PGlite isolado. Não executa cobranças nem altera estoque dos bancos reais.

| Suíte | Resultado |
| --- | --- |
| Proteção de venda, itens, transações e vínculo | Passou |
| Estorno Pix/crédito, confirmação, bloqueio de boleto e repetição | Passou |
| Estoque antes/após envio, eventos duplicados e chargeback | Passou |
| Token e autorização Pix, valor, vínculo, operação antiga e duplicidade | Passou |
| Recusa e proteção contra eventos antigos | Passou |
| Nova tentativa: pagamento/data corretos, histórico e reabertura única | Passou |
| Preferências independentes Site/Mercado Livre no Telegram | Passou |
| Respostas JSON, HTML, vazias e erros HTTP | Passou |

## Consultas aos serviços em execução

- ERP local (3000) e Central local (3001): HTTP 307 na página inicial. Comprova resposta HTTP, não login ou operação completa.
- Loja local (3002): HTTP 200 na página inicial.
- Exportação local de pedidos sem token: HTTP 401.
- Exportação local com token do ERP: HTTP 200, zero pedidos pagos retornados.
- Segredos de sincronização loja/ERP configurados e iguais; nenhum segredo foi exposto no relatório.
- Configuração da Central: inicialmente HTTP 404. A variável da loja apontava para localhost:3002. Corrigida para localhost:3001 em `.env` e `.env.local` da loja.
- Consulta após correção: HTTP 200, revisão 6, comissão habilitada em 1%, wallet presente. Isso comprova configuração; não comprova split criado/recebido.
- Asaas Sandbox: consulta autenticada de pagamentos retornou HTTP 200. Nenhuma cobrança ou operação de estorno foi enviada.

## Limites e próxima etapa

- ERP local está configurado para buscar a loja publicada (`https://demirdiesel.com.br`), não a loja local. Alinhar o ambiente escolhido antes do teste integrado. Conferir também o destino do webhook loja → ERP.
- A loja em execução precisa carregar a variável corrigida; reiniciar o serviço se o ambiente não tiver sido recarregado.
- Compra completa, pagamento Pix com lastro, crédito, cartão salvo, Telegram real, envio/retirada e comissão liquidada ainda não foram validados nesta execução.
- Boleto: testado o bloqueio seguro do estorno comum; o fluxo específico de reembolso não está implementado.
- Devolução: testada a proteção do estoque após envio; recebimento físico, frete reverso e reembolso após conferência ainda não estão implementados.
- Próximo teste: pedido novo de uma unidade no Sandbox, pagamento Pix Copia e Cola conforme orientação do suporte, importação e estorno antes do envio, conferindo as duas bases e a confirmação do Asaas.

## Compra integrada autorizada — cartão de crédito Sandbox

Executada depois das verificações acima, com autorização explícita para comprar e restaurar o estoque de produção utilizado.

- Produto #853, uma unidade, R$ 20,00. Estoque inicial: ERP 9 / loja 9.
- Cliente e endereço fictícios exclusivos do teste. A primeira tentativa (#22) foi rejeitada pelo Asaas por telefone fictício inválido; não criou cobrança nem movimentou estoque. Foi encerrada antes da nova tentativa.
- Checkout efetivo: pedido #23 criado pela rota `/api/checkout` da loja local, autenticado como cliente de teste. Comissão persistida: 1%, com wallet configurada.
- Pagamento `pay_5jb5x6er3hx36cye` processado com cartão fictício no Asaas Sandbox pelo endpoint `payWithCreditCard`. Nenhum cartão real utilizado.
- Asaas confirmou o pagamento. O webhook publicado processou `PAYMENT_CONFIRMED`, a loja ficou PAGO e o ERP importou a venda #233. Estoque: ERP 8 / loja 8.
- Split real da cobrança: percentual 1%, valor R$ 0,19, status AWAITING_CREDIT. Não foi validado recebimento pela Figo; o pagamento foi estornado antes do crédito.
- Reembolso solicitado pela rota local da integração `/api/integrations/erp/orders/23`, com autenticação do ERP. Não houve clique na interface do ERP nesta execução.
- Asaas confirmou REFUNDED e reembolso DONE de R$ 20,00. O evento PAYMENT_REFUNDED foi processado. Split passou a CANCELLED.
- Loja: CANCELADO, estoque_baixado=false. ERP: venda #233 CANCELADA, vínculo com refund_status=REFUNDED.
- Chamada repetida pela rota de estorno não gerou reposição adicional.
- Verificação final: **ERP 9 / loja 9**, iguais ao início. Nenhum ajuste direto do saldo do produto foi necessário.
- Foram encontrados 43 registros de notificação no ERP para o evento do pedido. Entrega no Telegram não foi conferida nesta execução.

O histórico cancelado foi preservado para auditoria. Este teste comprova o ciclo financeiro/integrado de cartão antes do envio, não o fluxo visual no navegador, Pix, boleto, retirada, envio ou devolução física.

O script `scripts/tests/sandbox-purchase.mjs` executa operações reais no ambiente Sandbox e usa as bases de estoque configuradas. Não faz parte das suítes isoladas. Seu estado de execução fica em `node_modules/.cache/order-cleanup/`, fora do versionamento, e impede criar o mesmo checkout novamente nesta execução.

## Continuação — cartão salvo, retirada, boleto e Pix

### Cartão salvo e retirada: pedido #24

- Cartão fictício salvo pela API de conta da loja e confirmado na listagem, final 4444. Token não exposto.
- Checkout com cartão salvo e opção pickup, sem processamento externo adicional pelo script. Asaas confirmou o pagamento automaticamente.
- Pedido #24, pagamento `pay_lynbkv2h18yvtvpw`, venda ERP #234, uma unidade de R$ 20,00.
- Pela rota da integração na loja, simuladas etapas ENVIADO (pronto para retirada) e ENTREGUE (retirado). O pedido manteve somente a baixa original; o estorno comum após a etapa de saída retornou 409.
- Nenhuma mercadoria foi retirada de fato. O script restaurou somente o snapshot logístico desse pedido identificado como teste antes de solicitar o reembolso, para encerrar a simulação sem modificar as regras gerais de devolução.
- Reembolso efetivo: REFUNDED / DONE. ERP e loja cancelados, estoque final 9 / 9.
- Primeira conferência final ocorreu antes do processamento assíncrono do ERP; após o webhook concluir, a conferência passou. Isso evidencia a necessidade de aguardar ambos os sistemas.
- Não valida a interação visual no ERP nem o registro de recebimento de devolução física.

### Boleto: pedido #26

- Emitido boleto Sandbox `pay_rnl72csxde1en5y6`, R$ 20,00, com split configurado.
- Enquanto PENDING, loja PENDENTE, estoque_baixado=false, sem venda paga importada. Estoques 9 / 9.
- Solicitação de estorno pela rota comum retornou 409, como previsto para boleto ainda não suportado pelo fluxo.
- Cobrança não paga removida no Sandbox e pedido encerrado como CANCELADO, sem reposição nem reembolso fictício.
- Pagamento de boleto e reembolso pelo endpoint específico continuam pendentes de implementação/validação. Este cenário não comprova reembolso de boleto pago.

### Pix: pedido #25 — pagamento e estorno concluídos

- Cobrança Sandbox `pay_fe5cqifhkgvuxix0`, R$ 20,00, gerada pelo checkout com comissão de 1%.
- Fatura: https://sandbox.asaas.com/i/fe5cqifhkgvuxix0.
- Pix Copia e Cola obtido da API oficial e entregue para pagamento no painel Sandbox da Demir, conforme instrução do suporte. Não usar o botão de confirmação direta.
- A rota externa de autorização implementada aceita PIX_REFUND; ela recusa PIX_QR_CODE. Por isso o pagamento pela API não foi tentado nem foram afrouxadas as regras de segurança para viabilizar o teste.
- Após o pagamento manual, conferir importação e baixa única, executar estorno Pix e aguardar DONE/REFUNDED e reposição nas duas bases.

#### Resultado após pagamento manual

- Comprovante enviado pelo usuário: `Comprovante_-_3570144.pdf`, pagamento de R$ 20,00 em 09/10/2026 às 12:22:53 (Brasília), cliente devedor fictício do teste. Leitura do documento não substituiu a consulta oficial ao Asaas.
- Consulta Asaas: pagamento RECEIVED, split 1% de R$ 0,19 com status DONE. Evento PAYMENT_SPLIT_DONE processado pela loja. Isso comprova o processamento do split no provedor, além da configuração enviada.
- Pedido PAGO, venda #235 importada no ERP, estoques 8 / 8 após uma unidade vendida.
- Solicitação única de estorno enviada pela rota da integração da loja. Inicialmente retornou pendente; nenhuma reposição antecipada foi feita.
- Autorização externa registrada às 12:23:59 (Brasília), valor R$ 20,00; sem recusa. Transação de devolução Pix consultada na API com status DONE.
- PAYMENT_REFUNDED recebido e processado. Conferência final confirmou REFUNDED / DONE, pedido CANCELADO, estoque_baixado=false, venda #235 CANCELADA.
- **Estoques finais: loja 9 / ERP 9**, iguais ao início. A reposição foi feita pelo fluxo normal, sem ajuste direto do saldo.
- Notificações do ERP registradas para o pedido. Entrega visual no Telegram continua sem conferência.

O procedimento de pagamento Pix Copia e Cola orientado pelo suporte viabilizou o reembolso, ao contrário das confirmações simuladas usadas no pedido antigo #21.

## Continuação — envio com rastreio e Telegram

- Novo pedido de entrega #27, R$ 20,00, uma unidade do produto #853. Cartão fictício salvo, pagamento `pay_1l2erq8l1u8oncvw`; importado como venda #236.
- Estoques iniciais 9 / 9, após pagamento 8 / 8.
- Na API da loja foram registrados envio com transportadora/rastreio fictícios e depois entrega. Os dados de rastreio foram conferidos no banco. Não houve envio de mercadoria nem contato com transportadora.
- Solicitações comuns de reembolso em ENVIADO e ENTREGUE retornaram bloqueio 409. Andamento não baixou estoque novamente.
- Restaurado exclusivamente o snapshot logístico do pedido de teste, já que não houve movimentação física; então solicitado o reembolso para encerrar o teste. Não foi simulado recebimento físico de devolução por uma funcionalidade inexistente.
- Conferência final: pagamento REFUNDED, reembolso DONE, loja CANCELADO, venda #236 CANCELADA. **Estoques ERP 9 / loja 9**, iguais ao início.
- Nova suíte `site-fulfillment.cjs`: passou validação de autorização do ERP, status inválido, pedido não importado, bloqueio durante estorno, exigência de rastreio/transportadora, NF-e para faturamento, conversão de status para envio/retirada/entrega e retorno de erro da loja. Usa dependências simuladas, sem mudanças no banco real.
- Observação da rota ERP: atualização local antecede a chamada da loja. O teste de erro comprova propagação do erro, não atomicidade entre as duas bases. Recuperação/reconciliação de falhas ainda precisa de melhoria.
- Telegram: nos pedidos #23, #24 e #25, cada evento teve 43 notificações no ERP, uma entrega Telegram registrada como enviada, uma tentativa e zero erros. Isso comprova sucesso registrado pelo envio; leitura pelo destinatário não foi comprovada.

O conjunto isolado passa a ter nove suítes. Interação visual autenticada no ERP, reembolso de boleto pago, devolução física/frete reverso e reembolso parcial continuam sem validação completa.

Envio completo com rastreio e devolução física com reembolso após conferência ainda não foram validados em um pedido integrado nesta continuação.

## Continuação — falhas de integração e integridade do estoque

- `site-payment-webhook.cjs`: rejeição de token ausente/incorreto e evento incompleto antes de consultar pagamento; evento antigo de confirmação usa REFUNDED consultado no provedor; falha simulada do ERP retorna 502 e reenvio duplicado tenta entregar novamente; chargeback não dispara o fluxo comum de cancelamento; referência externa inválida é ignorada; falha transacional não entrega ao ERP.
- `site-stock-transaction.cjs`: falta de estoque no segundo item desfaz a baixa do primeiro e o registro do evento; eventos distintos de pagamento não baixam duas vezes; eventos distintos de reembolso não repõem duas vezes; evento PENDING atrasado preserva PAGO/CANCELADO.
- Testes realizados com serviços simulados e PostgreSQL isolado em memória. Não comprovam concorrência entre bancos reais, fila persistente, disponibilidade do ambiente publicado nem comportamento completo de chargeback/reembolso parcial.
- Nenhuma compra adicional, cobrança externa ou alteração no estoque real nesta etapa. O último saldo real conferido permanece 9 / 9, conforme o encerramento do pedido #27.
- O conjunto automatizado passa a conter onze suítes. Boleto pago com reembolso, débito (não identificado como modalidade do checkout atual), recebimento físico da devolução/frete reverso e reembolso parcial permanecem sem teste completo; não foram simulados como funcionalidades concluídas.

## Notificações detalhadas do Site

- Mensagens novas passam a incluir cliente, telefone, modalidade de entrega, endereço de envio (com complemento e CEP) ou local de retirada, valor, pagamento, produtos, referências e quantidades.
- Preservados title/reference dos itens retornados pela loja, antes descartados pela validação do ERP. Produto sem título usa seu identificador.
- Cabeçalho Telegram distingue Site de Mercado Livre pelo identificador do evento; conteúdo continua escapado como HTML. Pedidos grandes mostram itens que cabem no limite de 1000 caracteres e orientam consultar os demais no ERP.
- Suíte nova verifica dados de envio/retirada, acentos, produtos/quantidades, fallback, limite, escape HTML e identificação do canal. Envio Telegram simulado: nenhuma mensagem de teste externa enviada nesta etapa.
- Mudança depende de publicação do ERP e vale para notificações novas; deduplicação não reenvia notificações antigas já entregues.
- Pendências de validação completa: boleto pago/reembolso, devolução recebida/conferida/frete reverso, estorno parcial, débito se disponibilizado no checkout, fluxo visual autenticado, concorrência real da última unidade, recuperação de falhas entre bancos e paginação acima de 100 pedidos. Não executar esses cenários com estoque real sem implementação e isolamento adequados.

## Continuação — importação e recuperação de notificações

- Nova suíte `site-order-sync.cjs`, com dependências simuladas: erro de importação em um pedido registra ERRO e permite importar o próximo; falha de notificação não desfaz importação; nova sincronização de pedido existente tenta notificar novamente com a mesma chave de evento. A deduplicação real do banco não é comprovada por esse mock.
- Confirmado que nomes/referências dos itens chegam à mensagem; respostas HTTP de erro e pedidos inválidos impedem a importação.
- **Lacuna reproduzida, ainda não corrigida:** uma consulta de estorno que falha aborta a sincronização geral antes de buscar pedidos novos. Webhook direcionado a um pedido ignora essa varredura e segue normalmente.
- A suíte verifica explicitamente o comportamento problemático atual; passar no teste não significa que a lacuna foi resolvida. Conjunto agora com treze suítes.
- Nenhum pedido novo, envio Telegram externo ou alteração nas bases reais nesta continuação.

## Correção da consulta de estornos e compra #28

- Corrigido `syncSiteOrders`: exceção ao reconciliar um estorno é isolada por pedido, registrada em log e retornada em `refundErrors`; os outros estornos e a busca/importação seguem. Falha ao obter a própria lista de estornos continua sendo erro da consulta ao banco. A correção não transforma erro em confirmação de reembolso.
- Regressão atualizada: consulta de estorno #99 falha, mas pedido #2 continua sendo processado. Treze suítes passaram; ESLint do arquivo alterado passou.
- Nova compra Sandbox com cartão fictício salvo: pedido #28, pagamento `pay_xxzq3jefctvtje6r`, R$ 20,00, uma unidade do produto #853. Importado como venda #237; CONFIRMED, split 1% de R$ 0,19 AWAITING_CREDIT; estoques 9 / 9 → 8 / 8.
- Estorno solicitado pela API da loja antes do envio. Conferência final oficial: REFUNDED com reembolso DONE; loja CANCELADO, venda #237 CANCELADA; estoques **loja 9 / ERP 9**, iguais ao início. Eventos de criação, confirmação e estorno registrados; 43 notificações ERP.
- Primeira tentativa não alcançou checkout por falha de rede na autenticação; nova execução com acesso de rede completou a compra. Não houve segunda cobrança criada nessa falha.
- Compra comprova fluxo integrado Sandbox existente; aplicação publicada não foi atualizada pelo agente. Correção de sincronização e novo texto Telegram dependem de publicação do ERP. Este teste não comprova que a correção já opera no ERP publicado.

## Implementação — boleto pago e devolução integral

- Loja: boleto pago usa `/payments/{id}/bankSlip/refund`, com claim contra duplicidade e persistência do `requestUrl` HTTPS validado. Retorno do link significa AWAITING_CUSTOMER, sem cancelamento nem reposição antecipada. Boleto não pago é rejeitado. Timeout/resultado incerto preserva a claim.
- ERP: guarda e mostra o formulário de reembolso e permite copiar seu link para o cliente. Pagador precisa fornecer dados/documentos ao Asaas; conclusão continua dependendo da confirmação financeira oficial. Referência: https://docs.asaas.com/reference/estornar-boleto.
- Devolução integral: solicitar, registrar rastreio reverso manual, conferir todos os produtos/quantidades e condições, registrar operador/data/nota de inspeção e depois solicitar reembolso. Andamento bloqueado durante devolução. Não aceita confirmação sem solicitação anterior ou sem aprovação explícita de todos os itens.
- Estoque é reposto uma vez quando houver recebimento conferido E estorno confirmado. Mantidos timestamps e histórico de envio; não é necessário voltar artificialmente à separação. Pix após devolução passa pela mesma autorização externa, condicionada ao recebimento registrado.
- Não contempla devolução parcial/danificada, emissão automática de etiqueta reversa nem emissão de documento fiscal de devolução. Cancelamento mantém os bloqueios fiscais anteriores.
- Migrations aplicadas somente na loja e no ERP Demir: `20261009120000_returns_and_bank_slip_refund.sql` e `20261009130000_site_return_receipt.sql`. Nenhum outro banco do ERP alterado.
- Recuperada do histórico oficial a migration `20261009020312_enable_ordens_realtime.sql` que existia somente na nuvem; conteúdo original preservado no repositório. Nenhum reaplicar dessa migration ocorreu na Demir.

### Validação integrada: pedido #29

- Compra Sandbox R$ 20,00, produto #853, cartão fictício salvo, cobrança `pay_jtwu46c2pbgx9fvg`, venda ERP #238. Estoques 9 / 9 → 8 / 8.
- Simulado envio com rastreio fictício pela API da loja. Solicitação de devolução registrada; reembolso antes do recebimento foi bloqueado com 409.
- Recebimento integral aprovado pela API nova. Nenhuma mercadoria saiu fisicamente. O harness registrou a mesma conferência diretamente no vínculo ERP; essa etapa não comprova interação visual/autenticação do frontend.
- Reembolso pela API: REFUNDED / DONE. Loja restaurou estoque para 9 e manteve histórico de envio. ERP publicado ainda usa código antigo e não conciliou automaticamente a devolução; o harness validou reembolso DONE, recebimento nas duas bases e reposição da loja e chamou `cancelar_venda` oficial para concluir.
- Conferência final passou: loja CANCELADO, venda #238 CANCELADA, **estoques loja 9 / ERP 9**, iguais ao início. Nenhum ajuste direto do saldo do produto.
- Quinze suítes isoladas passaram. Novas coberturas: boleto/link/claim/pagamento pendente, permissão de devolução ERP, operador derivado da sessão, confirmação explícita, falha da loja sem marcar recebimento ERP, SQL de autorização Pix após recebimento e reposição idempotente.
- TypeScript da loja e ESLint dos arquivos alterados passaram. Typecheck completo do ERP encontrou referências ausentes anteriores em `.next-dev/types/validator.ts` (duas rotas NF-e) e `artifacts/captures/ia/central.tsx`. Não atribuídos aos arquivos desta alteração.
- Typecheck adicional de todo `src` do ERP, excluindo os arquivos gerados/capturas, passou sem erros; configuração temporária guardada no cache ignorado.
- Teste browser `scripts/tests/site-returns-ui.cjs` criado com respostas controladas para validar botões/mobile sem writes reais. Sessão salva expirou e tentativa de login da conta de captura não concluiu; **validação visual ainda pendente**. Usuário solicitado a revisar `.env.capture`; nenhuma senha exibida.
- Pagamento/reembolso de boleto de ponta a ponta com formulário do cliente não foi executado nesta etapa: não deixar estoque real debitado aguardando preenchimento manual. Implementação e testes simulados não equivalem a reembolso bancário concluído.

### Uso após publicar loja e ERP

1. Boleto pago: menu do pedido → Cancelar e estornar → motivo. Depois abrir/copiar formulário do boleto e disponibilizar ao pagador; consultar até a confirmação. Não criar segunda solicitação enquanto a primeira está pendente.
2. Pedido enviado/entregue: menu → Solicitar devolução física → motivo e rastreio opcional. Após chegada real, Conferir recebimento da devolução → conferir lista e quantidades → nota → confirmar todos os itens aprovados.
3. Recebimento conferido: Reembolsar devolução recebida. Acompanhar estorno; estoque/cancelamento só concluem após confirmação. Se houver NF-e autorizada/processando, o fluxo exige regularização fiscal e não deve ser forçado.

## Validação funcional do frontend no navegador

- Repetida a tentativa de autenticação com `.env.capture`. Não houve resposta de `/api/auth/callback/credentials`; não é possível concluir que a senha está errada. O formulário tem bloqueio de verificação Turnstile antes de enviar credenciais. Login autenticado completo continua pendente.
- Criado host isolado que compila o componente real `StorefrontOrders` e seus controles Radix/React em um servidor temporário local. Next navigation/link e diálogos fiscais externos são substituídos por adaptadores; endpoints de pedidos têm respostas controladas. Nenhum acesso aos bancos nem envio financeiro nesses testes.
- Testes passaram com viewport 390×844 e 1440×900: abrir solicitação, conferir lista e quantidade, enviar motivo, exibir ação de recebimento, bloquear confirmação sem checkbox, enviar aprovação integral, exibir ação de reembolso e formulário do boleto com URL correta.
- Depois de solicitar devolução, menu não oferece atualização de andamento nem reembolso antes do recebimento aprovado.
- Comandos: `node scripts/tests/site-returns-ui.cjs --component` e `node scripts/tests/site-returns-ui.cjs --component --desktop`.
- Esta validação comprova interação funcional do componente com o contrato da API, não autenticação/permissões reais, fluxo completo da página publicada nem layout visual com CSS da aplicação (o host isolado não carrega Tailwind). Testes de permissão/backend permanecem nas suítes separadas.
- Estoque real não alterado; último saldo integrado conferido continua loja 9 / ERP 9. Boleto pago e conclusão do formulário Asaas ainda exigem teste integrado assistido.

## Dialog de pedidos e testes fictícios adicionais

- Detalhes do pedido passa a seguir o formato do dialog de detalhes da OS: tela inteira no celular, largura ampliada no computador, cabeçalho/rodapé fixos e conteúdo rolável em blocos.
- A abertura agora tem estado separado do pedido selecionado. Fechar preserva os dados durante a animação de saída; a próxima abertura substitui os dados pelo pedido escolhido.
- Teste funcional do componente passou em celular e computador, incluindo detalhes com cliente/produtos e fechamento. O host isolado não carrega o CSS completo da aplicação; a comparação visual final permanece na página autenticada.
- Reexecutada a suíte fictícia de estorno: boleto não pago rejeitado, boleto pago gera formulário HTTPS, solicitação duplicada não cria segundo reembolso. Nenhuma cobrança, documento ou alteração de estoque real nesta etapa.
- Esses testes simulam contratos da API e interação. Não comprovam a liquidação/reembolso bancário de um boleto no Asaas; o formulário do pagador e confirmação oficial continuam pendentes.

## Acompanhamento financeiro no detalhe e boleto #30

- Detalhes reúne provedor/identificador da cobrança, situação e última consulta do estorno, formulário completo com abrir/copiar link e ações de andamento, devolução, reembolso e NF-e. Dados selecionados são atualizados quando a lista é recarregada, preservando conteúdo ao fechar.
- Teste funcional verifica formulário e estado aguardando cliente dentro do detalhe, consulta disponível e ausência de nova solicitação durante reembolso pendente.
- Criado pelo checkout local o pedido #30, R$ 20,00, produto #853 × 1, cobrança Sandbox `pay_jjblvp34sh4ewjle`, boleto https://sandbox.asaas.com/i/jjblvp34sh4ewjle. Split 1% configurado e pendente.
- Conferência após criação: PENDING, pedido PENDENTE, `estoque_baixado=false`, loja 9 / ERP 9, iguais ao início. Sem venda importada enquanto não pago.
- Próxima etapa manual: confirmar pagamento no painel Sandbox Asaas. Depois solicitar estorno pela integração e fornecer o `requestUrl` real ao pagador. Ainda não há formulário real deste pedido, pagamento confirmado ou reembolso concluído. Não alterar status/estoque diretamente para simular conclusão.

### Continuação #30 — confirmação oficial por API e formulário verdadeiro

- Corrigida a orientação anterior sobre confirmação manual: existe `POST /v3/sandbox/payment/{id}/confirm`. A referência específica e o changelog documentam uso em contas Sandbox; a página geral em inglês contém informação conflitante. Referência: https://docs.asaas.com/reference/confirmar-pagamento.
- Executada a confirmação autorizada para `pay_jjblvp34sh4ewjle`, após validar Sandbox, ID, referência #30, método BOLETO, valor R$ 20 e estado PENDING. Retorno RECEIVED.
- Webhook/importação ocorreram: loja PAGO, venda ERP #239; estoque 9 / 9 → 8 / 8; split de 1%, R$ 0,19, DONE.
- Estorno solicitado pela API local da loja: REFUND_REQUESTED / AWAITING_CUSTOMER. Formulário verdadeiro: https://sandbox.asaas.com/000/solicitar-estorno/y9we5cgsjp1rccm9.
- Harness espelhou no vínculo ERP #30 somente os metadados da solicitação comprovados pela API oficial e claim da loja, com binding de pagamento/venda; não alterou estado da venda ou estoque. Não comprova solicitação pela UI autenticada.
- **Teste aberto:** pagador precisa concluir o formulário; reembolso ainda não confirmado. Estoque permanece 8 / 8, uma unidade abaixo do saldo inicial em cada base. Reposição deve ser conferida ao final; não foi realizada antecipadamente e não se declara estoque restaurado.

### Organização do Marketplace e detalhes

- Filtros de número/situação movidos para sheet; botão com contador de filtros ativos alinhado às tabs de Produtos/Pedidos, inclusive com disposição lateral em celular. Limpar filtros restaura a primeira página.
- Ações do dropdown dos pedidos receberam ícones, incluindo consulta, estorno, devolução e formulário do boleto.
- Detalhe sem altura fixa de tela inteira, limitado a 90dvh com rolagem quando necessário. Abas Resumo, Entrega, Pagamento e Histórico exibem apenas o conteúdo selecionado; conteúdo é preservado durante o fechamento.
- Resposta scoped da API passa a fornecer forma de pagamento, subtotal, contato importado e valores/referência dos itens. Detalhe apresenta documento, e-mail, telefone, endereço/complemento/CEP, transportadora, rastreios, NF-e, link do boleto e nota de conferência quando disponíveis; dados ausentes não são inventados.
- Testes funcionais isolados passaram em celular/computador para sheet/pesquisa, troca de abas, fechamento, reembolso e formulário. Host não carrega o Tailwind completo; validação visual final no ERP autenticado ainda não foi realizada.
- Nenhuma cobrança ou movimentação de estoque nesta alteração de interface.
