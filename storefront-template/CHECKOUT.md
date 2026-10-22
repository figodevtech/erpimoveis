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

O primeiro teste cria e remove um schema isolado, sem modificar produtos reais.
Ele testa concorrência pela última unidade, rollback do carrinho, repetição de
reserva/cancelamento e confirmação sem baixa duplicada.
