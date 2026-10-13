# Novo cliente: projeto Supabase do zero

Este roteiro usa a **Demonstração atualizada** como modelo e cria uma instalação
independente. Não copie bancos de clientes em produção. O arquivo antigo
`jean-car-estrutura.sql` é um registro daquela implantação, não o modelo dos
próximos clientes.

## Sequência de execução no Windows

Execute os comandos no PowerShell, na raiz do repositório. Use `npm.cmd` e
`npx.cmd` se a política de execução bloquear os arquivos `.ps1` do npm.

1. Atualize e teste a Demonstração; exporte um pacote novo para este cliente.
2. Crie o projeto Supabase e preencha `.env.novo-cliente` com suas credenciais.
3. Confira o destino e aplique a instalação.
4. Crie o Administrador e associe o primeiro usuário a esse perfil.
5. Configure empresa, Auth, e-mail, deployment e integrações do cliente.
6. Audite, cadastre o banco nas atualizações e faça os testes de liberação.

```powershell
# Origem: Demonstração
npm.cmd run db:deploy:demo
npm.cmd run db:novo-cliente -- exportar

# Destino: novo projeto (preencha o arquivo antes de continuar)
Copy-Item .env.novo-cliente.example .env.novo-cliente
notepad .env.novo-cliente

# Instalação e perfil
npm.cmd run db:novo-cliente -- instalar
npm.cmd run db:novo-cliente -- instalar --aplicar
npm.cmd run db:novo-cliente -- admin
npm.cmd run db:novo-cliente -- admin --aplicar

# Execute depois de configurar e validar o cliente
npm.cmd run db:novo-cliente -- auditar
npm.cmd run db:novo-cliente -- cadastrar
npm.cmd run db:novo-cliente -- cadastrar --aplicar
npm.cmd run db:status
```

O destino dos comandos `instalar`, `admin`, `auditar` e `cadastrar` vem de
`.env.novo-cliente` (ou das mesmas variáveis no terminal), não da seleção de
um bloco em `.env.local`. Para o próximo cliente, substitua as credenciais e
os identificadores desse arquivo. Os detalhes de cada etapa estão abaixo.

## 1. Preparar o modelo

Na raiz do ERP, instale as dependências e tenha `pg_dump` no PATH. Use uma versão
do `pg_dump` igual ou superior à versão PostgreSQL da origem. Se necessário,
defina `PG_DUMP_PATH` com o caminho do executável.

Atualize a Demonstração e teste o ERP antes de gerar o pacote:

```powershell
npm run db:deploy:demo
npm run db:novo-cliente -- exportar
```

O exportador exige que o histórico da Demonstração corresponda às migrations
locais. Um snapshot PostgreSQL mantém estrutura, catálogos e histórico na mesma
versão durante a exportação. O pacote fica em `artifacts/db/modelo-atual/`:

- `estrutura.sql`: schema `public`, extensões, ACLs, triggers próprios de
  `auth.users`, políticas de Storage e tabelas na publicação Realtime.
- `manifesto.json`: hashes, histórico de versões/nomes, configurações dos buckets
  e os catálogos técnicos permitidos.

Os catálogos incluem permissões, tipos de ajuste, modelo/linhas de DRE,
unidades de medida e tabelas de referência NCM/CST/classificação IBS/CBS.
O catálogo `permissao` é comum a todos os clientes: a importação copia da
Demonstração os campos `id`, `nome` e `descricao`, preservando os identificadores.
Os perfis e seus vínculos (`perfil` e `perfilpermissao`) são definidos em cada
cliente e não são copiados da origem. O comando `admin` cria o perfil
Administrador no destino e vincula todas as permissões disponíveis.
Somente as colunas explicitamente permitidas são exportadas; autores de registros
e dados da empresa não são copiados. Catálogo vazio na origem gera aviso e exige
preparação separada. As referências fiscais refletem a versão da origem; este
processo não consulta nem atualiza automaticamente as tabelas oficiais.

Guarde o pacote até concluir a implantação. Não gere outro pacote no meio de uma
retomada. O exportador atualiza os arquivos localmente, mas não grava na origem.

## 2. Criar e identificar o destino

Crie o projeto na organização Supabase apropriada, com PostgreSQL compatível
com a origem. Aguarde o provisionamento.

```powershell
Copy-Item .env.novo-cliente.example .env.novo-cliente
```

Preencha **apenas credenciais do projeto novo**:

