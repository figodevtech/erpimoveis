# Mercado Livre — entrada em produção

## Preço independente e busca paginada — setembro/2026

- A fila de estoque envia somente available_quantity (ou quantidade da variação).
  Não lê precovenda, não envia preço e não gera logs de sincronização de preço.
  Alterações de preço devem ser feitas explicitamente na edição do anúncio.
- Aplicar `20260916150000_marketplace_product_search.sql` antes do deploy do ERP.
  A busca do Marketplace usa RPC restrita a service_role, após autorização da rota.
  A função filtra tokens, vínculos e estoque no banco; devolve somente a página e o
  total, sem transferir o catálogo inteiro para a aplicação. Não há fallback por lotes.
- A normalização SQL cobre acentos latinos comuns em português; não é equivalência
  Unicode completa. Códigos estruturados são procurados nos campos de código.
- A contagem e busca por substring ainda precisam examinar candidatos no banco.
  Medir com EXPLAIN ANALYZE em catálogo representativo antes de prometer redução
  de CPU do Postgres. A redução direta é de tráfego, memória da função e round trips.
- Validar a migration no demo: busca com/sem acentos, várias palavras, referência,
  primeira/última página, vínculos e produtos sem estoque. Os testes locais verificam
  payload e contrato do código; não executam a função contra bancos de clientes.

## Atualização de segurança OAuth — setembro/2026

- Aplicar `20260915160000_mercadolivre_refresh_lease.sql` em cada banco ERP **antes** do deploy do ERP.
- A renovação usa lease de 90 segundos no banco; chamadas concorrentes aguardam brevemente e recebem erro temporário se a renovação continuar ocupada.
- Timeouts de escrita não são repetidos automaticamente: conciliar antes de reenviar uma operação que possa ter sido processada.
- Testar duas requisições simultâneas com token próximo de expirar em ambiente controlado.
- Full e itens identificados como multiorigem não recebem o saldo do ERP pelo endpoint simples. Gestão por depósito ainda requer implementação e configuração específica.
- O guia abaixo contém a arquitetura inicial; a Central também recupera eventos via conta proprietária e precisa das credenciais descritas a seguir.

### Credenciais atuais da Central

Além de `MERCADOLIVRE_CLIENT_ID` e `CRON_SECRET`, configurar `MERCADOLIVRE_CLIENT_SECRET`, `MERCADOLIVRE_REDIRECT_URI` (callback `/api/integracoes/mercadolivre/owner/callback`), `MERCADOLIVRE_STATE_SECRET` e `MERCADOLIVRE_TOKEN_ENCRYPTION_KEY`. Autorizar a conta proprietária na Central para recuperação de eventos perdidos. Os callbacks das lojas continuam nos ERPs.

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

A Central também usa o Client Secret e a autorização da conta proprietária para recuperar eventos perdidos. Consulte as credenciais atuais no início deste documento.

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
# Persistência de tokens e carga no banco

## Contato pós-venda por motivo

No atendimento, “Iniciar contato por motivo” consulta o action guide somente ao
abrir o diálogo. O envio reconsulta as opções para validar habilitação, capacidade,
limite de caracteres e template oficial; o pedido permanece filtrado por empresa e
conta no servidor. Não há polling nem nova tabela neste fluxo.

Suportados quando disponibilizados pela API: OTHER, SEND_INVOICE_LINK,
REQUEST_VARIANTS e REQUEST_BILLING_INFO (templates sem variáveis).
DELIVERY_PROMISE é oferecido somente quando habilitado pela API com as duas variáveis
numéricas conhecidas (INIT e LIMIT). O formulário exige horas inteiras entre 0 e 23,
com início anterior ao fim. Não modifica a modalidade nem a data do envio: comunica
um intervalo usando a data determinada pelo Mercado Livre. Outros contratos de
variáveis desconhecidos não são oferecidos. Respostas a conversas iniciadas pelo
comprador continuam no campo normal.
Não existe fallback automático entre os dois endpoints nem repetição automática
do envio. Em falha de rede, confira o histórico antes de reenviar.

Validar em pedido autorizado: opção indisponível, capacidade esgotada, texto no
limite, envio de template e resposta do comprador. Os testes locais de normalização
não substituem a confirmação do fluxo pela API real.

Referência: https://developers.mercadolivre.com.br/pt_br/pt_br/motivos-para-se-comunicar

A renovação reutiliza o token válido já carregado pelo servidor e compartilha a
renovação em andamento dentro do processo. O lease no banco protege processos
distintos. Não foi adicionado polling periódico.

Se a gravação do token renovado falhar, são feitas no máximo três tentativas de
persistir o mesmo resultado, sem repetir o refresh OAuth. Uma gravação com resposta
perdida é conferida antes de reportar conflito. A gravação condicional não sobrescreve
uma reconexão concorrente. Uma indisponibilidade persistente ainda pode exigir
reconexão; esse mecanismo não substitui a validação em ambiente implantado.
