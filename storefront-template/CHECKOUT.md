# Estoque e pagamento das lojas

O saldo `produto.estoque` do ERP representa a quantidade disponível para vender.
O carrinho consulta esse saldo, sem reservar. Ao finalizar a compra, o ERP trava
os produtos em ordem de ID e reserva todos os itens na mesma transação, usando
a rotina de baixa existente. Uma falha desfaz a reserva inteira. A reserva gera
movimentos identificados como **Reserva do site**, sem criar receita ou venda.

O preço é o preço específico do site. O servidor confere novamente esse preço
e a disponibilidade no ERP antes de criar uma cobrança. O catálogo continua
sincronizando em segundo plano; sua atualização visual não substitui essa trava.

Cada tentativa possui UUID persistido no aparelho e vínculo com o cliente.
Ela guarda o endereço, os itens e os totais como um checkout interno. Iniciar,
abandonar ou ter uma cobrança recusada não cria registro em `venda`. A referência
é reservada na sequência para permitir conciliação e proteção contra repetição.
Pix/boleto ainda não pagos também permanecem como tentativas internas.
Tentativas simultâneas com o mesmo carrinho retomam o pedido existente. Uma
transição atômica permite enviar a cobrança uma única vez. Timeout não comprova
falha: o sistema busca a cobrança por cliente e referência e mantém o estoque
reservado enquanto houver dúvida. Não salva número de cartão ou CVV.

Após pagamento confirmado pelo Asaas, a tentativa cria um único pedido no site,
com seus itens, endereço e configuração financeira. “Meus pedidos” nas duas lojas
mostra apenas compras com pagamento confirmado, com acompanhamento, nota fiscal,
produtos, entrega/retirada e rastreamento. A importação cria uma única venda no ERP
e associa a baixa já realizada. Não há segunda baixa. Pedidos antigos mantêm
seu comportamento anterior. Estornos de vendas importadas continuam passando
pelo fluxo existente de devolução física; uma reserva ainda não importada pode
ser devolvida atomicamente após estorno confirmado.

## Prazos

- Preparação abandonada, antes de enviar a cobrança: 20 minutos. A transição
  de cancelamento impede que uma requisição atrasada envie a cobrança depois.
- Pix pendente: 30 minutos; cartão hospedado ainda `PENDING`: 60 minutos.
  A liberação depende de cancelamento confirmado pelo provedor. Cartões
  autorizados ou em análise de risco não são tratados como abandono.
- Boleto: vencimento em três dias, com cancelamento do registro configurado
  para o vencimento. O estoque permanece reservado até chegar a confirmação
  bancária e terminar a janela de compensação. Contamos até o fim do terceiro
  dia útil após essa confirmação (SLA de dois dias úteis mais uma margem).
  Fins de semana, feriados nacionais, Carnaval, Sexta-feira Santa, Corpus Christi
  e fechamentos bancários de dezembro ficam fora da contagem. Depois disso,
  consultamos a cobrança, cancelamos no Asaas e só liberamos com confirmação.
- Se o evento bancário não chegar, a integração falhar ou o resultado financeiro
  ficar inconclusivo, a reserva não é liberada por um simples relógio. A pendência
  fica visível em **Marketplace → Loja → Pedidos → Reservas de compras**.

Nenhuma integração distribuída promete ausência absoluta de falhas. Eventos
duplicados, atrasados e indisponibilidade são tratados com idempotência e
conciliação. Pagamento após cancelamento exige revisão manual e não gera
liberação nem cumprimento automático de um pedido sem estoque.

