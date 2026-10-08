# Preparação do ciclo de vendas do site

Análise do código em 07/10/2026, abrangendo loja Demir Diesel, ERP e configuração de comissão da Central. Não constitui validação dos ambientes publicados ou das contas Asaas. Nenhuma operação financeira foi executada nesta análise.

## Modelo recomendado

Separar quatro dimensões: pagamento, atendimento do pedido, devolução física e integração. Um estorno financeiro não comprova que a mercadoria voltou. Um pedido entregue pode ter chargeback; um pedido pago pode ainda não ter sido importado.

- Pagamento: pendente, confirmado, recebido, recusado, vencido, estorno solicitado, estornado parcialmente, estornado integralmente e contestado. Preservar também o status original do provedor.
- Atendimento: aguardando pagamento, aguardando separação, separado, faturado, enviado, entregue e cancelado.
- Devolução: não solicitada, solicitada, recebida, aprovada para estoque e concluída, com quantidades por item.
- Integração: pendente, processando, sincronizado e erro, com tentativas e última mensagem.

## Cenários e lacunas

| Cenário | Comportamento observado | Preparação necessária |
| --- | --- | --- |
| Pagamento normal | Webhook consulta Asaas, registra evento, baixa estoque local e solicita importação ERP. | Testar Pix e cartão, inclusive cartão salvo, até financeiro, estoque e comissão. |
| Checkout repetido ou resposta perdida | A rota cria um pedido antes da cobrança; não há chave de idempotência no fluxo examinado. | Reutilizar tentativa/pedido por chave; conciliar cobrança criada antes de permitir nova cobrança. |
| Cobrança criada, gravação local falha | A rota retorna erro após criar a cobrança externa. | Recuperar vínculo por referência externa; tratar resultado incerto sem repetir cobrança. |
| Dois clientes compram a última unidade | Checkout consulta saldo; baixa local só ocorre ao processar pagamento. | Reserva com validade e fonte de estoque definida; se já pago e sem saldo, registrar exceção e resolver sem perder o pagamento. |
| ERP e loja vendem o mesmo produto | Existem saldos em bancos distintos e importação posterior. | Definir estoque disponível central, reserva e reconciliação entre canais; testar atualização de catálogo concorrente com baixa/importação. |
| Evento Asaas duplicado | RPC deduplica event_id e usa estoque_baixado; importação usa vínculo único. | Testar concorrência e eventos diferentes para o mesmo pagamento. |
| Eventos atrasados | Webhook relê situação atual na API. | Restringir transições para impedir reabertura indevida de pedido terminal; guardar histórico. |
| ERP indisponível | Loja atualiza pagamento e responde 502 quando entrega ao ERP falha. | Fila persistente de entrega, retentativas e conciliação agendada independente do navegador. |
| Recuperação de pedidos perdidos | Busca geral retorna até 100 pagos, ordenados pelos mais antigos; webhook busca pedido específico. | Paginação/cursor e varredura completa; testar mais de 100 pedidos. |
| Falha ao consultar um estorno pendente | Consultas de estornos antecedem a importação e podem interromper toda a sincronização. | Isolar falha por pedido e continuar importando outros. |
| Cancelar antes do pagamento | ERP importa apenas pagos; ação implementada é cancelar e estornar venda paga. | Fluxo próprio para cobrança pendente, expiração e pagamento tardio após cancelamento. |
| Estorno integral antes do envio | Confirmação REFUNDED cancela e devolve estoque, com proteções contra exclusão. | Preservar lançamento financeiro original, registrar reversão e distinguir saldo/taxas/comissão. |
| Estorno após envio/entrega | Rotina atual devolve estoque ao confirmar estorno, sem exigir recebimento físico. | Não repor automaticamente; abrir devolução e conferir itens recebidos e condição. |
| Chargeback | Webhook trata CHARGEBACK_REQUESTED e CHARGEBACK_DISPUTE como CANCELADO; RPC local repõe estoque. ERP só cancela por REFUNDED. | Estado de contestação separado, alerta e bloqueios; não repor estoque por evento financeiro. |
| Estorno parcial | Tratamento automático examinado reconhece REFUNDED como conclusão integral. | Valores acumulados, saldo restante e itens/quantidades devolvidos; impedir cancelamento integral por estorno parcial. |
| Boleto | Checkout aceita boleto; estorno automático examinado aceita Pix/cartão. | Fluxo específico ou bloqueio claro com orientação operacional; validar dados necessários no provedor. |
| NF-e autorizada ou processamento fiscal | Cancelamento ERP possui bloqueio para esses estados. | Coordenar cancelamento fiscal/devolução e registrar exceções financeiras externas. |
| Central indisponível | Configuração de pagamento usa cópia local; ausência de configuração usa padrão sem comissão. | Validade/revisão da configuração e política explícita para impedir cobrança sem comissão obrigatória. |
| Comissão criada mas não recebida | Checkout guarda percentual, wallet e revisão enviados; isso não comprova recebimento. | Conciliar split real por pagamento e mostrar previsto, confirmado, recebido, revertido ou erro. |
| Notificação falha | Importação tenta notificações com deduplicação; exceção é registrada em log. | Retentativa persistente e monitoramento; Site/ML têm preferências independentes na migration nova. |

