import { SafeHttpError, SafeRadioHttpClient, validateRadioUrlSyntax } from "./safe-http";
import {
  EMPTY_RADIO_METADATA,
  type RadioCheckResult,
  type RadioMetadata,
  type RadioPlaylistFormat,
  type RadioResolveCandidate,
  type RadioResolveResult,
  type RadioStreamType,
} from "./types";

const PLAYLIST_MAX_BYTES = 256 * 1024;
const STREAM_SAMPLE_MAX_BYTES = 32 * 1024;
const MAX_PLAYLIST_CANDIDATES = 12;
const EPHEMERAL_FABRICA_HOST = /^e-[a-z0-9-]+\.fabricahost\.com\.br$/i;

export function stableRadioPlaybackUrl(inputUrl: string | null) {
  if (!inputUrl) return null;

  try {
    const url = new URL(inputUrl);
    if (
      EPHEMERAL_FABRICA_HOST.test(url.hostname) &&
      url.searchParams.has("f") &&
      url.searchParams.has("tid")
    ) {
      return new URL(url.pathname, "https://ice.fabricahost.com.br").toString();
    }
  } catch {
    return inputUrl;
  }

  return inputUrl;
}

function contentType(headers: Record<string, string>) {
  return headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() || null;
}

export function detectRadioResource(
  input: string,
  responseContentType?: string | null,
): { playlistFormat: RadioPlaylistFormat | null; streamType: RadioStreamType | null } {
  const pathname = validateRadioUrlSyntax(input).pathname.toLowerCase();
  const type = responseContentType?.toLowerCase().split(";", 1)[0].trim() ?? "";

  if (pathname.endsWith(".m3u8") || type === "application/vnd.apple.mpegurl") {
    return { playlistFormat: "M3U8", streamType: "HLS" };
  }
  if (pathname.endsWith(".pls") || type === "audio/x-scpls" || type === "application/pls+xml") {
    return { playlistFormat: "PLS", streamType: null };
  }
  if (
    pathname.endsWith(".m3u") ||
    type === "audio/x-mpegurl" ||
    type === "application/x-mpegurl" ||
    type === "audio/mpegurl"
  ) {
    return { playlistFormat: "M3U", streamType: null };
  }
  if (
    type.startsWith("audio/") ||
    /\.(?:mp3|aac|aacp|ogg|opus|flac|wav|m4a)$/i.test(pathname)
  ) {
    return { playlistFormat: null, streamType: "DIRECT_STREAM" };
  }
  return { playlistFormat: null, streamType: null };
}

function uniqueUrls(urls: string[]) {
  return Array.from(new Set(urls));
}

export function parseM3U(content: string, baseUrl: string) {
  const urls: string[] = [];
  for (const rawLine of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    try {
      urls.push(new URL(line, baseUrl).toString());
    } catch {
      // Uma linha ruim nao invalida as demais entradas da playlist.
    }
  }
  return uniqueUrls(urls).slice(0, MAX_PLAYLIST_CANDIDATES);
}

export function parsePLS(content: string, baseUrl: string) {
  const entries = new Map<number, string>();
  for (const line of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.trim().match(/^File(\d+)\s*=\s*(.+)$/i);
    if (!match) continue;
    try {
      entries.set(Number(match[1]), new URL(match[2].trim(), baseUrl).toString());
    } catch {
      // Mantem as outras entradas validas.
    }
  }
  return uniqueUrls(Array.from(entries.entries()).sort(([a], [b]) => a - b).map(([, url]) => url)).slice(
    0,
    MAX_PLAYLIST_CANDIDATES,
  );
}

function numberHeader(value: string | undefined) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function codecFromContentType(value: string | null) {
  if (!value) return null;
  if (value.includes("mpeg")) return "MP3";
  if (value.includes("aac")) return "AAC";
  if (value.includes("ogg")) return "OGG";
  if (value.includes("opus")) return "OPUS";
  if (value.includes("flac")) return "FLAC";
  return null;
}

function codecFromBody(body: Uint8Array) {
  if (body.length >= 4) {
    const signature = Buffer.from(body.subarray(0, 4)).toString("ascii");
    if (signature.startsWith("ID3")) return "MP3";
    if (signature === "OggS") return "OGG";
    if (signature === "fLaC") return "FLAC";
  }
  if (body.length >= 2 && body[0] === 0xff) {
    if ((body[1] & 0xf6) === 0xf0) return "AAC";
    if ((body[1] & 0xe0) === 0xe0) return "MP3";
  }
  return null;
}

