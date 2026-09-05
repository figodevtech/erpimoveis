# Validação das regras de negócio

`npm run test:negocio` executa todos os arquivos `src/**/*.test.ts` e
`src/**/*.test.tsx`, com Node e `tsx`. O comando descobre arquivos novos
automaticamente e não precisa de credenciais de banco.

Os testes rodam no GitHub Actions junto da verificação de tipos, em pushes para
`main`/`develop` e em pull requests. Também são uma etapa obrigatória de
`npm run build`, pelo script `prebuild`; uma falha interrompe a compilação.
Executar `next build` diretamente não aciona os scripts do npm.

Para verificar a integração SQL das comissões, depois de aplicar a migração
`20260904180000_comissao_de_vendas.sql` na demonstração:

```sh
npm run db:test:sql -- supabase/tests/comissao_de_vendas.sql demo
```

Esse teste usa as conexões já configuradas em `.env.migrations.local` e precisa
dos cadastros básicos da demonstração. As alterações do cenário ficam em uma
transação encerrada com `ROLLBACK`. Ele verifica beneficiário, taxa, frete,
desconto, congelamento, publicação na DRE, fila financeira, parcelamento,
proteção contra duplicidade, pagamento e cancelamento. Não roda automaticamente
no CI nem no build, pois depende do banco de demonstração.
