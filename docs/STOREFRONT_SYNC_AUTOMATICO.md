# Sincronização automática da loja

O ERP registra produtos novos, alterações de dados, estoque, fotos e publicação
na `site_catalog_sync_queue`. A rota autenticada `GET /api/integracoes/site/cron`
consome essa fila a cada minuto, conforme `vercel.json`. Não depende de alguém
abrir o ERP nem clicar em Sincronizar catálogo.

O envio usa `site_catalog_export`. O preço continua vindo de
`site_product_link.preco_site`, independente de `produto.precovenda`. O preço
do ERP só é usado como valor inicial ao criar o vínculo com a loja. As rotinas
de exportação não alteram esse vínculo nem o preço específico do site.

## Publicação

Publique o código atualizado do ERP e da loja. No projeto do ERP, configure:

- `CRON_SECRET`: segredo do agendador; a chamada exige Bearer mesmo em desenvolvimento.
- `STOREFRONT_API_URL`: origem final da loja desse cliente, sem redirecionamento.
- `STOREFRONT_CATALOG_SYNC_SECRET`: igual a `ERP_CATALOG_SYNC_SECRET` na loja.

O cron da Vercel executa somente no deployment de produção. O plano precisa
permitir agendamento por minuto. O mesmo código atende Demir e BR Peças usando
o banco e as variáveis de cada instalação, com validação de empresa única.
Não é necessário adicionar tabelas ou aplicar migrations nas lojas para esta rotina.

## Falhas e concorrência

Cada execução envia até três lotes de 100 produtos, dentro de um limite de
tempo. A fila reserva as linhas no banco; execuções simultâneas não reservam
os mesmos itens. Se houver edição durante o envio, a versão mais nova fica
pendente para outra rodada. Se a execução cair, a reserva expira em 15 minutos.

Falhas mantêm os itens na fila com erro e próxima tentativa automática,
com espera crescente de 5 minutos até 6 horas. O Marketplace mostra o estado
e o último erro. Os logs do ERP usam o prefixo `[site/cron]`.
Categorias são enviadas mesmo sem produtos pendentes, inclusive para ocultar
categorias desmarcadas no ERP.

## Desenvolvimento local

Enquanto a loja está no computador, o cron de produção não alcança localhost.
Com o preview da loja aberto, execute na raiz do ERP:

```powershell
npm.cmd run storefront:worker -- --site-url http://localhost:3011
```

O processo lê `.env.local`, valida a empresa e processa a fila a cada minuto.
O endereço informado só pode ser localhost/127.0.0.1; ele vale apenas para esse
processo e não muda os arquivos de ambiente nem o destino de produção.
Encerre com Ctrl+C. Para uma única rodada, acrescente `--once`.

```powershell
npm.cmd run test:storefront
```

Referências: [agendamento de produção](https://vercel.com/docs/cron-jobs/quickstart)
e [autenticação e execução dos crons](https://vercel.com/docs/cron-jobs/manage-cron-jobs).
