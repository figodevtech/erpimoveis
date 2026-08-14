# Integração Shopee — operação e publicação

## Arquitetura

- A Figo Central mantém Partner ID, Partner Key e tokens das lojas.
- Cada implantação do ERP acessa a Central com `PLATFORM_API_URL`, `PLATFORM_INSTALLATION_ID` e `PLATFORM_API_SECRET`.
- Imagens públicas do ERP são baixadas pelo ERP e enviadas à Shopee pela Central; a chave da Shopee não é exposta ao cliente.

## Recursos implementados

- autorização e renovação automática de tokens;
- importação idempotente de pedidos;
- importação de anúncios e vínculo automático por SKU quando possível;
- vínculo manual por Item ID e Model ID;
- publicação de produto com imagens, categoria, preço, estoque, pacote e logística;
- edição de título, descrição e SKU;
- atualização de preço e estoque;
- ativação e pausa de anúncio;
- sincronização diária de pedidos, preço e estoque como fallback;
- lista de conversas, histórico, leitura e resposta de mensagens do comprador.

## Permissões do aplicativo Shopee

No Go-live, solicite pelo menos os módulos:

- Shop / Authorization;
- Product Management;
- Media Space;
- Order Management;
- Logistics;
- Customer Service / Seller Chat.

Para as próximas etapas, também serão necessários Returns/Refunds, Payment e Push Mechanism. A permissão de PII é separada: sem a aprovação de segurança, nomes, telefone e endereço do comprador podem continuar mascarados.

## Vercel

Configure `CRON_SECRET` com uma chave aleatória de pelo menos 16 caracteres em cada projeto ERP. O `vercel.json` executa `/api/integracoes/shopee/cron` diariamente às 03:00 UTC, compatível com o plano Hobby. Para intervalos menores, use Vercel Pro ou configure o Push Mechanism da Shopee.

## Ordem de publicação

1. Publicar a Figo Central, pois ela contém o novo endpoint de upload de mídia e a liberação do Seller Chat no proxy.
2. Publicar o ERP.
3. Confirmar as variáveis de plataforma e `CRON_SECRET` no Vercel.
4. No sandbox, importar anúncios e testar publicação, edição, preço, estoque e mensagens.
5. Se a Shopee retornar erro de permissão, habilitar o módulo correspondente no aplicativo ou incluí-lo na solicitação de Go-live.

## Limitações atuais

- O fluxo completo de expedição, geração de etiqueta, cancelamento iniciado pelo vendedor, devoluções/reembolsos e conciliação financeira ainda precisa ser implementado e homologado por região/logística.
- O Push Mechanism ainda precisa ser cadastrado no console para atualização em tempo real; o cron diário e a sincronização manual permanecem como fallback.
- Produtos com variações podem ser vinculados por Model ID, mas criação e edição completas das grades de variações ainda não estão disponíveis na interface.
