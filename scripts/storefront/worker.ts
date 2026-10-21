import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const args = process.argv.slice(2);
  const index = args.indexOf('--site-url');
  if (index >= 0) {
    const target = new URL(args[index + 1]);
    if (!['localhost', '127.0.0.1'].includes(target.hostname) || !['http:', 'https:'].includes(target.protocol)) {
      throw new Error('--site-url aceita apenas localhost/127.0.0.1. Em produção use STOREFRONT_API_URL.');
    }
    process.env.STOREFRONT_API_URL = target.origin;
  }
  if (!process.env.STOREFRONT_API_URL || !process.env.STOREFRONT_CATALOG_SYNC_SECRET) {
    throw new Error('Configure STOREFRONT_API_URL e STOREFRONT_CATALOG_SYNC_SECRET no ambiente do ERP.');
  }
  const { requireEmpresaId } = await import('../../src/lib/empresa-context');
  const { runStorefrontCatalog } = await import('../../src/lib/integrations/storefront-catalog-run');
  const empresaId = await requireEmpresaId();
  let stopped = false;
  let wake: (() => void) | undefined;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; wake?.(); });
  console.log(`Sincronização automática ativa para empresa ${empresaId}: ${new URL(process.env.STOREFRONT_API_URL).origin}`);
  do {
    try {
      const result = await runStorefrontCatalog(empresaId, { maxBatches: 3, budgetMs: 20_000 });
      console.log(new Date().toISOString(), JSON.stringify(result));
    } catch {
      console.error('Falha na sincronização. Consulte a fila no Marketplace; haverá nova tentativa automática.');
      if (args.includes('--once')) process.exitCode = 1;
    }
    if (args.includes('--once') || stopped) break;
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 60_000);
      wake = () => { clearTimeout(timer); resolve(); };
    });
  } while (!stopped);
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Falha ao consultar a empresa do ERP.";
  console.error(message.replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g, "[URL]"));
  process.exitCode = 1;
});