## Ordem de implementação

1. **Integridade financeira e física:** separar chargeback, estorno e devolução; bloquear reposição de itens enviados sem conferência; definir regras de comissão obrigatória e resultado financeiro incerto.
2. **Entrega confiável:** fila persistente, isolamento por pedido, paginação e conciliação agendada; expor erros e tentativas.
3. **Concorrência:** idempotência do checkout, recuperação de cobranças órfãs, reserva e reconciliação de estoque entre canais.
4. **Operação:** cancelamento de pendentes, estorno parcial, devolução por item, fluxo fiscal e financeiro auditável.
5. **Visibilidade:** detalhes do pagamento, comissão, taxas, estorno, entrega e histórico de eventos no ERP.

## Decisões propostas para os sistemas

- Estoque volta automaticamente apenas quando não houve saída física; após envio, somente após recebimento e aprovação da devolução.
- Chargeback gera contestação, não cancelamento logístico automático.
- Estorno solicitado ainda não cancela definitivamente a venda nem confirma devolução.
- Venda paga não é excluída: manter histórico e reversões auditáveis.
- Se a comissão for obrigatória, configuração ausente/inválida impede nova cobrança, com mensagem clara e alerta administrativo.
- Navegador atualiza a interface; processamento e recuperação devem continuar no servidor com ERP fechado.
- Taxas e valores de comissão devem ser conciliados pelos valores efetivos do provedor, sem presumir devolução.

## Validação mínima antes de produção

Executar cenários controlados: pagamento Pix/cartão; tentativa repetida; timeout após criação; disputa da última unidade; webhook duplicado/fora de ordem; ERP fora do ar; mais de 100 pedidos; falha em um estorno sem bloquear outro pedido; cancelamento pendente seguido de pagamento tardio; estorno integral antes/depois do envio; devolução parcial; chargeback; NF-e autorizada; Central indisponível; comissão ausente; falha de Telegram. Verificar saldos, movimentações, lançamentos financeiros, vínculos e ausência de operações duplicadas.

## Referências no código

- Loja: app/api/checkout/route.ts; app/api/webhooks/asaas/route.ts; app/api/integrations/erp/orders/route.ts; app/api/integrations/erp/orders/[id]/route.ts; lib/store-payment-config.ts; supabase/migrations/20260929_configure_asaas_payments.sql.
- ERP: src/lib/integrations/site-order-sync.ts; src/lib/integrations/site-refund-status.ts; src/app/api/integracoes/site/webhook/route.ts; supabase/migrations/20260930140000_site_orders_integration.sql; supabase/migrations/20261006140000_site_sale_refund_protection.sql.

Este documento prepara os ajustes; não altera regras em produção nem aplica migrations.