As regras financeiras seguem a documentação de [eventos de cobrança do Asaas](https://docs.asaas.com/docs/webhook-para-cobrancas),
[remoção de cobranças](https://docs.asaas.com/reference/excluir-cobranca) e
[duplicidade após repetição de uma requisição](https://docs.asaas.com/docs/duplicate-charge-after-retry-without-idempotency).

## Publicação

Antes da ativação, concilie os pedidos antigos pendentes. Eles foram criados
sem reserva no ERP e podem ainda possuir links de pagamento válidos. O sistema
impede iniciar novas compras enquanto esse passivo não for resolvido. Isso
aparece no painel de reservas; não cancelamos cobranças antigas silenciosamente.
Pedidos de teste devem ser identificados e encerrados com confirmação do
responsável; pedidos reais precisam de tratamento individual antes da virada.

1. Aplicar as migrations no ERP e no banco próprio de cada loja. O utilitário
   abaixo limita os alvos aos dois clientes autorizados e confere os projetos.
   Sem `--apply`, somente inspeciona. Pode selecionar um alvo específico:
   `--target=brpecas`, `--target=demir`, `--target=site_brpecaspb` ou
   `--target=site_demirdiesel`.

   ```powershell
   node --import tsx scripts/storefront/checkout-migrations.ts
   node --import tsx scripts/storefront/checkout-migrations.ts --apply
   ```

2. Publicar primeiro o ERP de cada cliente, depois sua loja. A loja deriva a
   conexão do `ERP_ORDER_WEBHOOK_URL` já existente, usando `ERP_ORDER_SYNC_SECRET`.
   No ERP, o par é `STOREFRONT_ORDER_SYNC_SECRET`. Não existe outra variável de
   endereço para estoque. Cada instalação deve apontar para seu próprio cliente.
3. Manter o cron autenticado `/api/integracoes/site/cron/checkout` ativo a cada
   minuto no ERP. Ele complementa os webhooks e tenta novamente falhas de entrega.
   O `CRON_SECRET` já existente é reutilizado. Em servidor sem Vercel, o agendador
   deve chamar essa rota com o mesmo Bearer, ou executar o worker com `--checkout`.
4. No webhook do Asaas de cada conta, incluir os eventos de cobrança, pagamento,
   cancelamento, estorno e **PAYMENT_BANK_SLIP_CANCELLED**. A URL permanece
   `/api/webhooks/asaas`. Eventos são persistidos antes de consultar o provedor.
5. Homologar com credenciais sandbox o ciclo completo de cobrança e cancelamento
   antes de disponibilizar pagamentos reais. Os testes automatizados usam banco
   isolado e respostas simuladas; não criam cobranças nas contas de produção.

## Código comum e novos clientes

`storefront-template/lib` e `storefront-template/app/api` guardam o núcleo comum.
`scripts/storefront/install-checkout.mjs` sincroniza esse núcleo nas duas lojas.
O frontend mantém a identidade própria de cada cliente, usando o mesmo contrato
de tentativa, consulta de disponibilidade e confirmação. Novas lojas devem
receber esses módulos, as migrations comuns e a integração do carrinho/checkout.
Não compartilhe banco, catálogo ou segredos entre clientes.

Para copiar somente o núcleo comum para uma nova loja já criada:

```powershell
node scripts/storefront/install-checkout.mjs --core-only site_novocliente
node scripts/storefront/template.mjs sync site_novocliente
```

Depois integre seus componentes de carrinho e checkout ao contrato descrito
acima. A cópia do núcleo não modifica a identidade visual ou os componentes da
nova loja e não publica nem aplica migrations.

Validações:

```powershell
node --import tsx scripts/tests/site-checkout-sql.ts
node scripts/tests/storefront-schema.cjs
node --test scripts/tests/site-checkout.test.mjs scripts/tests/storefront-auto-sync.test.mjs
node site_brpecaspb/scripts/integration.test.mjs
```

## Parcelamento por produto e envio

### Regras por grupo e prioridade individual

Em **Configurações → Tipos → Grupos de produto**, abra o grupo salvo e configure
o bloco **Pagamento no site**. A regra é salva separadamente dos demais dados
do grupo e vale para os produtos que não têm uma exceção individual.

A prioridade é: **produto com personalização → grupo atual do produto → padrão
à vista**. No cadastro do produto, o switch **Personalizar parcelamento deste
produto** permite criar uma exceção; desligá-lo e salvar devolve a herança.
Uma exceção explícita de pagamento à vista também prevalece sobre um grupo
que permite parcelas. Mudar de grupo passa a usar a regra do novo grupo,
desde que o produto esteja em modo de herança.

A migration ERP `20261028120000_site_group_checkout_policy.sql` cria
`site_group_checkout_config` e adiciona `payment_override` à configuração do
produto. Regras individuais antigas são preservadas como exceções; produtos
sem configuração própria herdam automaticamente. Peso e dimensões continuam
sempre específicos do produto, mesmo quando o parcelamento é herdado.

Os dois sites recebem a regra efetiva no endpoint de configuração existente.
Não é necessário copiar as regras por grupo para os bancos das lojas nem
republicar os produtos ao alterar o parcelamento do grupo. As consultas do
checkout usam a associação do produto no ERP, sem aceitar grupo informado
pelo navegador. O total é validado novamente antes de reservar e cobrar.

No ERP, configure em **Cadastro do produto → Marketplace → Pagamento no site**.
As regras continuam em `site_product_checkout_config`; produtos sem configuração
permitem somente pagamento à vista e a loja absorve as taxas. Não há nova
migration para estes campos: o contrato JSON ganha valores padrão compatíveis.

`feeMode` permite `absorbed`, `incremental` e `full`. As taxas são consultadas em
`GET /v3/myAccount/fees/` na própria conta Asaas da loja, respeitando promoções
vigentes. `incremental` preserva o líquido de uma venda em 1x; `full` repassa a
operação e o percentual inclusive em 1x. O limite sem acréscimo só se aplica
a `incremental`. A taxa operacional é aplicada uma vez ao total da venda, sem
multiplicar pelo número de parcelas. O cálculo considera que a taxa percentual
incide também sobre o acréscimo (gross-up), arredondando para cima em centavos.
Em carrinhos mistos, o repasse e o custo do frete são ponderados pela participação
dos produtos. O limite de parcelas respeita todos os itens. Antecipação,
comissão da Central e mensageria não são incluídas no repasse.

`monthlyInterestPercent` e `shippingRates` são legados lidos para compatibilidade;
não são usados no cálculo nem editados na interface. Regras existentes sem
`feeMode` são interpretadas como `absorbed`; confira-as antes de habilitar repasse.
O servidor confere regras, taxas, frete e `expectedTotal` antes de reservar estoque
ou criar cobrança. Uma falha na consulta não permite cobrar com uma taxa inventada.

Crédito parcelado usa `installmentCount` e `totalValue`, sem `value`. Conciliação,
estorno e cancelamento abrangem o plano inteiro. O switch de salvar cartão
começa desligado; somente referência tokenizada e dados mascarados são salvos.
Débito continua na fatura hospedada Asaas, na mesma aba.

### Cota??o PAC e SEDEX via Melhor Envio

A API direta dos Correios exige contrato. Sem contrato próprio, a integração
usa o Melhor Envio e requer uma conta autorizada por loja. Configure no
ambiente **do servidor de cada site**, nunca em variáveis `NEXT_PUBLIC_`:

```dotenv
MELHOR_ENVIO_ENVIRONMENT=sandbox
MELHOR_ENVIO_CLIENT_ID=
MELHOR_ENVIO_CLIENT_SECRET=
```

O e-mail técnico reutiliza `NEXT_PUBLIC_COMPANY_EMAIL`. O CEP de origem é lido de
**Configurações → Empresa** no ERP pelo endpoint de regras já autenticado,
sem nova variável de origem. O produto precisa de `shippingPackage`: peso unitário
embalado em kg e largura, altura e comprimento em cm. Somente esses dados físicos
ficam no produto; preços de frete não são cadastrados nele.

`POST /api/shipping/quote` consulta o carrinho completo com preços autoritativos
para seguro, usando `custom_price` e `custom_delivery_time` do provedor. O checkout
cota automaticamente pelo endereço selecionado, invalida a escolha ao mudar CEP
ou itens, exige escolha de serviço e confere novamente preço e disponibilidade
antes de cobrar. O frete escolhido entra no total e seu snapshot fica junto ao
endereço do pedido e nos metadados da tentativa. Retirada não cobra frete.

Sem conexão autorizada nem token manual legado, permanece o fluxo de frete a
combinar, com aviso de que ele não está incluído no pagamento dos produtos.
Com conexão cadastrada e falha na autorização ou cotação,
entrega fica bloqueada até uma cotação válida; não vira frete grátis.
Uma cotação sandbox não pode ser usada com Asaas production.

A tarifa só vale para etiquetas emitidas pelo Melhor Envio. A integração atual
cota e registra o serviço; não compra etiquetas automaticamente. A loja deve emitir
a etiqueta com a mesma embalagem e serviço antes de postar nos Correios.

A homologação real depende das contas, dos tokens e das medidas. Os testes isolados
não validam credenciais nem tarifas reais e não criam compras financeiras:

```powershell
node --test site_brpecaspb/scripts/integration.test.mjs scripts/tests/site-checkout.test.mjs
node scripts/tests/product-checkout-controls-ui.mjs
```

Fontes: [taxas da conta Asaas](https://docs.asaas.com/reference/recuperar-taxas-da-conta),
[taxa sobre a venda parcelada](https://www.asaas.com/cobranca-cartao),
[cotação Melhor Envio](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos),
[API Preço Correios](https://www.correios.com.br/atendimento/developers/manuais/manual-api-preco-1).

### Condições na página do produto

`ProductPaymentTerms` usa o mesmo contrato e cálculo do checkout para mostrar
o limite efetivo, valor das parcelas, acréscimo e total. A tabela exibe somente
as opções permitidas para o valor e quantidade atuais. A regra por grupo jáé resolvida no ERP; a página não usa um limite fixo de parcelas. Falha na
consulta de regras ou taxas mostra indisponibilidade, sem anunciar uma
condição inventada. O frete é cotado separadamente e entra no total no checkout.

### Autoriza??o da conta Melhor Envio

O callback de cada loja ? `/api/integrations/melhor-envio/callback`, na URL
p?blica can?nica de `NEXT_PUBLIC_SITE_URL`. Registre exatamente essa URL no
aplicativo Melhor Envio. N?o use a URL do ERP como callback do aplicativo.

Depois de publicar ERP e loja com as tr?s vari?veis acima na Vercel, abra
**Marketplace ? Site ? Frete ? Melhor Envio ? Conectar Melhor Envio** no ERP.
O ERP autentica a solicita??o com o segredo de pedidos j? existente; n?o h?
um novo segredo de integra??o. O navegador ? redirecionado para o provedor,
que deve ser autorizado pelo titular da conta da loja. Somente o escopo
`shipping-calculate` ? solicitado. A compra de etiquetas n?o ? autorizada.

O in?cio usa estado aleat?rio descart?vel, com validade de dez minutos,
armazenado como hash. A loja vincula esse estado ao navegador por cookie
HttpOnly/SameSite=Lax. O callback consome o estado antes de trocar o c?digo,
recusando falta de cookie, repeti??o, expira??o e ambiente/client divergentes.
O resultado retorna ? loja sem incluir c?digos ou tokens na URL seguinte.

A migration comum de loja `20261028160000_shipping_oauth.sql` cria duas tabelas
com RLS e acesso somente service_role: `store_shipping_oauth_state` e
`store_shipping_connection`. N?o pertence ao ERP e n?o altera pagamentos,
estoque nem pedidos. Os tokens s?o cifrados com AES-256-GCM usando chave
derivada do Client Secret, vinculados ao dom?nio, ambiente e Client ID. Se
alterar essas configura??es, reconecte a conta. Nunca exponha Client Secret,
access_token ou refresh_token em API p?blica, logs, localStorage ou componentes.

A renova??o ? feita ao consultar o frete, nos sete dias anteriores ao vencimento,
com trava por conex?o e confirma??o condicional da vers?o. Requisi??es simult?neas
n?o renovam o mesmo refresh_token duas vezes. Em resposta perdida ou falha de
persist?ncia, exige nova autoriza??o em vez de repetir o POST ?s cegas. Se a
conta ficar inativa al?m da validade do refresh_token, tamb?m ser? preciso
reautorizar. A conex?o pode ser refeita pelo bot?o **Reconectar** no ERP.

`MELHOR_ENVIO_TOKEN` continua aceito como alternativa legada quando n?o h?
conex?o OAuth salva. No fluxo OAuth n?o precisa ser preenchido no ambiente.
Nunca use uma conta ou token de outro lojista, nem misture sandbox e produ??o.

Testes isolados, sem autoriza??o ou compra real:

```powershell
node --test scripts/tests/shipping-oauth.test.mjs scripts/tests/site-checkout.test.mjs site_brpecaspb/scripts/integration.test.mjs
node scripts/tests/storefront-schema.cjs
```
