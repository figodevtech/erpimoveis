# MELHORIA DO MÓDULO DE RÁDIO — CANAIS TEMÁTICOS

O ERP já possui um módulo de rádio implementado e funcionando.

O backend das rádios já existe.

O frontend/player também já existe e está funcionando corretamente.

NÃO recrie o módulo de rádio.

NÃO recrie o player.

NÃO altere desnecessariamente o funcionamento das rádios existentes.

NÃO implemente upload de MP3.

NÃO implemente playlists próprias.

NÃO implemente armazenamento de músicas.

NÃO implemente Spotify, YouTube Music, Deezer ou APIs semelhantes.

A tarefa agora é adicionar **CANAIS TEMÁTICOS DE MÚSICA**, usando streams públicos de rádios online que já possuem programação contínua por gênero.

Exemplos:

* Só MPB
* Forró
* Sertanejo
* Sertanejo Romântico
* Samba & Pagode
* Rock
* Pop
* Pop Rock Nacional
* Gospel
* Reggae
* Anos 80
* Anos 90
* Anos 2000
* Música Eletrônica
* Bossa Nova

Para o usuário, esses canais deverão funcionar exatamente como as rádios atuais.

Exemplo:

```text
Usuário seleciona:

🎵 MPB

        ↓

backend retorna streamUrl

        ↓

player existente toca normalmente
```

---

# 1. ANALISAR PRIMEIRO A IMPLEMENTAÇÃO EXISTENTE

Antes de fazer qualquer alteração:

1. localize o módulo de rádio já implementado;
2. identifique a entidade/model atual das rádios;
3. identifique os services responsáveis por streams;
4. identifique como M3U8/HLS já é tratado;
5. identifique os endpoints atuais;
6. identifique o contrato utilizado pelo frontend;
7. identifique como `streamUrl`, `streamType` e `streamStatus` são retornados;
8. identifique o sistema de favoritos existente;
9. identifique o modelo multiempresa, se houver;
10. identifique migrations/schema existentes.

A nova funcionalidade deve **reutilizar integralmente a infraestrutura atual**.

Não crie um segundo módulo independente de áudio.

---

# 2. CONCEITO

Atualmente existem rádios como:

```text
📻 Mix FM João Pessoa
📻 Arapuan FM
📻 CBN João Pessoa
```

Agora deverão existir também canais temáticos:

```text
🎵 MPB
🎵 Forró
🎵 Sertanejo
🎵 Samba & Pagode
🎵 Rock
🎵 Anos 80
```

Tecnicamente ambos são streams.

A diferença é apenas conceitual.

Uma rádio representa uma emissora:

```text
Mix FM João Pessoa
93.7 FM
```

Um canal temático representa um gênero:

```text
MPB
Só música brasileira
```

O player não precisa conhecer essa diferença.

---

# 3. NÃO CRIAR UMA PLAYLIST DE ARQUIVOS

Apesar de a funcionalidade ser apresentada ao usuário como uma seleção temática, NÃO criar:

```text
Playlist
 ├ musica1.mp3
 ├ musica2.mp3
 ├ musica3.mp3
 └ musica4.mp3
```

Não armazenar arquivos de música.

Não criar tabela de músicas.

Não criar:

```ts
Track
Song
Album
Artist
```

para esta funcionalidade.

O conteúdo vem de streams externos contínuos.

Arquitetura:

```text
Canal "MPB"
      ↓
stream externo
      ↓
player existente
      ↓
🔊 usuário
```

---

# 4. APROVEITAR A ENTIDADE DE RÁDIO EXISTENTE

Preferencialmente NÃO criar uma entidade completamente separada.

Adapte a entidade atual de rádio.

Criar algo equivalente a:

```ts
type RadioChannelType =
  | "RADIO"
  | "THEMATIC";
```

Ou utilize enum/nomenclatura equivalente ao padrão do projeto.

Exemplo de rádio existente:

```json
{
  "name": "Mix FM João Pessoa",
  "type": "RADIO",
  "frequency": "93.7 FM"
}
```

Exemplo de canal novo:

```json
{
  "name": "MPB",
  "type": "THEMATIC",
  "frequency": null
}
```

Não introduza esse campo exatamente dessa forma caso o schema atual tenha uma solução melhor.

---

# 5. CONTRATO COM O PLAYER DEVE PERMANECER IGUAL

O frontend/player já funciona.

Portanto, um canal temático deve continuar retornando algo compatível com:

