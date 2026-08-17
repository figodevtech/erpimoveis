import type { Client } from "pg";

import { JOAO_PESSOA_RADIO_CATALOG } from "../../src/lib/radio/catalog";
import { stableRadioPlaybackUrl } from "../../src/lib/radio/stream-service";
import { THEMATIC_RADIO_CATALOG } from "../../src/lib/radio/thematic-catalog";
import {
  connectDatabase,
  loadDatabaseConfigs,
  type DatabaseConfig,
} from "../db/lib";

type ChannelType = "RADIO" | "THEMATIC";

type StationSnapshot = {
  name: string;
  slug: string;
  channel_type: ChannelType;
  frequency: string | null;
  city: string | null;
  state: string | null;
  country: string;
  neighborhood: string | null;
  description: string | null;
  genres: string[];
  logo_url: string | null;
  website_url: string | null;
  source_page: string | null;
  stream_url: string | null;
  playlist_url: string | null;
  playlist_format: string | null;
  stream_type: string | null;
  codec: string | null;
  bitrate: number | null;
  stream_status: string;
  last_checked_at: Date | string | null;
  last_online_at: Date | string | null;
  active: boolean;
  system_default: boolean;
  notes: string | null;
};

type SourceSnapshot = {
  station_slug: string;
  source_url: string;
  label: string | null;
  priority: number;
  resolved_stream_url: string | null;
  playlist_format: string | null;
  stream_type: string | null;
  codec: string | null;
  bitrate: number | null;
  stream_status: string;
  last_checked_at: Date | string | null;
  last_online_at: Date | string | null;
  active: boolean;
  notes: string | null;
};

type CatalogSnapshot = {
  stations: StationSnapshot[];
  sources: SourceSnapshot[];
};

const STATION_COLUMNS = [
  "name",
  "slug",
  "channel_type",
  "frequency",
  "city",
  "state",
  "country",
  "neighborhood",
  "description",
  "genres",
  "logo_url",
  "website_url",
  "source_page",
  "stream_url",
  "playlist_url",
  "playlist_format",
  "stream_type",
  "codec",
  "bitrate",
  "stream_status",
  "last_checked_at",
  "last_online_at",
  "active",
  "system_default",
  "notes",
  "company_id",
] as const;

const SOURCE_COLUMNS = [
  "station_id",
  "source_url",
  "label",
  "priority",
  "resolved_stream_url",
  "playlist_format",
  "stream_type",
  "codec",
  "bitrate",
  "stream_status",
  "last_checked_at",
  "last_online_at",
  "active",
  "notes",
] as const;

const radioSlugs = JOAO_PESSOA_RADIO_CATALOG.map((station) => station.id);
const thematicSlugs = THEMATIC_RADIO_CATALOG.map((station) => station.slug);
const catalogSlugs = [...radioSlugs, ...thematicSlugs];
const expectedSourceKeys = new Set(
  THEMATIC_RADIO_CATALOG.flatMap((station) =>
    station.sources.map((source) => `${station.slug}\u0000${source.url}`),
  ),
);

function placeholders(count: number) {
  return Array.from({ length: count }, (_, index) => `$${index + 1}`).join(", ");
}

async function readDemoSnapshot(client: Client): Promise<CatalogSnapshot> {
  const stationResult = await client.query<StationSnapshot>(
    `select ${STATION_COLUMNS.filter((column) => column !== "company_id").join(", ")}
       from public.radio_station
      where company_id is null
        and slug = any($1::text[])
      order by channel_type, name`,
    [catalogSlugs],
  );

  const foundSlugs = new Set(stationResult.rows.map((station) => station.slug));
  const missingStations = catalogSlugs.filter((slug) => !foundSlugs.has(slug));
  if (missingStations.length) {
    throw new Error(
      `O catálogo de demonstração não contém: ${missingStations.join(", ")}.`,
    );
  }

  const sourceResult = await client.query<SourceSnapshot>(
    `select station.slug as station_slug,
            source.source_url,
            source.label,
            source.priority,
            source.resolved_stream_url,
            source.playlist_format,
            source.stream_type,
            source.codec,
            source.bitrate,
            source.stream_status,
            source.last_checked_at,
            source.last_online_at,
            source.active,
            source.notes
       from public.radio_stream_source source
       join public.radio_station station on station.id = source.station_id
      where station.company_id is null
        and station.slug = any($1::text[])
      order by station.slug, source.priority`,
    [thematicSlugs],
  );

  const sources = sourceResult.rows.filter((source) =>
    expectedSourceKeys.has(`${source.station_slug}\u0000${source.source_url}`),
  );
  const foundSourceKeys = new Set(
    sources.map((source) => `${source.station_slug}\u0000${source.source_url}`),
  );
  const missingSources = [...expectedSourceKeys].filter(
    (sourceKey) => !foundSourceKeys.has(sourceKey),
  );
  if (missingSources.length) {
    throw new Error(
      `O catálogo temático de demonstração está incompleto (${missingSources.length} fontes ausentes).`,
    );
  }

  return {
    stations: stationResult.rows.map((station) => ({
      ...station,
      stream_url: stableRadioPlaybackUrl(station.stream_url),
    })),
    sources: sources.map((source) => ({
      ...source,
      resolved_stream_url: stableRadioPlaybackUrl(source.resolved_stream_url),
    })),
  };
}

