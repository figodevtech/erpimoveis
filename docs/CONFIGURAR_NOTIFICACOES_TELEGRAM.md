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

## 6. Configurar o processador recorrente

O endpoint de processamento é:

```text
GET https://seu-dominio/api/integracoes/telegram/processar
Authorization: Bearer SEU_CRON_SECRET
```

Configure o mesmo agendador servidor-servidor usado pelas integrações de marketplace para executar esse endpoint a cada minuto. Se o plano de hospedagem não permitir frequência de um minuto, use cinco minutos; os avisos apenas chegarão com esse atraso máximo.

Para uma verificação manual, um administrador pode abrir `Configurações > Telegram` e clicar em **Processar agora**. O botão não expõe `CRON_SECRET` ao navegador.

## 7. Ativar a entrega

Depois que migration, webhook e agendador estiverem validados:

1. altere `TELEGRAM_NOTIFICATIONS_ENABLED=true`;
2. faça novo deploy;
3. abra `Configurações > Telegram` e confirme que a integração está ativa;
4. clique em **Processar agora** para verificar que não há erro.

Eventos podem ser registrados enquanto a integração está desativada. Antes de ativar em um banco com uso real, confira a quantidade de eventos pendentes no painel para não enviar um volume histórico inesperado.

## 8. Cadastrar os destinatários

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

## 9. Teste de homologação

1. Conecte um usuário ao bot de homologação.
2. Selecione `Todas as mudanças` e `Todas as OS` temporariamente.
3. Crie uma OS.
4. Clique em **Processar agora** e confirme a mensagem de criação.
5. Altere a OS para `EM_ANDAMENTO`.
6. Processe novamente e confirme a mensagem com status anterior e novo.
7. Repita com `CONCLUIDO`, `SEM_COBRANCA` e `CANCELADO`.
8. Pause os avisos e confirme que novos eventos não geram entrega para esse usuário.
9. Reative, teste `Minhas OS` e confirme que OS de outro usuário não chega.
10. Confira o painel de Configurações: fila vazia e nenhuma entrega com falha.

## 10. Operação e solução de problemas

- **Webhook sem URL:** publique a aplicação e clique em Configurar webhook novamente.
- **Unauthorized no webhook:** `TELEGRAM_WEBHOOK_SECRET` do servidor não corresponde ao registrado; registre novamente.
- **Mensagem de teste não chega:** confirme que o usuário tocou em Iniciar e não bloqueou o bot.
- **Username não corresponde:** confirme que o `@usuário` informado no ERP é o mesmo da conta que abriu o bot.
- **Eventos ficam pendentes:** confira o agendador e `CRON_SECRET`, ou use Processar agora.
- **Erro 403 do Telegram:** normalmente o usuário bloqueou o bot; desconecte e faça um novo vínculo.
- **Mensagens duplicadas:** consulte as entregas no banco; a restrição única por evento/usuário deve impedir duplicidade.
- **Alteração de token:** atualize `TELEGRAM_BOT_TOKEN`, publique novamente e registre o webhook outra vez.

Nunca envie token ou segredo em capturas de tela, chamados, logs ou mensagens.
