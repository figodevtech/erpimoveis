# Monitor de produção

Consulta a cada dez minutos os logs de API e Postgres de Alpha Garage e Demir e envia somente ocorrências para os tópicos correspondentes do Telegram.

Secrets necessários estão listados em `secrets.example`. A função e o único job `erp-monitor-production` ficam no Alpha Garage. Não replique esse job nos demais bancos, pois isso duplicaria os alertas.

O job executa nos minutos 5, 15, 25, 35, 45 e 55 de cada hora. O segredo de chamada fica somente no Vault do projeto e nos secrets da Edge Function.
