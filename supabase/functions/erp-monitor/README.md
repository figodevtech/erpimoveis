# Monitor de produção

Monitor legado de logs de API e Postgres. Novas instalações devem usar o monitor dinâmico hospedado na Figo Central.

Não mantenha projetos fixos no código. Enquanto esta função ainda estiver implantada, configure `ERP_MONITOR_PROJECTS` como um array JSON com `name`, `ref` e `topicEnv`. Projetos removidos não devem permanecer nessa lista.

O bot técnico usa `ERP_MONITOR_TELEGRAM_BOT_TOKEN`. Ele é independente de
`TELEGRAM_BOT_TOKEN`, que pertence às notificações funcionais do ERP. Cadastre o
token técnico nos Secrets da Edge Function legada, e não nas variáveis do
Vercel de cada cliente.

O job executa nos minutos 5, 15, 25, 35, 45 e 55 de cada hora. O segredo de chamada fica somente no Vault do projeto e nos secrets da Edge Function.
