# Valores de compra das entradas fiscais

Os valores comerciais vigentes permanecem em `valor_unitario_compra` e `valor_total`.
O primeiro ajuste congela a referência anterior em `valor_unitario_compra_original`
e `valor_total_original`. Cada alteração exige motivo e gera um registro imutável
em `entrada_valor_ajuste`, com o usuário autenticado e os valores anteriores/novos.

O ajuste não movimenta quantidades, não modifica o XML, apropriações ou tributos,
e não altera transações financeiras nem custos já registrados em vendas/OS.
O último custo do cadastro só muda se a linha alterada for a compra confirmada
mais recente (`created_at`, ID da entrada e ID do item, em ordem decrescente).

## Interfaces

`PATCH /api/entradas/:id/valores` recebe:

```json
{
  "inventory": "produto",
  "versaoEsperada": 0,
  "motivo": "Valor efetivo da compra",
  "itens": [{ "id": 1322, "valorUnitarioCompra": 1500 }]
}
```

`inventory: "usoconsumo"` atende uso/consumo e geral. A rota exige a permissão
de edição do estoque correspondente. O campo não aceita quantidade ou alterações
de vínculo. Revisões antigas e entradas canceladas retornam 409.

As rotas de criação fiscal aceitam `ajustesValores` opcional:

```json
{
  "motivo": "Conferência da compra",
  "itens": [
    { "inventory": "produto", "numeroItemFiscal": 1, "valorUnitarioCompra": 1500 },
    { "inventory": "usoconsumo", "consolidado": true, "valorUnitarioCompra": 25 }
  ]
}
```

A linha consolidada só existe nos fluxos personalizado/híbrido. Criação original,
ajuste e financeiro solicitado são gravados na mesma transação. Sem ajustes, a
chamada continua usando o motor original.

O GET do financeiro retorna `versao_financeiro`; o POST deve enviá-la como
`versaoEsperada`. A rotina confere a revisão e o total, bloqueia lançamento
duplicado em qualquer metade da nota e cria o grupo de parcelas atomicamente.

## Instalação e verificação

Aplicar `20261016004029_entrada_ajuste_valores.sql` antes de disponibilizar o novo
código da aplicação. A migration é aditiva e não corrige automaticamente entradas
existentes. O custo real da #1255 deve ser informado pelo usuário na tela.

- `npm run db:test:entrada-valores` valida migration e cenários na demonstração,
  sempre dentro de uma transação revertida; aceita a chave de outro banco como argumento.
- `npm run test:entrada-valores:ui` testa o editor real em Edge sem janela,
  com HTTP simulado e capturas em `artifacts/entrada-valores-ui`.
- `npm run test:negocio` inclui as regras unitárias de cálculo e validação.

Notas mistas legadas podem ter apenas custos físicos nos cabeçalhos. O total
financeiro inclui os acréscimos fiscais preservados quando o snapshot híbrido
garante a nota integral ou o XML confirma que todas as linhas foram apropriadas.
