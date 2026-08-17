# Implementar backend do módulo de Rádio em ERP existente

Analise primeiro toda a arquitetura, estrutura de pastas, banco de dados, autenticação, padrões de API, services, repositories, validações e convenções existentes neste ERP.

O ERP **já está pronto e funcionando**.

Sua tarefa é **somente implementar o backend do módulo de Rádio**, integrando-o à arquitetura atual.

Não recrie o projeto.

Não altere módulos existentes sem necessidade.

Não mude autenticação, banco, estrutura global, padrões de resposta ou arquitetura existente apenas para implementar esse recurso.

Reutilize os padrões já utilizados pelo sistema.

---

# 1. OBJETIVO

Criar um módulo de rádio online dentro do ERP.

O sistema deve permitir cadastrar estações de rádio que possuam transmissão pela internet.

Cada rádio poderá possuir:

* nome;
* frequência;
* cidade;
* estado;
* país;
* descrição;
* gêneros;
* logo;
* site oficial;
* URL direta do stream;
* URL de playlist;
* formato da playlist;
* codec;
* bitrate;
* status;
* indicação se está ativa;
* indicação se é rádio padrão do sistema;
* empresa proprietária do cadastro, quando aplicável.

Exemplo:

```json
{
  "name": "Mix FM João Pessoa",
  "frequency": "93.7 FM",
  "city": "João Pessoa",
  "state": "PB",
  "country": "Brasil",
  "genres": [
    "Pop",
    "Pop-Rock",
    "Hits"
  ],
  "logoUrl": null,
  "websiteUrl": "https://exemplo.com",
  "streamUrl": "https://servidor.com/stream",
  "playlistUrl": null,
  "playlistFormat": null,
  "codec": "AAC",
  "bitrate": 128,
  "active": true
}
```

---

# 2. CONCEITO IMPORTANTE

O ERP **não deverá retransmitir o áudio pelo próprio servidor**.

O backend será responsável por:

1. cadastrar as rádios;
2. armazenar os URLs;
3. validar os URLs;
4. identificar playlists;
5. resolver playlists para encontrar o stream real;
6. informar ao frontend qual URL deve ser reproduzida;
7. verificar periodicamente ou sob demanda se uma rádio continua disponível.

O áudio deverá ser consumido diretamente pelo navegador do usuário a partir do servidor da própria rádio.

Fluxo:

```text
ERP
 |
 | consulta rádio
 v
Backend
 |
 | retorna streamUrl
 v
Frontend
 |
 | <audio>
 v
Servidor da emissora
 |
 v
Áudio
```

O backend do ERP NÃO deverá funcionar como proxy contínuo de áudio.

Isso evita consumo desnecessário de:

* banda;
* CPU;
* memória;
* conexões simultâneas;
* infraestrutura.

---

# 3. MODELAGEM

Crie a entidade equivalente a:

```ts
RadioStation {
  id

  name
  slug?

  frequency?

  city?
  state?
  country?

  description?

  genres[]

  logoUrl?
  websiteUrl?

  streamUrl?

  playlistUrl?
  playlistFormat?

  codec?
  bitrate?

  streamStatus

  lastCheckedAt?
  lastOnlineAt?

  active

  systemDefault

  companyId?

  createdById?

  createdAt
  updatedAt
}
```

Adapte os tipos ao banco já utilizado no ERP.

Não introduza outro ORM ou banco.

---

# 4. STATUS DO STREAM

Crie um enum ou equivalente:

```ts
ONLINE
OFFLINE
UNKNOWN
INVALID
PLAYLIST_FOUND
RESOLVING
```

Pode adaptar os nomes ao padrão existente.

Exemplo:

```text
ONLINE
```

Significa que o servidor respondeu e existe indício suficiente de transmissão de áudio.

```text
OFFLINE
```

O endereço existia ou já funcionou, mas atualmente não responde corretamente.

```text
INVALID
```

URL inválida ou conteúdo incompatível com uma rádio.

```text
UNKNOWN
```

Ainda não foi testado.

---

# 5. URL DIRETA E PLAYLIST

Existem dois tipos principais de cadastro.

## Stream direto

Exemplo:

```text
https://servidor.com/live.mp3
```

ou:

```text
https://servidor.com/stream
```

ou:

```text
https://servidor.com/live.aac
```

Neste caso:

```json
{
  "streamUrl": "https://servidor.com/stream",
  "playlistUrl": null
}
```

---

## Playlist

Exemplo:

```text
https://servidor.com/radio.m3u
```

ou:

```text
https://servidor.com/radio.pls
```

Nesse caso:

