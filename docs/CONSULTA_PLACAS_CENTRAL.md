# Consulta de placas pela Central

O cadastro/edição de veículos e o desmanche mantêm a rota do ERP
`GET /api/veiculos/consulta-placa/[placa]`. Ela verifica a sessão, as permissões e chama `POST /api/v1/placas/consulta` na Central.

A Central autentica a instalação, verifica a assinatura e acessa a WDAPI.
Os dados retornam no mesmo formato, inclusive `extra` e `limiteConsultasPlaca`.
Nenhuma placa, credencial ou resposta de veículo é gravada no histórico central.
O log registra instalação, ID da solicitação, resultado e horários. IDs repetidos
na mesma instalação são bloqueados antes de chamar o provedor.

## Ativar

1. Aplicar `20260917120000_plate_queries.sql` e depois
   `20260917130000_plate_monthly_report.sql` e
   `20260917140000_plate_activity_months.sql` e
   `20260917150000_plate_company_quotas.sql` somente no banco da Central.
2. Configurar `API_PLACAS_TOKEN` somente no servidor da Central.
3. Publicar a Central antes do ERP.
4. O ERP usa `PLATFORM_API_URL`, `PLATFORM_INSTALLATION_ID` e `PLATFORM_API_SECRET`.
   Depois de validar, remover o token antigo das configurações do ERP.

A Central controla a cota mensal por empresa. O OWNER pode editar a cota na
linha da empresa em **Consultas de placas**. O valor inicial é 100, zero bloqueia
novas consultas, e a renovação ocorre a cada mês UTC. Ajuste as cotas antes
de publicar o ERP: limites personalizados antigos não são importados.
Alterar a cota preserva o consumo. Reservas simultâneas são serializadas no
banco; falhas e consultas pendentes consomem cota. Repetir o mesmo requestId
não gera novo consumo. O ERP passa a usar o limite retornado pela Central,
sem incrementar ou consultar o contador local legado. O histórico já existente
na Central entra no consumo; o histórico antigo do ERP não é importado.
Ainda não há faturamento automático.

O menu **Consultas de placas** (`/placas`) mostra tentativas, concluídas, falhas,
pendentes e última consulta de cada empresa. O seletor de competência permite
consultar somente meses com atividade (UTC); sem registros, o seletor fica
desabilitado. Empresas sem uso aparecem com zero. Consultas
anteriores à centralização não são importadas do contador agregado do ERP.

A rota alternativa `/api/veiculos/placa` (BrasilAPI), sem consumidores encontrados
no código, não foi alterada. O rastreamento de encomendas PacoteVício não faz parte
da consulta de placas.

Teste local na Central: `npx tsx --test src/lib/plates/*.test.ts`.

O resumo de uso nas configurações do ERP consulta `GET /api/veiculos/cota-placas`,
que autentica o usuário e busca `GET /api/v1/placas/cota` na Central.
Sem acesso à Central, o painel mostra dados indisponíveis, sem usar o contador antigo.

Teste de cotas em PostgreSQL local descartável: `node scripts/test-plate-quotas.cjs`
na pasta da Central (requer PostgreSQL no PATH e a porta 55439 livre).
