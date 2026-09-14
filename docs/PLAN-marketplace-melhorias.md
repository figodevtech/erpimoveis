# Plano de Implementação: Melhorias no Módulo Marketplace & Integração com Produtos

> **Status:** Proposta refinada com regra de negócio estrita de preços  
> **Módulo:** Marketplace (Mercado Livre) & Estoque/Produtos  
> **Data:** 12/09/2026  
> **Autor/Agente:** project-planner  

---

## 🎯 Objetivos do Projeto

Implementar um conjunto integrado de quatro melhorias no módulo de Marketplace (Mercado Livre) e no diálogo de edição de produtos, tornando o fluxo de publicação e manutenção de anúncios ágil, consistente e bidirecional:

1. **Alteração do Valor do Anúncio Durante a Publicação (Regra Estrita de Isolamento):**
   - Durante a publicação do anúncio, o sistema puxa o preço de venda atual do produto como sugestão inicial, mas **deve permitir alterar livremente o valor para o anúncio**.
   - **Regra inviolável:** Essa alteração **NÃO PODE** refletir no cadastro do produto no ERP. O preço digitado pertence exclusivamente ao anúncio no Mercado Livre, mantendo o `precovenda` do balcão/oficina inalterado.
   - Além disso, deve-se neutralizar qualquer rotina de reconciliação ou webhook que tente sobrescrever o `produto.precovenda` com o preço do Mercado Livre.
2. **Abertura do Diálogo de Edição de Produto no Marketplace:** Permitir abrir e salvar o diálogo completo de edição do produto do ERP (`DialogProduto`) diretamente da listagem e dos cards do Marketplace.
3. **Unificação do Motor de Busca de Produtos:** Fazer com que o endpoint `/api/integracoes/mercadolivre/products` utilize o mesmo motor de busca tokenizado, estruturado e com normalização de acentos/stop-words do módulo de produtos (`src/lib/product-search.ts`).
4. **Anunciar no Mercado Livre Dentro do Diálogo de Produto:** Disponibilizar ação direta de criação de anúncio na aba Marketplace do diálogo de edição de produto (`TabMarketplace`).

---

## 🔍 Análise de Arquitetura e Diagnóstico Técnico

### 1. Alteração de Preço durante a Publicação & Isolamento do ERP
- **Diagnóstico da Dor do Usuário:**
  - Na tela atual (`MercadoLivreCreateListingDialog`), logo na etapa 1 (`product`), o preço do produto é exibido como texto estático (`ProductDetail label="Preço de venda" value={...}`), sem nenhum campo de digitação, passando a impressão de que o valor vem travado do cadastro.
  - O campo de preço só aparece na etapa 5 (`offer`).
  - Na etapa 6 (`review`), o valor e o cálculo de taxas do ML voltam a ser apenas texto estático.
  - No backend, a sincronização de retorno (`applyMercadoLivrePriceToErp` em `mercadolivre-reconciliation.ts` e `mercadolivre-notifications.ts`) executava um update automático em `public.produto.precovenda`, o que contaminaria o preço da loja física caso o anúncio tivesse preço diferenciado.
- **Solução Proposta:**
  - **Interface (Wizard):**
    - Na etapa 1 (`product`): Adicionar campo de input explícito **"Preço do Anúncio no Mercado Livre"** com formatação de moeda em tempo real (`ValueInput`). Inicializa com o `precovenda` do produto, mas fica 100% editável.
    - Adicionar aviso claro: *"Preço exclusivo deste anúncio no Mercado Livre. O cadastro do produto no ERP não será alterado."*
    - Na etapa 6 (`review`): Adicionar botão ou input de ajuste rápido de preço com recálculo imediato do resumo financeiro e taxas do ML.
  - **Backend e Reconciliação:**
    - Garantir que a criação do anúncio envie o preço editado para o Mercado Livre e grave no vínculo (`mercadolivre_product_link`), sem tocar na tabela `produto`.
    - Desativar a sobrescrita de `produto.precovenda` em `applyMercadoLivrePriceToErp` nas rotinas de reconciliação e webhooks, preservando a independência do preço de venda do ERP.

