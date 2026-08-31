# Mercado Livre — entrada em produção

## Arquitetura

```text
OAuth e API: ERP do cliente → Mercado Livre
Notificações: Mercado Livre → Figo Central → ERP do cliente
Conciliação: Vercel Cron → ERP do cliente → Mercado Livre
```

A URL única de notificações evita criar um aplicativo Mercado Livre por cliente. A Central identifica o vendedor pelo `user_id` e entrega o evento à instalação cadastrada. A entrega usa HMAC derivado da credencial da instalação e expira em cinco minutos.

## Ordem obrigatória de publicação

1. Aplicar na base da Central `20260831120000_add_mercadolivre_webhook_gateway.sql`.
2. Configurar na Central/Vercel `MERCADOLIVRE_CLIENT_ID` e `CRON_SECRET`.
3. Publicar `central.figosoftwares.com.br`.
4. Confirmar `GET https://central.figosoftwares.com.br/api/integracoes/health`.
5. Publicar cada ERP com `PLATFORM_API_URL`, `PLATFORM_INSTALLATION_ID`, `PLATFORM_API_SECRET`, credenciais Mercado Livre e `CRON_SECRET`.
6. Aplicar em cada banco ERP `20260831130000_remove_mercadolivre_tokens_from_raw_metadata.sql`.
7. Reconectar a conta Mercado Livre uma vez em cada ERP para registrar o vendedor na Central.
8. Alterar no painel do aplicativo a URL de notificações para `https://central.figosoftwares.com.br/api/integracoes/mercadolivre/webhook`.
9. Habilitar os tópicos usados pelo ERP e enviar uma notificação de teste.
10. Conferir em `GET /applications/APP_ID` que o aplicativo Mercado Livre não possui escopos `urn:mp:`.

Não publique o ERP novo antes da migration e do deploy da Central: o callback OAuth passará a registrar a conta no gateway.

## Variáveis da Central

```env
MERCADOLIVRE_CLIENT_ID=
CRON_SECRET=
APP_URL=https://central.figosoftwares.com.br
```

A Central não precisa do Client Secret nesta etapa porque não chama a API do Mercado Livre; ela apenas valida o `application_id` e roteia eventos.

## Variáveis de cada ERP

```env
PLATFORM_API_URL=https://central.figosoftwares.com.br
PLATFORM_INSTALLATION_ID=
PLATFORM_API_SECRET=

MERCADOLIVRE_CLIENT_ID=
MERCADOLIVRE_CLIENT_SECRET=
MERCADOLIVRE_REDIRECT_URI=https://DOMINIO_DO_ERP/api/integracoes/mercadolivre/callback
MERCADOLIVRE_SITE_ID=MLB
MERCADOLIVRE_STATE_SECRET=
CRON_SECRET=
```

Cadastre no aplicativo Mercado Livre todos os domínios HTTPS usados no OAuth. A `MERCADOLIVRE_REDIRECT_URI` de cada deploy deve corresponder exatamente ao endereço cadastrado.

## Teste de aceite por empresa

- conectar usando a conta administradora do vendedor;
- confirmar que a Central associou o `user_id` à instalação correta;
- publicar um anúncio e validar imagem, categoria, atributos e frete;
- editar título, preço e estoque;
- pausar e reativar o anúncio;
- criar um pedido controlado;
- confirmar importação única da venda e baixa de estoque;
- validar pagamento, `shipment_id`, modalidade logística e rastreamento;
- gerar a etiqueta do Mercado Envios apenas em `ready_to_ship/ready_to_print` (ou `printed` para reimpressão);
- validar um carrinho/pack com mais de uma ordem usando o mesmo envio;
- para ME1, testar os eventos obrigatórios `shipped` e `delivered` pelo endpoint V2;
- validar emissão e associação da NF-e quando aplicável;
- responder pergunta e mensagem;
- simular cancelamento, reclamação ou devolução;
- confirmar que uma repetição do mesmo webhook não duplica pedido ou venda;
- aguardar uma execução dos dois crons e verificar ausência de falhas.

## Retorno imediato

Se o gateway apresentar falha após a troca da URL, volte temporariamente a URL de notificações para o ERP que estiver em homologação. O endpoint público anterior foi mantido durante a transição.