```json
{
  "streamUrl": null,
  "playlistUrl": "https://servidor.com/radio.m3u",
  "playlistFormat": "M3U"
}
```

O backend deverá acessar a playlist e tentar encontrar o stream real.

---

# 6. RESOLUÇÃO DE M3U

Exemplo de arquivo:

```text
#EXTM3U
#EXTINF:-1,Minha Rádio
https://servidor.com:8000/stream
```

O sistema deverá ignorar:

```text
#EXTM3U
#EXTINF
```

e extrair:

```text
https://servidor.com:8000/stream
```

Depois:

```text
playlistUrl
       ↓
GET
       ↓
parser M3U
       ↓
stream encontrado
       ↓
validação
       ↓
streamUrl
```

---

# 7. RESOLUÇÃO DE PLS

Um arquivo PLS pode possuir:

```ini
[playlist]
NumberOfEntries=1
File1=https://servidor.com/stream
Title1=Minha Rádio
Length1=-1
Version=2
```

Extrair:

```text
File1
```

Neste caso:

```text
https://servidor.com/stream
```

Se houver múltiplos:

```text
File1
File2
File3
```

tentar encontrar o primeiro stream válido.

---

# 8. HLS / M3U8

Não confundir:

```text
.m3u
```

com:

```text
.m3u8
```

Uma `.m3u8` pode representar transmissão HLS.

Neste caso não necessariamente deve ser transformada em outro stream.

Pode ser utilizada diretamente como:

```text
streamUrl
```

e retornar:

```json
{
  "streamType": "HLS"
}
```

O frontend decidirá se utiliza:

* suporte nativo;
* hls.js;
* outra implementação já existente.

---

# 9. DETECÇÃO AUTOMÁTICA

Ao cadastrar uma URL, tente identificar automaticamente:

```text
.mp3
.aac
.ogg
.m3u
.pls
.m3u8
```

Mas NÃO dependa exclusivamente da extensão.

Também analise, quando possível:

```http
Content-Type
```

Exemplos:

```text
audio/mpeg
audio/aac
audio/ogg
audio/x-mpegurl
application/vnd.apple.mpegurl
audio/x-scpls
```

---

# 10. TESTE DE STREAM

Crie um serviço como:

```ts
RadioStreamService
```

ou equivalente ao padrão do projeto.

Responsabilidades:

```ts
validateUrl()
detectType()
resolvePlaylist()
checkStream()
getStreamMetadata()
```

Não acople toda essa lógica diretamente nos controllers/routes.

---

# 11. VALIDAÇÃO DE URL

Antes de salvar:

* verificar se é HTTP ou HTTPS;
* normalizar URL;
* impedir valores obviamente inválidos;
* limitar tamanho;
* realizar validação segura;
* tratar redirects.

Nunca confie cegamente no URL fornecido pelo usuário.

---

# 12. SEGURANÇA CONTRA SSRF

Esta parte é OBRIGATÓRIA.

Como o backend fará requisições para URLs fornecidas por usuários, proteja contra SSRF.

Não permita acessar:

```text
localhost
127.0.0.1
0.0.0.0
::1
```

Nem redes privadas, locais ou internas, incluindo faixas equivalentes a:

```text
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
```

Bloqueie também acessos a:

* metadata services de cloud;
* IPs internos;
* protocolos que não sejam HTTP/HTTPS;
* redirecionamentos para hosts privados.

Exemplo de ataque que deve ser bloqueado:

```text
http://169.254.169.254/latest/meta-data/
```

ou:

```text
http://localhost:3000/api/admin
```

A validação deve acontecer também após redirects.

---

# 13. TIMEOUT

Jamais deixe validação de rádio pendurada indefinidamente.

Use timeout.

Exemplo conceitual:

```text
5 a 10 segundos
```

Adapte ao padrão do projeto.

Também limite:

* quantidade de redirects;
* tamanho máximo de playlist;
* quantidade de bytes analisados.

Não baixe um stream inteiro.

---

# 14. NÃO BAIXAR O ÁUDIO

Ao validar uma rádio:

NÃO:

```text
baixar continuamente o MP3
```

Apenas obtenha bytes/cabeçalhos suficientes para validar a transmissão.

Se o servidor permitir HEAD, pode tentar.

Mas várias rádios não implementam HEAD corretamente.

Portanto implemente fallback para GET com leitura limitada.

---

# 15. ICY / ICECAST / SHOUTCAST

Muitas rádios usam:

* Icecast;
* Shoutcast;
* ICY.

O serviço deve tolerar esses servidores.

Quando disponível, capture metadata como:

