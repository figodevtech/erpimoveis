# Integração Shopee — operação e publicação

## Disponibilidade no ERP

A integração permanece oculta por padrão enquanto a homologação e o Go-live estiverem pausados. O Marketplace abre diretamente no Mercado Livre e não consulta a Shopee.

Para reativar a interface em um ambiente controlado, configure no build do ERP:

```env
NEXT_PUBLIC_SHOPEE_INTEGRATION_ENABLED=true
```

Sem essa variável, ou com o valor `false`, a conexão em Configurações Gerais, o seletor de canal e as telas Shopee não são exibidos. As rotas e estruturas de banco são preservadas para retomada futura.

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
- sincronização de pedidos, preço e estoque a cada 15 minutos como fallback;
- preparação de envio por coleta, postagem ou logística não integrada, conforme os parâmetros retornados para o pedido.

## Permissões do aplicativo Shopee

No Go-live, solicite pelo menos os módulos:

- Shop / Authorization;
- Product Management;
- Media Space;
- Order Management;
- Logistics;

O módulo Customer Service / Seller Chat não deve ser solicitado: a Shopee encerrou novas solicitações para aplicativos Third-party Partner em 18/11/2024. O atendimento permanece no Seller Center.

Para as próximas etapas, também serão necessários Returns/Refunds, Payment e Push Mechanism. A permissão de PII é separada: sem a aprovação de segurança, nomes, telefone e endereço do comprador podem continuar mascarados.

## Vercel

Configure `CRON_SECRET` com uma chave aleatória de pelo menos 16 caracteres em cada projeto ERP. O `vercel.json` executa `/api/integracoes/shopee/cron` a cada 15 minutos. Essa frequência exige um plano Vercel que aceite múltiplas execuções diárias; caso contrário, use um agendador externo autenticado até concluir o Push Mechanism.

## Ordem de publicação

1. Publicar a Figo Central, pois ela contém o endpoint de upload de mídia, renovação segura de tokens e monitoramento por instalação.
2. Publicar o ERP.
3. Confirmar as variáveis de plataforma e `CRON_SECRET` no Vercel.
4. No sandbox, importar anúncios e testar publicação, edição, preço, estoque, pedidos e preparação de envio.
5. Se a Shopee retornar erro de permissão, habilitar o módulo correspondente no aplicativo ou incluí-lo na solicitação de Go-live.

## Limitações atuais

- A preparação inicial da expedição está implementada. Geração/download de etiqueta, cancelamento iniciado pelo vendedor, devoluções/reembolsos e conciliação financeira ainda precisam ser implementados e homologados por região/logística.
- O Push Mechanism ainda precisa ser cadastrado no console para atualização em tempo real; o cron diário e a sincronização manual permanecem como fallback.
- Produtos com variações podem ser vinculados por Model ID, mas criação e edição completas das grades de variações ainda não estão disponíveis na interface.