async function upsertStation(client: Client, station: StationSnapshot) {
  const values = STATION_COLUMNS.map((column) =>
    column === "company_id" ? null : station[column],
  );
  const updateColumns = STATION_COLUMNS.filter(
    (column) => column !== "slug" && column !== "company_id",
  );
  const result = await client.query<{ id: string }>(
    `insert into public.radio_station (${STATION_COLUMNS.join(", ")})
     values (${placeholders(STATION_COLUMNS.length)})
     on conflict (slug) where company_id is null do update
       set ${updateColumns.map((column) => `${column} = excluded.${column}`).join(", ")}
     returning id`,
    values,
  );

  return result.rows[0].id;
}

async function upsertSource(
  client: Client,
  stationId: string,
  source: SourceSnapshot,
) {
  const payload = { ...source, station_id: stationId };
  const values = SOURCE_COLUMNS.map((column) => payload[column]);
  const updateColumns = SOURCE_COLUMNS.filter(
    (column) => column !== "station_id" && column !== "priority",
  );

  await client.query(
    `insert into public.radio_stream_source (${SOURCE_COLUMNS.join(", ")})
     values (${placeholders(SOURCE_COLUMNS.length)})
     on conflict (station_id, priority) do update
       set ${updateColumns.map((column) => `${column} = excluded.${column}`).join(", ")}`,
    values,
  );
}

async function syncDatabase(
  database: DatabaseConfig,
  snapshot: CatalogSnapshot,
) {
  const { client } = await connectDatabase(database);
  try {
    await client.query("begin");
    const stationIds = new Map<string, string>();

    for (const station of snapshot.stations) {
      stationIds.set(station.slug, await upsertStation(client, station));
    }
    for (const source of snapshot.sources) {
      const stationId = stationIds.get(source.station_slug);
      if (!stationId) {
        throw new Error(`Canal temático não encontrado: ${source.station_slug}.`);
      }
      await upsertSource(client, stationId, source);
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function inspectCatalog(database: DatabaseConfig) {
  const { client } = await connectDatabase(database);
  try {
    const stations = await client.query<{
      channel_type: ChannelType;
      total: string;
      online: string;
    }>(
      `select channel_type,
              count(*)::text as total,
              count(*) filter (where stream_status = 'ONLINE' and stream_url is not null)::text as online
         from public.radio_station
        where company_id is null
          and slug = any($1::text[])
        group by channel_type`,
      [catalogSlugs],
    );
    const catalogSources = await client.query<{
      station_slug: string;
      source_url: string;
    }>(
      `select station.slug as station_slug, source.source_url
         from public.radio_stream_source source
         join public.radio_station station on station.id = source.station_id
        where station.company_id is null
          and station.slug = any($1::text[])`,
      [thematicSlugs],
    );
    const ephemeral = await client.query<{ total: string }>(
      `select count(*)::text as total
         from public.radio_station
        where company_id is null
          and slug = any($1::text[])
          and stream_url ~* '^https://e-[a-z0-9-]+\\.fabricahost\\.com\\.br/'`,
      [catalogSlugs],
    );

    const counts = new Map(
      stations.rows.map((row) => [
        row.channel_type,
        { total: Number(row.total), online: Number(row.online) },
      ]),
    );
    return {
      radios: counts.get("RADIO") ?? { total: 0, online: 0 },
      playlists: counts.get("THEMATIC") ?? { total: 0, online: 0 },
      sources: catalogSources.rows.filter((source) =>
        expectedSourceKeys.has(`${source.station_slug}\u0000${source.source_url}`),
      ).length,
      ephemeralUrls: Number(ephemeral.rows[0]?.total ?? 0),
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const databases = loadDatabaseConfigs();
  const demo = databases.find((database) => database.key === "demo");
  if (!demo) throw new Error("Banco de demonstração não configurado.");

  const demoConnection = await connectDatabase(demo);
  let snapshot: CatalogSnapshot;
  try {
    snapshot = await readDemoSnapshot(demoConnection.client);
  } finally {
    await demoConnection.client.end();
  }

  console.log(
    `Catálogo carregado: ${radioSlugs.length} rádios, ${thematicSlugs.length} playlists e ${snapshot.sources.length} fontes.`,
  );

  for (const database of databases) {
    if (database.key !== "demo") {
      console.log(`Sincronizando ${database.label}...`);
      await syncDatabase(database, snapshot);
    }

    const result = await inspectCatalog(database);
    if (
      result.radios.total !== radioSlugs.length ||
      result.playlists.total !== thematicSlugs.length ||
      result.sources !== expectedSourceKeys.size ||
      result.ephemeralUrls !== 0
    ) {
      throw new Error(`Falha na validação final de ${database.label}.`);
    }
    console.log(
      `- ${database.label}: ${result.radios.total} rádios (${result.radios.online} online), ` +
        `${result.playlists.total} playlists (${result.playlists.online} online), ` +
        `${result.sources} fontes temáticas.`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
