# Integrações de marketplace

## Mercado Livre

O ERP suporta OAuth, criação e edição de anúncios, preço/estoque, importação de pedidos, Mercado Envios, etiqueta, NF-e, mensagens, perguntas, reclamações e devoluções.

Variáveis obrigatórias:

```env
MERCADOLIVRE_CLIENT_ID=
MERCADOLIVRE_CLIENT_SECRET=
MERCADOLIVRE_REDIRECT_URI=https://SEU_DOMINIO/api/integracoes/mercadolivre/callback
MERCADOLIVRE_SITE_ID=MLB
MERCADOLIVRE_STATE_SECRET=
CRON_SECRET=
```

No painel do Mercado Livre, habilite leitura/escrita e configure notificações em:

```text
https://SEU_DOMINIO/api/integracoes/mercadolivre/webhook
```

Os tópicos mínimos são `orders_v2`, `items` e `shipments`. Para toda a operação do ERP, habilite também mensagens, perguntas, reclamações/devoluções e invoices disponíveis para o aplicativo.

O agendador deve chamar, com `Authorization: Bearer CRON_SECRET`:

```text
GET https://SEU_DOMINIO/api/integracoes/mercadolivre/cron
```

## Shopee

A integração utiliza a Figo Central como gateway. Partner Key, access token e refresh token não são instalados nos ERPs dos clientes.

Fluxo:

```text
ERP do cliente → central.figosoftwares.com.br → Shopee Open Platform
```

Cada ERP precisa somente das credenciais de instalação já utilizadas pelo módulo financeiro:

```env
PLATFORM_API_URL=https://central.figosoftwares.com.br
PLATFORM_INSTALLATION_ID=
PLATFORM_API_SECRET=
APP_URL=https://DOMINIO_DO_ERP
SHOPEE_CRON_SECRET=
```

A Central guarda as credenciais Shopee:

```env
SHOPEE_PARTNER_ID=
SHOPEE_PARTNER_KEY=
SHOPEE_BASE_URL=https://openplatform.sandbox.test-stable.shopee.sg
SHOPEE_REDIRECT_URI=https://central.figosoftwares.com.br/api/integracoes/shopee/callback
SHOPEE_TOKEN_ENCRYPTION_KEY=
```

No aplicativo de teste da Shopee, cadastre `central.figosoftwares.com.br` como domínio de redirecionamento.

### Ativação

1. Rotacionar a Partner Key de teste e configurá-la somente na Central/Vercel.
2. Gerar `SHOPEE_TOKEN_ENCRYPTION_KEY` com 32 bytes em base64.
3. Aplicar `20260804210000_create_shopee_gateway.sql` no Supabase da Central.
4. Aplicar `20260804180000_add_shopee_integration.sql` nos bancos dos ERPs.
5. Publicar a Central e depois os ERPs.
6. Abrir **Configurações Gerais > Integrações de marketplace > Shopee** e conectar a loja.
7. Em **Marketplace > Shopee > Catálogo**, vincular Item ID/Model ID aos produtos locais.
8. Fazer uma sincronização controlada de pedidos antes de ativar o agendador.

O gateway renova o token e assina as chamadas com HMAC-SHA256. Os pedidos, vínculos e vendas permanecem no banco de cada ERP.

O agendador de cada ERP chama:

```text
GET https://SEU_DOMINIO/api/integracoes/shopee/cron
```

Publicação e edição de anúncios dependem dos escopos de produtos, categorias/atributos, mídia e logística aprovados pela Shopee. A etapa atual cobre conexão, metadados da loja, vínculos e importação de pedidos.