```json
{
  "id": "...",
  "name": "MPB",
  "streamUrl": "https://...",
  "streamType": "HLS",
  "streamStatus": "ONLINE"
}
```

O frontend NÃO deverá precisar:

```text
resolver playlist
procurar fallback
consultar outro serviço
decidir qual servidor usar
```

Isso continua sendo responsabilidade do backend.

---

# 6. FONTES MÚLTIPLAS / FALLBACK

Uma melhoria importante será permitir que um canal temático tenha mais de uma fonte.

Exemplo:

```text
MPB
 │
 ├── fonte 1
 ├── fonte 2
 └── fonte 3
```

Se:

```text
fonte 1 = ONLINE
```

usar fonte 1.

Se:

```text
fonte 1 = OFFLINE
fonte 2 = ONLINE
```

usar fonte 2.

Assim o usuário continua vendo apenas:

```text
🎵 MPB
```

e não precisa saber qual servidor está fornecendo o áudio.

---

# 7. MODELAGEM DAS FONTES

Analise o banco atual.

Caso seja adequado, criar entidade equivalente a:

```ts
RadioStreamSource {
  id
  radioStationId

  streamUrl
  streamType

  priority

  status

  lastCheckedAt
  lastOnlineAt

  active

  createdAt
  updatedAt
}
```

Relacionamento:

```text
RadioStation
     │
     ├── RadioStreamSource
     ├── RadioStreamSource
     └── RadioStreamSource
```

Exemplo:

```text
MPB
 ├ priority 1 → Vagalume
 └ priority 2 → fallback
```

Se o banco atual permitir uma implementação melhor sem criar nova tabela, adapte.

Mas NÃO armazene simplesmente URLs separados por vírgula.

---

# 8. SELEÇÃO AUTOMÁTICA DA FONTE

Criar algo equivalente a:

```ts
resolveBestStream(channelId)
```

Fluxo:

```text
buscar fontes ativas
        ↓
ordenar por priority
        ↓
primeira ONLINE
        ↓
retornar streamUrl
```

Caso o status esteja desatualizado, o backend pode realizar validação de acordo com a infraestrutura de health check já existente.

---

# 9. NÃO TESTAR TODOS OS STREAMS EM TODO GET

Não executar:

```text
GET externo fonte 1
GET externo fonte 2
GET externo fonte 3
```

toda vez que o frontend chamar:

```http
GET /api/radios
```

Utilize os mecanismos de status já implementados.

Exemplo:

```ts
status
lastCheckedAt
lastOnlineAt
```

O endpoint normal deve ser rápido.

---

# 10. CATÁLOGO INICIAL DE CANAIS TEMÁTICOS

Adicionar inicialmente os seguintes canais.

Os URLs abaixo são streams públicos encontrados para estações temáticas.

IMPORTANTE:

**TODOS DEVEM SER TESTADOS PELO BACKEND ANTES DE SEREM CONSIDERADOS ONLINE.**

Um endpoint externo pode mudar, expirar ou ficar temporariamente indisponível.

Uma falha em um canal NÃO deve impedir a importação dos outros.

---

# 11. MPB

Canal:

```json
{
  "name": "MPB",
  "slug": "mpb",
  "type": "THEMATIC",
  "description": "Música Popular Brasileira",
  "genres": ["MPB", "Música Brasileira"],
  "active": true,
  "systemDefault": true
}
```

Fonte principal:

```text
https://stream.vagalume.fm/hls/1470154983100588/aac.m3u8
```

Tipo esperado:

```text
HLS / AAC
```

Página de referência:

```text
https://vagalume.fm/mpb/
```

---

# 12. FORRÓ

Canal:

```json
{
  "name": "Forró",
  "slug": "forro",
  "type": "THEMATIC",
  "description": "Clássicos e sucessos do forró",
  "genres": ["Forró", "Piseiro", "Nordeste"],
  "active": true,
  "systemDefault": true
}
```

Fonte principal:

```text
https://stream.vagalume.fm/hls/147015501223418/aac.m3u8
```

Página:

```text
https://vagalume.fm/forro/
```

Fallback 1:

```text
https://stream.zeno.fm/1k5m0vv5w0hvv
```

Esse stream possui programação de Forró/Brega.

Fallback 2:

```text
https://stream.zeno.fm/uh7p2mkb86wtv
```

---

# 13. SERTANEJO

