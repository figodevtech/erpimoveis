# Validação das regras de negócio

`npm run test:negocio` executa todos os arquivos `src/**/*.test.ts` e
`src/**/*.test.tsx`, com Node e `tsx`. O comando descobre arquivos novos
automaticamente e não precisa de credenciais de banco.

Os testes rodam no GitHub Actions junto da verificação de tipos, em pushes para
`main`/`develop` e em pull requests. Também são uma etapa obrigatória de
`npm run build`, pelo script `prebuild`; uma falha interrompe a compilação.
Executar `next build` diretamente não aciona os scripts do npm.

Para validar a edição dos eventos financeiros das reservas:

```sh
npm run db:test:edicao-eventos-reserva
```

O comando testa a migration de edição duas vezes e verifica custos manuais,
parcelas em aberto, ajustes de eventos já pagos, taxas administrativas automáticas,
consumo e repasses. Todo o cenário e as alterações de schema são revertidos com
`ROLLBACK`; a migration não é aplicada por esse teste. Os testes unitários também
verificam permissões, escopo da reserva e configuração de edição de transações.

`npm run db:test:exclusao-eventos-reserva` também verifica a exclusão de todos os
tipos de lançamento da reserva: preservação de outros custos do mesmo grupo,
taxa automática sem recriação, devolução do consumo ao estoque e exclusão de
despesas/repasses com correção do extrato. Baixas já pagas são preservadas e a
diferença vira ajuste financeiro. As migrations são testadas duas vezes, sempre
com `ROLLBACK`.

`npm run db:test:valor-reserva` valida também a receita da reserva, lançada
automaticamente somente no check-out (quando a hospedagem foi prestada), e não
na criação da reserva nem no pagamento, pelo ERP ou pelo site. A competência é
o dia do check-out registrado. Confere atualização do preço, edição/exclusão,
idempotência e cancelamento. O valor bruto aparece no painel de resultados,
independentemente de classificação na DRE; somente a taxa administrativa compõe
a receita da administradora. O teste inteiro roda em `ROLLBACK`, incluindo as
migrations.

A recuperação de referências faltantes em reservas já concluídas também é testada:
é idempotente, mantém registros excluídos pelo operador e não cria cobranças nem
inclui o valor bruto na DRE.

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
