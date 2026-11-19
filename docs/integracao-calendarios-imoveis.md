# Disponibilidade: ERP, Cespedes Living, Booking e Airbnb

## Implementação

O ERP usa `imovel_ocupacao` como fonte única para disponibilidade interna, cotação,
agenda pública e site Cespedes Living (modo API). Eventos iCal são bloqueios externos,
sem criar reservas financeiras ou hóspedes a partir de dados incompletos do calendário.

Na aba **Booking e Airbnb** de cada imóvel:

1. Abrir a plataforma, copiar o iCal exportado do anúncio e salvar no canal correto.
2. O ERP lê o calendário ao salvar. A tela mostra última atualização, períodos e erros.
3. Selecionar **Para Airbnb** ou **Para Booking**, copiar a URL de saída correspondente
   e importá-la no anúncio. As URLs diferem pelo destino para não devolver seus próprios eventos.
4. Usar **Atualizar agora** para consultar os canais (intervalo mínimo de 30 segundos).

Exportação: `/api/public/imoveis/ID/calendario.ics?canal=AIRBNB` ou `canal=BOOKING`.
O link sem `canal` continua funcionando, mas exporta apenas ocupações locais.
A exportação exige imóvel/proprietário ativos e imóvel publicado. A URL deve usar o
ERP público em HTTPS; não importar localhost ou preview protegido nas plataformas.

## Reconciliação e concorrência

- A identidade é `(calendário, UID)`; uma nova leitura atualiza o mesmo bloqueio.
- Eventos cancelados ou ausentes de um snapshot completo são inativados somente nessa origem.
- Falha HTTP, redirecionamento, timeout, resposta HTML, corpo acima de 2 MB, iCal inválido,
  recorrência ou datas com horários não suportados preservam os bloqueios anteriores.
- O parser aceita eventos de dias inteiros dos calendários de hospedagem; não importa
  nomes de hóspedes, descrições ou valores. Datas de saída são exclusivas.
- A leitura usa lease por calendário e token de execução. Snapshot com token/URL antigos
  não é aplicado. Reconciliar datas e atualizar o status ocorre numa transação no banco.
- Ocupações externas podem se sobrepor: o conflito é informado sem descartar bloqueios.
  Novas ocupações internas sobre datas externas ativas são barradas no banco.
- URLs de saída excluem os eventos originados no canal de destino. UIDs exportados pelo
  próprio ERP são ignorados na importação. Validar o comportamento de reexportação dos
  anúncios reais antes de ativar vendas: se um canal reescrever identificadores e remover
  a origem de eventos importados, o iCal pode não permitir distinguir um bloqueio espelhado.
- Bloqueios externos são gerenciados pelo feed; não podem ser liberados pela ação de
  exclusão de bloqueio manual. Remover o canal exclui somente suas ocupações externas.
  Para desconectar completamente, também remover na plataforma o calendário importado.

## Execução periódica e publicação

As migrations `20261119120000` e `20261119130000` estão aplicadas no banco Cespedes Living.
As rotas novas e a tela precisam ser publicadas para uso fora do desenvolvimento.

O `vercel.json` registra execução a cada 15 minutos:
`GET /api/integracoes/imoveis/calendarios/processar`.
Definir `CRON_SECRET` no ambiente de produção. O endpoint aceita GET/POST somente com
`Authorization: Bearer <CRON_SECRET>` e é dispensado da sessão do ERP no middleware.
Não retorna URLs nem tokens. Processa até 10 calendários por execução, priorizando os
mais antigos; em carteiras maiores, ampliar a capacidade e monitorar a fila.

A frequência de 15 minutos do Vercel Cron exige plano Pro/Enterprise. Não ativar um plano
pago automaticamente: se a hospedagem for Hobby, remover a entrada `crons` e configurar
um agendador externo/existente para chamar a mesma rota autenticada a cada 15 minutos.
Sem publicação, segredo e agendador ativo, o processamento periódico não ocorre.
O botão manual e a leitura ao salvar funcionam independentemente do agendador.

Antes de liberar:

1. Cadastrar um anúncio real e conferir os períodos importados no ERP e no site.
2. Importar a URL correspondente ao destino no Airbnb/Booking e conferir os bloqueios.
3. Alterar e cancelar uma reserva e conferir a liberação somente quando todas as origens
   liberarem o período. Testar também uma reserva criada pelo ERP/site.
4. Conferir conflito entre canais, falha do feed, última atualização e recuperação.
5. Conferir que o agendador realmente executa em produção com o segredo configurado.

## Validação executada

`npm run test:calendarios-imoveis`: parser/exportador, transporte e preservação em falhas.
`npm run db:test:calendarios-imoveis`: cenários transacionais sempre revertidos, incluindo
lease, edição, cancelamento, conflitos, desconexão e cotação real usada pelo site.
Os testes usam dados sintéticos; não substituem a validação com os anúncios reais.

## Limites do iCal

A frequência de consulta do ERP não força o Airbnb/Booking a ler a exportação. Pode haver
horas de atraso e risco de reservas simultâneas. Não sincroniza tarifas, pagamentos ou
cadastro completo de hóspedes. Sem assinatura de provedor, mas sujeito à infraestrutura
já contratada e aos limites de execução. A opção iCal precisa estar disponível no Booking.

Referências:
- https://www.airbnb.com/help/article/99
- https://www.youtube.com/watch?v=Smj-WfWpi4o (Booking.com Partners)
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://www.rfc-editor.org/rfc/rfc5545.html