```json
{
  "name": "Sertanejo",
  "slug": "sertanejo",
  "type": "THEMATIC",
  "description": "Sucessos da música sertaneja",
  "genres": ["Sertanejo"],
  "active": true,
  "systemDefault": true
}
```

Fonte principal:

```text
https://stream.vagalume.fm/hls/14619606471054026608/aac.m3u8
```

Página:

```text
https://vagalume.fm/sertanejo/
```

Fallback:

```text
https://stream.zeno.fm/6kumndewqbruv
```

---

# 14. SERTANEJO ROMÂNTICO

```json
{
  "name": "Sertanejo Romântico",
  "slug": "sertanejo-romantico",
  "type": "THEMATIC",
  "description": "Baladas e clássicos românticos do sertanejo",
  "genres": ["Sertanejo", "Românticas"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/1499715905423293/aac.m3u8
```

Página:

```text
https://vagalume.fm/sertanejo-romantico/
```

---

# 15. SAMBA & PAGODE

Nome apresentado:

```text
Samba & Pagode
```

```json
{
  "name": "Samba & Pagode",
  "slug": "samba-pagode",
  "type": "THEMATIC",
  "description": "Samba e pagode brasileiro",
  "genres": ["Samba", "Pagode"],
  "active": true,
  "systemDefault": true
}
```

Fonte principal:

```text
https://stream.vagalume.fm/hls/147015499779090/aac.m3u8
```

Página de referência:

```text
https://vagalume.fm/samba-e-pagode/
```

Fallback:

```text
https://stream.zeno.fm/10tft0s9qs8uv
```

Outro fallback conhecido no formato M3U:

```text
http://stream.zeno.fm/hfqaq0bhfg8uv.m3u
```

O backend já possui resolução de M3U; reutilizar a implementação existente.

Priorizar URLs HTTPS para o frontend.

---

# 16. ROCK

```json
{
  "name": "Rock",
  "slug": "rock",
  "type": "THEMATIC",
  "description": "Clássicos e sucessos do rock",
  "genres": ["Rock"],
  "active": true,
  "systemDefault": true
}
```

Fonte principal:

```text
https://stream.vagalume.fm/hls/14647977281792658143/aac.m3u8
```

Fonte alternativa:

```text
https://stream.vagalume.fm/hls/1464201608479108132/aac.m3u8
```

Fallback:

```text
https://stream.zeno.fm/fspaefq5b8luv
```

---

# 17. POP

```json
{
  "name": "Pop",
  "slug": "pop",
  "type": "THEMATIC",
  "description": "Hits da música pop",
  "genres": ["Pop"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/14660050141766497579/aac.m3u8
```

---

# 18. POP NACIONAL

```json
{
  "name": "Pop Nacional",
  "slug": "pop-nacional",
  "type": "THEMATIC",
  "genres": ["Pop", "Brasil"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/1470169276225492/aac.m3u8
```

---

# 19. POP ROCK NACIONAL

```json
{
  "name": "Pop Rock Nacional",
  "slug": "pop-rock-nacional",
  "type": "THEMATIC",
  "description": "Rock e pop rock brasileiro",
  "genres": ["Rock", "Pop Rock", "Brasil"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/14671417541091220806/aac.m3u8
```

Página:

```text
https://vagalume.fm/pop-rock-br/
```

---

# 20. ANOS 80

```json
{
  "name": "Hits Anos 80",
  "slug": "anos-80",
  "type": "THEMATIC",
  "genres": ["Anos 80", "Flashback"],
  "active": true,
  "systemDefault": true
}
```

Fonte principal:

```text
https://stream.vagalume.fm/hls/1507663468882713/aac.m3u8
```

Página:

```text
https://vagalume.fm/hits-anos-80/
```

Fallback:

```text
https://stream.zeno.fm/tm0owvzi6fqtv
```

---

# 21. ANOS 90

```json
{
  "name": "Hits Anos 90",
  "slug": "anos-90",
  "type": "THEMATIC",
  "genres": ["Anos 90", "Flashback"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/1478022035646498/aac.m3u8
```

---

# 22. ANOS 2000

```json
{
  "name": "Hits Anos 2000",
  "slug": "anos-2000",
  "type": "THEMATIC",
  "genres": ["Anos 2000", "Flashback"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/147396460892793/aac.m3u8
```

---

# 23. GOSPEL

```json
{
  "name": "Gospel",
  "slug": "gospel",
  "type": "THEMATIC",
  "genres": ["Gospel", "Cristã"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/14658544132100453351/aac.m3u8
```

