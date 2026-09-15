# Central Pessoal — Meu Perfil

> IMPORTANTE: antes de modificar a Central Pessoal ou o upload de foto de usuário, leia este documento
> integralmente. Depois de qualquer alteração funcional, estrutural, visual, no banco, nas APIs ou nas
> regras de segurança, atualize esta documentação no mesmo conjunto de mudanças.

## Objetivo e escopo atual

A rota `/meu-perfil` apresenta a identidade do usuário, resumos por período e listas paginadas de
vendas, ordens e serviços. Todo usuário autenticado consulta os próprios dados. Quem possui
`usuarios:ver-perfis` também pode navegar entre usuários e, pelo mesmo contrato de autorização,
consultar e alterar a foto do perfil selecionado. Essa permissão não depende de
`usuarios:visualizar`, que abre o cadastro de usuários.

O upload de foto é **implementado** e independente de qualquer formulário: o ícone de lápis abre o
seletor nativo e a seleção inicia imediatamente o processamento, upload e persistência. Não existe
etapa adicional de anexar ou clicar em “Salvar”. Remoção manual e recorte ajustável estão **fora do
escopo atual**.

## Localização e responsabilidades

- [`meu-perfil-client.tsx`](../../src/app/(app)/(pages)/meu-perfil/meu-perfil-client.tsx): estado da
  tela, usuário selecionado, consultas e coordenação do upload imediato.
- [`perfil-header.tsx`](../../src/app/(app)/(pages)/meu-perfil/components/perfil-header.tsx): card,
  avatar/fallback, input nativo oculto, lápis e estado visual de envio.
- [`lib/api.ts`](../../src/app/(app)/(pages)/meu-perfil/lib/api.ts): contratos HTTP do frontend.
- [`GET /api/me/perfil`](../../src/app/api/me/perfil/route.ts): retorna identidade e `fotoUrl`.
- [`GET /api/me/usuarios`](../../src/app/api/me/usuarios/route.ts): lista `id`, `nome` e `email` para
  o seletor de perfil.
- [`POST /api/me/perfil/foto`](../../src/app/api/me/perfil/foto/route.ts): autoriza, valida, normaliza,
  grava e substitui a foto.
- [`foto-perfil.ts`](../../src/lib/meu-perfil/foto-perfil.ts): limites, formatos e isolamento de paths.
- [`20260827130000_usuario_foto_perfil.sql`](../../supabase/migrations/20260827130000_usuario_foto_perfil.sql):
  campos e bucket.
- [`20260915130000_permissao_usuarios_ver_perfis.sql`](../../supabase/migrations/20260915130000_permissao_usuarios_ver_perfis.sql):
  permissão de navegar entre perfis.

## Fluxo do frontend

O perfil ativo é identificado por `usuarioId` na URL; sem o parâmetro, usa o usuário da sessão. O
estado guarda a chave que originou os dados para não mostrar informações do usuário anterior durante
uma troca. Ao selecionar um arquivo, o cliente:

1. registra a chave do perfil que iniciou o envio e mostra indicador no lápis;
2. envia `multipart/form-data`, campo `file`, para `POST /api/me/perfil/foto`, com `usuarioId` quando
   estiver administrando outro perfil;
3. após resposta `200`, substitui `fotoUrl` apenas se aquele perfil ainda estiver visível;
4. mostra sucesso ou erro e libera nova seleção, inclusive do mesmo arquivo.

Trocar de perfil durante um upload não aplica a foto recebida ao card errado. A API já recebeu o ID
original e persiste no alvo autorizado correto.

## API e autorização

`GET /api/me/perfil?usuarioId=<uuid>` retorna `MeuPerfil`, incluindo `fotoUrl: string | null`.

`POST /api/me/perfil/foto?usuarioId=<uuid>` recebe um `FormData` com `file`. A resposta de sucesso é:

```json
{ "fotoUrl": "https://.../storage/v1/object/public/usuario-avatar/<usuario>/<arquivo>.webp" }
```

O helper [`getMeUserId`](../../src/app/api/me/_helpers.ts) exige sessão Auth.js. O próprio usuário
sempre pode alterar sua foto. Para outro UUID, exige `usuarios:ver-perfis`, a mesma permissão que
habilita a navegação entre perfis. A API usa `service_role`; o navegador não recebe credencial de
Storage nem permissão direta de escrita.

`GET /api/me/usuarios` alimenta o seletor e também exige `usuarios:ver-perfis`. Ela existe em vez de
`/api/users` porque aquela rota exige `usuarios:visualizar` e devolve salário e comissões.

As APIs leem a permissão no banco a cada requisição. O seletor na tela lê as permissões da sessão,
que só são recarregadas no login: quem recebe ou perde `usuarios:ver-perfis` precisa sair e entrar
de novo para a tela refletir a mudança.