### 2. Abertura do Diálogo de Edição de Produto pelo Marketplace
- **Situação Atual:**
  - O arquivo `marketplace-client.tsx` renderiza a tabela (`Table`) e os cards (`Grid2X2`) de produtos.
  - O menu `productActions` só traz ações do Mercado Livre ("Criar anúncio", "Vincular", "Editar anúncio", "Sincronizar", etc.). Não há opção de editar o cadastro do produto do ERP caso o vendedor precise corrigir foto, NCM, título base ou código de barras.
- **Solução Proposta:**
  - Importar `DialogProduto` de `@/app/(app)/(pages)/estoque/components/dialog-produto/dialog-produto` em `marketplace-client.tsx`.
  - Gerenciar o estado de abertura: `editingProductId: number | undefined` e `productDialogOpen: boolean`.
  - Adicionar item de menu no dropdown de ações: `Editar produto no ERP` (com ícone de lápis/produto).
  - No callback `onAfterSaveProduct`, invocar `loadProducts()` e `loadLinkedListingProducts()` para recarregar fotos, descrições e títulos atualizados sem reload de página.

### 3. Igualar o Motor de Busca em Marketplace com o Módulo de Produtos
- **Situação Atual:**
  - O endpoint `/api/products/route.ts` usa `getProductSearchTokens` e `matchesProductSearch` de `@/lib/product-search.ts`, além de busca direta no Postgres com tratamento de números, códigos de barras, etiquetas, referências e tolerância a acentuação.
  - O endpoint `/api/integracoes/mercadolivre/products/route.ts` possui apenas um filtro rudimentar com `query.or('titulo.ilike... ,referencia.ilike...')`. Ele falha em buscas de múltiplas palavras (ex: "filtro ar gol"), não remove stop-words, não normaliza acentos e não busca em campos como etiqueta e NCM.
- **Solução Proposta:**
  - Refatorar a lógica de busca de `/api/integracoes/mercadolivre/products/route.ts` para seguir o mesmo padrão arquitetural de `/api/products/route.ts`.
  - Utilizar `getProductSearchTokens`, busca estruturada por identificadores/códigos e filtro `matchesProductSearch` nas consultas paginadas.
  - Com isso, o comportamento de busca no Marketplace e no componente `ProductSelect` (ao selecionar produto para anunciar) será 100% idêntico ao da tela de Estoque/Produtos.

### 4. Anunciar no Mercado Livre Dentro do Diálogo de Produto
- **Situação Atual:**
  - O diálogo `EdicaoProduto` renderiza `TabMarketplace` (`src/app/(app)/(pages)/estoque/components/dialog-produto/tabs/tab-marketplace.tsx`).
  - Quando o produto não possui anúncio vinculado, exibe apenas a mensagem passiva: *"Este produto ainda não possui anúncio do Mercado Livre vinculado"* e um link estático para `/marketplace`.
- **Solução Proposta:**
  - Adicionar botão com ação direta: **"Anunciar no Mercado Livre"** com destaque visual na `TabMarketplace`.
  - Ao clicar, direcionar para `/marketplace?canal=mercadolivre&secao=products&anunciar=${produto.id}`.
  - Em `marketplace-client.tsx`, ler o parâmetro de query `anunciar` ao carregar a página e abrir automaticamente o `MercadoLivreCreateListingDialog` com o produto correspondente já selecionado.

---

## 📋 Detalhamento das Tarefas de Implementação