Página:

```text
https://vagalume.fm/gospel/
```

---

# 24. GOSPEL INTERNACIONAL

```json
{
  "name": "Gospel Internacional",
  "slug": "gospel-internacional",
  "type": "THEMATIC",
  "genres": ["Gospel", "Internacional"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/1470245767122628/aac.m3u8
```

---

# 25. REGGAE

```json
{
  "name": "Reggae",
  "slug": "reggae",
  "type": "THEMATIC",
  "genres": ["Reggae"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/1465840912218182609/aac.m3u8
```

---

# 26. ELETRÔNICA

```json
{
  "name": "Eletrônica",
  "slug": "eletronica",
  "type": "THEMATIC",
  "genres": ["Eletrônica", "Dance"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/146411300413492499/aac.m3u8
```

---

# 27. HIP-HOP

```json
{
  "name": "Hip-Hop",
  "slug": "hip-hop",
  "type": "THEMATIC",
  "genres": ["Hip-Hop", "Rap"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/1470155107337444/aac.m3u8
```

---

# 28. R&B

```json
{
  "name": "R&B",
  "slug": "rnb",
  "type": "THEMATIC",
  "genres": ["R&B", "Soul"],
  "active": true,
  "systemDefault": true
}
```

Fonte:

```text
https://stream.vagalume.fm/hls/1467745876337223/aac.m3u8
```

---

# 29. BOSSA NOVA

```json
{
  "name": "Bossa Nova",
  "slug": "bossa-nova",
  "type": "THEMATIC",
  "genres": ["Bossa Nova", "MPB", "Jazz"],
  "active": true,
  "systemDefault": true
}
```

Fonte HTTPS:

```text
https://ice6.somafm.com/bossa-128-aac
```

Tipo esperado:

```text
AAC
```

Essa fonte é um canal especializado em Bossa Nova/Samba/Brazilian-style music.

---

# 30. IMPORTAÇÃO INICIAL

Criar seed/importação idempotente.

Exemplo conceitual:

```ts
const thematicChannels = [
  {
    slug: "mpb",
    name: "MPB",
    sources: [
      {
        url: "https://stream.vagalume.fm/hls/1470154983100588/aac.m3u8",
        priority: 1
      }
    ]
  },

  {
    slug: "forro",
    name: "Forró",
    sources: [
      {
        url: "https://stream.vagalume.fm/hls/147015501223418/aac.m3u8",
        priority: 1
      },
      {
        url: "https://stream.zeno.fm/1k5m0vv5w0hvv",
        priority: 2
      },
      {
        url: "https://stream.zeno.fm/uh7p2mkb86wtv",
        priority: 3
      }
    ]
  },

  {
    slug: "sertanejo",
    name: "Sertanejo",
    sources: [
      {
        url: "https://stream.vagalume.fm/hls/14619606471054026608/aac.m3u8",
        priority: 1
      },
      {
        url: "https://stream.zeno.fm/6kumndewqbruv",
        priority: 2
      }
    ]
  }
];
```

Não necessariamente copie exatamente essa implementação.

Adapte ao ORM e banco existentes.

---

# 31. VALIDAR OS LINKS DURANTE A IMPORTAÇÃO

NÃO faça:

```text
insert URL
↓
marcar ONLINE automaticamente
```

Faça:

```text
URL candidata
     ↓
validação existente do RadioStreamService
     ↓
identificar formato
     ↓
testar HLS / áudio
     ↓
ONLINE?
```

Se funcionar:

```text
status = ONLINE
```

Se não funcionar:

```text
status = OFFLINE
```

e testar o próximo fallback.

---

# 32. HLS

Grande parte dos canais principais usa:

```text
.m3u8
```

Ou seja:

```text
HLS
```

O módulo anterior já deveria possuir suporte para HLS.

REUTILIZE essa implementação.

Não transforme HLS em MP3.

Pode retornar ao frontend:

```json
{
  "streamUrl": "https://stream.vagalume.fm/hls/.../aac.m3u8",
  "streamType": "HLS"
}
```

O player existente deverá continuar responsável pela reprodução.

---

# 33. ENDPOINT EXISTENTE DE LISTAGEM

Evite criar um endpoint totalmente separado se não houver necessidade.

Preferencialmente:

```http
GET /api/radios
```

continua retornando tudo.

Exemplo:

```json
[
  {
    "name": "Mix FM João Pessoa",
    "type": "RADIO"
  },
  {
    "name": "Arapuan FM",
    "type": "RADIO"
  },
  {
    "name": "MPB",
    "type": "THEMATIC"
  },
  {
    "name": "Forró",
    "type": "THEMATIC"
  },
  {
    "name": "Rock",
    "type": "THEMATIC"
  }
]
```

Opcionalmente permitir:

```http
GET /api/radios?type=THEMATIC
```

e:

```http
GET /api/radios?type=RADIO
```

desde que isso não quebre o frontend atual.

---

# 34. FAVORITOS DEVEM FUNCIONAR IGUAL

Se o sistema já permite:

```text
⭐ Mix FM
```

também deve permitir:

```text
⭐ MPB
⭐ Forró
⭐ Rock
```

Não criar outro sistema de favoritos.

Reutilizar o relacionamento atual.

---

# 35. ÚLTIMO CANAL UTILIZADO

Se já existe armazenamento da última rádio utilizada, um canal temático também deverá ser aceito.

Exemplo:

```text
lastRadioStationId
```

pode apontar tanto para:

```text
RADIO
```

quanto:

```text
THEMATIC
```

---

# 36. STREAM ATIVO

Quando um canal possui várias fontes:

```text
Forró

1 Vagalume
2 Zeno
3 Zeno fallback
```

o backend deve descobrir qual está disponível.

O frontend deverá receber apenas:

```json
{
  "name": "Forró",
  "streamUrl": "https://stream-atualmente-online...",
  "streamStatus": "ONLINE"
}
```

Não enviar toda a lógica de fallback para o frontend.

---

# 37. TROCA AUTOMÁTICA DE FALLBACK

Quando uma fonte cair:

```text
fonte 1
ONLINE
   ↓
OFFLINE
```

no próximo health check:

```text
testar fonte 2
```

Se:

```text
fonte 2 = ONLINE
```

ela passa a ser utilizada.

Não precisa alterar o canal.

Para o usuário continua sendo:

```text
🎵 Forró
```

---

# 38. NÃO FAZER PROXY DO ÁUDIO

Manter a arquitetura anterior.

NÃO:

```text
stream externo
     ↓
backend ERP
     ↓
usuário
```

Preferir:

```text
backend informa URL
       ↓
frontend
       ↓
servidor do stream
```

O backend apenas:

* cadastra;
* valida;
* monitora;
* seleciona o melhor stream.

---

# 39. HTTPS

Como o ERP provavelmente roda em HTTPS, priorizar streams:

```text
https://
```

Streams apenas:

```text
http://
```

podem ser bloqueados pelo navegador como Mixed Content.

Por isso URLs HTTP devem ser utilizadas apenas se a arquitetura atual conseguir tratá-las corretamente sem comprometer segurança.

Priorizar sempre fontes HTTPS.

---

# 40. NÃO DEPENDER EXCLUSIVAMENTE DO VAGALUME

Os streams do Vagalume são excelentes fontes iniciais, mas são serviços externos.

Por isso a arquitetura NÃO pode ficar:

```ts
if (canal === "MPB") {
   return vagalumeUrl;
}
```

Hardcoded dentro do service.

Os streams devem ficar no banco.

Exemplo:

```text
RadioStation
      ↓
RadioStreamSources
      ↓
URLs
```

Assim futuramente podemos substituir:

```text
Vagalume
```

por:

```text
outro provedor
```

sem alterar código.

---

# 41. NÃO UTILIZAR RADIO BROWSER EM TODA REQUISIÇÃO

Pode existir integração futura com Radio Browser, mas NÃO é objetivo desta tarefa transformar cada play em uma pesquisa externa.

O catálogo inicial deverá estar no banco.

Radio Browser pode eventualmente ser usado como fonte administrativa ou recuperação futura, mas não deve ser dependência obrigatória da reprodução.

---

# 42. STATUS DOS CANAIS

Os canais deverão reutilizar:

```text
ONLINE
OFFLINE
UNKNOWN
INVALID
```

ou os estados já existentes.

Exemplo:

```json
{
  "name": "MPB",
  "streamStatus": "ONLINE",
  "lastCheckedAt": "..."
}
```

---

# 43. CASO TODAS AS FONTES ESTEJAM OFFLINE

Retornar o canal normalmente, mas:

```json
{
  "name": "MPB",
  "streamUrl": null,
  "streamStatus": "OFFLINE"
}
```