```text
icy-name
icy-description
icy-genre
icy-br
icy-url
content-type
```

Exemplo de resposta:

```text
icy-name: Minha Rádio
icy-genre: Pop
icy-br: 128
content-type: audio/mpeg
```

Esses dados podem ser usados para enriquecer o cadastro.

Não sobrescreva automaticamente dados personalizados do usuário sem uma regra explícita.

---

# 16. ENDPOINTS

Adapte as rotas ao padrão atual do ERP.

Criar operações equivalentes a:

```http
GET /api/radios
```

Lista rádios disponíveis.

Filtros opcionais:

```text
name
city
state
genre
active
systemDefault
```

---

```http
GET /api/radios/:id
```

Retorna os detalhes da rádio.

---

```http
POST /api/radios
```

Cadastra uma rádio.

---

```http
PUT /api/radios/:id
```

ou:

```http
PATCH /api/radios/:id
```

Atualiza uma rádio.

Siga o padrão do ERP.

---

```http
DELETE /api/radios/:id
```

Remove ou inativa a rádio, conforme padrão existente.

---

```http
POST /api/radios/test
```

Recebe:

```json
{
  "url": "https://servidor.com/stream"
}
```

E retorna algo semelhante a:

```json
{
  "valid": true,
  "online": true,
  "type": "DIRECT_STREAM",
  "streamUrl": "https://servidor.com/stream",
  "contentType": "audio/mpeg",
  "codec": "MP3",
  "bitrate": 128
}
```

---

# 17. RESOLVER PLAYLIST

Criar rota ou service equivalente a:

```http
POST /api/radios/resolve
```

Entrada:

```json
{
  "url": "https://servidor.com/radio.m3u"
}
```

Retorno:

```json
{
  "success": true,
  "playlistUrl": "https://servidor.com/radio.m3u",
  "playlistFormat": "M3U",
  "streams": [
    {
      "url": "https://audio.servidor.com/stream",
      "online": true
    }
  ],
  "selectedStream": "https://audio.servidor.com/stream"
}
```

---

# 18. RESOLVER AUTOMATICAMENTE AO CADASTRAR

Quando o usuário informar:

```text
https://servidor.com/listen.m3u
```

o backend poderá:

```text
receber URL
   ↓
detectar M3U
   ↓
resolver playlist
   ↓
testar streams
   ↓
encontrar stream válido
   ↓
salvar:

playlistUrl
streamUrl
playlistFormat
streamStatus
```

Exemplo final:

```json
{
  "playlistUrl": "https://servidor.com/listen.m3u",
  "playlistFormat": "M3U",
  "streamUrl": "https://audio.servidor.com:8000/live",
  "streamStatus": "ONLINE"
}
```

---

# 19. FAVORITOS

Se a arquitetura atual permitir usuário individual, criar uma relação equivalente a:

```ts
RadioFavorite {
  id
  userId
  radioStationId
  createdAt
}
```

Evitar favoritos duplicados.

Rotas equivalentes:

```http
GET /api/radios/favorites

POST /api/radios/:id/favorite

DELETE /api/radios/:id/favorite
```

Ao listar as rádios, se houver usuário autenticado, pode retornar:

```json
{
  "isFavorite": true
}
```

---

# 20. ÚLTIMA RÁDIO UTILIZADA

Opcionalmente salve por usuário:

```ts
lastRadioStationId
```

ou crie entidade de preferência.

Objetivo:

Quando o usuário entrar novamente no ERP, o frontend poderá restaurar a última estação utilizada.

NÃO reproduza automaticamente áudio sem interação do usuário, pois navegadores possuem políticas de autoplay.

Apenas retorne a última rádio.

---

# 21. MULTIEMPRESA

Se o ERP for multiempresa, respeitar completamente o isolamento já existente.

Uma rádio cadastrada como particular:

```text
companyId = empresa atual
```

só poderá ser acessada por usuários autorizados daquela empresa.

Uma rádio global:

```text
systemDefault = true
companyId = null
```

poderá aparecer para todas as empresas.

Exemplo:

```text
Rádios padrão do ERP
+
Rádios cadastradas pela empresa
```

Nunca permita vazamento entre empresas.

Use exatamente os mecanismos de tenant/company já existentes.

---

# 22. PERMISSÕES

Integrar com o sistema de permissões existente.

Exemplo conceitual:

```text
radio.view
radio.create
radio.update
radio.delete
```

Se o ERP possuir outro padrão, siga o padrão existente.

Usuários comuns podem eventualmente:

```text
visualizar
tocar
favoritar
```

Enquanto administradores podem:

```text
cadastrar
editar
excluir
testar
```