function metadataFromHeaders(headers: Record<string, string>): RadioMetadata {
  const responseContentType = contentType(headers);
  return {
    name: headers["icy-name"]?.trim() || null,
    description: headers["icy-description"]?.trim() || null,
    genre: headers["icy-genre"]?.trim() || null,
    bitrate: numberHeader(headers["icy-br"]),
    websiteUrl: headers["icy-url"]?.trim() || null,
    contentType: responseContentType,
    codec: codecFromContentType(responseContentType),
  };
}

function offlineResult(inputUrl: string, error: unknown): RadioCheckResult {
  const message = error instanceof Error ? error.message : "Stream indisponivel.";
  return {
    inputUrl,
    resolvedUrl: null,
    status: "OFFLINE",
    streamType: null,
    playlistFormat: null,
    httpStatus: null,
    checkedAt: new Date().toISOString(),
    metadata: { ...EMPTY_RADIO_METADATA },
    message,
  };
}

export class RadioStreamService {
  constructor(private readonly httpClient = new SafeRadioHttpClient()) {}

  validateUrl(url: string) {
    return validateRadioUrlSyntax(url).toString();
  }

  detectStreamType(url: string, responseContentType?: string | null) {
    return detectRadioResource(url, responseContentType);
  }

  async checkStream(inputUrl: string): Promise<RadioCheckResult> {
    const normalizedUrl = this.validateUrl(inputUrl);

    try {
      let response = await this.httpClient.request(normalizedUrl, {
        method: "HEAD",
        timeoutMs: 5_000,
        maxBytes: 1,
      });
      let detected = detectRadioResource(response.finalUrl, contentType(response.headers));

      const headIsUseful =
        response.status >= 200 &&
        response.status < 300 &&
        (detected.streamType !== null || detected.playlistFormat !== null);

      if (!headIsUseful) {
        response = await this.httpClient.request(normalizedUrl, {
          method: "GET",
          timeoutMs: 7_000,
          maxBytes: STREAM_SAMPLE_MAX_BYTES,
        });
        detected = detectRadioResource(response.finalUrl, contentType(response.headers));
      }

      const metadata = metadataFromHeaders(response.headers);
      const sampledCodec = codecFromBody(response.body);
      if (!metadata.codec && sampledCodec) metadata.codec = sampledCodec;
      const onlineHttp = response.status >= 200 && response.status < 300;
      const hasIcyMetadata = Boolean(
        metadata.name || metadata.description || metadata.genre || response.headers["icy-metaint"],
      );
      const inferredDirect =
        detected.streamType ?? (onlineHttp && (hasIcyMetadata || sampledCodec) ? "DIRECT_STREAM" : null);
      const isPlaylist = detected.playlistFormat === "M3U" || detected.playlistFormat === "PLS";
      const status = onlineHttp ? (isPlaylist ? "PLAYLIST_FOUND" : inferredDirect ? "ONLINE" : "INVALID") : "OFFLINE";

      return {
        inputUrl: normalizedUrl,
        resolvedUrl: onlineHttp ? stableRadioPlaybackUrl(response.finalUrl) : null,
        status,
        streamType: detected.streamType ?? (status === "ONLINE" ? inferredDirect : null),
        playlistFormat: detected.playlistFormat,
        httpStatus: response.status,
        checkedAt: new Date().toISOString(),
        metadata,
        message:
          status === "INVALID"
            ? "O endereco respondeu, mas nao foi identificado como stream ou playlist de radio."
            : status === "OFFLINE"
              ? `Servidor respondeu HTTP ${response.status}.`
              : null,
      };
    } catch (error) {
      if (error instanceof SafeHttpError && ["INVALID_URL", "UNSAFE_URL"].includes(error.code)) throw error;
      return offlineResult(normalizedUrl, error);
    }
  }

  async getMetadata(url: string) {
    return (await this.checkStream(url)).metadata;
  }

  async resolveM3U(content: string, baseUrl: string) {
    return parseM3U(content, baseUrl);
  }

  async resolvePLS(content: string, baseUrl: string) {
    return parsePLS(content, baseUrl);
  }