| Variável | Conteúdo |
| --- | --- |
| `NOVO_CLIENTE_KEY` | Chave única sem espaços, como `oficina_silva` |
| `NOVO_CLIENTE_NOME` | Nome exibido nos scripts |
| `NOVO_CLIENTE_PROJECT_REF` | Project ref de 20 letras do novo Supabase |
| `NOVO_CLIENTE_DATABASE_URL` | Conexão PostgreSQL, preferencialmente Session pooler, porta 5432 |
| `NOVO_CLIENTE_SUPABASE_URL` | `https://PROJECT_REF.supabase.co` |
| `NOVO_CLIENTE_SERVICE_ROLE_KEY` | Chave administrativa somente desse projeto |

Codifique caracteres especiais da senha na URL PostgreSQL. Use o host de pooler
mostrado em **Connect** no novo projeto; não adivinhe a região. `.env.novo-cliente`
é ignorado pelo Git. Valores definidos no ambiente do terminal têm precedência.

## 3. Conferir e instalar

```powershell
npm run db:novo-cliente -- instalar
npm run db:novo-cliente -- instalar --aplicar
```

A primeira execução confere o destino e mostra os buckets ausentes. A segunda:

1. Confere que o project ref das URLs corresponde ao destino.
2. Recusa origem igual ao destino, banco já cadastrado ou projeto com tabelas,
   usuários Auth, arquivos de Storage ou histórico anterior.
3. Importa a estrutura e reconstrói as permissões, removendo acessos padrão
   adicionais do projeto novo.
4. Compara a estrutura restaurada com o pacote antes de registrar o histórico.
5. Inicializa os catálogos técnicos e ajusta suas sequências.
6. Registra as migrations já incorporadas à estrutura sem executar novamente
   o SQL antigo.
7. Cria os buckets vazios pela API, com os mesmos limites, tipos MIME e
   configuração pública/privada do modelo.

Estrutura, catálogos e histórico são instalados em uma transação. Se a importação
falhar, o script faz rollback. A criação dos buckets ocorre depois do commit e
não é transacional; em caso de falha de rede, repita `instalar --aplicar` com o
mesmo pacote. Uma marca técnica em `supabase_migrations.erp_provisionamento`
identifica essa retomada. Buckets divergentes não são sobrescritos.

O script não cria o projeto na plataforma Supabase, não copia usuários, arquivos,
empresa, clientes, produtos, vendas, saldos ou credenciais de integrações.

## 4. Perfil e primeiro usuário

```powershell
npm run db:novo-cliente -- admin
npm run db:novo-cliente -- admin --aplicar
```

O comando cria ou reutiliza **Administrador**, vincula todas as permissões locais
e inclui permissões atuais que estiverem ausentes. Não atribui o perfil a usuários.
Crie o primeiro usuário no Auth do projeto novo e confirme que o trigger criou
seu registro em `public.usuario`. Associe esse usuário ao perfil Administrador
pela interface do ERP ou por SQL revisado para esse usuário específico.

Não copie usuários, senhas, UUIDs de responsáveis ou perfis de outro cliente.
Novas permissões adicionadas depois não são automaticamente atribuídas a todos
os perfis; confira o Administrador depois de migrations de permissões.

Para um cliente já cadastrado, o mesmo perfil pode ser conferido/criado assim:

```powershell
npx tsx scripts/db/criar-perfil-administrador.ts --banco jeancar
npx tsx scripts/db/criar-perfil-administrador.ts --banco jeancar --aplicar
```

## 5. Configuração específica do cliente

Antes de liberar o ERP, prepare:

- Empresa: razão social, documento, endereço, contato e identidade visual.
- Configurações gerais, etapas da OS e opções comerciais desejadas.
- Grupos e plano de contas, centros de custo, contas bancárias e implantação da
  DRE. Os catálogos de DRE não substituem o plano de contas do cliente.
- Categorias e grupos de produtos/serviços e outros cadastros usados pela oficina.
- Configuração fiscal, certificado, séries/numeração, município e homologação,
  caso haja emissão de NF-e/NFS-e/SPED. Não copiar certificados e sequências
  fiscais de outra empresa.
- Variáveis do deployment: URL e chaves Supabase desse projeto, domínio do ERP,
  segredos de sessão/cron e instalação própria na Figo Central quando utilizada.
- Integrações contratadas: Focus, marketplaces, Telegram, pagamentos e seus
  callbacks/webhooks. Cadastre credenciais próprias e deixe desativado o que não
  será usado.
- Monitoramento: novas instalações usam o monitor dinâmico da Figo Central;
  confira o cadastro do projeto. O `erp-monitor` em `supabase/functions` é legado.