Não invente um segundo sistema de autorização.

---

# 23. LISTAGEM

O backend deve retornar dados adequados ao frontend.

Exemplo:

```json
{
  "id": "123",
  "name": "Mix FM João Pessoa",
  "frequency": "93.7 FM",
  "city": "João Pessoa",
  "state": "PB",
  "country": "Brasil",
  "genres": [
    "Pop",
    "Hits"
  ],
  "logoUrl": "https://...",
  "streamUrl": "https://...",
  "streamType": "AAC",
  "streamStatus": "ONLINE",
  "active": true,
  "isFavorite": true
}
```

---

# 24. PESQUISA

Permitir pesquisar por:

```text
nome
frequência
cidade
estado
gênero
```

Exemplo:

```http
GET /api/radios?search=mix
```

Pode retornar:

```text
Mix FM João Pessoa
Mix FM São Paulo
...
```

Se o ERP utilizar paginação em outras telas, utilize a mesma estratégia.

---

# 25. ORDENAÇÃO

Sugestão:

```text
favoritas primeiro
↓
rádios padrão
↓
nome em ordem alfabética
```

Mas respeite a arquitetura de filtros e ordenação existente.

---

# 26. STATUS DA RÁDIO

Não execute validação externa pesada toda vez que:

```http
GET /api/radios
```

for chamado.

Isso seria caro e lento.

Salve:

```ts
streamStatus
lastCheckedAt
```

Exemplo:

```json
{
  "streamStatus": "ONLINE",
  "lastCheckedAt": "2026-08-15T20:00:00Z"
}
```

O frontend apenas consulta esse resultado.

---

# 27. REVALIDAÇÃO

Criar service reutilizável para:

```ts
checkRadioStream(radioId)
```

Ele deverá:

```text
buscar rádio
↓
testar URL
↓
resolver playlist se necessário
↓
atualizar streamUrl se necessário
↓
atualizar streamStatus
↓
atualizar lastCheckedAt
↓
se online:
    atualizar lastOnlineAt
```

---

# 28. ENDPOINT DE REVALIDAÇÃO

Administradores podem executar algo equivalente a:

```http
POST /api/radios/:id/check
```

Resposta:

```json
{
  "online": true,
  "streamStatus": "ONLINE",
  "streamUrl": "https://...",
  "checkedAt": "..."
}
```

---

# 29. VALIDAÇÕES DE CADASTRO

Obrigatório:

```text
name
```

E pelo menos um:

```text
streamUrl
```

ou:

```text
playlistUrl
```

Não permitir:

```text
streamUrl = null
playlistUrl = null
```

para uma rádio ativa.

---

# 30. DUPLICIDADE

Evitar cadastros duplicados quando possível.

Considere analisar:

```text
streamUrl
playlistUrl
companyId
```

Mas não considere apenas o nome da estação, pois duas cidades podem possuir rádios com nomes iguais.

---

# 31. RESPOSTAS DE ERRO

Usar exatamente o padrão já existente no ERP.

Exemplos conceituais:

```json
{
  "error": "RADIO_STREAM_INVALID",
  "message": "Não foi possível identificar uma transmissão de áudio válida."
}
```

Outro:

```json
{
  "error": "RADIO_STREAM_OFFLINE",
  "message": "A rádio foi cadastrada, mas o stream não respondeu no momento."
}
```

---

# 32. IMPORTANTE: PERMITIR SALVAR RÁDIO OFFLINE

Se o URL estiver sintaticamente válido mas temporariamente indisponível, não necessariamente impeça o cadastro.

Pode salvar:

```text
streamStatus = OFFLINE
```

Isso é importante porque rádios podem sofrer indisponibilidade temporária.

URLs claramente inválidas ou inseguras devem ser rejeitadas.

---

# 33. FRONTEND NÃO FAZ PARTE DESTA TAREFA

Não implemente uma nova interface completa nesta tarefa, salvo pequenos tipos/contratos estritamente necessários para compatibilidade.

O frontend posteriormente utilizará:

```tsx
<audio src={radio.streamUrl} />
```

ou um player HLS.

O objetivo desta tarefa é entregar o backend preparado para isso.

---

# 34. COMPATIBILIDADE COM CORS

Ao testar o stream no backend, CORS não interfere da mesma forma que no navegador.

Porém, o frontend reproduzirá diretamente o áudio da emissora.

Se determinada rádio impedir reprodução direta no browser, apenas informe essa limitação.

Não implemente automaticamente proxy permanente de áudio como solução.

---

# 35. NÃO PROXYAR STREAM POR PADRÃO

Não crie:

