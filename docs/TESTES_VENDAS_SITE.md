# Vendas do site: estado e testes

Revisão do código em 09/10/2026. Testes automatizados não comprovam a configuração dos ambientes publicados nem a liquidação no Asaas.

## O que está implementado para testar

- Checkout Asaas e envio de split quando a configuração obtida da Central habilita a comissão.
- Webhook com autenticação, consulta do pagamento no Asaas e processamento com deduplicação.
- Importação do pedido pago no ERP, estoque e notificações no ERP/Telegram, com preferência independente para o Site.
- Atualização de andamento, rastreio e acesso à operação fiscal.
- Solicitação e consulta de estorno integral de Pix/cartão antes do envio.
- Autorização externa de estorno Pix vinculada à solicitação registrada, com validação de pagamento, valor e pedido.
- Registro de recusa e nova tentativa controlada; bloqueio das ações de andamento durante solicitação de estorno.
- Confirmação do estorno para cancelar e repor estoque antes do envio. Após envio, proteção contra reposição financeira automática.

## Sequência recomendada no Sandbox

1. Confirmar variáveis, segredos, migrations e URLs nos ambientes realmente usados. Asaas deve alcançar o endpoint público HTTPS da loja; a loja deve alcançar o ERP.
2. Fazer um novo pedido Pix. Conforme orientação recebida do suporte Asaas, pagar o próprio código em Pix > Transferências > Pix Copia e Cola, com saldo Sandbox e chave Pix cadastrada. Não usar a confirmação direta do painel/API para este teste de estorno.
3. Conferir pagamento, importação única, quantidade baixada nos dois sistemas, financeiro e notificações. Testar com a tela do ERP fechada também.
4. Antes de enviar, solicitar estorno pelo ERP. Conferir autorização APPROVED, estorno DONE/pagamento REFUNDED, cancelamento e reposição de uma única vez.
5. Reenviar o evento para confirmar que não há nova baixa ou reposição. Testar recusa e nova tentativa sem duplicar a operação.
6. Repetir o fluxo com cartão Sandbox, incluindo cartão salvo. Confirmar o reembolso no provedor, não apenas a solicitação aceita.
7. Criar um novo pagamento com comissão habilitada: conferir split real na cobrança, wallet Sandbox da Figo e recebimento no provedor. Percentual salvo no pedido não comprova liquidação do split.
8. Testar separação, envio, entrega/retirada e os bloqueios de cancelamento após envio, incluindo NF-e autorizada.

## Pendências para completar a operação

- Comissão Figo: o código envia split, mas a configuração Central → loja e a liquidação efetiva ainda precisam de validação; testes anteriores tiveram comissão zero.
- Devolução física completa: solicitação, frete reverso, recebimento/conferência por item e disparo de reembolso conforme a política definida. O bloqueio após envio não substitui esse fluxo.
- Estorno parcial e tratamento de outros meios, como boleto: a rota atual de estorno automático aceita Pix/cartão.
- Fila persistente para entrega ao ERP, retentativas e conciliação agendada. O webhook funciona com o navegador fechado, mas ainda aguarda a chamada ao ERP e pode falhar quando ele estiver indisponível.
- Varredura de recuperação paginada além dos 100 pedidos e isolamento de falhas nas consultas de estorno.
- Idempotência do checkout, recuperação de cobrança criada com gravação local falha, reserva e concorrência de estoque entre ERP e loja.
- Política para configuração da Central indisponível: o fallback local pode operar sem comissão se não houver configuração válida.
- Conciliação de taxas/comissão, reversões financeiras e casos de contestação fiscal/chargeback.

Os pedidos antigos encerrados manualmente no Sandbox não são evidência de reembolso concluído. Usar novos pedidos para validar o ciclo completo.
