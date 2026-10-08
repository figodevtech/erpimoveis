# Roteiro rápido — migrations dos bancos

As migrations ficam em `supabase/migrations`. Os comandos aplicam os mesmos
arquivos em cada banco; não é necessário copiar schema para o SQL Editor.

Para criar um banco do zero para um novo cliente, siga o
[roteiro de novos bancos](ROTEIRO_NOVOS_BANCOS.md).

## 1. Antes do commit/merge

```powershell
npm run lint
npx tsc --noEmit
npm run db:status
```

Uma migration nova pode aparecer como pendente. Não pode aparecer como
`somente no remoto`.

## 2. Atualizar somente a Demonstração

Depois do commit/merge na `main`:

```powershell
git switch main
git pull --ff-only origin main
npm ci
npm run db:deploy:demo
```

Esse comando faz o dry-run e aplica migrations somente na Demonstração. Teste
no ERP todos os fluxos afetados antes de continuar.

## 3. Atualizar Demir e Garage Premium

Se a Demonstração estiver funcionando:

```powershell
npm run db:deploy:clients
```

Digite `CLIENTES` quando solicitado. O comando confirma que a Demonstração está
atualizada, aplica no Demir e no Garage Premium e compara os três bancos.

### Ordem especial para `20260820170000_public_schema_lockdown`

Essa migration remove o acesso direto de `anon` e `authenticated` às tabelas,
views, sequences e funções da aplicação. Antes de aplicá-la nos clientes:

1. publique a versão nova da aplicação em cada projeto da Vercel;
2. remova a variável `OPEN_PERMISSIONS` de Preview, Production e Development;
3. valide login, Dashboard, Clientes, Ordens, Estoque, Financeiro,
   Configurações e Usuários na Demonstração;
4. somente então execute `npm run db:deploy:clients`.

Não recrie `OPEN_PERMISSIONS`: a aplicação não utiliza mais essa opção.

## 4. Conferência final

```powershell
npm run db:status
```

O resultado esperado é `bancos alinhados e sem migrations pendentes`.

## Atalho para fazer todo o fluxo

```powershell
npm run db:deploy
```

Esse atalho atualiza a Demonstração, pausa para testes e só atualiza os clientes
depois das confirmações `DEMO` e `CLIENTES`.

## Regras

- Não executar migrations pelo SQL Editor.
- Não usar `--include-all`.
- Não editar uma migration que já foi aplicada.
- Não colocar migrations novas em `supabase/migrations/old`.
- Nunca versionar `.env.local` ou `.env.migrations.local`.