```http
/api/radios/:id/audio
```

para retransmitir continuamente a rádio pelo ERP.

Somente considere proxy de áudio se existir uma necessidade futura explícita.

A arquitetura padrão deve ser:

```text
Frontend
    ↓
servidor da rádio
```

e NÃO:

```text
Frontend
    ↓
ERP
    ↓
servidor da rádio
```

---

# 36. LOGS

Registrar erros importantes de:

```text
falha na resolução
timeout
redirect excessivo
playlist inválida
stream offline
SSRF bloqueado
erro HTTP
```

Não grave dados sensíveis.

Não transforme indisponibilidades normais de rádios em erros críticos do ERP.

---

# 37. TESTES

Criar testes seguindo o padrão existente do projeto.

Cobrir pelo menos:

### Stream direto válido

```text
https://radio.test/stream.mp3
```

Deve identificar stream.

### M3U

```text
playlist
↓
stream
```

Deve resolver corretamente.

### PLS

```text
File1=https://...
```

Deve resolver.

### M3U8

Deve identificar como HLS.

### URL inválida

Deve rejeitar.

### Timeout

Deve finalizar corretamente.

### SSRF

Devem ser bloqueados:

```text
localhost
127.0.0.1
192.168.x.x
10.x.x.x
169.254.169.254
```

### Redirect para IP privado

Também deve ser bloqueado.

### Rádio offline

Deve retornar:

```text
OFFLINE
```

sem quebrar a aplicação.

---

# 38. ESTRUTURA DO SERVICE

Algo conceitualmente semelhante a:

```ts
class RadioStreamService {
  async validateUrl(url: string) {}

  async detectStreamType(url: string) {}

  async resolvePlaylist(url: string) {}

  async resolveM3U(content: string) {}

  async resolvePLS(content: string) {}

  async checkStream(url: string) {}

  async getMetadata(url: string) {}

  async checkRadio(radioId: string) {}
}
```

Não utilize obrigatoriamente essa estrutura se o ERP já possuir outro padrão arquitetural.

A prioridade é seguir a arquitetura atual.

---

# 39. CATÁLOGO INICIAL — RÁDIOS DE JOÃO PESSOA/PB

O módulo deverá ser entregue já preparado para importar/cadastrar um catálogo inicial de rádios de **João Pessoa/PB**.

Essas rádios deverão ser cadastradas preferencialmente como:

```text
systemDefault = true
```

e:

```text
companyId = null
```

pois serão rádios padrão disponibilizadas pelo próprio ERP.

IMPORTANTE:

Algumas rádios abaixo possuem uma `playlistUrl` no formato `.m3u`, mas ainda não possuem o `streamUrl` direto conhecido.

Nesses casos, o backend deverá:

```text
playlistUrl
    ↓
baixar playlist com segurança
    ↓
resolver M3U
    ↓
extrair URL real
    ↓
validar stream
    ↓
salvar streamUrl
```

Nunca considere automaticamente que a URL `.m3u` é o áudio final.

---

## CATÁLOGO INICIAL

Utilizar os seguintes dados como catálogo inicial:

