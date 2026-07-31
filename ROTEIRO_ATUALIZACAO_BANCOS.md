# Roteiro rápido — migrations dos bancos

As migrations ficam em `supabase/migrations`. Os comandos aplicam os mesmos
arquivos em cada banco; não é necessário copiar schema para o SQL Editor.

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

## 3. Atualizar Demir, AlphaGarage e Garage Premium

Se a Demonstração estiver funcionando:

```powershell
npm run db:deploy:clients
```

Digite `CLIENTES` quando solicitado. O comando confirma que a Demonstração está
atualizada, aplica no Demir, no AlphaGarage e no Garage Premium e compara os quatro bancos.

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
