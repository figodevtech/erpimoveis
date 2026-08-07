# Capturas dos módulos com Playwright

## Roteiro rápido

Execute os comandos abaixo no PowerShell, a partir da raiz do projeto.

### Primeira execução na máquina

1. Instale as dependências do projeto:

```powershell
npm install
```

2. Crie o arquivo local de configuração:

```powershell
Copy-Item .env.capture.example .env.capture
```

3. Abra `.env.capture` e preencha pelo menos estas variáveis com uma conta da Demonstração:

```env
CAPTURE_BASE_URL=http://127.0.0.1:3100
CAPTURE_EMAIL=email-da-conta
CAPTURE_PASSWORD=senha-da-conta
```

A conta precisa ter permissão para acessar todos os módulos que serão capturados. Não envie `.env.capture` para o Git, pois ele contém a senha e o estado de autenticação.

### Capturar todos os módulos

```powershell
npm run capture:all
```

Não é necessário iniciar `npm run dev` separadamente. O comando inicia o ERP local na porta configurada, autentica, gera as imagens e encerra o servidor ao terminar.

### Capturar somente as três telas de apresentação em alta resolução

```powershell
$env:CAPTURE_ONLY="estoque-produtos,acompanhamento,acompanhamento-financeiro"
$env:CAPTURE_DEVICE_SCALE_FACTOR="2"
$env:CAPTURE_SCREENSHOT_SCALE="device"
npm run capture:all
```

As imagens terão uma área visível equivalente a `1440x900`, mas serão gravadas em `2880x1800`, ficando mais legíveis quando usadas como miniaturas.

Ao terminar, limpe as variáveis temporárias da sessão do PowerShell:

```powershell
Remove-Item Env:CAPTURE_ONLY -ErrorAction SilentlyContinue
Remove-Item Env:CAPTURE_DEVICE_SCALE_FACTOR -ErrorAction SilentlyContinue
Remove-Item Env:CAPTURE_SCREENSHOT_SCALE -ErrorAction SilentlyContinue
```

### Conferir o resultado

As três imagens serão gravadas em:

- `artifacts/captures/estoque-produtos.png`;
- `artifacts/captures/acompanhamento.png`;
- `artifacts/captures/acompanhamento-financeiro.png`.

Confira também `artifacts/captures/report-partial.json`. Cada tela concluída deve aparecer com o status `captured`. O painel de Acompanhamento é preparado automaticamente com o setor `Visão geral` e a captura aguarda o carregamento das ordens terminar.

Sempre revise visualmente os PNGs antes de usá-los externamente, mesmo com a anonimização automática.

## 1. Configuração local

Copie `.env.capture.example` para `.env.capture` e informe uma conta dedicada à Demonstração:

```env
CAPTURE_BASE_URL=http://127.0.0.1:3100
CAPTURE_EMAIL=capturas@example.invalid
CAPTURE_PASSWORD=senha-da-conta-demo
CAPTURE_SEED_CONFIRM=DEMONSTRACAO
CAPTURE_HIDE_FINANCIAL_VALUES=false
CAPTURE_FULL_PAGE=false
CAPTURE_DEVICE_SCALE_FACTOR=1
CAPTURE_SCREENSHOT_SCALE=css
```

`.env.capture` e o estado autenticado em `playwright/.auth/` são ignorados pelo Git. O estado contém cookies de acesso e não deve ser compartilhado.

## 2. Dados fictícios

Revise `scripts/captures/seed-demo.ts` e execute:

```powershell
npm run capture:seed:demo -- --apply
```

O comando possui duas travas: exige `CAPTURE_SEED_CONFIRM=DEMONSTRACAO` e valida o identificador do projeto Supabase. Ele se recusa a executar nos bancos dos clientes. Os registros usam o marcador `[CAPTURA PLAYWRIGHT]` e são atualizados de forma idempotente.

Para preencher especificamente o estoque com um catálogo mais apresentável, execute no SQL Editor do projeto de Demonstração o arquivo `scripts/captures/seed-demo-products.sql`. Ele cria ou atualiza 15 peças fictícias com referências `DEMO-*`, sem apagar os demais produtos.

## 3. Gerar todas as capturas

```powershell
npm run capture:all
```

O Playwright inicia o projeto local quando necessário, autentica a conta e percorre as rotas definidas em `tests/captures/support/modules.ts`.

Por padrão, cada imagem representa uma tela normal de `1440x900`, mantendo o menu lateral com a mesma altura da captura. Use `CAPTURE_FULL_PAGE=true` somente quando precisar registrar todo o conteúdo rolável da página.

Para imagens destinadas a miniaturas, use `CAPTURE_DEVICE_SCALE_FACTOR=2` junto com `CAPTURE_SCREENSHOT_SCALE=device`. A área visível continua sendo `1440x900`, mas o PNG resultante possui `2880x1800` e mantém melhor legibilidade quando reduzido.

Arquivos gerados:

- imagens: `artifacts/captures/*.png`;
- relatório: `artifacts/captures/report.json`;
- traces de falha: `artifacts/playwright/`.

Rotas sem permissão são registradas como `unauthorized` e não geram imagem. Para capturar todos os módulos, a conta deve possuir todas as permissões correspondentes.

Para atualizar somente módulos específicos, informe os slugs separados por vírgula. Essa execução grava `report-partial.json` sem substituir o relatório completo:

```powershell
$env:CAPTURE_ONLY="dashboard,clientes"
npm run capture:all
Remove-Item Env:CAPTURE_ONLY
```

## 4. Proteção de dados

Antes de cada screenshot, a automação substitui e-mails, documentos, telefones, placas, CEPs e a identidade da conta conectada. Colunas de tabela identificadas como cliente, proprietário, usuário, responsável, documento, contato, placa ou chassi também são neutralizadas.

Para reforçar a proteção em um componente específico:

```tsx
<span data-capture-sensitive>{valorPrivado}</span>
```

Para remover um elemento somente das capturas:

```tsx
<div data-capture-hide>Conteúdo interno</div>
```

Defina `CAPTURE_HIDE_FINANCIAL_VALUES=true` para substituir valores monetários. Mesmo com a anonimização, revise visualmente as imagens antes de publicá-las.