  async resolvePlaylist(inputUrl: string): Promise<RadioResolveResult> {
    const playlistUrl = this.validateUrl(inputUrl);
    const checkedAt = new Date().toISOString();

    try {
      const response = await this.httpClient.request(playlistUrl, {
        method: "GET",
        timeoutMs: 8_000,
        maxBytes: PLAYLIST_MAX_BYTES,
      });
      const detected = detectRadioResource(response.finalUrl, contentType(response.headers));
      const body = Buffer.from(response.body).toString("utf8");
      const bodyLooksM3U = /^\s*#EXTM3U/im.test(body);
      const bodyLooksHls = /^\s*#EXT-X-/im.test(body);
      const bodyLooksPLS = /^\s*\[playlist\]/im.test(body) || /^\s*File\d+\s*=/im.test(body);
      const playlistFormat = bodyLooksHls
        ? "M3U8"
        : detected.playlistFormat ?? (bodyLooksPLS ? "PLS" : bodyLooksM3U ? "M3U" : null);

      if (response.status < 200 || response.status >= 300) {
        return {
          playlistUrl,
          playlistFormat,
          streamUrl: null,
          streamType: null,
          status: "OFFLINE",
          checkedAt,
          metadata: metadataFromHeaders(response.headers),
          candidates: [],
          message: `Playlist respondeu HTTP ${response.status}.`,
        };
      }

      if (playlistFormat === "M3U8") {
        return {
          playlistUrl,
          playlistFormat,
          streamUrl: response.finalUrl,
          streamType: "HLS",
          status: "ONLINE",
          checkedAt,
          metadata: metadataFromHeaders(response.headers),
          candidates: [],
          message: null,
        };
      }

      if (!playlistFormat || !["M3U", "PLS"].includes(playlistFormat)) {
        return {
          playlistUrl,
          playlistFormat: null,
          streamUrl: null,
          streamType: null,
          status: "INVALID",
          checkedAt,
          metadata: metadataFromHeaders(response.headers),
          candidates: [],
          message: "O conteudo recebido nao e uma playlist M3U, M3U8 ou PLS valida.",
        };
      }

      const urls = playlistFormat === "PLS" ? parsePLS(body, response.finalUrl) : parseM3U(body, response.finalUrl);
      if (!urls.length) {
        return {
          playlistUrl,
          playlistFormat,
          streamUrl: null,
          streamType: null,
          status: "INVALID",
          checkedAt,
          metadata: metadataFromHeaders(response.headers),
          candidates: [],
          message: "A playlist nao contem enderecos de stream validos.",
        };
      }

      const candidates: RadioResolveCandidate[] = [];
      for (const candidateUrl of urls) {
        try {
          const result = await this.checkStream(candidateUrl);
          candidates.push({ ...result, candidateUrl });
          if (result.status === "ONLINE") {
            return {
              playlistUrl,
              playlistFormat,
              streamUrl: result.resolvedUrl,
              streamType: result.streamType,
              status: "ONLINE",
              checkedAt: result.checkedAt,
              metadata: result.metadata,
              candidates,
              message: null,
            };
          }
        } catch (error) {
          const failed = offlineResult(candidateUrl, error);
          candidates.push({ ...failed, status: "INVALID", candidateUrl });
        }
      }

      return {
        playlistUrl,
        playlistFormat,
        streamUrl: null,
        streamType: null,
        status: "OFFLINE",
        checkedAt,
        metadata: metadataFromHeaders(response.headers),
        candidates,
        message: "Nenhum stream da playlist esta disponivel no momento.",
      };
    } catch (error) {
      if (error instanceof SafeHttpError && ["INVALID_URL", "UNSAFE_URL"].includes(error.code)) throw error;
      return {
        playlistUrl,
        playlistFormat: detectRadioResource(playlistUrl).playlistFormat,
        streamUrl: null,
        streamType: null,
        status: "OFFLINE",
        checkedAt,
        metadata: { ...EMPTY_RADIO_METADATA },
        candidates: [],
        message: error instanceof Error ? error.message : "Playlist indisponivel.",
      };
    }
  }

  async test(input: { url?: string | null; streamUrl?: string | null; playlistUrl?: string | null }) {
    if (input.playlistUrl) return this.resolvePlaylist(input.playlistUrl);
    if (input.streamUrl) return this.checkStream(input.streamUrl);
    if (input.url) {
      const detected = detectRadioResource(input.url);
      if (detected.playlistFormat) return this.resolvePlaylist(input.url);

      const checked = await this.checkStream(input.url);
      if (checked.status === "PLAYLIST_FOUND" && checked.resolvedUrl) {
        return this.resolvePlaylist(checked.resolvedUrl);
      }
      return checked;
    }
    throw new SafeHttpError("INVALID_URL", "Informe url, streamUrl ou playlistUrl.", 400);
  }
}

export const radioStreamService = new RadioStreamService();
