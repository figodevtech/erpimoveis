# ERP imobiliário integrado ao site

## 1. Decisões definidas

O ERP será a fonte dos cadastros, disponibilidade, operações e informações financeiras. O site terá catálogo público, área do cliente e portal do proprietário.

Referência de escopo: :codex-file-citation{path="C:/Users/luc14/OneDrive/Documentos/WORK/erpimoveis/docs/planejamento/FIGO_Orcamento_ERP_Imobiliario (1).pdf" purpose="source"}.

- **Um proprietário por imóvel**, permitindo vários imóveis para o mesmo proprietário.
- Um imóvel poderá oferecer **venda, locação tradicional e temporada** simultaneamente.
- **Reservas são estadias de temporada**. Negociações de venda e contratos de locação terão registros próprios.
- A reserva enviada pelo cliente será **confirmada automaticamente**, após validar preço, capacidade e disponibilidade.
- Reserva não paga continuará bloqueando o período até **cancelamento manual no ERP**.
- Cliente e proprietário terão **contas separadas, com e-mails diferentes**. Contas de proprietário serão criadas exclusivamente pelo ERP.
- Cadastro público exigirá **nome, e-mail, telefone, CPF e senha**, com confirmação do e-mail.
- Esta entrega terá operação e financeiro completos, com **cobranças e baixas manuais**. Pagamento online ficará para a etapa seguinte.

## 2. Módulos e experiência no ERP

### Proprietários

Criar módulo com listagem, busca, filtros, cadastro PF/PJ e dialog responsivo seguindo o padrão de Clientes.

Reutilizar os componentes cadastrais comuns, preservando comportamento específico de cada módulo. Não copiar carteira de crédito, vendas de produtos ou regras fiscais de mercadorias para Proprietários.

Abas do dialog:

| Aba | Conteúdo |
|---|---|
| Geral | Identificação, CPF/CNPJ, contatos, endereço, foto e situação cadastral. |
| Imóveis | Imóveis vinculados, modalidades, publicação e ocupação. |
| Reservas | Reservas dos imóveis, filtradas por período e situação. |
| Financeiro | Receitas, taxas, despesas, demonstrativos, repasses e saldo. |
| Acesso ao portal | Criar acesso, reenviar convite, consultar ativação, bloquear e revogar. |

O e-mail de acesso poderá ser diferente do e-mail de contato. Criar um proprietário não criará automaticamente sua conta de portal.

### Imóveis

Criar listagem com busca, filtros por proprietário, localização, modalidade, publicação e situação.

O cadastro conterá identificação, tipo, características, endereço, localização pública aproximada, proprietário, fotos, documentos, comodidades, regras e valores por modalidade.

Abas: **Geral, Fotos e documentos, Publicação, Disponibilidade, Reservas, Locações, Vendas e Financeiro**.

Separar:

- **Situação cadastral:** ativo ou inativo.
- **Publicação:** modalidades e anúncios publicados.
- **Situação comercial e ocupação:** disponível, reservado, ocupado, alugado, em negociação, vendido ou em manutenção, conforme operações e período consultado.

Os estados operacionais serão calculados. Alterar um campo manualmente não poderá liberar um período já ocupado.

Ações no imóvel:

- **Nova reserva:** abre o formulário com imóvel selecionado.
- **Registrar locação:** abre negociação/contrato de aluguel tradicional.
- **Registrar venda:** abre negociação de venda imobiliária.
- **Bloquear período:** registra manutenção ou indisponibilidade.
- **Publicar/despublicar:** controla a exposição no site.

### Reservas

Criar módulo próprio com lista e calendário, filtros e cadastro vinculado obrigatoriamente a imóvel e cliente.

Registrar entrada, saída, hóspedes, origem, preços discriminados, taxas, observações, documentos e histórico.

Estados: **Confirmada → Em andamento → Concluída**, com cancelamento autorizado pelo ERP. A situação financeira será independente: pendente, parcialmente paga ou quitada.