```json
[
  {
    "id": "radio-camara-887",
    "name": "Rádio Câmara",
    "frequency": "88.7 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Pública"],
    "websiteUrl": "https://www.joaopessoa.pb.leg.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-camara-887-fm/68919",
    "playlistUrl": "https://www.radios.com.br/play/playlist/68919/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "radio-pop-893",
    "name": "Rádio Pop",
    "frequency": "89.3 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Popular", "Eclética", "Debates", "Entrevistas"],
    "websiteUrl": "https://portalpopnoticias.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-pop-893-fm/39537",
    "playlistUrl": "https://www.radios.com.br/play/playlist/39537/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "cabo-branco-915",
    "name": "Rádio Cabo Branco",
    "frequency": "91.5 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["MPB"],
    "websiteUrl": null,
    "sourcePage": "https://www.radios.com.br/aovivo/radio-cabo-branco-915-fm/10563",
    "playlistUrl": "https://www.radios.com.br/play/playlist/10563/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "sucesso-929",
    "name": "Rádio Sucesso",
    "frequency": "92.9 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Popular", "Eclética", "Hits"],
    "websiteUrl": "https://www.sucesso92fm.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-sucesso-929-fm/14705",
    "playlistUrl": "https://www.radios.com.br/play/playlist/14705/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true,
    "notes": "O stream já apresentou instabilidade. Validar antes de marcar como ONLINE."
  },
  {
    "id": "mix-fm-937",
    "name": "Mix FM João Pessoa",
    "frequency": "93.7 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Pop", "Pop-Rock", "Hits", "Jovem"],
    "websiteUrl": "https://aovivo.radiomixfm.com.br/joaopessoa",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-mix-937-fm/13959",
    "playlistUrl": "https://www.radios.com.br/play/playlist/13959/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "arapuan-953",
    "name": "Arapuan FM",
    "frequency": "95.3 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Hits", "Românticas", "Forró"],
    "websiteUrl": "https://www.arapuanfm.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-arapuan-953-fm/9627",
    "playlistUrl": "https://www.radios.com.br/play/playlist/9627/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "cpad-961",
    "name": "Rádio CPAD",
    "frequency": "96.1 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Gospel"],
    "websiteUrl": null,
    "sourcePage": "https://www.radios.com.br/aovivo/radio-cpad-961-fm/12233",
    "playlistUrl": "https://www.radios.com.br/play/playlist/12233/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "joao-pessoa-fm-977",
    "name": "Rádio João Pessoa",
    "frequency": "97.7 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Popular", "Adulta", "MPB"],
    "websiteUrl": "https://joaopessoafm.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-joao-pessoa-977-fm/178614",
    "playlistUrl": "https://www.radios.com.br/play/playlist/178614/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "correio-983",
    "name": "Rádio 98 Correio",
    "frequency": "98.3 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Hits", "Eclética"],
    "websiteUrl": "https://www.correiosat.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-98-correio-fm/8886",
    "playlistUrl": "https://www.radios.com.br/play/playlist/8886/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "rede-aleluia-997",
    "name": "Rede Aleluia João Pessoa",
    "frequency": "99.7 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Gospel"],
    "websiteUrl": "https://redealeluia.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-rede-aleluia-997-fm/24493",
    "playlistUrl": "https://www.radios.com.br/play/playlist/24493/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "bandnews-1011",
    "name": "BandNews FM João Pessoa",
    "frequency": "101.1 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Jornalismo", "Notícias"],
    "websiteUrl": "https://www.bandnewsfm.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-bandnews-1011-fm/234749",
    "playlistUrl": "https://www.radios.com.br/play/playlist/234749/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "cbn-1017",
    "name": "CBN João Pessoa",
    "frequency": "101.7 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Jornalismo", "Notícias", "Futebol", "Entrevistas"],
    "websiteUrl": "https://cbnparaiba.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-cbn-joao-pessoa-1017-fm/16734",
    "playlistUrl": "https://www.radios.com.br/play/playlist/16734/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "novabrasil-1025",
    "name": "Novabrasil FM João Pessoa",
    "frequency": "102.5 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["MPB", "Música Brasileira"],
    "websiteUrl": "https://novabrasilfm.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-nova-brasil-1025-fm/14757",
    "playlistUrl": "https://www.radios.com.br/play/playlist/14757/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "liga-fm-1033",
    "name": "Liga FM João Pessoa",
    "frequency": "103.3 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Popular", "Eclética", "Notícias"],
    "websiteUrl": "https://joaopessoa.ligafm.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-liga-1033-fm/11829",
    "playlistUrl": "https://www.radios.com.br/play/playlist/11829/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "parahyba-fm-1039",
    "name": "Parahyba FM",
    "frequency": "103.9 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Pop-Rock", "MPB", "Música Brasileira"],
    "websiteUrl": "https://epc.pb.gov.br/radio-ao-vivo/parahyba-fm",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-parahyba-1039-fm/14505",
    "playlistUrl": "https://www.radios.com.br/play/playlist/14505/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "rede-master-1045",
    "name": "Rede Master",
    "frequency": "104.5 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Gospel"],
    "websiteUrl": null,
    "sourcePage": "https://www.radios.com.br/aovivo/radio-rede-master-1045-fm/113634",
    "playlistUrl": "https://www.radios.com.br/play/playlist/113634/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "tabajara-1055",
    "name": "Rádio Tabajara",
    "frequency": "105.5 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Eclética", "MPB", "Cultura"],
    "websiteUrl": "https://epc.pb.gov.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-tabajara-1055-fm/14751",
    "playlistUrl": "https://www.radios.com.br/play/playlist/14751/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "ceu-fm-1071",
    "name": "Rádio Céu",
    "frequency": "107.1 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Gospel"],
    "websiteUrl": "https://www.correiosat.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-ceu-1071-fm/17889",
    "playlistUrl": "https://www.radios.com.br/play/playlist/17889/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "deus-e-amor-1077",
    "name": "Rádio Deus é Amor",
    "frequency": "107.7 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "genres": ["Gospel"],
    "websiteUrl": "https://www.ipdapb.com.br/",
    "sourcePage": "https://www.radios.com.br/aovivo/radio-deus-e-amor-1077-fm/115539",
    "playlistUrl": "https://www.radios.com.br/play/playlist/115539/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "mangabeira-879",
    "name": "Rádio Mangabeira",
    "frequency": "87.9 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "neighborhood": "Mangabeira",
    "genres": ["Comunitária"],
    "websiteUrl": null,
    "sourcePage": "https://www.radios.com.br/aovivo/radio-mangabeira-879-fm/33961",
    "playlistUrl": "https://www.radios.com.br/play/playlist/33961/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "valentina-879",
    "name": "Rádio Valentina",
    "frequency": "87.9 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "neighborhood": "Valentina",
    "genres": ["Comunitária", "Hits", "Adulta"],
    "websiteUrl": null,
    "sourcePage": "https://www.radios.com.br/aovivo/radio-valentina-879-fm/35977",
    "playlistUrl": "https://www.radios.com.br/play/playlist/35977/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  },
  {
    "id": "cruz-das-armas-879",
    "name": "Rádio Cruz das Armas",
    "frequency": "87.9 FM",
    "city": "João Pessoa",
    "state": "PB",
    "country": "Brasil",
    "neighborhood": "Cruz das Armas",
    "genres": ["Comunitária", "Popular"],
    "websiteUrl": null,
    "sourcePage": "https://www.radios.com.br/aovivo/radio-cruz-das-armas-879-fm/12258",
    "playlistUrl": "https://www.radios.com.br/play/playlist/12258/listen-radio.m3u",
    "playlistFormat": "M3U",
    "streamUrl": null,
    "streamStatus": "UNKNOWN",
    "active": true,
    "systemDefault": true
  }
]
```

