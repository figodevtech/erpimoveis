import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(path.resolve(process.cwd()));

async function main() {
  const [
    { THEMATIC_RADIO_CATALOG },
    {
      checkAndUpsertThematicSource,
      refreshThematicStationFromSources,
      upsertGlobalThematicChannelDefinition,
    },
  ] = await Promise.all([
    import("../../src/lib/radio/thematic-catalog"),
    import("../../src/lib/radio/repository"),
  ]);

  let onlineChannels = 0;
  let offlineChannels = 0;
  let failedChannels = 0;
  let onlineSources = 0;
  let offlineSources = 0;
  let inactiveSources = 0;

  for (const entry of THEMATIC_RADIO_CATALOG) {
    try {
      const channel = await upsertGlobalThematicChannelDefinition(entry);

      for (const sourceEntry of entry.sources) {
        try {
          const { source } = await checkAndUpsertThematicSource(channel.id, sourceEntry);
          if (!source.active) inactiveSources += 1;
          else if (source.streamStatus === "ONLINE") onlineSources += 1;
          else offlineSources += 1;

          const detected = [source.streamType, source.playlistFormat, source.codec]
            .filter(Boolean)
            .join("/") || "não detectado";
          console.log(
            `[${entry.slug}] fonte ${source.priority} ${source.label ?? ""}: ` +
              `${source.active ? source.streamStatus : "INACTIVE"} (${detected}) -> ${source.sourceUrl}`,
          );
        } catch (error) {
          offlineSources += 1;
          console.error(
            `[${entry.slug}] fonte ${sourceEntry.priority}: falha ao persistir - ` +
              `${error instanceof Error ? error.message : "erro desconhecido"}`,
          );
        }
      }

      const refreshed = await refreshThematicStationFromSources(channel.id);
      if (refreshed.streamStatus === "ONLINE") onlineChannels += 1;
      else offlineChannels += 1;
      console.log(
        `[${entry.slug}] canal ${refreshed.streamStatus}` +
          `${refreshed.streamUrl ? ` -> ${refreshed.streamUrl}` : " -> sem stream ativo"}`,
      );
    } catch (error) {
      failedChannels += 1;
      console.error(
        `[${entry.slug}] falha na importação - ${error instanceof Error ? error.message : "erro desconhecido"}`,
      );
    }
  }

  console.log(
    `Importação temática concluída: ${onlineChannels} canais online, ` +
      `${offlineChannels} indisponíveis, ${failedChannels} falhas; ` +
      `${onlineSources} fontes online, ${offlineSources} indisponíveis e ` +
      `${inactiveSources} inativas.`,
  );
  if (failedChannels > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
