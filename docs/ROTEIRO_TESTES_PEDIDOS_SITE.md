# Testes dos pedidos do Site — Sandbox

## Preparação

1. Publicar o código atualizado do ERP e da loja. As migrations de devolução integral e boleto já foram aplicadas na Demir; publicar o frontend não aplica migrations.
2. Na loja, conferir que a API Asaas é Sandbox e que a chave e a wallet da Figo pertencem ao Sandbox. Conferir URLs públicas HTTPS dos webhooks e os respectivos tokens, sem divulgar seus valores.
3. No ERP, `STOREFRONT_API_URL` deve apontar para a loja testada. Em teste local: ERP 3000, central 3001 e loja 3002. Asaas não alcança localhost; eventos externos precisam de endpoint público.
4. Usar uma unidade de um produto escolhido e anotar os saldos iniciais na loja e no ERP. Fazer um cenário por vez. Não despachar mercadoria real nos testes.
5. Após cada teste, verificar pagamento oficial, situação da venda e saldos das duas bases. Só avançar depois de recuperar exatamente as quantidades iniciais. Não corrigir saldo diretamente para esconder uma falha.

## Boleto pago e reembolso — pendente de teste completo

1. Comprar no checkout com boleto e uma unidade. Antes do pagamento, confirmar que não houve baixa de estoque.
2. Simular a liquidação pelo recurso oficial do Sandbox Asaas. Confirmar que o pagamento ficou recebido e que o pedido foi importado, com baixa única nas duas bases.
3. No Marketplace, abrir Ações → Cancelar e estornar e informar o motivo, antes do envio.
4. Abrir ou copiar o formulário do boleto exibido no pedido. O pagador precisa preenchê-lo conforme a orientação do Asaas. Não enviar documentos fictícios ou de terceiros.
5. Enquanto aguarda o cliente/Asaas, verificar que a venda não está cancelada e que o estoque não foi reposto.
6. Consultar até confirmação oficial de reembolso. Confirmar cancelamento e reposição única. Consultar e sincronizar novamente: o estoque não deve aumentar outra vez.

Se o formulário não puder ser concluído com os recursos do Sandbox, obter instruções do suporte Asaas. Esse cenário não está validado de ponta a ponta apenas porque a API devolveu um link.

## Devolução integral — repetir pela página autenticada

1. Comprar com cartão fictício ou Pix pago manualmente no Sandbox. No Pix, usar o código Copia e Cola em Pix → Transferências, conforme orientação do suporte, para simular lastro.
2. Registrar andamento até enviado/entregue usando rastreio de teste; não enviar produto real.
3. Abrir Ações → Solicitar devolução física. Informar motivo e rastreio reverso, se disponível.
4. Conferir que atualizar andamento e estornar antes do recebimento estão bloqueados.
5. Abrir Conferir recebimento da devolução. Verificar a lista, as quantidades e a condição de todos os itens; registrar a nota e confirmar explicitamente que todos estão aptos ao estoque.
6. Usar Reembolsar devolução recebida e consultar até a confirmação. Conferir reposição única na loja e no ERP e manutenção das datas de envio/recebimento.
7. Repetir a consulta/sincronização e verificar que não ocorre segunda reposição.

O backend foi testado com compra Sandbox #29 e o componente com respostas controladas; a repetição autenticada na página publicada ainda falta. O teste isolado de navegador não comprova layout com o CSS completo nem autenticação real.

## Controle pela página

- Pesquisa por número do pedido e filtros de estorno, devolução, cancelamento e erro de importação.
- Próxima ação na lista; Ações → Detalhes do pedido mostra itens, endereço completo, rastreios, motivos e datas registradas. Essas datas não constituem um histórico de auditoria de todas as alterações.
- Confirmar os menus em celular e computador com a sessão real e as permissões de vendas.
- Testar notificações de Site e Mercado Livre separadamente, envio/retirada, cliente/endereço/produtos/quantidades e deduplicação.

## Ainda requer implementação ou validação específica

- Estorno parcial e conferência por item de devolução parcial/danificada: o fluxo atual é integral; não marcar todos os itens aprovados para contornar esse limite.
- Integração de cotação, etiquetas, custos e frete reverso com um fornecedor; o rastreio reverso atual é manual.
- Tratamento operacional completo de contestação/chargeback e histórico de auditoria.
- Paginação da importação acima de 100 pedidos, concorrência da última unidade e recuperação entre bases com falhas reais.
- Cenários fiscais de NF-e autorizada/cancelamento/devolução. Os bloqueios atuais não substituem emissão de documento fiscal de devolução.
- Cartão de débito: não é uma opção implementada no checkout atual.

## Opções de frete para avaliar

Melhor Envio é um candidato para a primeira integração: possui API e logística reversa PAC/SEDEX. A documentação informa que o Sandbox não gera a etiqueta reversa nem o código de devolução; validar essa parte exige um plano assistido de homologação com o fornecedor. Fonte: https://docs.melhorenvio.com.br/reference/inserir-logistica-reversa-no-carrinho

Correios diretamente é alternativa para quem pretende contratar o serviço e manter integração própria. O Web Service de logística reversa exige contrato específico. Fonte: https://www.correios.com.br/atendimento/developers/arquivos/manual-de-implementacao-do-web-service-logistica-reversa.pdf

Antes de escolher, comparar cobertura para peso/dimensões das peças, regiões atendidas, coleta e custos reais da Demir. Nenhum fornecedor foi configurado ou contratado nesta alteração.
