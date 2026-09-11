Você está trabalhando no projeto **ERP Oficina**, repositório:

`figodevtech/erpoficina`

Stack principal:

* Next.js 15
* React 19
* TypeScript
* Supabase
* API oficial do Mercado Livre
* integração Mercado Livre já existente e em estágio avançado

# OBJETIVO

Melhorar o fluxo de **criação e validação de anúncios do Mercado Livre**, com foco em **Mercado Envios 2 — ME2**.

A implementação deve fazer o ERP consultar o Mercado Livre como **fonte de verdade** para:

* disponibilidade de Mercado Envios;
* tipos logísticos;
* logística aplicável ao anúncio;
* política de frete grátis;
* custo estimado de envio;
* custos de venda;
* comissão;
* taxa fixa;
* validações da publicação;
* confirmação do modo logístico após a publicação.

O objetivo é chegar ao seguinte fluxo:

```text
Produto ERP
   ↓
Categoria Mercado Livre
   ↓
Preço + condição + estoque
   ↓
Tipo de anúncio
   ↓
Dimensões + peso
   ↓
Consultar Mercado Envios
   ↓
Resolver ME2 + logística
   ↓
Consultar custos de frete
   ↓
Consultar custos de venda
   ↓
Mostrar líquido estimado
   ↓
Validar anúncio
   ↓
ANÚNCIO VÁLIDO
   ↓
Habilitar publicação
   ↓
POST /items
   ↓
GET /items/{id}
   ↓
Confirmar ME2 aplicado
```

Não crie uma segunda integração paralela.

**Analise e evolua a implementação existente.**

---

# 1. DOCUMENTAÇÃO OFICIAL — LEITURA OBRIGATÓRIA

ANTES DE ALTERAR O CÓDIGO, leia a documentação oficial atual do Mercado Livre abaixo.

Não confie somente no comportamento atual do ERP.

Compare:

* documentação atual;
* payloads reais;
* respostas atuais da API;
* implementação existente.

## Mercado Envios 2

Referência oficial:

