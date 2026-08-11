# Configuração das notificações de OS pelo Telegram

## 1. Criar o bot

1. Abra o Telegram e procure a conta verificada `@BotFather`.
2. Envie `/newbot`.
3. Informe o nome visível, por exemplo `Figo Central - Ordens`.
4. Informe um username terminado em `bot`, por exemplo `figo_ordens_bot`.
5. Copie o token entregue pelo BotFather e guarde-o como segredo.
6. Opcionalmente use `/setdescription`, `/setabouttext` e `/setuserpic` para personalizar o bot.

Use bots diferentes para homologação e produção. Uma sugestão é acrescentar `_homolog_bot` ao username de testes.

## 2. Gerar os segredos

Gere dois valores diferentes com pelo menos 32 bytes aleatórios. No terminal do projeto:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Execute o comando duas vezes:

- o primeiro valor será `TELEGRAM_WEBHOOK_SECRET`;
- o segundo valor será `CRON_SECRET`.

## 3. Configurar o ambiente

Adicione no ambiente da aplicação:

```text
TELEGRAM_BOT_TOKEN=token-entregue-pelo-botfather
TELEGRAM_BOT_USERNAME=username-sem-arroba
TELEGRAM_WEBHOOK_SECRET=primeiro-segredo-gerado
TELEGRAM_NOTIFICATIONS_ENABLED=false
APP_URL=https://dominio-publico-do-erp
CRON_SECRET=segundo-segredo-gerado
```

Regras:

- `APP_URL` precisa usar HTTPS e não deve terminar com `/`;
- não use variáveis com prefixo `NEXT_PUBLIC_` para tokens ou segredos;
- configure os mesmos valores no servidor que executará o cron;
- depois de alterar variáveis na Vercel, faça um novo deploy.

O arquivo `telegram.env.example` serve apenas como referência e não contém credenciais reais.

## 4. Aplicar a migration

A migration é:

```text
supabase/migrations/20260810190000_notificacoes_os_telegram.sql
```

Siga o fluxo seguro já adotado pelo projeto:

```powershell
npm run db:status
npm run db:deploy
```

O comando valida e aplica primeiro no banco de Demonstração. Teste a integração nesse banco antes de autorizar a atualização dos bancos dos clientes.

## 5. Publicar e registrar o webhook

1. Publique a aplicação com as variáveis configuradas e `TELEGRAM_NOTIFICATIONS_ENABLED=false`.
2. Entre no ERP com um usuário que possa editar Configurações.
3. Abra `Configurações > Telegram`.
4. Confirme que token/username, segredo e URL pública aparecem como configurados.
5. Clique em **Configurar webhook**.
6. Atualize a tela e confira se a URL do webhook aparece sem erro.

O Telegram chamará:

```text
POST https://seu-dominio/api/integracoes/telegram/webhook
```

O endpoint valida o cabeçalho secreto configurado e não aceita chamadas anônimas sem esse valor.

## 6. Configurar o envio em tempo real

Não é necessário criar um Database Webhook manualmente no painel do Supabase. A migration
cria um trigger baseado diretamente no `pg_net`, compatível inclusive com projetos que não
possuem o schema auxiliar `supabase_functions`.

Depois de aplicar a migration e publicar a aplicação, abra **Configurações > Telegram** e
clique em **Configurar webhook**. Além do webhook de entrada do bot, essa ação registra no
banco a URL do processador e o `CRON_SECRET` daquele cliente em uma tabela privada.

O trigger da OS insere uma linha na fila dentro da mesma transação. Depois que a alteração
é confirmada, o `pg_net` chama o processador de forma assíncrona, sem atrasar o
salvamento da OS. Normalmente a mensagem chega em poucos segundos.

Como cada cliente possui banco, domínio e segredos próprios, repita apenas a aplicação da
migration, o deploy e o clique em **Configurar webhook** em cada instalação.

## 7. Configurar o processador recorrente de contingência

O endpoint de processamento é:

```text
GET https://seu-dominio/api/integracoes/telegram/processar
Authorization: Bearer SEU_CRON_SECRET
```

