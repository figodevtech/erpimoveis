# Correção de ofertas e saúde do agendador

1. Aplicar `20260921120000_mercadolivre_scheduler_diagnostics.sql` nos bancos ERP (demo primeiro, depois Demir/Garage). Não é migration da Central.
2. Fazer deploy do ERP. Nenhuma nova variável de ambiente ou alteração no cron é necessária.
3. Conferir o diagnóstico: a saúde consulta a última execução de cada etapa por índice; a tabela de histórico permanece com 50 registros. Falhas, etapas ausentes, presas ou realmente atrasadas continuam alertando.
4. Na próxima execução de `job=notifications`, até 30 eventos `public_offers` anteriormente ignorados por falta de processador voltam à fila. Não há nova rotina periódica. Os eventos processados não são reabertos.
5. Confirmar o resultado nos eventos. Falhas de API/permissão/banco permanecem como erro com retry; não são mascaradas. Ofertas antigas indisponíveis podem requerer investigação.

O recurso `/seller-promotions/offers/{id}?app_version=v2` identifica o anúncio. O processador confere seu vendedor, lê os preços atuais e atualiza somente o vínculo do marketplace. Não modifica `produto.precovenda`, não adere a promoções nem envia preços ao Mercado Livre. Avisos respeitam a preferência PRECO e o filtro existente de mudanças relevantes.

Referência: https://developers.mercadolivre.com.br/pt_br/gerenciar-ofertas

Testes locais cobrem parsing, erros/retry e contratos de integração/SQL. A execução da migration e o recebimento de uma oferta real precisam ser verificados no ambiente implantado.