---

# 39.1. NÃO CONFIAR CEGAMENTE NOS LINKS DO CATÁLOGO

Os dados acima são um catálogo inicial.

No momento da importação, o sistema deve validar cada rádio.

Fluxo:

```text
seed/importação
      ↓
lê playlistUrl
      ↓
RadioStreamService.resolvePlaylist()
      ↓
encontra possível stream
      ↓
RadioStreamService.checkStream()
      ↓
ONLINE?
 ┌────┴─────┐
SIM         NÃO
↓           ↓
salva       mantém
streamUrl   streamUrl = null
↓           ↓
ONLINE      OFFLINE/UNKNOWN
```

Uma falha em uma rádio NÃO deve impedir a importação das demais.

Exemplo:

```text
Mix FM        → ONLINE
Arapuan       → ONLINE
CBN           → ONLINE
Rádio X       → OFFLINE
Rádio Y       → playlist inválida
```

A importação deverá continuar normalmente.

---

# 39.2. IMPORTAÇÃO IDEMPOTENTE

A rotina de seed/importação deverá ser idempotente.

Executá-la novamente não poderá criar:

```text
Mix FM
Mix FM
Mix FM
```

Use uma chave estável, slug ou outro identificador adequado.

Exemplo:

```text
mix-fm-937
arapuan-953
cbn-1017
```

Se a rádio já existir:

```text
atualizar metadados necessários
```

ou ignorar, conforme o padrão adotado pelo projeto.

Não duplicar registros.

---

# 39.3. RESOLVER STREAMS NA IMPORTAÇÃO

Para registros como:

```json
{
  "playlistUrl": "https://www.radios.com.br/play/playlist/13959/listen-radio.m3u",
  "streamUrl": null
}
```

a rotina deverá tentar resolver:

```text
GET playlist
      ↓
conteúdo:

#EXTM3U
#EXTINF:-1,Mix FM
https://servidor-real-da-radio/stream

      ↓

streamUrl =
https://servidor-real-da-radio/stream
```

Depois testar o endereço extraído.

Se válido:

```json
{
  "streamStatus": "ONLINE",
  "streamUrl": "https://servidor-real-da-radio/stream"
}
```

Se não:

```json
{
  "streamStatus": "OFFLINE",
  "streamUrl": null
}
```

ou mantenha o stream encontrado com status `OFFLINE`, caso faça mais sentido na arquitetura atual.

---

# 39.4. ORIGEM NÃO É O STREAM

Diferenciar claramente:

```text
websiteUrl
```

Site oficial da rádio.

```text
sourcePage
```

Página utilizada para localizar informações/playlist.

```text
playlistUrl
```

Arquivo ou endpoint que referencia uma ou mais transmissões.

```text
streamUrl
```

URL que efetivamente entrega o áudio.

Nunca utilizar:

```text
sourcePage
```

como:

