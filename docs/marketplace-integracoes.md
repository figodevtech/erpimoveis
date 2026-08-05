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

No painel do aplicativo do Mercado Livre, habilite leitura e escrita e configure a URL de notificações como:

```text
https://SEU_DOMINIO/api/integracoes/mercadolivre/webhook
```

Os tópicos mínimos são `orders_v2`, `items` e `shipments`. Para usar toda a operação do ERP, habilite também mensagens, perguntas, reclamações/devoluções e invoices disponíveis para o aplicativo.

O agendador deve chamar, com `Authorization: Bearer CRON_SECRET`:

```text
GET https://SEU_DOMINIO/api/integracoes/mercadolivre/cron
```

## Shopee

A primeira etapa da integração Shopee suporta:

- autorização segura da loja e renovação automática do token;
- consulta incremental dos pedidos dos últimos 15 dias;
- importação idempotente para vendas do ERP;
- atualização de status e restauração de estoque em cancelamentos;
- vínculo de Item ID/Model ID da Shopee com o produto do ERP;
- rotina protegida para sincronização automática.

Variáveis obrigatórias:

```env
SHOPEE_PARTNER_ID=
SHOPEE_PARTNER_KEY=
SHOPEE_REDIRECT_URI=https://erpoficina.figosoftwares.com.br/api/integracoes/shopee/callback
SHOPEE_STATE_SECRET=
# Opcional; o padrão é https://partner.shopeemobile.com
SHOPEE_BASE_URL=
# Opcional; CRON_SECRET também é aceito
SHOPEE_CRON_SECRET=
```

Cadastre exatamente a mesma `SHOPEE_REDIRECT_URI` no aplicativo da Shopee. Depois de aplicar a migration, conecte a loja em **Configurações Gerais** e vincule cada produto/SKU em **Marketplace > Shopee > Catálogo** antes de sincronizar pedidos; itens sem vínculo entram usando um produto temporário e não baixam estoque.

### Cadastro do aplicativo e onboarding do vendedor

1. Criar ou acessar a conta de desenvolvedor no [Shopee Open Platform](https://open.shopee.com/).
2. Criar um aplicativo para o mercado brasileiro. Se o aplicativo conectará lojas de clientes diferentes, solicitar a modalidade de parceiro/ERP; uma integração restrita à própria loja pode usar a modalidade interna disponibilizada pela Shopee.
3. Informar os dados jurídicos e técnicos solicitados durante a análise do aplicativo.
4. Cadastrar como URL de retorno exatamente `https://erpoficina.figosoftwares.com.br/api/integracoes/shopee/callback`.
5. Solicitar inicialmente os módulos de autorização de loja, informações da loja e pedidos. Para publicar e editar anúncios pelo ERP, solicitar também produtos, categorias/atributos, Media Space/imagens e logística.
6. Após a aprovação, copiar o `Partner ID` e a `Partner Key` para as variáveis do ambiente de produção. A Partner Key deve ser tratada como segredo e nunca enviada ao navegador.
7. Gerar `SHOPEE_STATE_SECRET` com valor aleatório forte e configurar `CRON_SECRET` ou `SHOPEE_CRON_SECRET`.
8. Aplicar a migration da Shopee e publicar a nova versão do ERP.
9. No ERP, abrir **Configurações Gerais > Empresa e integrações de marketplace > Shopee** e clicar em **Conectar loja**.
10. O vendedor será enviado à Shopee, fará login e autorizará o aplicativo. A Shopee retorna `code` e `shop_id`; o ERP troca esses dados pelos tokens e salva a loja automaticamente.
11. Voltar ao Marketplace, vincular Item ID/Model ID aos produtos do ERP e fazer uma sincronização controlada de pedidos.

O access token da API v2 possui validade curta e é renovado automaticamente pelo ERP usando o refresh token. Cada chamada privada é assinada no servidor com HMAC-SHA256; nenhuma credencial da Shopee fica exposta no front-end.

O agendador deve chamar, com `Authorization: Bearer CRON_SECRET`:

```text
GET https://SEU_DOMINIO/api/integracoes/shopee/cron
```

Publicação e edição de anúncios Shopee dependem dos escopos de produto aprovados para o aplicativo e da configuração de categoria, atributos, imagens e canais logísticos da loja. Esses fluxos devem ser ativados após validar a autorização real da conta no Open Platform.
