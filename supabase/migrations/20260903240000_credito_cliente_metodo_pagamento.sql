-- Crédito Cliente como forma de pagamento.
--
-- Não é dinheiro entrando: é o saldo da carteira do cliente
-- (`cliente.saldo_credito`, criada em 20260903230000) sendo consumido para
-- quitar o que ele devia — ou aumentado, quando o título é a pagar.
--
-- Fica em arquivo próprio, sem usar o valor em nada aqui: o Postgres recusa
-- usar um valor de enum na mesma transação em que ele foi adicionado. Quem usa
-- é `20260903250000_baixar_com_credito_cliente`, já com este valor commitado.
alter type public.metodo_pagamento add value if not exists 'CREDITO CLIENTE';