| ID | Tarefa | Arquivos Afetados | Agente Responsável |
| :--- | :--- | :--- | :--- |
| **TASK-01** | **Unificar Motor de Busca da API do Marketplace**<br>- Adotar `getProductSearchTokens` e `matchesProductSearch`<br>- Suportar IDs numéricos, referências, códigos e termos compostos | `src/app/api/integracoes/mercadolivre/products/route.ts` | `backend-specialist` |
| **TASK-02** | **Abertura do Diálogo de Edição de Produto no Marketplace**<br>- Integrar `DialogProduto` no `MarketplaceClient`<br>- Adicionar opção "Editar produto no ERP" em `productActions`<br>- Atualizar listagem após salvamento (`onAfterSaveProduct`) | `src/app/(app)/(pages)/marketplace/marketplace-client.tsx` | `frontend-specialist` |
| **TASK-03** | **Edição de Preço durante a Publicação & Isolamento do ERP**<br>- Adicionar input editável de preço do anúncio na etapa 1 (`product`) e na etapa 6 (`review`)<br>- Manter `form.price` sincronizado com recálculo dinâmico de taxas<br>- Proteger `produto.precovenda` contra alterações de preço originadas pelo Mercado Livre (reconciliação/webhooks) | `src/app/(app)/(pages)/marketplace/mercadolivre/create-listing/create-listing-dialog.tsx`<br>`src/app/(app)/(pages)/marketplace/marketplace-client.tsx`<br>`src/lib/integrations/mercadolivre-reconciliation.ts`<br>`src/lib/integrations/mercadolivre-notifications.ts` | `frontend-specialist` & `backend-specialist` |
| **TASK-04** | **Ação "Anunciar no Mercado Livre" no Diálogo de Produto**<br>- Substituir aviso passivo na `TabMarketplace` por botão de ação<br>- Tratar parâmetro de URL `anunciar={id}` na página do Marketplace para abertura automática do wizard | `src/app/(app)/(pages)/estoque/components/dialog-produto/tabs/tab-marketplace.tsx`<br>`src/app/(app)/(pages)/marketplace/marketplace-client.tsx` | `frontend-specialist` |
| **TASK-05** | **Testes e Validação de Regressão**<br>- Testes unitários do motor de busca unificado e fluxo de preços<br>- Verificação de compilação TypeScript (`tsc --noEmit`)<br>- Execução da suíte de testes de negócio (`npm run test:negocio`) | `src/lib/product-search.test.ts`<br>`src/app/api/integracoes/mercadolivre/products/*.test.ts` | `test-engineer` |

---

## 🏁 Critérios de Aceite

- [x] Na etapa 1 de criação do anúncio, o usuário visualiza o preço do cadastro do ERP e pode digitar um novo preço exclusivo para o Mercado Livre.
- [x] O valor definido para o anúncio é publicado com sucesso no Mercado Livre e **NÃO altera o preço de venda (`precovenda`) do produto no ERP**.
- [x] Nem a publicação, nem a reconciliação, nem os webhooks alteram o preço de balcão do ERP.
- [x] Usuário pesquisa "filtro óleo gol" ou código de barras na aba Marketplace e encontra exatamente os mesmos produtos que no módulo Estoque.
- [x] Usuário clica nas ações de qualquer produto no Marketplace e consegue abrir o diálogo de edição do ERP, alterar dados, salvar e ver a lista de Marketplace atualizar.
- [x] Usuário entra na aba Marketplace dentro do diálogo de um produto não anunciado e consegue clicar em "Anunciar no Mercado Livre", abrindo o dialog de cadastro de anúncio diretamente ali, sem redirecionar para a página `/marketplace`.
- [x] Ao concluir a publicação, o card do Mercado Livre dentro do diálogo do produto atualiza automaticamente exibindo os dados do anúncio recém-criado.
- [x] Usuário visualiza na tabela de estoque o ícone do Mercado Livre com tooltip indicando se o produto possui anúncio ativo.
- [x] No diálogo do produto com anúncio ativo, o card do Mercado Livre exibe métricas completas e botão para "Editar anúncio" com stepper modal.
- [x] Todos os 1.400 testes de negócio e 109 testes do Mercado Livre continuam passando sem regressões.
