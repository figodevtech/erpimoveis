import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(path.resolve(process.cwd()));

async function main() {
  const [{ JOAO_PESSOA_RADIO_CATALOG }, { radioStreamService }, { upsertGlobalCatalogStation }] =
    await Promise.all([
      import("../../src/lib/radio/catalog"),
      import("../../src/lib/radio/stream-service"),
      import("../../src/lib/radio/repository"),
    ]);

  let online = 0;
  let unavailable = 0;
  let failed = 0;

  for (const entry of JOAO_PESSOA_RADIO_CATALOG) {
    try {
      const result = entry.streamUrl
        ? await radioStreamService.checkStream(entry.streamUrl)
        : await radioStreamService.resolvePlaylist(entry.playlistUrl!);
      const station = await upsertGlobalCatalogStation(entry, result);
      if (station.streamStatus === "ONLINE") online += 1;
      else unavailable += 1;
      console.log(`${entry.id}: ${station.streamStatus}${station.streamUrl ? " (stream resolvido)" : ""}`);
    } catch (error) {
      failed += 1;
      console.error(`${entry.id}: falha na importacao - ${error instanceof Error ? error.message : "erro desconhecido"}`);
    }
  }

  console.log(`Importacao concluida: ${online} online, ${unavailable} indisponiveis, ${failed} falhas.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