```text
streamUrl
```

---

# 39.5. LOGO DAS RÁDIOS

Não inventar URLs de logos.

Inicialmente:

```json
{
  "logoUrl": null
}
```

Se futuramente houver logo oficial cadastrada, armazenar normalmente.

Não fazer scraping automático de imagens durante essa implementação, salvo se já existir infraestrutura própria no ERP para isso.

---

# 39.6. CATÁLOGO GLOBAL

Essas rádios deverão aparecer como catálogo padrão:

```text
📻 João Pessoa/PB

88.7  Rádio Câmara
89.3  Rádio Pop
91.5  Cabo Branco
92.9  Sucesso
93.7  Mix FM
95.3  Arapuan
96.1  CPAD
97.7  Rádio João Pessoa
98.3  98 Correio
99.7  Rede Aleluia
101.1 BandNews FM
101.7 CBN
102.5 Novabrasil
103.3 Liga FM
103.9 Parahyba FM
104.5 Rede Master
105.5 Tabajara
107.1 Rádio Céu
107.7 Rádio Deus é Amor
```

Além das comunitárias:

```text
87.9 Rádio Mangabeira
87.9 Rádio Valentina
87.9 Rádio Cruz das Armas
```

---

# 39.7. RESULTADO ESPERADO DA IMPORTAÇÃO

Depois que o backend for implementado, deve ser possível consultar:

```http
GET /api/radios?city=João%20Pessoa&state=PB
```

e obter:

```json
{
  "data": [
    {
      "id": "...",
      "name": "Mix FM João Pessoa",
      "frequency": "93.7 FM",
      "city": "João Pessoa",
      "state": "PB",
      "genres": ["Pop", "Pop-Rock", "Hits", "Jovem"],
      "streamUrl": "https://servidor-real/stream",
      "streamStatus": "ONLINE",
      "systemDefault": true
    },
    {
      "id": "...",
      "name": "Arapuan FM",
      "frequency": "95.3 FM",
      "city": "João Pessoa",
      "state": "PB",
      "streamUrl": "https://servidor-real/stream",
      "streamStatus": "ONLINE",
      "systemDefault": true
    }
  ]
}
```

O objetivo final é que o frontend NÃO precise conhecer `.m3u`, `.pls`, RadiosNet ou detalhes técnicos da emissora.

O frontend deverá receber preferencialmente:

```text
name
frequency
logoUrl
streamUrl
streamType
streamStatus
isFavorite
```

Toda lógica de resolução deverá ficar no backend.


# 40. RESULTADO ESPERADO

Ao terminar, deverá ser possível realizar:

```text
Cadastrar rádio
      ↓
informar stream ou playlist
      ↓
backend valida
      ↓
backend identifica o formato
      ↓
se playlist:
   encontra stream real
      ↓
salva rádio
      ↓
frontend lista rádio
      ↓
usuário seleciona
      ↓
backend retorna streamUrl
      ↓
frontend reproduz
```

Exemplo:

```text
Usuário seleciona:

Mix FM João Pessoa
93.7 FM

           ↓

GET /api/radios/123

           ↓

{
  "name": "Mix FM João Pessoa",
  "streamUrl": "https://servidor-radio/stream",
  "streamStatus": "ONLINE"
}

           ↓

<audio src="https://servidor-radio/stream">
```

---

# 41. REGRAS FINAIS

Antes de programar:

1. analise o projeto existente;
2. identifique banco e ORM utilizados;
3. identifique padrão de autenticação;
4. identifique multiempresa/tenant;
5. identifique padrão de controllers/routes;
6. identifique services/repositories existentes;
7. identifique padrão de validação;
8. identifique padrão de tratamento de erros;
9. identifique padrão de testes.

Depois implemente o módulo adaptado a isso.

Não:

* refatore partes não relacionadas;
* altere APIs existentes;
* mude banco;
* mude ORM;
* crie segundo sistema de autenticação;
* crie segundo sistema de permissões;
* faça proxy permanente do áudio;
* exponha endpoints internos;
* aceite URLs inseguras;
* ignore proteção SSRF.

Ao finalizar:

* informe todos os arquivos criados;
* informe todos os arquivos modificados;
* explique a modelagem adicionada;
* liste as novas rotas;
* descreva como funciona a resolução M3U/PLS;
* explique a proteção contra SSRF;
* informe como testar uma rádio;
* informe se foi necessário criar migration/schema;
* forneça exemplos de requisição e resposta;
* execute os testes/lint/typecheck disponíveis no projeto;
* corrija erros encontrados relacionados à implementação antes de considerar a tarefa concluída.
