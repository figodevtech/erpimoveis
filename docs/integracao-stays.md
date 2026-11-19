# Integração inicial Stays

## Escopo desta entrega

Conta Stays → anúncios → vínculo por imóvel → importação de reservas/bloqueios →
disponibilidade central do ERP e site Cespedes Living. Webhooks assinados antecipam a
reconciliação, com recuperação periódica no processador já existente.

Esta etapa só consulta a API remota (GET). Não cria anúncios, altera tarifas, faz cobrança
ou envia as reservas criadas no ERP/site à Stays. Portanto ainda não habilita a venda
simultânea completa: a saída ERP → Stays será uma etapa posterior, após teste da conta.
Não usar iCal como se fosse a confirmação de bloqueio imediato dos canais.

## Configuração para testar

1. Obter uma conta Stays de teste ou autorização para usar a API da conta do cliente.
   Confirmar o custo de API Externa com a Stays antes de ativá-la.
2. Configurar no servidor:
   - `STAYS_BASE_URL`: origem HTTPS do sistema, por exemplo `https://cliente.stays.net`.
   - `STAYS_CLIENT_ID` e `STAYS_CLIENT_SECRET`: credenciais de API Externa.
   - `STAYS_WEBHOOK_PUBLIC_KEY`: chave pública PEM fornecida pelo suporte Stays.
3. Usar `.env.local` para desenvolvimento e variáveis privadas no ambiente de hospedagem.
   Não usar `NEXT_PUBLIC_`, não enviar credenciais para navegador nem colocá-las no Git.
   A validação aceita subdomínios Stays `.stays.net` e `.stays.com.br`, sem redirecionamentos.
   Domínios próprios exigem ampliar conscientemente a validação antes de configurar.
4. Aplicar `20261119140000_integracao_stays_inicial.sql` no banco deste ERP.
5. Publicar e solicitar ao suporte Stays notificações em:
   `https://DOMINIO-DO-ERP/api/integracoes/stays/webhook`
   Eventos: `reservation.created`, `reservation.modified`, `reservation.canceled`,
   `reservation.deleted`, `reservation.reactivated`. O suporte fornece a chave pública
   da aplicação. O endpoint não aceita notificações sem assinatura válida e login correto.
6. No imóvel → Booking e Airbnb → Stays, carregar anúncios, selecionar o correspondente
   e vincular. A consulta de anúncios também verifica o acesso real à API.

Uma conexão configurada no servidor não significa credenciais já testadas. A interface
somente confirma anúncio vinculado após salvar o vínculo real. O vínculo é persistido
antes da primeira importação; se a leitura falhar, a tela permite tentar novamente.

## Fluxo e proteções

- O catálogo e as reservas são paginados em lotes de 20, como a documentação Stays.
- Importa reservas `reserved`, `booked`, `contract`, `blocked` e `maintenance` por
  `dateType=included`, com horizonte de dois anos. O UID local é `stays:<reservation_id>`.
- Somente dados mínimos de disponibilidade entram na ocupação: sem clientes, preços
  ou lançamentos financeiros. Cancelamentos e exclusões retiram o bloqueio dessa origem.
- A identidade da conta é vinculada ao domínio Stays. Trocar o ambiente não reutiliza
  silenciosamente os vínculos anteriores. Uma unidade só pode apontar para um imóvel
  do ERP por conta, e o imóvel tem um vínculo Stays por vez.
- Webhooks validam `x-stays-client-id` e a assinatura RSA SHA256 em
  `JSON.stringify({action,_dt,payload})`, conforme a documentação oficial.
- Não aplicamos cegamente o estado do webhook: consultamos o snapshot atual da Stays.
  Uma notificação atrasada não reabre datas usando um payload antigo.
- O hash do evento serve como recibo durável; não armazenamos o payload com dados pessoais.
  Eventos repetidos já concluídos recebem `{succeed:true}` sem duplicar importações.
- Falhas e lease ocupada retornam erro para permitir reenvio. Apenas após reconciliar
  confirmamos recebimento. Anúncios não vinculados são reconhecidos sem alterar imóveis;
  o vínculo posterior executa uma primeira leitura completa.
- A reconciliação usa o mesmo lock/lease e transação dos calendários; falha HTTP,
  resposta inválida, paginação truncada ou dados incoerentes preservam bloqueios anteriores.
- O processador periódico de calendários consulta até dois vínculos Stays por execução,
  alternando entre os vinculados. Não exige outro endpoint de agendamento. Webhooks são
  o caminho imediato; polling recupera falhas. Manter `CRON_SECRET` e o agendador ativos.
- A disponibilidade do site é lida da mesma `imovel_ocupacao`; não é necessário criar
  um calendário separado no site. Os bloqueios externos continuam visíveis no ERP.
- Evitar a dupla importação Stays + iCal dos mesmos anúncios. Após validar a Stays,
  retirar os vínculos iCal correspondentes no ERP e nas plataformas, com reconciliação
  prévia das reservas. Não desconectar os canais já usados pelo cliente na Stays.
- Desvincular remove somente os bloqueios Stays do ERP/site. A conexão Stays ↔ OTAs não
  é alterada. Esse efeito é confirmado na interface antes de executar.

## Testes antes de produção

- `npm run test:stays`: credenciais/destinos, paginação, payloads e assinatura.
- `npm run db:test:stays`: teste no banco com fixtures transacionais revertidas,
  vínculo único, isolamento de conta, cancelamento e cotação real do site.
- Com a conta real/de teste: carregar anúncios, vincular uma unidade, conferir reservas
  futuras, criar/alterar/cancelar uma reserva de teste na Stays e conferir webhook,
  ocupação do ERP e datas no site. Não prometer prazo de entrega sem medir a conta.
- Testar falha da API, reenvio de webhook e recuperação; confirmar ausência de mudanças
  em anúncios, preços e financeiro durante esta etapa.

Documentação de referência: https://stays.net/external-api/
Ativação da API: https://academy.stays.net/pt-BR/support/solutions/articles/36000279445-como-acessar-a-documentacao-api-da-stays/
