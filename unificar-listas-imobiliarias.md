# Plano de Unificação Front-End: Imóveis, Proprietários e Reservas

Alinhar a arquitetura visual e a experiência de usuário das listagens de **Imóveis**, **Proprietários** e **Reservas** com o padrão de **Clientes** (`src/app/(app)/(pages)/clientes`).

---

## 🎯 Objetivos de Design e Interface

1. **Padrão de KPIs no Topo (Cards)**:
   - Grade responsiva de 3 cards (`grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 mb-6`).
   - Cards com títulos, ícones descritivos, números grandes em destaque e subtítulos explicativos.
   - Skeletons durante o carregamento.

2. **Barra de Busca e Filtros Estilizada**:
   - Container arredondado (`bg-card p-4 rounded-2xl shadow-sm border border-primary/30`).
   - Campo de busca com ícone de lupa à esquerda e botão "X" de limpar busca à direita.
   - Seleção de status e filtros específicos alinhados no grid responsivo.

3. **Lista dentro de Card**:
   - Container `<Card>` padronizado com `<CardHeader className="border-b-2 pb-4">`.
   - Cabeçalho com título da lista ("Lista de Imóveis", "Lista de Proprietários", "Lista de Reservas"), botão "Recarregar" com spinner inline (`Loader2`).
   - Ações no cabeçalho: botão primário de novo cadastro ("+ Imóvel", "+ Proprietário", "+ Reserva") e alternador Lista/Calendário para reservas.
   - `<CardContent>` com barra de progresso animada no topo durante loading.
   - Tabela estilizada com tipografia compacta e status badges consistentes.
   - Paginação limpa com seleção de registros por página e botões de navegação.

---

## 🗂️ Arquitetura por Módulo (Componentes Dedicados)

### 1. Backend / APIs
- [x] Adicionado suporte a contadores de status/KPIs em `src/lib/imobiliario/internal-api.ts` para `imoveis`, `proprietarios` e `reservas` via rota `GET /api/{modulo}/status-counter`.

### 2. Módulo de Imóveis (`src/app/(app)/(pages)/imoveis`)
- [x] `types.ts`: Tipos de filtros, paginação e KPIs de imóveis.
- [x] `components/cards.tsx`: KPIs (Total de Imóveis, Imóveis Disponíveis, Ocupados/Outros).
- [x] `components/searchfilter.tsx`: Barra de busca + filtro de situação operacional + proprietário.
- [x] `components/imoveis-data-table.tsx`: Card container + header de ações ("+ Imóvel") + barra de loading + tabela de imóveis + paginação.
- [x] `page.tsx`: Orquestração do estado, busca com debounce e filtros.

### 3. Módulo de Proprietários (`src/app/(app)/(pages)/proprietarios`)
- [x] `types.ts`: Tipos de filtros, paginação e KPIs de proprietários.
- [x] `components/cards.tsx`: KPIs (Total de Proprietários, Proprietários Ativos, Proprietários Inativos).
- [x] `components/searchfilter.tsx`: Barra de busca + filtro de status (Ativo/Inativo).
- [x] `components/proprietarios-data-table.tsx`: Card container + header com botão ("+ Proprietário") + barra de loading + tabela + paginação.
- [x] `page.tsx`: Orquestração do estado e busca.

### 4. Módulo de Reservas (`src/app/(app)/(pages)/reservas`)
- [x] `types.ts`: Tipos de filtros, paginação e KPIs de reservas.
- [x] `components/cards.tsx`: KPIs (Total de Reservas, Confirmadas/Em andamento, Concluídas/Canceladas).
- [x] `components/searchfilter.tsx`: Barra de busca + filtro de status + período (início/fim) + imóvel.
- [x] `components/reservas-data-table.tsx`: Card container + header com switcher (Lista / Calendário) e botão ("+ Reserva") + barra de loading + tabela + paginação.
- [x] `page.tsx`: Orquestração de estado e suporte alternado para visão de lista ou calendário.

---

## 🧪 Critérios de Verificação
1. [x] `GET /api/imoveis/status-counter`, `GET /api/proprietarios/status-counter` e `GET /api/reservas/status-counter` configurados com agregações exatas.
2. [x] Página `/imoveis` renderiza os 3 cards de KPI, a barra de busca arredondada e a tabela dentro do Card com ações.
3. [x] Página `/proprietarios` renderiza os 3 cards de KPI, a barra de busca arredondada e a tabela dentro do Card com ações.
4. [x] Página `/reservas` renderiza os 3 cards de KPI, a barra de busca arredondada com datas, e a alternância entre tabela no Card e calendário.
5. [x] Todos os diálogos de criação/edição (`EntityDialog`) continuam funcionando normalmente.
6. [x] TypeScript typecheck sem nenhum erro (`npx tsc --noEmit` executado com código 0).
