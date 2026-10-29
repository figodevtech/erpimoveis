import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { LookupAddress, LookupOptions } from "node:dns";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.google",
  "instance-data",
]);

export type SafeHttpErrorCode =
  | "INVALID_URL"
  | "UNSAFE_URL"
  | "DNS_LOOKUP_FAILED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "TOO_MANY_REDIRECTS"
  | "INVALID_REDIRECT";

export class SafeHttpError extends Error {
  readonly code: SafeHttpErrorCode;
  readonly statusCode: number;

  constructor(code: SafeHttpErrorCode, message: string, statusCode = 422) {
    super(message);
    this.name = "SafeHttpError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type SafeHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  finalUrl: string;
  truncated: boolean;
};

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type SafeHttpTransportInput = {
  url: URL;
  method: "GET" | "HEAD";
  headers: Record<string, string>;
  address: ResolvedAddress;
  timeoutMs: number;
  maxBytes: number;
};

export type SafeHttpTransport = (input: SafeHttpTransportInput) => Promise<Omit<SafeHttpResponse, "finalUrl">>;
export type RadioDnsResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type SafeHttpRequestOptions = {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

async function withinTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new SafeHttpError("TIMEOUT", message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseIpv4(value: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function isPrivateIpv4(value: string) {
  const parts = parseIpv4(value);
  if (!parts) return true;
  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && parts[2] === 0) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && parts[2] === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function ipv6ToGroups(value: string): number[] | null {
  let normalized = value.toLowerCase().split("%")[0];
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }

  const embeddedIpv4 = normalized.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (embeddedIpv4) {
    const parts = parseIpv4(embeddedIpv4);
    if (!parts) return null;
    const high = ((parts[0] << 8) | parts[1]).toString(16);
    const low = ((parts[2] << 8) | parts[3]).toString(16);
    normalized = normalized.slice(0, -embeddedIpv4.length) + `${high}:${low}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;

  return groups.map((group) => Number.parseInt(group, 16));
}

function inIpv6Cidr(value: number[], prefix: number[], bits: number) {
  const wholeGroups = Math.floor(bits / 16);
  const remainingBits = bits % 16;
  for (let index = 0; index < wholeGroups; index += 1) {
    if (value[index] !== prefix[index]) return false;
  }
  if (!remainingBits) return true;
  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return (value[wholeGroups] & mask) === (prefix[wholeGroups] & mask);
}

function isPrivateIpv6(value: string) {
  const groups = ipv6ToGroups(value);
  if (groups === null) return true;
  const prefix = (address: string) => ipv6ToGroups(address) ?? Array(8).fill(0);

  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] <= 1) return true;

  // IPv4 compativel legado, NAT64 e faixas de descarte nao devem contornar a
  // classificacao do endereco IPv4 embutido.
  if (inIpv6Cidr(groups, prefix("::"), 96)) return true;

  // IPv4 mapeado em IPv6 precisa passar pela mesma classificacao do IPv4.
  if (inIpv6Cidr(groups, prefix("::ffff:0:0"), 96)) {
    const ipv4 = groups[6] * 65_536 + groups[7];
    return isPrivateIpv4(
      `${(ipv4 >>> 24) & 255}.${(ipv4 >>> 16) & 255}.${(ipv4 >>> 8) & 255}.${ipv4 & 255}`,
    );
  }

  return (
    inIpv6Cidr(groups, prefix("fc00::"), 7) ||
    inIpv6Cidr(groups, prefix("fe80::"), 10) ||
    inIpv6Cidr(groups, prefix("ff00::"), 8) ||
    inIpv6Cidr(groups, prefix("64:ff9b::"), 96) ||
    inIpv6Cidr(groups, prefix("64:ff9b:1::"), 48) ||
    inIpv6Cidr(groups, prefix("100::"), 64) ||
    inIpv6Cidr(groups, prefix("2001:db8::"), 32) ||
    inIpv6Cidr(groups, prefix("2001::"), 32) ||
    inIpv6Cidr(groups, prefix("2002::"), 16)
  );
}

export function isPublicRadioAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !isPrivateIpv4(address);
  if (family === 6) return !isPrivateIpv6(address);
  return false;
}

function normalizedHostname(url: URL) {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function validateRadioUrlSyntax(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeHttpError("INVALID_URL", "URL de radio invalida.", 400);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new SafeHttpError("INVALID_URL", "A URL deve usar HTTP ou HTTPS.", 400);
  }
  if (url.username || url.password) {
    throw new SafeHttpError("UNSAFE_URL", "URLs com credenciais embutidas nao sao permitidas.", 400);
  }

  const hostname = normalizedHostname(url);
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new SafeHttpError("UNSAFE_URL", "Endereco interno bloqueado.", 400);
  }

  if (isIP(hostname) && !isPublicRadioAddress(hostname)) {
    throw new SafeHttpError("UNSAFE_URL", "Endereco IP privado ou reservado bloqueado.", 400);
  }

  return url;
}

const defaultResolver: RadioDnsResolver = async (hostname) => {
  if (isIP(hostname)) {
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map((item) => ({ address: item.address, family: item.family as 4 | 6 }));
};

const defaultTransport: SafeHttpTransport = (input) =>
  new Promise((resolve, reject) => {
    const client = input.url.protocol === "https:" ? https : http;
    let settled = false;

    const finish = (value: Omit<SafeHttpResponse, "finalUrl">) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const lookup = (
      _hostname: string,
      options: LookupOptions,
      callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
    ) => {
      if (options?.all) {
        callback(null, [input.address]);
        return;
      }
      callback(null, input.address.address, input.address.family);
    };

    const request = client.request(
      {
        protocol: input.url.protocol,
        hostname: normalizedHostname(input.url),
        port: input.url.port || undefined,
        path: `${input.url.pathname}${input.url.search}`,
        method: input.method,
        headers: { Host: input.url.host, ...input.headers },
        lookup: lookup as never,
        servername: isIP(normalizedHostname(input.url)) ? undefined : normalizedHostname(input.url),
        agent: false,
        insecureHTTPParser: true,
      },
      (response) => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
        }

        if (input.method === "HEAD") {
          response.resume();
          finish({ status: response.statusCode ?? 0, headers, body: new Uint8Array(), truncated: false });
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const remaining = input.maxBytes - size;
          if (remaining > 0) {
            chunks.push(buffer.subarray(0, remaining));
            size += Math.min(buffer.length, remaining);
          }
          if (size >= input.maxBytes) {
            finish({
              status: response.statusCode ?? 0,
              headers,
              body: Buffer.concat(chunks),
              truncated: true,
            });
            response.destroy();
          }
        });
        response.on("end", () =>
          finish({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks), truncated: false }),
        );
        response.on("error", fail);
      },
    );

    request.setTimeout(input.timeoutMs, () => {
      request.destroy(new SafeHttpError("TIMEOUT", "A radio nao respondeu dentro do limite."));
    });
    request.on("error", (error) => {
      if (error instanceof SafeHttpError) fail(error);
      else fail(new SafeHttpError("NETWORK_ERROR", "Nao foi possivel conectar ao servidor da radio."));
    });
    request.end();
  });

export class SafeRadioHttpClient {
  constructor(
    private readonly resolver: RadioDnsResolver = defaultResolver,
    private readonly transport: SafeHttpTransport = defaultTransport,
  ) {}

  async request(input: string, options: SafeHttpRequestOptions = {}): Promise<SafeHttpResponse> {
    const method = options.method ?? "GET";
    const timeoutMs = options.timeoutMs ?? 7_000;
    const maxBytes = options.maxBytes ?? 64 * 1024;
    const maxRedirects = options.maxRedirects ?? 3;
    const deadline = Date.now() + timeoutMs;
    let current = validateRadioUrlSyntax(input);

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const remainingForDns = deadline - Date.now();
      if (remainingForDns <= 0) throw new SafeHttpError("TIMEOUT", "A radio nao respondeu dentro do limite.");
      const hostname = normalizedHostname(current);
      let addresses: ResolvedAddress[];
      try {
        addresses = await withinTimeout(
          this.resolver(hostname),
          remainingForDns,
          "A resolucao DNS da radio excedeu o limite.",
        );
      } catch (error) {
        if (error instanceof SafeHttpError) throw error;
        throw new SafeHttpError("DNS_LOOKUP_FAILED", "Nao foi possivel resolver o servidor da radio.");
      }
      if (!addresses.length) {
        throw new SafeHttpError("DNS_LOOKUP_FAILED", "O servidor da radio nao possui endereco DNS.");
      }
      if (addresses.some((item) => !isPublicRadioAddress(item.address))) {
        throw new SafeHttpError("UNSAFE_URL", "O servidor resolveu para uma rede privada ou reservada.", 400);
      }

      const remainingForRequest = deadline - Date.now();
      if (remainingForRequest <= 0) throw new SafeHttpError("TIMEOUT", "A radio nao respondeu dentro do limite.");
      const response = await withinTimeout(
        this.transport({
          url: current,
          method,
          address: addresses[0],
          timeoutMs: remainingForRequest,
          maxBytes,
          headers: {
            "User-Agent": "ERPImoveis-RadioChecker/1.0",
            Accept: "audio/*, application/vnd.apple.mpegurl, audio/x-mpegurl, audio/x-scpls, */*;q=0.5",
            "Icy-MetaData": "0",
            ...options.headers,
          },
        }),
        remainingForRequest,
        "A radio nao respondeu dentro do limite.",
      );

      if (!REDIRECT_STATUSES.has(response.status)) {
        return { ...response, finalUrl: current.toString() };
      }

      if (redirectCount === maxRedirects) {
        throw new SafeHttpError("TOO_MANY_REDIRECTS", "A radio excedeu o limite de redirecionamentos.");
      }
      const location = response.headers.location;
      if (!location) {
        throw new SafeHttpError("INVALID_REDIRECT", "O servidor retornou um redirecionamento sem destino.");
      }
      try {
        current = validateRadioUrlSyntax(new URL(location, current).toString());
      } catch (error) {
        if (error instanceof SafeHttpError) throw error;
        throw new SafeHttpError("INVALID_REDIRECT", "O servidor retornou um redirecionamento invalido.");
      }
    }

    throw new SafeHttpError("TOO_MANY_REDIRECTS", "A radio excedeu o limite de redirecionamentos.");
  }
}
