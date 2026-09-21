# Descrições com IA pela Central

Fluxo: navegador → servidor ERP → `/api/v1/ia/descricao-produto` na Central → OpenAI.
O botão fica junto à descrição na aba Geral, no cadastro e na edição do produto,
e também na descrição da aba Marketplace da edição. A sugestão tem até
300 caracteres e só substitui a descrição após **Aplicar descrição**. O usuário
salva o produto normalmente; nenhum anúncio é publicado automaticamente.

## Ativação

1. Aplicar **somente no banco da Central**, nesta ordem, as migrations
   `central.figosoftwares.com.br/supabase/migrations/20260916160000_ai_descriptions_pilot.sql`
   `central.figosoftwares.com.br/supabase/migrations/20260916170000_ai_usage_dashboard.sql`
   e `central.figosoftwares.com.br/supabase/migrations/20260917160000_ai_company_quotas.sql`.
   A migration do piloto local do ERP foi removida antes de ser aplicada.
2. Na configuração privada do servidor da **Central**, definir:

   ```dotenv
   OPENAI_API_KEY=preencher_localmente
   IA_DESCRICOES_ENABLED=true
   ```

3. Publicar/reiniciar a Central com a rota nova. Depois publicar o ERP.
4. O ERP usa as credenciais existentes `PLATFORM_API_URL`,
   `PLATFORM_INSTALLATION_ID` e `PLATFORM_API_SECRET`. Não configurar a chave
   OpenAI no ERP, no navegador, no Git ou no chat.
5. Testar com instalação ativa, assinatura ACTIVE/PAST_DUE e usuário com permissão
   de criar ou editar estoque. Assinaturas BLOCKED/CANCELED não usam a IA.

## Piloto e consumo

A Central identifica a empresa pelas credenciais da instalação, nunca por um ID
de empresa enviado pelo ERP. Só recebe dados descritivos do produto e o ID do
usuário autenticado do ERP (para auditoria).

- Modelo fixo `gpt-4.1-mini-2025-04-14`, Responses API, `store: false`, 200 tokens
  máximos de saída e entrada limitada. Sem repetição automática.
- Reserva atômica centralizada: cotas editáveis por empresa, inicialmente 20 tentativas/dia UTC e 100/mês UTC;
  500 tentativas globais no piloto. Duplicatas da mesma instalação não chamam a
  OpenAI novamente. Falha no controle de consumo bloqueia a chamada.
- Erros/timeouts também contam como tentativas: o provedor pode já ter consumido
  recursos. Isso não representa cobrança ao cliente.
- `ai_description_usage` registra empresa, instalação, usuário, horário, estado,
  modelo, ID da resposta e tokens das gerações concluídas. Não guarda textos.
- O menu Inteligência Artificial (`/ia`) mostra consumo por empresa, períodos,
  cotas e custo estimado em USD, incluindo o desconto de tokens em cache.
- O filtro `?mes=YYYY-MM` lista apenas meses com atividade e abre no mais recente.
  Sem registros, mostra "Sem atividade". Tentativas, concluídas, tokens, custos locais e custos da OpenAI
  respeitam o mesmo mês. Saldo disponível estimado e cotas são atuais e não
  representam o fechamento histórico do mês selecionado.
- O painel atualiza os dados locais a cada minuto enquanto está visível. O gráfico
  mostra as tentativas dos últimos 14 dias. A referência manual de saldo é opcional.
- Para consultar gastos oficiais automaticamente, configurar `OPENAI_ADMIN_KEY`
  **somente na Central**, com uma chave administrativa da organização OpenAI.
  A chave comum `OPENAI_API_KEY` continua sendo usada apenas para gerar textos.
  `OPENAI_COSTS_PROJECT_ID` restringe o relatório a um projeto; sem esse filtro,
  os custos exibidos são de toda a organização, incluindo outros sistemas.
- A consulta `/v1/organization/costs` exibe o mês atual com cache de 5 minutos,
  suporta paginação e não exibe totais parciais em falhas. Não consulta créditos
  disponíveis; o saldo oficial continua acessível pelo link para a OpenAI.
  Não é necessário digitar saldo para acompanhar os gastos automaticamente.
- O proprietário pode registrar o saldo conferido na OpenAI. O painel desconta
  da referência apenas os custos conhecidos registrados posteriormente. O saldo
  restante é uma estimativa, não uma consulta automática ao saldo oficial.
  Falhas e tentativas sem custo conhecido são destacadas como dados incompletos.
- Ainda não há faturamento automático. Os limites de tentativas não são uma
  garantia de teto em dólares; outros usos da mesma chave também consomem saldo.
- Desativar na Central com `IA_DESCRICOES_ENABLED=false` e reiniciar/reimplantar.

Testes na Central: `npx tsx --test src/lib/ai/*.test.ts`.
Os dois repositórios possuem mudanças e precisam ser versionados separadamente.

Referências: https://developers.openai.com/api/docs/guides/text e
https://developers.openai.com/api/docs/models/gpt-4.1-mini.

## Cotas por empresa

Em **Inteligência Artificial**, o OWNER usa **Editar cota** na tabela.
Todas as empresas aparecem, inclusive sem consumo. Zero em qualquer limite
bloqueia gerações. Alterar cotas não zera consumo e tentativas anteriores
registradas na Central contam no respectivo dia/mês. O ERP recebe erro 429
com a indicação da cota atingida antes de chamar o provedor.
Disponíveis agora considera o menor restante entre dia e mês; o teto global
de 500 tentativas do piloto também pode bloquear, mesmo havendo cota individual.
As cotas se aplicam à geração de descrições; não representam crédito monetário.

Teste em PostgreSQL local descartável: `node scripts/test-ai-quotas.cjs`
na pasta da Central (PostgreSQL no PATH, porta 55440 livre).