[Mercado Envios 2 — Mercado Livre Developers](https://developers.mercadolivre.com.br/pt_br/mercado-envios-2?utm_source=chatgpt.com)

Use essa documentação principalmente para analisar:

* `shipping_preferences`;
* ME1 x ME2;
* `mode`;
* `logistic_type`;
* logística `default`;
* restrições;
* categorias;
* vendedor;
* dimensões;
* formas de envio.

---

## Custos de envio

Referência oficial:

[Custos de envio — Mercado Livre Developers](https://developers.mercadolivre.com.br/custos-de-envio?utm_source=chatgpt.com)

Analise especialmente:

```http
GET /users/{USER_ID}/shipping_options/free
```

e os conceitos:

```text
dimensions
item_price
listing_type_id
mode
condition
logistic_type
free_shipping
coverage
list_cost
billable_weight
mandatory_free_shipping
```

Esse endpoint deve ser tratado como fonte oficial para simulação do custo aproximado de envio para o vendedor antes de publicar ou editar.

---

## Custos por vender / listing_prices

Referência oficial:

[Custos por vender — Mercado Livre Developers](https://developers.mercadolivre.com.br/pt_br/comissao-por-vender?utm_source=chatgpt.com)

Analise:

```http
GET /sites/{SITE_ID}/listing_prices
```

Principalmente:

```text
category_id
price
currency_id
listing_type_id
shipping_mode
logistic_type
billable_weight
```

e a resposta:

```text
sale_fee_amount
sale_fee_details
fixed_fee
financing_add_on_fee
percentage_fee
listing_fee_amount
```

REGRA CRÍTICA:

**`sale_fee_amount` representa o custo total da venda e o `fixed_fee` retornado dentro de `sale_fee_details` já está incluído nele.**

Não somar ou subtrair `fixed_fee` novamente no cálculo líquido.

Exemplo correto:

```ts
estimatedNetAmount =
  price
  - saleFeeAmount
  - sellerShippingCost;
```

NÃO fazer:

```ts
price
- saleFeeAmount
- fixedFee
- sellerShippingCost
```

porque isso pode cobrar a taxa fixa duas vezes no cálculo apresentado pelo ERP.

Além disso, consulte a documentação vigente para verificar quais parâmetros são efetivamente aplicáveis ao site `MLB`.

Não trate `billable_weight` como universalmente obrigatório apenas porque existe na API.

---

## Validador de publicações

Referência oficial:

[Validador de publicações — Mercado Livre Developers](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/validador-de-publicacoes?utm_source=chatgpt.com)

Endpoint:

```http
POST /items/validate
```

Utilize esse recurso como última validação oficial antes da criação.

Considere que uma publicação válida pode retornar:

```text
204 No Content
```

e trate corretamente respostas sem JSON.

---

## Publicação de produtos

Referência oficial:

[Publicar produtos — Mercado Livre Developers](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos?utm_source=chatgpt.com)

Revisar especialmente:

```http
POST /items
GET /items/{ITEM_ID}
POST /items/{ITEM_ID}/description
```

Não enviar campos não documentados apenas porque eles aparecem em respostas de outras APIs.

---

## User Products

Referência oficial:

[User Products — Mercado Livre Developers](https://developers.mercadolivre.com.br/pt_br/user-products?utm_source=chatgpt.com)

O ERP já possui suporte parcial ao modelo de User Products.

Não faça uma migração completa nesta tarefa, mas a implementação nova não pode assumir que todos os vendedores continuarão usando exclusivamente o modelo legado.

Observe especialmente a tag:

```text
user_product_seller
```

e conceitos:

```text
user_product_id
family_id
family_name
```

---

## Aplicação Mercado Livre

Caso encontre erros de autorização, `403`, escopos ou problemas de acesso:

[Gerencie seu aplicativo — Mercado Livre Developers](https://developers.mercadolivre.com.br/pt_br/gerencie-seu-aplicativo?utm_source=chatgpt.com)

Há mudanças recentes nas regras de aplicações Mercado Livre/Mercado Pago.

Não altere OAuth preventivamente.

Somente investigue essa área se houver evidência de problema de autorização.

---

# 2. REGRA SOBRE DOCUMENTAÇÃO

Antes de implementar qualquer comportamento relacionado a:

```text
shipping_preferences
shipping_modes
shipping_options/free
listing_prices
items/validate
POST /items
User Products
```

abra a documentação oficial correspondente.

Se houver divergência entre:

```text
documentação atual
```

e:

```text
código atual do ERP
```

priorize a documentação oficial atual.

No relatório final, informe explicitamente qualquer comportamento antigo encontrado e corrigido.

---

# 3. ANALISE O CÓDIGO EXISTENTE PRIMEIRO

Revise pelo menos:

```text
src/app/api/integracoes/mercadolivre/items/route.ts

src/app/api/integracoes/mercadolivre/items/[itemId]/route.ts

src/app/api/integracoes/mercadolivre/shipping-quote/route.ts

src/app/api/integracoes/mercadolivre/listing-options/route.ts

src/app/api/integracoes/mercadolivre/category-attributes/route.ts

src/lib/integrations/mercadolivre-shipping-preferences.ts

src/lib/integrations/mercadolivre-listing-validation.ts

src/lib/integrations/mercadolivre-address.ts

src/lib/integrations/mercadolivre-package.ts

src/lib/integrations/mercadolivre.ts
```

Depois procure os componentes React responsáveis pela criação/edição de anúncio.

Localize no projeto componentes responsáveis por:

* produto;
* título;
* categoria;
* atributos;
* preço;
* estoque;
* tipo de anúncio;
* imagens;
* dimensões;
* peso;
* Mercado Envios;
* custos;
* publicação.

Não presuma nomes.

Use busca no repositório.

---

# 4. ENTENDA O QUE JÁ EXISTE

O projeto já possui lógica relacionada a:

```text
GET /categories/{CATEGORY_ID}/shipping_preferences

GET /users/{USER_ID}/shipping_preferences

POST /users/{USER_ID}/shipping_modes

GET /users/{USER_ID}/shipping_options/free

GET /sites/MLB/listing_prices

POST /items/validate

POST /items

GET /items/{ITEM_ID}
```

Não duplique essas chamadas sem necessidade.

Identifique os helpers e rotas existentes e reutilize-os.

---

# 5. NÃO QUEBRAR FUNCIONALIDADES EXISTENTES

Preserve:

* OAuth;
* refresh token;
* isolamento por `empresa_id`;
* permissões;
* criação de anúncio;
* edição;
* atributos;
* imagens;
* GTIN;
* User Products;
* sincronização de estoque;
* sincronização de preço;
* pedidos;
* webhooks;
* Mercado Envios pós-venda;
* rastreamento;
* etiquetas;
* NF-e;
* devoluções;
* reclamações.

Faça alterações somente dentro do escopo necessário.

---

# 6. DISPONIBILIDADE DO MERCADO ENVIOS

Para uma categoria selecionada, consulte:

```http
GET /categories/{CATEGORY_ID}/shipping_preferences
```

e:

```http
GET /users/{USER_ID}/shipping_preferences
```

Mercado Envios somente deve ser considerado disponível se houver compatibilidade entre:

```text
categoria
+
conta vendedora
```

Não mostrar ME2 apenas porque a categoria possui:

```text
mode = me2
```

se a conta do vendedor não estiver habilitada.

---

# 7. CATEGORY ATTRIBUTES

Revise a rota existente:

```text
/api/integracoes/mercadolivre/category-attributes
```

Ela já obtém informações de categoria e logística.

Evite criar outra rota fazendo exatamente a mesma coisa.

Normalize adequadamente:

```ts
shippingOptions
categoryShippingOptions
userShippingOptions

logisticOptions
categoryLogisticOptions
userLogisticOptions

me2Restricted
me2Restrictions

defaultDimensions
```

A UI deve consumir essas informações.

---

# 8. SHIPPING MODES DO ANÚNCIO ESPECÍFICO

Depois de possuir:

```text
categoria
preço
condição
tipo de anúncio
dimensões
peso
atributos relevantes
```

consultar:

```http
POST /users/{USER_ID}/shipping_modes
```

Use o contexto do anúncio.

Enviar somente propriedades válidas e documentadas.

Considere dados como:

```text
buying_mode
category_id
channels
condition
dimensions
item_currency
item_price
listing_type_id
local_pick_up
sale_terms
seller_id
site_id
title
attributes
```

Utilizar:

```text
site_id = MLB
channel = marketplace
```

quando aplicável.

A resposta do Mercado Livre deve ser a fonte de verdade da disponibilidade daquele anúncio.

---

# 9. RESOLVER LOGÍSTICA

Dentro das opções retornadas, procurar:

```text
mode = me2
```

e seus tipos logísticos.

Normalizar uma estrutura semelhante a:

```ts
type MercadoEnviosLogisticOption = {
  type: string;
  default: boolean;
  attributes: Record<string, unknown>;
};
```

Se a API indicar um tipo como:

```text
default = true
```

usar esse tipo como seleção inicial.

Se houver várias logísticas:

```text
drop_off
cross_docking
xd_drop_off
self_service
fulfillment
...
```

não assumir que todas estão disponíveis.

Mostrar somente as retornadas para aquele vendedor/anúncio.

---

# 10. NÃO HARDCODAR LOGISTIC TYPE

Evite:

```ts
const logisticType = "drop_off";
```

ou qualquer lógica equivalente como fonte definitiva.

Hardcodes podem existir apenas como:

* label amigável;
* tradução;
* fallback visual.

Nunca para determinar disponibilidade operacional.

---

# 11. FRETE GRÁTIS NÃO É A MESMA COISA QUE MERCADO ENVIOS

Tratar separadamente:

```text
Mercado Envios habilitado
```

e:

```text
frete grátis para o comprador
```

ME2 pode estar ativo com:

```text
free_shipping = false
```

ou:

```text
free_shipping = true
```

dependendo das regras do anúncio.

---

# 12. IDENTIFICAR FRETE GRÁTIS OBRIGATÓRIO

Consulte as informações retornadas pelas APIs e pela documentação.

Depois da publicação, a documentação também permite identificar regras como:

```text
mandatory_free_shipping
```

nas informações de shipping/tags do item.

Antes da publicação, não invente uma regra local baseada apenas no preço.

Consulte os recursos oficiais aplicáveis.

Normalize uma política:

```ts
type FreeShippingPolicy =
  | "mandatory"
  | "optional"
  | "unavailable"
  | "unknown";
```

Se for obrigatório:

```ts
freeShipping = true;
```

e bloquear a alteração na UI.

Mostrar:

```text
O Mercado Livre exige frete grátis para este anúncio.
```

---

# 13. CORRIGIR shipping-quote

Revise:

```text
POST /api/integracoes/mercadolivre/shipping-quote
```

A implementação atual utiliza:

```http
GET /users/{USER_ID}/shipping_options/free
```

Mantenha a API oficial.

Porém revise a normalização da resposta conforme a documentação vigente.

Considere estruturas como:

```text
coverage.all_country.list_cost
coverage.all_country.currency_id
coverage.all_country.billable_weight
```

Não presuma a existência de:

```text
quote.cost
quote.seller.cost
coverage.cost
```

sem confirmação da documentação ou de resposta real da API.

---

# 14. NORMALIZAR COTAÇÃO

Criar um tipo centralizado.

Exemplo:

```ts
type MercadoLivreShippingQuote = {
  currencyId: string;
  sellerShippingCost: number | null;
  billableWeight: number | null;
  freeShipping: boolean;
  logisticType: string;
  origin: MercadoLivreShippingAddress | null;
  raw?: unknown;
};
```

O nome:

```text
sellerShippingCost
```

deve representar o custo aproximado do envio retornado pela API para o vendedor naquele cenário.

Nunca inferir custo zero se a API não retornar zero.

---

# 15. SIMULAR CENÁRIOS DE FRETE

Quando permitido pela política do anúncio, calcular:

## Cenário 1

```text
free_shipping=false
```

## Cenário 2

```text
free_shipping=true
```

Consultando:

```http
/users/{USER_ID}/shipping_options/free
```

com os mesmos:

```text
dimensions
price
listing type
condition
logistic type
```

---

# 16. RETORNO NORMALIZADO

Exemplo conceitual:

```ts
{
  mode: "me2",

  logisticType: "drop_off",

  freeShippingPolicy: "optional",

  quotes: {
    buyerPaysShipping: {
      available: true,
      freeShipping: false,
      sellerShippingCost: 0,
      currencyId: "BRL"
    },

    freeShipping: {
      available: true,
      freeShipping: true,
      sellerShippingCost: 27.9,
      currencyId: "BRL"
    }
  },

  physicalWeight: 900,
  billableWeight: 1200
}
```

Os valores são apenas exemplo.

Não hardcodar.

Se a API retornar custo diferente de zero no primeiro cenário, respeitar a resposta.

---

# 17. DIMENSÕES

Atualmente o ERP trabalha com:

```text
lengthCm
widthCm
heightCm
weightGrams
```

Centralize a conversão para o formato exigido pelo Mercado Livre.

Atenção à ordem exigida pelos endpoints.

Não permita que:

```text
shipping_modes
```

use uma ordem e:

```text
shipping_options/free
```

use outra sem intenção.

Criar helper compartilhado.

Exemplo conceitual:

```ts
buildMercadoLivreShippingDimensions(...)
```

---

# 18. ATRIBUTOS DE EMBALAGEM

Preserve suporte a:

```text
SELLER_PACKAGE_LENGTH
SELLER_PACKAGE_WIDTH
SELLER_PACKAGE_HEIGHT
SELLER_PACKAGE_WEIGHT
```

quando aplicáveis segundo a categoria/modelo atual.

Não adicionar atributos duplicados.

---

# 19. ENDEREÇO DE ORIGEM

O projeto já possui:

```text
mercadolivre-address.ts
```

Reutilize-o.

Ao calcular envio, utilizar as informações que a API disponibilizar.

Pode haver restrições de privacidade na resposta do endereço.

Não considerar isso automaticamente erro fatal se os endpoints logísticos conseguirem calcular normalmente.

Se realmente faltarem dados necessários, retornar mensagem amigável:

```text
Não foi possível calcular o Mercado Envios com o endereço de origem atual da conta.
Revise o endereço de envio no Mercado Livre.
```

---

# 20. BILLABLE WEIGHT

Quando:

```text
shipping_options/free
```

retornar:

```text
billable_weight
```

armazene e apresente.

Exemplo:

```text
Peso informado: 900 g
Peso faturável pelo Mercado Livre: 1.200 g
```

Mas NÃO assuma que `billable_weight` precisa ser enviado em todos os endpoints ou que seja obrigatório no Brasil.

Consulte a documentação atual de `listing_prices`.

Envie somente quando:

* aceito;
* pertinente;
* útil para precisão;
* documentado.

---

# 21. LISTING PRICES

Reutilize:

```text
/api/integracoes/mercadolivre/listing-options
```

e:

```http
GET /sites/MLB/listing_prices
```

Quando possível, considerar:

```text
price
currency_id
category_id
listing_type_id
shipping_mode
logistic_type
```

e demais parâmetros documentados aplicáveis.

---

# 22. REGRA CRÍTICA SOBRE sale_fee_amount

A documentação atual informa que:

```text
sale_fee_amount
```

é o **custo total por vender** retornado pelo calculador.

O:

```text
sale_fee_details.fixed_fee
```

é um detalhamento desse total.

Portanto:

```ts
marketplaceCost = saleFeeAmount;
```

e não:

```ts
marketplaceCost = saleFeeAmount + fixedFee;
```

Não contar a taxa fixa duas vezes.

---

# 23. RESUMO FINANCEIRO

Calcular:

```ts
estimatedNetAmount =
  price
  - saleFeeAmount
  - sellerShippingCost;
```

Acrescentar outros custos somente se:

* forem retornados separadamente pela API;
* não estiverem incluídos no `sale_fee_amount`;
* houver documentação que justifique.

---

# 24. MOSTRAR DETALHAMENTO SEM DUPLICAR CUSTOS

Na interface pode aparecer:

```text
Preço                                 R$ 150,00

Custo total Mercado Livre            -R$ 22,50
  Comissão percentual                 R$ 16,50
  Taxa fixa                           R$  6,00

Mercado Envios                       -R$ 27,90
────────────────────────────────────────────
Líquido estimado                      R$ 99,60
```

Mas deixe claro que:

```text
Comissão percentual
Taxa fixa
```

são componentes explicativos do:

```text
Custo total Mercado Livre
```

e não custos adicionais.

---

# 25. NOVA ETAPA: VALIDAR ANÚNCIO

Criar uma etapa explícita:

```text
Validar anúncio
```

antes de:

```text
Publicar anúncio
```

Pode ser botão manual ou processo automático claramente sinalizado.

A publicação somente poderá ocorrer após validação atual.

---

# 26. VALIDAÇÃO DEVE INCLUIR

Verificar:

```text
conta conectada
permissão da conta
restrições do vendedor
produto
categoria
condição
preço
estoque
tipo de anúncio
imagem
atributos obrigatórios
GTIN quando informado
garantia quando aplicável
dimensões
peso
Mercado Envios
logística
frete grátis
cotação de envio
custos do anúncio
/items/validate
```

---

# 27. /items/validate

Depois de montar o payload final que seria enviado para:

```http
POST /items
```

enviar o mesmo payload compatível para:

```http
POST /items/validate
```

Tratar:

```text
204
```

como validação bem-sucedida.

Tratar corretamente:

```text
warnings
errors
causes
references
```

quando retornados.

Não exigir JSON em resposta `204`.

---

# 28. VALIDAÇÃO STALE

Criar estado semelhante a:

```ts
type ListingValidationState =
  | "idle"
  | "loading"
  | "valid"
  | "invalid"
  | "stale";
```

Se qualquer dado que influencia o anúncio mudar depois de validado:

```text
categoria
preço
listing type
condição
estoque
atributos
GTIN
dimensões
peso
frete grátis
logística
imagem
```

marcar a validação como:

```text
stale
```

e impedir publicação até nova validação.

---

# 29. EVITAR RACE CONDITIONS

O formulário pode recalcular custos enquanto o usuário altera dados.

Exemplo:

```text
R$ 100
↓
R$ 120
↓
R$ 150
```

Não permitir que uma resposta da primeira cotação sobrescreva a terceira.

Use:

```text
AbortController
request id
sequenciamento
```

ou solução equivalente.

---

# 30. DEBOUNCE

Pode utilizar debounce curto:

```text
400–700 ms
```

para cálculos automáticos.

Mas:

```text
Validar anúncio
```

deve executar imediatamente.

---

# 31. UI DO MERCADO ENVIOS

Mostrar algo semelhante a:

```text
MERCADO ENVIOS

✓ Disponível

Logística
Drop Off

Peso da embalagem
900 g

Peso faturável
1.200 g
```

Usar nomes amigáveis para logística.

Exemplo:

```text
drop_off → Agência / ponto de despacho
cross_docking → Coleta / Cross Docking
self_service → Mercado Envios Flex
fulfillment → Mercado Envios Full
```

Mas os códigos reais devem permanecer internamente.

---

# 32. UI DE COTAÇÃO

Quando opcional:

```text
FORMA DE ENVIO

◉ Frete calculado pelo Mercado Livre
  Comprador paga o frete
  Custo estimado para o vendedor: R$ X,XX

○ Frete grátis
  Comprador não paga
  Custo estimado para o vendedor: R$ Y,YY
```

Se obrigatório:

```text
✓ Frete grátis obrigatório

O Mercado Livre exige frete grátis para esta publicação.

Custo estimado do vendedor:
R$ XX,XX
```

---

# 33. RESUMO DO ANÚNCIO

Antes de publicar:

```text
RESUMO DA PUBLICAÇÃO

Preço
R$ 150,00

Tipo
Clássico

Mercado Envios
ME2

Logística
Drop Off

Custo total por vender
R$ XX,XX

Custo estimado do envio
R$ YY,YY

Líquido estimado
R$ ZZ,ZZ
```

---

# 34. STATUS DA VALIDAÇÃO

Quando tudo estiver correto:

```text
✓ Categoria validada
✓ Mercado Envios disponível
✓ Logística confirmada
✓ Frete calculado
✓ Custos de venda calculados
✓ Publicação validada pelo Mercado Livre
```

Somente então:

```text
[ Publicar anúncio ]
```

deve ficar habilitado.

---

# 35. PAYLOAD DE SHIPPING

Para ME2, respeite exatamente o payload suportado pela documentação atual.

Exemplo observado na documentação:

```json
{
  "shipping": {
    "mode": "me2",
    "local_pick_up": false,
    "free_shipping": false,
    "free_methods": []
  }
}
```

Não adicionar:

```text
logistic_type
```

ao POST `/items` apenas porque ele foi retornado por `/shipping_modes`.

Primeiro confirme se o campo é documentado como aceito naquele payload.

O `logistic_type` deve ser usado para:

* análise;
* cálculo;
* validação;
* previsão;
* comparação pós-publicação.

---

# 36. PUBLICAÇÃO

Depois da validação:

```http
POST /items
```

Somente prosseguir se:

```text
validationState === valid
```

e os dados atuais corresponderem exatamente aos dados validados.

---

# 37. VERIFICAÇÃO PÓS-PUBLICAÇÃO

Depois da criação:

```http
GET /items/{ITEM_ID}
```

Confirmar:

```ts
item.shipping.mode === "me2"
```

e:

```ts
Boolean(item.shipping.logistic_type)
```

e:

```ts
item.shipping.local_pick_up !== true
```

quando a publicação exigir exclusivamente Mercado Envios.

Também conferir:

```text
free_shipping
```

contra o cenário selecionado.

---

# 38. PRESERVAR MECANISMO DE SEGURANÇA ATUAL

O projeto já possui lógica para fechar automaticamente um anúncio que foi solicitado como ME2 mas foi criado sem Mercado Envios.

PRESERVE ESSA PROTEÇÃO.

Evolua-a, não remova.

---

# 39. LOGÍSTICA PREVISTA X REAL

Antes de publicar:

```text
expectedLogisticType
```

Depois:

```text
actualLogisticType
```

Se houver diferença:

```text
expected = drop_off
actual = cross_docking
```

não fechar automaticamente apenas por serem diferentes.

Primeiro verificar se:

```text
actual
```

é uma logística ME2 válida retornada pelo Mercado Livre.

Registrar a diferença para diagnóstico.

---

# 40. USER PRODUCTS

O projeto atualmente verifica:

```text
user_product_seller
```

e pode usar:

```text
family_name
user_product_id
family_id
```

Preserve essa lógica.

Não introduza código que dependa exclusivamente de:

```text
title
```

se a conta já estiver no modelo User Product.

---

# 41. NÃO FAZER MIGRAÇÃO COMPLETA DE USER PRODUCTS

Esta tarefa não deve transformar todo o marketplace para uma arquitetura nova de User Products.

Somente:

* manter compatibilidade;
* evitar regressão;
* reutilizar informações existentes.

---

# 42. TIPOS TYPESCRIPT

Evite `any` nas novas estruturas centrais.

Crie tipos para:

```text
shipping modes
logistic option
shipping quote
free shipping policy
listing costs
listing validation
```

Exemplo:

```ts
type MercadoLivreShippingValidation = {
  available: boolean;
  mode: "me2" | null;
  logisticType: string | null;
  logistics: MercadoEnviosLogisticOption[];
  freeShippingPolicy: FreeShippingPolicy;
  quotes: MercadoLivreShippingQuotes;
  physicalWeight: number | null;
  billableWeight: number | null;
};
```

---

# 43. HELPER CENTRAL

Se a arquitetura atual justificar, extraia lógica compartilhada.

Exemplos conceituais:

```ts
resolveMercadoEnviosOptions()

buildMercadoLivreDimensions()

quoteMercadoEnvios()

normalizeMercadoEnviosQuote()

getMercadoLivreListingCosts()

validateMercadoLivreListing()
```

Não criar arquivos desnecessariamente.

Primeiro analise a arquitetura atual.

---

# 44. NÃO DUPLICAR CRIAÇÃO E EDIÇÃO

POST:

```text
/api/integracoes/mercadolivre/items
```

e PATCH:

```text
/api/integracoes/mercadolivre/items/[itemId]
```

devem compartilhar helpers sempre que possível.

Especialmente:

```text
shipping validation
dimensions
quote
error normalization
```

---

# 45. ERROS AMIGÁVEIS

Converter respostas técnicas em mensagens úteis.

Exemplos:

```text
Mercado Envios não está disponível para esta categoria.
```

```text
A conta vendedora não possui Mercado Envios habilitado.
```

```text
A logística selecionada não está disponível para este anúncio.
```

```text
O Mercado Livre recusou as dimensões ou o peso informado.
```

```text
Não foi possível calcular o custo do Mercado Envios.
```

```text
O Mercado Livre exige frete grátis para este anúncio.
```

```text
Revise o endereço de envio cadastrado na conta Mercado Livre.
```

```text
A publicação possui campos que precisam ser corrigidos antes do envio.
```

---

# 46. RAW RESPONSE PARA DIAGNÓSTICO

Pode preservar respostas brutas internamente para diagnóstico.

Não exibir JSON bruto ao usuário.

Nunca salvar ou logar:

```text
access_token
refresh_token
Authorization
client_secret
```

---

# 47. LOGS

Pode registrar:

```text
empresa_id
ml_user_id
category_id
listing_type_id
shipping_mode
logistic_type
free_shipping
status HTTP
erro normalizado
```

Nunca tokens.

---

# 48. ERRO 403

Se:

```text
shipping_options/free
shipping_modes
listing_prices
```

retornar erro relacionado a:

```text
403
PA_UNAUTHORIZED
permission
scope
```

não invente workaround.

Investigue:

* permissões funcionais;
* aplicação conectada;
* configuração atual no DevCenter;
* mudanças vigentes da plataforma.

Consulte:

[Gerencie seu aplicativo — Mercado Livre Developers](https://developers.mercadolivre.com.br/pt_br/gerencie-seu-aplicativo?utm_source=chatgpt.com)

---

# 49. TESTES UNITÁRIOS

Adicionar testes para os helpers alterados.

Cobrir:

## ME2 disponível

```text
mode = me2
logistic type disponível
```

## ME2 indisponível

```text
available modes sem me2
```

## Várias logísticas

```text
drop_off
cross_docking
```

com:

```text
default = true
```

## Frete grátis obrigatório

```text
policy = mandatory
```

## Frete grátis opcional

```text
policy = optional
```

---

# 50. TESTE DE SHIPPING QUOTE

Com resposta semelhante a:

```json
{
  "coverage": {
    "all_country": {
      "list_cost": 27.9,
      "currency_id": "BRL",
      "billable_weight": 1200
    }
  }
}
```

esperar:

```ts
sellerShippingCost === 27.9
currencyId === "BRL"
billableWeight === 1200
```

---

# 51. TESTE DE LISTING PRICES

Se:

```ts
price = 150

sale_fee_amount = 22.5

sale_fee_details.fixed_fee = 6

shippingCost = 27.9
```

então:

```ts
marketplaceCost = 22.5
```

e:

```ts
estimatedNetAmount =
  150
  - 22.5
  - 27.9;
```

NÃO:

```ts
150
- 22.5
- 6
- 27.9;
```

Esse teste é obrigatório para impedir dupla cobrança visual da taxa fixa.

---

# 52. TESTE DE /items/validate

Testar:

```text
204 No Content
```

como sucesso.

Não executar:

```ts
response.json()
```

obrigatoriamente após um `204`.

---

# 53. TESTE STALE

Validar:

```text
validation = valid
```

alterar:

```text
price
```

e esperar:

```text
validation = stale
```

Faça o mesmo para:

```text
dimensions
weight
category
listing type
free shipping
```

---

# 54. TESTE PÓS-PUBLICAÇÃO

Adicionar teste da função responsável por confirmar Mercado Envios.

Exemplo válido:

```json
{
  "shipping": {
    "mode": "me2",
    "logistic_type": "drop_off",
    "local_pick_up": false
  }
}
```

deve ser aceito.

Exemplo:

```json
{
  "shipping": {
    "mode": "custom"
  }
}
```

deve falhar quando ME2 for obrigatório.

---

# 55. NÃO PUBLICAR ANÚNCIO REAL AUTOMATICAMENTE

Durante desenvolvimento e testes automatizados:

NÃO publique um anúncio real utilizando a conta de produção.

Utilize mocks, testes unitários e `/items/validate`.

A documentação do Mercado Livre alerta que uma publicação real pode ficar visível no Marketplace.

Qualquer teste real deverá ser uma etapa manual controlada.

---

# 56. TESTE MANUAL FINAL

Ao final da implementação, prepare instruções para testar um produto simples com:

```text
condition = new

listingType = gold_special

shippingMode = me2

localPickup = false
```

com:

```text
categoria real
preço real
peso real
dimensões reais
imagem válida
estoque > 0
```

Fluxo:

```text
1. preencher anúncio
2. consultar ME2
3. obter logística
4. simular custos
5. consultar listing_prices
6. validar /items/validate
7. conferir resumo financeiro
8. publicar manualmente
9. consultar GET /items/{id}
10. confirmar ME2
```

---

# 57. CRITÉRIOS DE ACEITAÇÃO

A tarefa só estará concluída quando, antes da publicação, o ERP conseguir informar:

```text
Mercado Envios disponível:
SIM / NÃO

Modo:
ME2

Logística:
valor real retornado pelo ML

Política de frete grátis:
obrigatório / opcional / indisponível

Peso físico:
X

Peso faturável:
Y, quando retornado

Custo estimado do Mercado Envios:
R$ X

Tipo do anúncio:
Clássico / Premium / etc.

Custo total por vender:
R$ X

Detalhamento da taxa fixa:
R$ X

Líquido estimado:
R$ X

Validação Mercado Livre:
VÁLIDO / INVÁLIDO
```

---

# 58. PUBLICAÇÃO SÓ COM VALIDAÇÃO ATUAL

O botão:

```text
Publicar anúncio
```

somente pode estar ativo quando:

```text
validationState = valid
```

e:

```text
hash/dados atuais === dados validados
```

ou mecanismo equivalente.

---

# 59. CRITÉRIO PÓS-PUBLICAÇÃO

Depois do POST `/items`, o ERP deve conseguir confirmar:

```text
shipping.mode = me2
```

e:

```text
shipping.logistic_type presente
```

quando ME2 foi exigido.

Caso contrário:

* aplicar o mecanismo de fechamento automático já existente;
* não considerar a publicação válida;
* informar o erro claramente.

---

# 60. NÃO PARE NA ANÁLISE

Você deve EXECUTAR a implementação.

Processo esperado:

```text
1. analisar código atual
2. ler documentação oficial
3. comparar implementação x documentação
4. definir alterações mínimas necessárias
5. implementar backend
6. implementar frontend
7. extrair helpers quando necessário
8. adicionar tipos
9. adicionar testes
10. executar testes
11. executar lint/typecheck relevante
12. corrigir erros
13. revisar diff
14. verificar regressões
15. documentar resultado
```

Não entregue apenas recomendações.

---

# 61. NÃO FAZER

Não:

* reescrever toda a integração Mercado Livre;
* remover funcionalidades existentes;
* alterar OAuth sem motivo;
* criar nova arquitetura paralela;
* hardcodar frete;
* hardcodar comissão;
* hardcodar logística;
* hardcodar política de frete grátis;
* inventar campos da API;
* duplicar `fixed_fee`;
* criar migrations sem necessidade;
* mexer em NF-e;
* quebrar pedidos;
* quebrar etiquetas;
* quebrar sincronização de estoque;
* expor tokens;
* publicar anúncios reais automaticamente.

---

# 62. RELATÓRIO FINAL

Quando terminar, entregue:

## Arquivos analisados

Liste os principais.

## Arquivos alterados

Liste todos.

## Problemas encontrados

Explique de forma objetiva.

## Divergências com a documentação oficial

Liste qualquer diferença encontrada entre o código anterior e a API atual.

## Backend

Explique as alterações.

## Frontend

Explique as alterações.

## Mercado Envios

Explique o novo fluxo.

## Custos

Explique como:

```text
shipping cost
sale_fee_amount
fixed_fee
estimated net amount
```

passaram a ser tratados.

## APIs oficiais utilizadas

Liste:

```text
/categories/{CATEGORY_ID}/shipping_preferences

/users/{USER_ID}/shipping_preferences

/users/{USER_ID}/shipping_modes

/users/{USER_ID}/shipping_options/free

/sites/MLB/listing_prices

/items/validate

/items

/items/{ITEM_ID}
```

e quaisquer outras necessárias.

## Testes executados

Informe comando e resultado.

## Pendências

Somente pendências reais.

## Teste manual

Forneça passo a passo para criarmos um anúncio controlado e confirmarmos Mercado Envios.

---

# PRIORIDADE MÁXIMA

O Mercado Livre deve ser a **fonte de verdade**.

O ERP deve:

```text
consultar
↓
calcular
↓
mostrar
↓
validar
↓
publicar
↓
confirmar
```

Nunca:

```text
presumir
↓
publicar
↓
descobrir depois que estava errado
```

A melhoria deve tornar a criação de anúncios com Mercado Envios previsível, validável e segura, sem quebrar a integração já existente.