O envio normal já é acionado pelo `pg_net`. Configure também o mesmo agendador
servidor-servidor usado pelas integrações de marketplace para executar esse endpoint a cada
cinco minutos. Ele serve como contingência para indisponibilidade temporária do Telegram,
do webhook ou da aplicação.

Para uma verificação manual, um administrador pode abrir `Configurações > Telegram` e clicar em **Processar agora**. O botão não expõe `CRON_SECRET` ao navegador.

## 8. Ativar a entrega

Depois que migration, webhook e agendador estiverem validados:

1. altere `TELEGRAM_NOTIFICATIONS_ENABLED=true`;
2. faça novo deploy;
3. abra `Configurações > Telegram` e confirme que a integração está ativa;
4. clique em **Processar agora** para verificar que não há erro.

Eventos podem ser registrados enquanto a integração está desativada. Antes de ativar em um banco com uso real, confira a quantidade de eventos pendentes no painel para não enviar um volume histórico inesperado.

## 9. Cadastrar os destinatários

1. Entre no ERP com um usuário que possa editar Configurações.
2. Abra `Configurações > Telegram`.
3. Em **Destinatários dos avisos**, selecione o usuário do ERP.
4. Informe o `@usuário` utilizado por essa pessoa no Telegram.
5. Escolha quando e quais OS ela deve acompanhar.
6. Clique em **Adicionar destinatário**.
7. Na lista, clique em **Gerar link** e envie o link copiado ao destinatário.
8. O destinatário abre o link e toca em **Iniciar**. O bot confere se o username da conversa corresponde ao cadastro feito pelo administrador.
9. Atualize a tela e use **Testar** para confirmar o recebimento.

Todo o cadastro é administrado em `Configurações > Telegram`; a página `Meu perfil` não participa da integração. O bot não consegue iniciar uma conversa somente pelo `@usuário`, portanto o destinatário precisa tocar em **Iniciar** uma vez para que o ERP receba o `chat_id`. Um `chat_id` não pode ser compartilhado por dois usuários.

## 10. Teste de homologação

1. Conecte um usuário ao bot de homologação.
2. Selecione `Todas as mudanças` e `Todas as OS` temporariamente.
3. Crie uma OS e confirme que a mensagem chega automaticamente em poucos segundos.
4. Se não chegar, confira os logs do `pg_net` antes de usar **Processar agora**.
5. Altere a OS para `EM_ANDAMENTO`.
6. Processe novamente e confirme a mensagem com status anterior e novo.
7. Repita com `CONCLUIDO`, `SEM_COBRANCA` e `CANCELADO`.
8. Pause os avisos e confirme que novos eventos não geram entrega para esse usuário.
9. Reative, teste `Minhas OS` e confirme que OS de outro usuário não chega.
10. Confira o painel de Configurações: fila vazia e nenhuma entrega com falha.

## 11. Operação e solução de problemas

- **Webhook sem URL:** publique a aplicação e clique em Configurar webhook novamente.
- **Unauthorized no webhook:** `TELEGRAM_WEBHOOK_SECRET` do servidor não corresponde ao registrado; registre novamente.
- **Mensagem de teste não chega:** confirme que o usuário tocou em Iniciar e não bloqueou o bot.
- **Username não corresponde:** confirme que o `@usuário` informado no ERP é o mesmo da conta que abriu o bot.
- **Eventos ficam pendentes:** confira o agendador e `CRON_SECRET`, ou use Processar agora.
- **Só envia ao clicar em Processar:** aplique a migration de tempo real, publique a aplicação e clique novamente em **Configurar webhook** para registrar o disparo daquele cliente.
- **Erro 403 do Telegram:** normalmente o usuário bloqueou o bot; desconecte e faça um novo vínculo.
- **Mensagens duplicadas:** consulte as entregas no banco; a restrição única por evento/usuário deve impedir duplicidade.
- **Alteração de token:** atualize `TELEGRAM_BOT_TOKEN`, publique novamente e registre o webhook outra vez.

Nunca envie token ou segredo em capturas de tela, chamados, logs ou mensagens.