Não gerar erro 500.

O fato de uma rádio externa estar fora do ar NÃO é erro interno do ERP.

---

# 44. IMPORTAÇÃO NÃO PODE FALHAR INTEIRA

Exemplo:

```text
MPB       ✅
Forró     ✅
Sertanejo ✅
Pagode    ❌
Rock      ✅
```

Resultado:

```text
importação concluída
```

Pagode fica:

```text
OFFLINE
```

Os demais continuam disponíveis.

---

# 45. CANAIS INICIAIS DESEJADOS

O resultado inicial deverá disponibilizar, no mínimo:

```text
🎵 MPB
🎵 Forró
🎵 Sertanejo
🎵 Sertanejo Romântico
🎵 Samba & Pagode
🎵 Rock
🎵 Pop
🎵 Pop Nacional
🎵 Pop Rock Nacional
🎵 Gospel
🎵 Gospel Internacional
🎵 Reggae
🎵 Eletrônica
🎵 Hip-Hop
🎵 R&B
🎵 Hits Anos 80
🎵 Hits Anos 90
🎵 Hits Anos 2000
🎵 Bossa Nova
```

---

# 46. IMPORTANTE SOBRE OS LINKS FORNECIDOS

Os URLs deste prompt foram encontrados como endpoints públicos de transmissão.

Serviços externos podem alterar:

* URL;
* CDN;
* codec;
* playlist;
* disponibilidade;
* política de acesso.

Portanto:

**não considere um URL válido apenas porque está neste prompt.**

Utilize a infraestrutura de validação do módulo já implementado.

Antes de deixar uma fonte `ONLINE`:

1. validar protocolo;
2. validar SSRF conforme módulo existente;
3. seguir redirects com segurança;
4. identificar `Content-Type`;
5. validar HLS quando `.m3u8`;
6. confirmar que há conteúdo de áudio;
7. atualizar `lastCheckedAt`;
8. atualizar `lastOnlineAt`.

---

# 47. NÃO ALTERAR O PLAYER

O player do frontend já está pronto.

Não:

* redesenhar player;
* alterar controles;
* trocar biblioteca;
* mudar lógica de volume;
* mudar comportamento persistente;
* mudar layout;
* criar outro player.

Apenas garantir que os novos registros sejam retornados no formato que o player atual já consegue reproduzir.

---

# 48. RESULTADO ESPERADO

Depois da implementação:

```text
RÁDIOS

📻 Mix FM João Pessoa
📻 Arapuan
📻 Correio
...

CANAIS TEMÁTICOS

🎵 MPB
🎵 Forró
🎵 Sertanejo
🎵 Samba & Pagode
🎵 Rock
🎵 Hits Anos 80
...
```

Ao clicar:

```text
MPB
 ↓
backend identifica melhor fonte
 ↓
streamUrl
 ↓
player atual
 ↓
🔊 música
```

---

# 49. TESTES

Criar testes para:

### Canal com uma fonte

```text
MPB
→ fonte 1 ONLINE
→ retornar fonte 1
```

### Canal com fallback

```text
Forró
→ fonte 1 OFFLINE
→ fonte 2 ONLINE
→ retornar fonte 2
```

### Todas offline

```text
Rock
→ fonte 1 OFFLINE
→ fonte 2 OFFLINE
→ streamStatus OFFLINE
```

### HLS

Confirmar identificação:

```text
aac.m3u8
→ HLS
```

### Rádio normal

Garantir que as rádios existentes continuem funcionando sem regressão.

### Favoritos

Garantir que canais `THEMATIC` possam ser favoritados.

### Duplicação

Rodar seed duas vezes não pode duplicar canais.

---

# 50. FINALIZAÇÃO

Ao terminar:

1. informe quais arquivos foram modificados;
2. informe quais arquivos foram criados;
3. informe migrations realizadas;
4. liste os canais temáticos cadastrados;
5. liste cada stream principal;
6. liste os fallbacks;
7. informe quais streams responderam durante os testes;
8. informe quais ficaram offline;
9. informe o tipo detectado de cada stream;
10. execute lint;
11. execute typecheck;
12. execute testes;
13. corrija erros relacionados à implementação;
14. confirme que as rádios de João Pessoa existentes continuam funcionando;
15. confirme que o frontend/player não foi alterado.

A tarefa só deve ser considerada concluída quando as rádios existentes continuarem funcionando e os canais temáticos forem integrados ao mesmo sistema.
