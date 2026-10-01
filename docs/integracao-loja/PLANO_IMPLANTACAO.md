# Plano de implantação — Loja própria integrada ao ERP

## Objetivo

Integrar o ERP à loja Demir Diesel por APIs HTTPS, mantendo bancos, autenticação,
checkout e pedidos independentes. O ERP é a fonte de verdade de produto, preço e
estoque físico. A loja mantém um espelho somente dos dados publicáveis.

`produto.exibirPdv` continua pertencendo exclusivamente ao Ponto de Venda.

## Arquitetura

```text
ERP (produto/preço/estoque)
  -> site_product_link
  -> site_catalog_sync_queue
  -> worker assinado com HMAC
  -> API da loja
  -> Supabase exclusivo da loja

Supabase da loja (pedido pago)
  -> fila de exportação
  -> API do ERP
  -> venda com canal ONLINE
```

Nenhum sistema recebe credenciais do banco do outro.

## Responsabilidades

### ERP

- cadastro base do produto;
- preço e estoque físico;
- decisão de publicação no canal Loja;
- preço específico e margem de segurança do canal;
- fila, retentativa e auditoria da sincronização;
- importação idempotente de pedidos pagos.

### Loja

- catálogo público espelhado;
- login, clientes, endereços e favoritos;
- carrinho, reservas locais, checkout e pagamentos;
- histórico de pedidos;
- exportação assíncrona dos pedidos pagos.

## Marcos

### M0 — Organização e contrato

- [x] Separar credenciais do Supabase da loja.
- [x] Criar endpoint inicial ERP -> loja.
- [x] Criar schema inicial do banco da loja.
- [x] Documentar o contrato inicial.
- [x] Isolar `site_demirdiesel/` do Git e do TypeScript do repositório pai.
- [ ] Trocar autenticação Bearer por HMAC com timestamp e event ID.

### M1 — Canal Loja no ERP

- [x] Criar migration de `site_product_link`.
- [x] Criar migration de `site_catalog_sync_queue`.
- [x] Criar funções de enfileiramento e reserva de tarefas.
- [x] Criar trigger incremental de produto.
- [x] Adicionar Loja ao seletor de Marketplace.
- [x] Criar API inicial de consulta e configuração da publicação.
- [x] Criar visão inicial Produtos da Loja.

### M2 — Sincronização ERP -> loja

- [ ] Implementar assinatura/verificação HMAC compartilhada.
- [ ] Implementar worker do ERP.
- [ ] Processar tarefas em lotes de até 100 produtos.
- [ ] Registrar sucesso, erro e próxima tentativa.
- [ ] Tornar o recebimento transacional e idempotente na loja.
- [ ] Criar ação “Sincronizar agora”.

### M3 — Banco e carga piloto

- [ ] Criar o projeto Supabase exclusivo da loja.
- [ ] Aplicar o schema revisado da loja.
- [ ] Configurar ambientes Development, Preview e Production.
- [ ] Publicar 5 a 10 produtos piloto.
- [ ] Validar preço, estoque, categoria, imagens, pausa e exclusão.
- [ ] Executar a carga completa em lotes.

### M4 — Operação e reconciliação

- [ ] Criar painel de saúde da sincronização.
- [ ] Criar reconciliação completa diária.
- [ ] Alertar fila parada e erros recorrentes.
- [ ] Medir atraso máximo e taxa de falha.

### M5 — Pedidos pagos loja -> ERP

- [ ] Criar endpoint idempotente de importação de pedido no ERP.
- [ ] Criar fila de exportação no banco da loja.
- [ ] Criar venda ERP com canal `ONLINE` após pagamento confirmado.
- [ ] Vincular `site_order_id` único à venda.
- [ ] Reconciliar cancelamento, estoque e rastreamento.

## Regras do canal Loja

O estoque publicável é calculado por:

```text
disponível = max(estoque ERP - estoque de segurança, 0)
estoque da loja = min(disponível, estoque máximo), quando houver máximo
```

O preço publicável é:

```text
preço da loja = preço específico, quando preenchido
preço da loja = produto.precovenda, caso contrário
```

Um produto somente é enviado como visível quando:

- o vínculo do canal está `PUBLICADO`;
- o produto não está excluído;
- o grupo não está inativo;
- o preço calculado é maior que zero.

Produtos pausados ou excluídos são enviados como tombstone (`visible=false`),
preservando os itens de pedidos antigos.

## Segurança do transporte

Cada requisição deve usar:

```text
X-Integration-Event-Id: UUID
X-Integration-Timestamp: epoch em segundos
X-Integration-Signature: sha256=<HMAC do timestamp + ponto + corpo bruto>
```

- rejeitar timestamp com diferença maior que cinco minutos;
- armazenar `event_id` para impedir replay;
- usar um segredo por direção;
- nunca compartilhar service role ou conexão de banco;
- limitar tamanho e quantidade de itens por lote.

## Critérios para liberar produção

- alteração de estoque chega à loja no prazo definido;
- reenvio do mesmo evento não duplica dados;
- produto pausado desaparece sem apagar histórico;
- falha HTTP entra em retentativa e fica visível no ERP;
- loja continua operando durante indisponibilidade temporária do ERP;
- pedido pago é importado no máximo uma vez;
- nenhuma credencial de banco cruza os sistemas.