- Check-in inicia a estadia; check-out conclui.
- Alterações de imóvel ou período revalidam disponibilidade e valores.
- Cancelamento libera o período e exige tratamento explícito das cobranças e dos valores recebidos.
- Não haverá cancelamento automático por falta de pagamento.

### Clientes: aba “Reservas”

Manter as abas atuais e acrescentar **Reservas**, carregada apenas quando aberta.

Exibir imóvel, período, hóspedes, situação da reserva, valor e situação financeira. Permitir abrir o registro e iniciar uma reserva com o cliente preenchido.

A consulta terá paginação e autorização próprias; acesso ao cadastro do cliente não concederá automaticamente acesso financeiro completo.

### Locações e vendas imobiliárias

Criar registros próprios, acessíveis pelo imóvel e por listagens dedicadas. Não reutilizar a venda de produtos ou as estruturas antigas de aluguel.

- **Locação:** cliente/locatário, contrato, vigência, valor, vencimentos, encargos, reajustes registrados, anexos, cobranças e encerramento.
- **Venda:** proprietário vendedor, comprador, negociação, preço, comissão, parcelas, recebimentos e conclusão/cancelamento.
- Cobranças recorrentes de locação serão geradas de forma idempotente por competência, usando o agendador já disponível no banco. Valores iniciais/finais e reajustes serão definidos no contrato, sem aplicar índices externos automaticamente.

Ao concluir uma venda com reservas ou locações existentes, apresentar um diálogo obrigatório para decidir quais operações serão mantidas ou encerradas. Para as mantidas, exigir a escolha do proprietário responsável pelos próximos repasses.

Preservar histórico e repasses realizados. Alterações de beneficiário terão data de vigência e ajustes explícitos; não reescreverão movimentações anteriores.

## 3. Banco, autenticação e integração com o site

### Estrutura de dados

Adicionar entidades para proprietários, imóveis, galeria/documentos, tarifas, reservas, contratos de locação, vendas imobiliárias, ocupações e acessos externos.

Relações principais:

- Proprietário → vários imóveis.
- Imóvel → reservas, contratos, vendas e bloqueios.
- Cliente → reservas, locações e compras imobiliárias.
- Operação → cobranças, recebimentos, despesas, comissões e repasses.

Preservar os cadastros atuais. Excluir fisicamente somente registros sem histórico; os demais serão inativados.

### Disponibilidade única

Reservas, contratos e bloqueios utilizarão o mesmo calendário de ocupações.

- Datas de temporada com saída exclusiva: uma estadia pode terminar no dia em que outra começa.
- Validação transacional no PostgreSQL impedirá sobreposição, inclusive entre pedidos simultâneos do site e do ERP.
- Reenvio da mesma solicitação não poderá criar outra reserva nem duplicar cobranças.
- Preços serão calculados pelo ERP; mudanças de preço exigirão nova confirmação do cliente.

### Separação dos acessos

Manter Supabase Auth para autenticação, com autorizações independentes:

| Público | Cadastro e autorização |
|---|---|
| Colaborador | Registro interno em `usuario`, criado pelo ERP, com perfil e permissões. |
| Cliente do site | Conta externa vinculada ao cadastro `cliente`, aproveitando `cliente.user_id`. |
| Proprietário | Conta externa exclusiva, vinculada ao proprietário e provisionada pelo ERP. |

Antes de liberar o cadastro público:

- Substituir o gatilho atual que transforma qualquer conta Auth em usuário interno.
- Remover qualquer atribuição de perfil ou setor baseada em metadados editáveis pelo usuário.
- Restringir a escrita direta em `cliente`, impedindo alterações externas de saldo, classificação e demais campos internos.
- Rever políticas antigas de Storage que concedem acesso amplo a usuários autenticados.
- Acrescentar auditoria de atores externos sem cadastrá-los como colaboradores.

### Cadastro do site refletindo no ERP

O cadastro será coordenado pelo servidor, com sincronização idempotente entre identidade e cliente.

