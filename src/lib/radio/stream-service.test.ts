import assert from "node:assert/strict";
import test from "node:test";
import {
  SafeHttpError,
  SafeRadioHttpClient,
  type RadioDnsResolver,
  type SafeHttpTransport,
} from "./safe-http";
import {
  RadioStreamService,
  parseM3U,
  parsePLS,
  stableRadioPlaybackUrl,
} from "./stream-service";

const resolver: RadioDnsResolver = async () => [{ address: "93.184.216.34", family: 4 }];

function response(
  status: number,
  headers: Record<string, string> = {},
  body = "",
): Awaited<ReturnType<SafeHttpTransport>> {
  return { status, headers, body: Buffer.from(body), truncated: false };
}

test("identifica stream direto e metadados ICY", async () => {
  const transport: SafeHttpTransport = async () =>
    response(200, { "content-type": "audio/mpeg", "icy-name": "Radio Teste", "icy-br": "128" });
  const service = new RadioStreamService(new SafeRadioHttpClient(resolver, transport));
  const result = await service.checkStream("https://radio.test/stream.mp3");

  assert.equal(result.status, "ONLINE");
  assert.equal(result.streamType, "DIRECT_STREAM");
  assert.equal(result.metadata.name, "Radio Teste");
  assert.equal(result.metadata.bitrate, 128);
});

test("resolve playlist M3U ate o stream", async () => {
  const transport: SafeHttpTransport = async ({ url }) => {
    if (url.pathname.endsWith(".m3u")) {
      return response(200, { "content-type": "audio/x-mpegurl" }, "#EXTM3U\n#EXTINF:-1,Teste\nhttps://cdn.radio.test/live.mp3\n");
    }
    return response(200, { "content-type": "audio/mpeg" });
  };
  const service = new RadioStreamService(new SafeRadioHttpClient(resolver, transport));
  const result = await service.resolvePlaylist("https://radio.test/listen.m3u");

  assert.equal(result.status, "ONLINE");
  assert.equal(result.playlistFormat, "M3U");
  assert.equal(result.streamUrl, "https://cdn.radio.test/live.mp3");
  assert.equal(result.candidates.length, 1);
});

test("substitui URL temporaria da FabricaHost pelo endpoint estavel", async () => {
  const signedUrl =
    "https://e-spo-104.fabricahost.com.br/98correiofm?f=token-temporario&tid=sessao-temporaria";
  const transport: SafeHttpTransport = async ({ url }) =>
    url.pathname.endsWith(".m3u")
      ? response(200, { "content-type": "audio/x-mpegurl" }, `#EXTM3U\n${signedUrl}\n`)
      : response(200, { "content-type": "audio/aac" });
  const service = new RadioStreamService(new SafeRadioHttpClient(resolver, transport));
  const result = await service.resolvePlaylist("https://radio.test/listen.m3u");

  assert.equal(result.status, "ONLINE");
  assert.equal(result.streamUrl, "https://ice.fabricahost.com.br/98correiofm");
  assert.equal(stableRadioPlaybackUrl(signedUrl), "https://ice.fabricahost.com.br/98correiofm");
});

test("resolve PLS respeitando a ordem numerica das entradas", async () => {
  const transport: SafeHttpTransport = async ({ url }) => {
    if (url.pathname.endsWith(".pls")) {
      return response(200, { "content-type": "audio/x-scpls" }, "[playlist]\nFile2=https://cdn.radio.test/two.mp3\nFile1=https://cdn.radio.test/one.mp3\n");
    }
    return response(200, { "content-type": "audio/aac", "icy-name": "Primeira" });
  };
  const service = new RadioStreamService(new SafeRadioHttpClient(resolver, transport));
  const result = await service.resolvePlaylist("https://radio.test/listen.pls");

  assert.equal(result.status, "ONLINE");
  assert.equal(result.playlistFormat, "PLS");
  assert.equal(result.streamUrl, "https://cdn.radio.test/one.mp3");
});

test("identifica M3U8 como HLS sem tratar segmentos como radios", async () => {
  const transport: SafeHttpTransport = async () =>
    response(200, { "content-type": "application/x-mpegurl" }, "#EXTM3U\n#EXT-X-VERSION:3\n");
  const service = new RadioStreamService(new SafeRadioHttpClient(resolver, transport));
  const result = await service.resolvePlaylist("https://radio.test/live");

  assert.equal(result.status, "ONLINE");
  assert.equal(result.playlistFormat, "M3U8");
  assert.equal(result.streamType, "HLS");
  assert.equal(result.streamUrl, "https://radio.test/live");
});

test("entrada generica url escolhe automaticamente playlist ou stream", async () => {
  const transport: SafeHttpTransport = async ({ url }) =>
    url.pathname.endsWith(".m3u")
      ? response(200, { "content-type": "audio/x-mpegurl" }, "#EXTM3U\nhttps://cdn.radio.test/live.mp3")
      : response(200, { "content-type": "audio/mpeg" });
  const service = new RadioStreamService(new SafeRadioHttpClient(resolver, transport));
  const result = await service.test({ url: "https://radio.test/listen.m3u" });

  assert.equal(result.status, "ONLINE");
  assert.equal("streamUrl" in result ? result.streamUrl : null, "https://cdn.radio.test/live.mp3");
});

test("parsers ignoram comentarios, lixo e duplicatas", () => {
  assert.deepEqual(parseM3U("#EXTM3U\n/live.mp3\nlixo invalido\n/live.mp3", "https://radio.test/a/list.m3u"), [
    "https://radio.test/live.mp3",
    "https://radio.test/a/lixo%20invalido",
  ]);
  assert.deepEqual(parsePLS("[playlist]\nFile2=/b.mp3\nFile1=/a.mp3", "https://radio.test/list.pls"), [
    "https://radio.test/a.mp3",
    "https://radio.test/b.mp3",
  ]);
});

test("URL invalida e esquema nao HTTP sao rejeitados", async () => {
  const service = new RadioStreamService(new SafeRadioHttpClient(resolver, async () => response(200)));
  await assert.rejects(service.checkStream("nao-e-url"), /URL de radio invalida/);
  await assert.rejects(service.checkStream("file:///etc/passwd"), /HTTP ou HTTPS/);
});

test("timeout e radio offline retornam OFFLINE sem quebrar o chamador", async () => {
  const timedOut = new RadioStreamService(
    new SafeRadioHttpClient(resolver, async () => {
      throw new SafeHttpError("TIMEOUT", "tempo esgotado");
    }),
  );
  assert.equal((await timedOut.checkStream("https://radio.test/live.mp3")).status, "OFFLINE");

  const unavailable = new RadioStreamService(
    new SafeRadioHttpClient(resolver, async () => response(503, { "content-type": "text/plain" })),
  );
  const result = await unavailable.checkStream("https://radio.test/live.mp3");
  assert.equal(result.status, "OFFLINE");
  assert.equal(result.httpStatus, 503);
});
