const PDF_SIGNATURE = "%PDF-";

export type NfsePdfDownloadDiagnostic = {
  attempt: number;
  status: number | null;
  contentType: string | null;
  size: number | null;
  host: string | null;
  error?: string;
};

type DownloadOptions = {
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  retryDelaysMs?: number[];
  timeoutMs?: number;
  maxSize?: number;
};

function hostFromUrl(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Baixa o PDF publicado pela Focus/prefeitura. Respostas HTML ou erros
 * transitórios ganham poucas tentativas, porque alguns provedores publicam o
 * DANFSe instantes depois de autorizar a nota.
 */
export async function downloadNfsePdf(url: string, options: DownloadOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const retryDelaysMs = options.retryDelaysMs ?? [600, 1_400];
  const maxSize = options.maxSize ?? 10 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const diagnostics: NfsePdfDownloadDiagnostic[] = [];
  let lastMessage = "O PDF da NFS-e ainda não está disponível.";

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) await wait(retryDelaysMs[attempt - 2] ?? 0);

      try {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { Accept: "application/pdf" },
          cache: "no-store",
        });
        const contentType = response.headers.get("content-type");
        const responseHost = hostFromUrl(response.url || url);

        if (!response.ok) {
          lastMessage = `O portal respondeu ${response.status} ao baixar a NFS-e.`;
          diagnostics.push({ attempt, status: response.status, contentType, size: null, host: responseHost });
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxSize) {
          return {
            ok: false as const,
            message: "O arquivo da NFS-e passa de 10MB.",
            diagnostics: [...diagnostics, { attempt, status: response.status, contentType, size: buffer.length, host: responseHost }],
          };
        }

        const signature = buffer.subarray(0, PDF_SIGNATURE.length).toString("latin1");
        diagnostics.push({ attempt, status: response.status, contentType, size: buffer.length, host: responseHost });
        if (signature === PDF_SIGNATURE) {
          return { ok: true as const, buffer, diagnostics };
        }

        lastMessage = `O endereço da NFS-e ainda não retornou um PDF (${contentType ?? "tipo desconhecido"}).`;
      } catch (error: unknown) {
        const value = error as { name?: string; message?: string };
        if (value?.name === "AbortError") {
          return {
            ok: false as const,
            message: "O portal da prefeitura demorou demais para disponibilizar o PDF.",
            diagnostics,
          };
        }
        lastMessage = value?.message || "Falha ao baixar o PDF da NFS-e.";
        diagnostics.push({
          attempt,
          status: null,
          contentType: null,
          size: null,
          host: hostFromUrl(url),
          error: lastMessage,
        });
      }
    }

    return { ok: false as const, message: lastMessage, diagnostics };
  } finally {
    clearTimeout(timer);
  }
}
