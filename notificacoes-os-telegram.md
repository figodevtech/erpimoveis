# Notificações de OS pelo Telegram

## Objetivo

Implementar avisos internos confiáveis e personalizáveis de ordens de serviço pelo Telegram no ERP atual.

## Tarefas

- [x] Criar schema, trigger, fila e funções de reserva no Supabase.
- [x] Implementar cliente Telegram, formatação, vínculo, webhook e worker.
- [x] Criar APIs administrativas com autenticação e validação.
- [x] Adicionar cadastro de destinatários e diagnóstico às Configurações.
- [x] Cobrir regras críticas com testes automatizados.
- [x] Validar lint direcionado, tipos, testes e build (aplicação da migration aguarda reconciliação do histórico remoto).
- [x] Documentar configuração do BotFather, ambiente, webhook e agendador.
- [x] Centralizar em Configurações o cadastro de contatos, preferências e vínculos do Telegram.

## Concluído quando

- [x] Administradores cadastram contatos, eventos e escopo de cada destinatário.
- [x] Criação e alteração real de status geram entregas sem bloquear a OS.
- [x] Falhas são repetidas sem duplicar mensagens.
- [x] Administradores diagnosticam e reprocessam falhas.
- [x] Segredos permanecem apenas no servidor.
