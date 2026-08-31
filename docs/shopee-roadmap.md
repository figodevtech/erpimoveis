# Levantamento funcional — integração Shopee

Este documento compara o que já existe no ERPOficina com o conjunto necessário para operar uma loja Shopee sem depender do Seller Center nas rotinas diárias.

> A disponibilidade exata de endpoints, eventos e dados depende da região da loja, categoria do aplicativo, módulos aprovados e permissões concedidas no Go-live.

## Situação atual

### Implementado

- autorização da loja pelo gateway da Figo Central;
- armazenamento criptografado e renovação de tokens;
- suporte a múltiplos domínios de ERP por instalação;
- importação idempotente de pedidos e criação de venda no ERP;
- painel de pedidos e sincronização manual/agendada;
- importação de anúncios e vínculo automático por SKU;
- vínculo manual por Item ID e Model ID;
- publicação de anúncio simples com imagens, preço, estoque, dimensões e logística;
- consulta dinâmica de categorias e atributos obrigatórios/opcionais;
- edição de título, descrição e SKU;
- atualização de preço e estoque, pausa e reativação;
- preparação de envio por coleta, postagem ou logística não integrada, conforme os parâmetros do pedido;
- consulta inicial de métricas de anúncios, quando autorizada;
- fallback a cada 15 minutos por cron para pedidos, preço e estoque.

### Parcial

- anúncios com variação: é possível armazenar Model ID, mas ainda falta criar e editar grades completas;
- desempenho: depende dos dados e permissões retornados pela Shopee e ainda não possui séries históricas;
- sincronização de pedidos: funciona por consulta, mas ainda não recebe eventos em tempo real;
- atributos: campos simples, listas e unidades estão cobertos; seleções múltiplas e regras condicionais precisam de homologação por categoria;
- atendimento: a Chat API não está disponível para novos aplicativos Third-party Partner desde 18/11/2024; o atendimento Shopee permanece no Seller Center.

## Backlog recomendado

### P0 — necessário antes de operar lojas reais

1. **Push Mechanism / webhooks**
   - endpoint público centralizado;
   - validação da origem e assinatura;
   - roteamento por Shop ID para a instalação correta;
   - eventos de pedido, envio, cancelamento, produto, devolução e mensagens;
   - idempotência, fila, retentativas e histórico de falhas;
   - cron mantido como reconciliação de segurança.

2. **Expedição Shopee**
   - consultar parâmetros de envio disponíveis;
   - organizar coleta ou postagem;
   - marcar pedido para envio;
   - obter transportadora e rastreamento;
   - gerar, baixar e imprimir etiqueta/documento de postagem;
   - exibir prazos e alertas de atraso no ERP.

3. **Ciclo completo do pedido**
   - sincronização incremental por `update_time`;
   - todos os estados e transições;
   - itens, variações, descontos, frete, taxas e vouchers;
   - cancelamento pelo vendedor com motivos permitidos;
   - atualização segura da venda local quando o pedido mudar;
   - política clara para reserva e devolução de estoque.

4. **Publicação homologada por categoria**
   - árvore pesquisável de categorias e breadcrumb;
   - marcas da categoria e opção “Sem marca” válida;
   - validações de tamanho, formato, quantidade e dependências entre atributos;
   - seleções múltiplas e atributos quantitativos;
   - variações/modelos, SKUs, preço e estoque por variação;
   - validação de imagens e vídeos;
   - mensagens de erro associadas ao campo recusado pela Shopee;
   - pré-visualização e confirmação antes de publicar.

5. **Segurança operacional**
   - rotação e alerta de falha na renovação de token;
   - rate limiting e backoff para limites da Shopee;
   - auditoria de publicação, preço, estoque e ações de pedido;
   - monitoramento por loja e alertas de sincronização;
   - testes de isolamento entre empresas/instalações.

### P1 — operação diária completa

6. **Devoluções, reembolsos e disputas**
   - listar solicitações e evidências;
   - acompanhar motivo, prazo e status;
   - aceitar, contestar ou oferecer solução quando permitido;
   - anexar evidências;
   - registrar efeitos financeiros e de estoque no ERP.

7. **Conciliação financeira**
   - valores a receber e liberados;
   - comissão, frete, descontos, vouchers, tarifas e ajustes;
   - conciliação pedido × venda × recebimento;
   - divergências e exportação para o financeiro/contábil.

8. **Gestão avançada de anúncios**
   - busca e paginação também nos anúncios remotos;
   - publicação em lote;
   - sincronização em lote de preço e estoque;
   - diagnóstico de anúncios banidos, suspensos ou incompletos;
   - histórico e comparação entre dado local e remoto;
   - política de margem, preço mínimo e estoque de segurança;
   - desvinculação e encerramento controlados.

9. **Atendimento completo, se a política da Shopee mudar**
   - chat unificado Shopee/Mercado Livre somente mediante permissão oficial;
   - filtros por canal, não lidas, pedido e comprador;
   - mensagens com imagem, produto e pedido quando suportadas;
   - modelos de resposta;
   - notificações em tempo real e indicador global de não lidas;
   - vínculo da conversa à venda, cliente e expedição.

### P2 — crescimento e otimização

10. **Promoções**
    - descontos da loja;
    - inclusão e remoção de itens em campanhas;
    - validação de conflito entre preço normal e promocional;
    - calendário e acompanhamento de promoções.

11. **Desempenho e inteligência**
    - séries históricas de visitas, conversão, vendas e avaliações;
    - comparação por período e por canal;
    - ruptura de estoque e perda de venda;
    - anúncios sem visualização ou baixa conversão;
    - margem líquida após taxas e frete;
    - recomendações sem alterar anúncios automaticamente.

12. **Multi-loja e governança**
    - mais de uma loja Shopee por empresa;
    - seletor de loja e consolidação de indicadores;
    - regras distintas de estoque/preço por loja;
    - permissões de usuário para publicar, cancelar, expedir e responder;
    - logs de ações por usuário.

## Ordem de execução sugerida

1. concluir publicação por categoria, variações e marcas;
2. implementar Push Mechanism com fila e reconciliação;
3. fechar expedição e etiqueta;
4. completar cancelamento e transições de pedidos;
5. devoluções/reembolsos;
6. conciliação financeira;
7. atendimento unificado;
8. promoções e inteligência de desempenho.

## Matriz mínima de homologação

- produto simples e produto com variações;
- categoria com atributo obrigatório, opcional, lista, texto, número e unidade;
- pedido pago, cancelado, enviado, entregue e devolvido;
- postagem e coleta, se ambas estiverem disponíveis na conta;
- etiqueta e rastreamento;
- alteração simultânea de estoque no ERP e na Shopee;
- token expirado e renovação automática;
- chamada duplicada de webhook;
- indisponibilidade temporária e limite de requisições;
- duas empresas distintas sem vazamento de dados;
- confirmação de que o informativo direciona o atendimento Shopee ao Seller Center.

## Referências oficiais

- API Reference: https://open.shopee.com/documents/v2/api-reference
- Returns: https://open.shopee.com/documents/v2/v2.returns.get_return_list
- Push Mechanism: https://open.shopee.com/push-mechanism/16
- Discounts: https://open.shopee.com/documents/v2/v2.discount.add_discount?module=99&type=1