- Agendamentos necessários: jobs de `pg_cron`, secrets do Vault e secrets/deploy
  de Edge Functions não são copiados. Os crons definidos em `vercel.json` dependem
  do deployment e das variáveis próprias do cliente.

## 6. Auth e envio de e-mails

No painel Authentication do novo projeto:

1. Habilite o provider Email para login por e-mail e senha.
2. Defina Site URL para o domínio desse ERP.
3. Adicione `https://DOMINIO/recuperar-senha` às Redirect URLs. Para desenvolvimento,
   adicione também a URL local usada, sem levar localhost como URL de produção.
4. Configure SMTP/remetente e teste recuperação de senha.
5. Defina o cadastro público conforme o atendimento do cliente. O ERP cria
   usuários pela API administrativa com `email_confirm: true`.

Configure também `SUPABASE_RESET_REDIRECT_URL` para o endereço de recuperação
desse deployment, ou as variáveis de URL utilizadas pela aplicação. Ajustes de
Auth no painel não vêm no dump SQL. [Referência de restauração do Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## 7. Auditar e incluir nas atualizações

```powershell
npm run db:novo-cliente -- auditar
npm run db:novo-cliente -- cadastrar
npm run db:novo-cliente -- cadastrar --aplicar
npm run db:status
```

`auditar` compara estrutura/histórico/buckets e mostra contagens de cadastros
essenciais vazios. Aprovação da infraestrutura não confirma que o ERP está
pronto para operação: revise os avisos e teste os fluxos da etapa seguinte.

`cadastrar --aplicar` inclui os metadados do cliente em `scripts/db/clientes.json`
e grava sua URL em `.env.migrations.local`, ignorado pelo Git. Nenhuma credencial
vai no JSON versionado. O carregador rejeita chaves, project refs e variáveis
duplicadas e URLs destinadas a outro projeto. Os clientes desse JSON passam a
participar automaticamente de `db:status`, `db:deploy` e `db:deploy:clients`.
O utilitário `db:aplicar:avulsa` também percorre os bancos cadastrados, mas não
registra o histórico; mantenha `db:deploy` como fluxo normal de atualização.

Na outra máquina/CI que roda as atualizações, configure também a variável
`ERP_DB_CHAVE_DO_CLIENTE` correspondente; versionar o cadastro não leva a senha.
Após o cadastro, mudanças de estrutura devem ser feitas por migrations novas,
não pela reimportação de outro pacote.

## 8. Teste para liberação

- Login do administrador e associação ao perfil correto.
- Recuperação de senha recebida por e-mail e retorno ao domínio correto.
- Cadastro de cliente, produto, estoque e OS; movimentação e financeiro no
  ambiente de validação da oficina.
- Upload e leitura em bucket público e em bucket privado; confirmar que acesso
  privado exige o fluxo autenticado/autorizado do ERP.
- Eventos Realtime e acesso dos usuários aos módulos permitidos.
- Emissão fiscal em homologação e integrações necessárias, quando contratadas.
- Confirmar que o deployment aponta somente para o projeto desse cliente.

No Table Editor, use a role `postgres` para inspeção administrativa. Simular
`authenticated` pode apresentar bloqueios previstos pelas ACLs/RLS; não abra
permissões apenas para visualizar tabelas no painel.

## Jean Car: situação nesta implantação

Infraestrutura copiada, histórico alinhado e 14 buckets criados. O perfil
Administrador foi criado com 145 permissões. A auditoria encontrou empresa,
configurações gerais, tipos de ajuste, plano de contas, catálogos de DRE,
unidades de medida, NCM e referências IBS/CBS vazios. Há um usuário, cuja associação
ao perfil precisa ser validada. Auth/SMTP/deployment e testes da oficina ainda
precisam de conferência: não foram configurados pelos scripts de estrutura.

O comando `base` permite preencher os catálogos técnicos ausentes em um banco
que recebeu apenas estrutura. Ele exige o mesmo schema do pacote e aceita
tabelas vazias ou catálogos idênticos; não mistura nem sobrescreve dados diferentes:

```powershell
npm run db:novo-cliente -- base
npm run db:novo-cliente -- base --aplicar
```

Para Jean Car, use suas credenciais em `.env.novo-cliente` e `NOVO_CLIENTE_KEY=jean`.
Isso não reinstala a estrutura nem executa migrations antigas. Esse preenchimento
não foi aplicado nesta auditoria; foi criada somente a base de permissões
necessária ao perfil Administrador solicitado.