Para o middleware, `usuarios:ver-perfis` não tira ninguém do modo executor: um perfil com
`execucao_os:visualizar` e essa permissão continua restrito à execução, ao chat e à Central Pessoal.

## Imagens, banco e Storage

`usuario.foto_url text` guarda a URL pública atual. `usuario.foto_path text` guarda o path interno para
substituição segura. O bucket público `usuario-avatar` aceita somente WebP de até 1 MiB; “público”
significa que a leitura pela URL do avatar não exige token. Inserção, atualização e exclusão não têm
policy para `anon` ou `authenticated` e ocorrem somente na API com `service_role`.

Entradas JPG, PNG, WebP e AVIF de até 8 MiB são aceitas. O servidor usa Sharp, aplica a orientação
EXIF, recorta centralmente por atenção para 512 × 512, converte para WebP com qualidade 84 e remove
metadados do original. Arquivos inválidos ou que não possam ser decodificados retornam `400`.

**HEIC/HEIF são recusados na validação.** O libvips distribuído com o Sharp traz libheif compilado
somente com o codec AV1: AVIF decodifica, mas HEIC (HEVC) falha com “compression format has not been
built in”. Recusar o tipo antes do processamento devolve uma mensagem útil em vez do erro genérico —
e, com o `accept` do input sem HEIC, o iOS converte a foto para JPEG durante o próprio upload.
Suportar HEIC exigiria um libvips personalizado com decodificador HEVC, o que está **fora do escopo
atual**.

Cada versão usa path aleatório dentro do diretório do usuário, evitando cache antigo. A API grava o
novo objeto, atualiza o banco e só então remove o anterior. Se banco falhar, remove o novo objeto. Uma
falha isolada ao apagar a versão anterior é registrada no servidor e não desfaz a foto já salva; isso
pode deixar um objeto órfão e é uma **limitação conhecida**.

## Integrações atuais

A aba Vendas mostra a comissão apurada por venda e um indicador com a soma do
período. Lista, indicador, relatório por setor e rentabilidade leem
`venda_comissao`; não recalculam o valor pelo cadastro. O beneficiário é o
vendedor, e a taxa fica congelada ao reconhecer a receita. Apuração não significa
pagamento: a despesa segue pela fila de eventos financeiros. As vendas anteriores
ao mês de implantação têm snapshot de leitura legado, sem nova despesa na DRE.

O chat interno lê `usuario.foto_url` nas listas e conversas e mantém iniciais como fallback. Assim, a
foto também aparece nos avatares e no toast de mensagem recebida após a próxima reconsulta do chat.
Consulte [`chat.md`](./chat.md).

## Testes e validação

- `npx tsx --test src/lib/meu-perfil/*.test.ts "src/app/(app)/(pages)/meu-perfil/components/*.test.tsx" src/app/api/_authz/action-permission.test.ts`
- `npx eslint "src/app/(app)/(pages)/meu-perfil" src/app/api/me/perfil src/lib/meu-perfil`
- `npx tsc --noEmit --incremental false`
- `npm run build`
- validar manualmente upload próprio e de outro usuário com `usuarios:ver-perfis`;
- validar que um perfil com `usuarios:ver-perfis` e sem `usuarios:visualizar` vê o seletor;
- validar que um usuário sem `usuarios:ver-perfis` recebe `403` ao forçar outro `usuarioId`.

## Regras para futuras implementações

1. leia esta documentação antes de alterar o módulo;
2. preserve o contrato `fotoUrl` ou documente sua alteração;
3. crie nova migração em vez de modificar uma já aplicada;
4. preserve a autorização no servidor para qualquer `usuarioId` recebido;
5. nunca exponha `service_role` nem libere escrita direta no bucket público;
6. mantenha validação por conteúdo/decodificação e normalização da imagem;
7. impeça que a limpeza de arquivo alcance o diretório de outro usuário;
8. mantenha as listas históricas paginadas;
9. adicione ou atualize testes;
10. atualize este documento no mesmo conjunto de mudanças.

## Histórico resumido

- **2026-08-26:** upload imediato de foto no card, suporte à administração de perfis autorizados,
  normalização WebP no servidor, substituição do arquivo anterior, persistência em `usuario` e consumo
  da imagem pelo chat interno.
- **2026-08-26 — Formatos aceitos:** HEIC e HEIF saíram da validação e do `accept`, porque o libvips
  do Sharp não decodifica HEVC; JPG, PNG, WebP e AVIF continuam aceitos.
- **2026-09-15 — Permissão própria:** navegar entre perfis passou de `usuarios:visualizar` para
  `usuarios:ver-perfis`, e o seletor deixou de ler `/api/users`. A migração concede a nova permissão
  a todo perfil que já tinha `usuarios:visualizar`.