- Novo cadastro cria o cliente correspondente, identificado como originado no site.
- E-mail confirmado e sincronização concluída serão necessários para reservar e acessar informações privadas.
- Cliente já existente será vinculado somente após verificar a identidade e a compatibilidade de CPF/e-mail.
- Conflitos irão para resolução no ERP, sem duplicação nem exposição do histórico de outra pessoa.
- Falhas de sincronização terão estado pendente e reprocessamento; o navegador não fará duas gravações independentes.
- Remover a unicidade de nome/razão social para permitir homônimos, mantendo as validações de documento.

Proprietários não poderão ser selecionados no cadastro público. O ERP enviará convite de ativação, sem fornecer senha definida pela equipe.

### Contratos de API e site

Adicionar APIs internas para Proprietários, Imóveis, Reservas, Locações e Vendas imobiliárias, incluindo `GET /api/clientes/:id/reservas`.

No site:

- Ampliar o contrato atual de imóveis para modalidades e preços distintos, preservando a navegação existente durante a transição.
- Implementar catálogo, detalhe, cotação e criação real de reserva.
- Implementar cadastro/login, perfil e reservas do cliente.
- Implementar portal do proprietário com imóveis, ocupação, reservas e demonstrativos autorizados.
- Retirar regras fictícias de preços e disponibilidade.
- Usar a identidade validada no servidor para determinar cliente ou proprietário; não confiar em IDs enviados pelo navegador.
- Expor somente campos públicos no catálogo e documentos privados por acesso autorizado e URLs temporárias.

O portal do proprietário será inicialmente **de consulta**. Contas de proprietário não reservarão como clientes; para isso será necessária a conta separada escolhida.

## 4. Financeiro e ordem de implementação

Reaproveitar títulos, parcelas, baixas, conciliação, anexos e DRE, acrescentando origens imobiliárias explícitas.

Separar valores recebidos em nome do proprietário da receita da administradora. Cada operação registrará seus valores, taxas, beneficiário e despesas, permitindo demonstrativo e repasse sem considerar todo aluguel como receita própria.

Implementar nesta ordem:

1. **Segurança e cadastros:** separação de acessos, Proprietários e componentes cadastrais compartilhados.
2. **Imóveis e calendário:** modalidades, publicação, tarifas, documentos e controle transacional de ocupação.
3. **Reservas integradas:** ERP, aba Reservas do cliente, cadastro/login e reserva automática no site.
4. **Locações, vendas e financeiro:** contratos, cobranças, comissões, repasses e diálogo de conclusão da venda.
5. **Portal e complementos do orçamento:** demonstrativos do proprietário, leads/visitas vinculados aos imóveis e adaptação da NFS-e aos serviços de administração/intermediação.

Pix/cartão online será uma etapa posterior, com provedor definido antes da implementação. Visitas imobiliárias serão um fluxo novo; não será restaurado o agendamento de oficina. Integrações com Airbnb/Booking, assinatura eletrônica e repasses bancários automáticos continuam fora desta entrega.

## 5. Testes e critérios de aceite

- Cadastro público cria/vincula cliente no ERP, sem criar colaborador ou acesso de proprietário.
- Cadastro repetido e falhas de sincronização não duplicam identidades ou clientes.
- Metadados forjados não concedem permissões; cliente e proprietário não acessam registros de terceiros, inclusive pela API direta do Supabase.
- Imóvel aceita várias modalidades e aparece no site somente quando publicado.
- Duas reservas simultâneas para o mesmo período permitem apenas uma confirmação; períodos consecutivos são aceitos.
- Reserva não paga permanece confirmada até cancelamento manual; cancelamento e alterações atualizam calendário e financeiro de forma consistente.
- Aba Reservas do cliente e dialog do proprietário apresentam os registros corretos, com paginação e permissões.
- Locação gera cobranças sem duplicação; recebimentos, despesas e repasses mantêm rastreabilidade.
- Venda com ocupações exige as decisões de manutenção/encerramento e beneficiário, preservando histórico.
- Fluxos existentes de clientes, estoque, vendas de produtos e financeiro continuam funcionando.
- Validar migrations em rollback, testes de negócio, isolamento de acesso, TypeScript, lint, build e jornadas reais nos dois projetos antes da publicação.
