# Notificações da BRPeças — 20/10/2026

Diagnóstico por consulta somente de leitura ao banco da BRPeças: as execuções
NOTIFICATIONS ficaram PARCIAL por respostas HTTP 400 em recursos
`/sites/GBL/user-products-families/{id}`. A resposta exige `X-API-Version: 2`.
Além disso, `user_products` e `user_products_families` eram ignorados por falta
de processador, embora a variante legada `user-products-families` fosse tratada.

A correção inclui o cabeçalho apenas para famílias GBL, normaliza os tópicos
atuais e legados e reconcilia os anúncios locais vinculados a cada user product.
Os avisos continuam respeitando as preferências. Não altera preços no cadastro
de produtos nem envia alterações ao Mercado Livre.

Após publicar o ERP, o cron existente recupera até 15 eventos ignorados por
tópico em cada execução, apenas quando o motivo registrado é exatamente a
ausência daquele processador. Eventos processados não são reabertos. Os eventos
ERRO continuam usando o retry existente. Nenhuma migration é necessária.

Verificar a próxima execução NOTIFICATIONS e a redução das pendências. O painel
também mostra eventos históricos, portanto os avisos podem diminuir gradualmente.
179 testes da integração e lint dos arquivos alterados passaram localmente.
A tentativa de validar a consulta diretamente na API a partir do ambiente local
falhou no transporte; a resposta com o cabeçalho deve ser confirmada no ambiente
publicado. Nenhum dado de produção foi alterado durante o diagnóstico.

Referência: https://developers.mercadolivre.com.br/pt_br/lojas-oficiais/produto-receba-notificacoes
