# Integração com a Central Financeira

Cada deploy do ERP usa seu próprio Supabase operacional e se conecta à Central somente por uma API servidor a servidor. Nenhuma credencial do Supabase Central deve ser configurada no navegador.

Configure no ambiente do ERP de cada empresa:

```env
PLATFORM_API_URL=https://central.seudominio.com.br
PLATFORM_INSTALLATION_ID=uuid-gerado-na-central
PLATFORM_API_SECRET=segredo-exibido-uma-vez
```

Para desenvolvimento local, `PLATFORM_API_URL` pode ser `http://localhost:3001`. Cadastre a instalação na empresa correspondente dentro da Central e gere um segredo exclusivo para cada deploy.

## Comportamento de acesso

- antes do prazo de aviso: acesso normal;
- depois do início do aviso: banner de pendência e acesso normal;
- depois do prazo de bloqueio: apenas `/plano`, autenticação e operações necessárias para consultar/pagar a mensalidade permanecem disponíveis;
- se a Central estiver temporariamente indisponível: o ERP falha aberto e não bloqueia a operação da oficina por falha de comunicação.

O módulo `/plano` exibe cobranças a vencer, vencidas e pagas. O PDF do C6 é obtido pelo servidor do ERP usando as credenciais da instalação; o segredo nunca é entregue ao navegador.
