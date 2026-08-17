import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { radioStreamService, stableRadioPlaybackUrl } from "./stream-service";
import { EMPTY_RADIO_METADATA } from "./types";
import type {
  RadioCheckResult,
  RadioResolveResult,
  RadioStationRecord,
  RadioStreamSourceRecord,
  RadioStreamStatus,
  RadioStreamType,
} from "./types";
import {
  radioCreateSchema,
  slugifyRadioName,
  type RadioCreateInput,
  type RadioListQuery,
  type RadioPatchInput,
} from "./validation";
import type { RadioCatalogEntry } from "./catalog";
import type {
  ThematicChannelCatalogEntry,
  ThematicSourceCatalogEntry,
} from "./thematic-catalog";
import {
  selectBestRadioSource,
  thematicStatusFromSources,
} from "./source-selection";

const RADIO_FIELDS = `
  id,name,slug,channel_type,frequency,city,state,country,neighborhood,description,genres,
  logo_url,website_url,source_page,stream_url,playlist_url,playlist_format,
  stream_type,codec,bitrate,stream_status,last_checked_at,last_online_at,
  active,system_default,company_id,created_by_id,notes,created_at,updated_at
`;

const RADIO_SOURCE_FIELDS = `
  id,station_id,source_url,label,priority,resolved_stream_url,playlist_format,
  stream_type,codec,bitrate,stream_status,last_checked_at,last_online_at,
  active,notes,created_at,updated_at
`;

type RadioContext = { companyId: number; userId: string };
type RadioDbRow = Record<string, any>;

type SourceAssessment = {
  stream_url: string | null;
  playlist_format: string | null;
  stream_type: RadioStreamType | null;
  codec: string | null;
  bitrate: number | null;
  stream_status: RadioStreamStatus;
  last_checked_at: string;
  last_online_at: string | null;
};

function httpError(message: string, statusCode: number) {
  const error = new Error(message);
  (error as any).statusCode = statusCode;
  return error;
}

function mapStation(row: RadioDbRow, favorites: Set<string> = new Set()): RadioStationRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    type: row.channel_type === "THEMATIC" ? "THEMATIC" : "RADIO",
    frequency: row.frequency ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    country: row.country ?? "Brasil",
    neighborhood: row.neighborhood ?? null,
    description: row.description ?? null,
    genres: Array.isArray(row.genres) ? row.genres : [],
    logoUrl: row.logo_url ?? null,
    websiteUrl: row.website_url ?? null,
    sourcePage: row.source_page ?? null,
    streamUrl: stableRadioPlaybackUrl(row.stream_url ?? null),
    playlistUrl: row.playlist_url ?? null,
    playlistFormat: row.playlist_format ?? null,
    streamType: row.stream_type ?? null,
    codec: row.codec ?? null,
    bitrate: row.bitrate == null ? null : Number(row.bitrate),
    streamStatus: row.stream_status ?? "UNKNOWN",
    lastCheckedAt: row.last_checked_at ?? null,
    lastOnlineAt: row.last_online_at ?? null,
    active: row.active !== false,
    systemDefault: row.system_default === true,
    companyId: row.company_id == null ? null : Number(row.company_id),
    createdById: row.created_by_id ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isFavorite: favorites.has(String(row.id)),
  };
}

function mapSource(row: RadioDbRow): RadioStreamSourceRecord {
  return {
    id: String(row.id),
    stationId: String(row.station_id),
    sourceUrl: String(row.source_url),
    label: row.label ?? null,
    priority: Number(row.priority),
    resolvedStreamUrl: stableRadioPlaybackUrl(row.resolved_stream_url ?? null),
    playlistFormat: row.playlist_format ?? null,
    streamType: row.stream_type ?? null,
    codec: row.codec ?? null,
    bitrate: row.bitrate == null ? null : Number(row.bitrate),
    streamStatus: row.stream_status ?? "UNKNOWN",
    lastCheckedAt: row.last_checked_at ?? null,
    lastOnlineAt: row.last_online_at ?? null,
    active: row.active !== false,
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function applyThematicSources(
  station: RadioStationRecord,
  sources: RadioStreamSourceRecord[],
): RadioStationRecord {
  if (station.type !== "THEMATIC") return station;

  const best = selectBestRadioSource(sources);
  const latestCheckedAt = sources
    .map((source) => source.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? station.lastCheckedAt;

  if (!best) {
    return {
      ...station,
      streamUrl: null,
      playlistUrl: null,
      playlistFormat: null,
      streamType: null,
      codec: null,
      bitrate: null,
      streamStatus: thematicStatusFromSources(sources),
      lastCheckedAt: latestCheckedAt,
    };
  }

  return {
    ...station,
    streamUrl: best.resolvedStreamUrl,
    playlistUrl: best.playlistFormat ? best.sourceUrl : null,
    playlistFormat: best.playlistFormat,
    streamType: best.streamType,
    codec: best.codec,
    bitrate: best.bitrate,
    streamStatus: "ONLINE",
    lastCheckedAt: latestCheckedAt,
    lastOnlineAt: best.lastOnlineAt ?? station.lastOnlineAt,
  };
}

async function hydrateStations(
  rows: RadioDbRow[],
  favorites: Set<string> = new Set(),
): Promise<RadioStationRecord[]> {
  const stations = rows.map((row) => mapStation(row, favorites));
  const thematicIds = stations
    .filter((station) => station.type === "THEMATIC")
    .map((station) => station.id);
  if (!thematicIds.length) return stations;

  const { data, error } = await supabaseAdmin
    .from("radio_stream_source")
    .select(RADIO_SOURCE_FIELDS)
    .in("station_id", thematicIds)
    .order("priority", { ascending: true });
  if (error) throw error;

  const byStation = new Map<string, RadioStreamSourceRecord[]>();
  for (const row of data ?? []) {
    const source = mapSource(row);
    const current = byStation.get(source.stationId) ?? [];
    current.push(source);
    byStation.set(source.stationId, current);
  }

  return stations.map((station) =>
    applyThematicSources(station, byStation.get(station.id) ?? []),
  );
}

function sanitizeSearch(value: string) {
  return value.replace(/[,()%'"\\]/g, " ").replace(/\s+/g, " ").trim();
}

async function favoriteIds(userId: string) {
  const { data, error } = await supabaseAdmin.from("radio_favorite").select("station_id").eq("user_id", userId);
  if (error) throw error;
  return new Set((data ?? []).map((item: any) => String(item.station_id)));
}

export async function listRadioStations(context: RadioContext, filters: RadioListQuery) {
  let query = supabaseAdmin
    .from("radio_station")
    .select(RADIO_FIELDS)
    .or(`company_id.is.null,company_id.eq.${context.companyId}`);

  if (filters.name) query = query.ilike("name", `%${sanitizeSearch(filters.name)}%`);
  if (filters.frequency) query = query.ilike("frequency", `%${sanitizeSearch(filters.frequency)}%`);
  if (filters.city) query = query.ilike("city", `%${sanitizeSearch(filters.city)}%`);
  if (filters.state) query = query.ilike("state", `%${sanitizeSearch(filters.state)}%`);
  if (filters.genre) query = query.contains("genres", [filters.genre]);
  if (filters.active !== undefined) query = query.eq("active", filters.active === "true");
  if (filters.systemDefault !== undefined) query = query.eq("system_default", filters.systemDefault === "true");
  if (filters.type) query = query.eq("channel_type", filters.type);

  const search = sanitizeSearch(filters.search);
  if (search) {
    query = query.or(
      `name.ilike.%${search}%,frequency.ilike.%${search}%,city.ilike.%${search}%,state.ilike.%${search}%`,
    );
  }

  const [{ data, error }, favorites] = await Promise.all([query, favoriteIds(context.userId)]);
  if (error) throw error;

  const all = await hydrateStations(data ?? [], favorites);
  all.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    if (a.systemDefault !== b.systemDefault) return a.systemDefault ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });

  const total = all.length;
  const from = (filters.page - 1) * filters.limit;
  const items = all.slice(from, from + filters.limit);

  return {
    data: items,
    pagination: {
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.max(1, Math.ceil(total / filters.limit)),
      pageCount: items.length,
      hasPrevPage: filters.page > 1,
      hasNextPage: from + items.length < total,
    },
    filters,
  };
}

export async function getRadioStation(id: string, context: RadioContext) {
  const { data, error } = await supabaseAdmin
    .from("radio_station")
    .select(RADIO_FIELDS)
    .eq("id", id)
    .or(`company_id.is.null,company_id.eq.${context.companyId}`)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError("Radio nao encontrada.", 404);
  const favorites = await favoriteIds(context.userId);
  return (await hydrateStations([data], favorites))[0];
}

async function getOwnedStationRow(id: string, context: RadioContext) {
  const { data, error } = await supabaseAdmin
    .from("radio_station")
    .select(RADIO_FIELDS)
    .eq("id", id)
    .eq("company_id", context.companyId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: global } = await supabaseAdmin
    .from("radio_station")
    .select("id")
    .eq("id", id)
    .is("company_id", null)
    .maybeSingle();
  if (global) throw httpError("Radios do catalogo global nao podem ser alteradas pela empresa.", 403);
  throw httpError("Radio nao encontrada.", 404);
}

function assessmentFromResult(
  result: RadioCheckResult | RadioResolveResult,
  fallbackStreamUrl: string | null,
): SourceAssessment {
  const isResolve = "streamUrl" in result;
  const streamUrl = isResolve ? result.streamUrl : result.resolvedUrl;
  return {
    stream_url: streamUrl ?? fallbackStreamUrl,
    playlist_format: result.playlistFormat,
    stream_type: result.streamType,
    codec: result.metadata.codec,
    bitrate: result.metadata.bitrate,
    stream_status: result.status,
    last_checked_at: result.checkedAt,
    last_online_at: result.status === "ONLINE" ? result.checkedAt : null,
  };
}

export async function assessRadioSource(input: Pick<RadioCreateInput, "streamUrl" | "playlistUrl">) {
  if (input.playlistUrl) {
    radioStreamService.validateUrl(input.playlistUrl);
    const playlistResult = await radioStreamService.resolvePlaylist(input.playlistUrl);
    if (playlistResult.status === "ONLINE" || !input.streamUrl) {
      return assessmentFromResult(playlistResult, null);
    }
  }
  if (input.streamUrl) {
    radioStreamService.validateUrl(input.streamUrl);
    return assessmentFromResult(await radioStreamService.checkStream(input.streamUrl), input.streamUrl);
  }
  return {
    stream_url: null,
    playlist_format: null,
    stream_type: null,
    codec: null,
    bitrate: null,
    stream_status: "UNKNOWN" as const,
    last_checked_at: new Date().toISOString(),
    last_online_at: null,
  };
}

function toDbPayload(input: RadioCreateInput) {
  return {
    name: input.name,
    slug: input.slug || slugifyRadioName(input.name),
    channel_type: input.type,
    frequency: input.frequency,
    city: input.city,
    state: input.state,
    country: input.country,
    neighborhood: input.neighborhood,
    description: input.description,
    genres: Array.from(new Set(input.genres)),
    logo_url: input.logoUrl,
    website_url: input.websiteUrl,
    source_page: input.sourcePage,
    stream_url: input.streamUrl,
    playlist_url: input.playlistUrl,
    playlist_format: input.playlistFormat,
    active: input.active,
    notes: input.notes,
  };
}

function throwDatabaseError(error: any) {
  if (error?.code === "23505") throw httpError("Ja existe uma radio com este slug ou endereco neste escopo.", 409);
  if (error?.code === "23514") throw httpError("Os dados da radio violam uma regra de integridade.", 400);
  throw error;
}

export async function createRadioStation(input: RadioCreateInput, context: RadioContext) {
  const assessment = await assessRadioSource(input);
  const { data, error } = await supabaseAdmin
    .from("radio_station")
    .insert({
      ...toDbPayload(input),
      ...assessment,
      company_id: context.companyId,
      system_default: false,
      created_by_id: context.userId,
    })
    .select(RADIO_FIELDS)
    .single();
  if (error) throwDatabaseError(error);
  if (!data) throw httpError("A radio foi criada sem retorno do banco.", 500);
  return mapStation(data);
}

function recordToCreateInput(row: RadioDbRow): RadioCreateInput {
  return {
    name: row.name,
    slug: row.slug,
    type: row.channel_type === "THEMATIC" ? "THEMATIC" : "RADIO",
    frequency: row.frequency,
    city: row.city,
    state: row.state,
    country: row.country,
    neighborhood: row.neighborhood,
    description: row.description,
    genres: row.genres ?? [],
    logoUrl: row.logo_url,
    websiteUrl: row.website_url,
    sourcePage: row.source_page,
    streamUrl: row.stream_url,
    playlistUrl: row.playlist_url,
    playlistFormat: row.playlist_format,
    active: row.active,
    notes: row.notes,
  };
}

export async function updateRadioStation(id: string, patch: RadioPatchInput, context: RadioContext) {
  const current = await getOwnedStationRow(id, context);
  const merged = radioCreateSchema.parse({ ...recordToCreateInput(current), ...patch });
  const sourceChanged = ["streamUrl", "playlistUrl", "playlistFormat", "active"].some((key) => key in patch);
  const assessment = sourceChanged ? await assessRadioSource(merged) : {};

  const { data, error } = await supabaseAdmin
    .from("radio_station")
    .update({ ...toDbPayload(merged), ...assessment })
    .eq("id", id)
    .eq("company_id", context.companyId)
    .select(RADIO_FIELDS)
    .single();
  if (error) throwDatabaseError(error);
  if (!data) throw httpError("A radio foi atualizada sem retorno do banco.", 500);
  return mapStation(data);
}

export async function deleteRadioStation(id: string, context: RadioContext) {
  await getOwnedStationRow(id, context);
  const { error } = await supabaseAdmin
    .from("radio_station")
    .delete()
    .eq("id", id)
    .eq("company_id", context.companyId);
  if (error) throw error;
}

export async function listFavoriteRadioStations(context: RadioContext) {
  const favorites = await favoriteIds(context.userId);
  if (!favorites.size) return [];
  const { data, error } = await supabaseAdmin
    .from("radio_station")
    .select(RADIO_FIELDS)
    .in("id", Array.from(favorites))
    .or(`company_id.is.null,company_id.eq.${context.companyId}`);
  if (error) throw error;
  return (await hydrateStations(data ?? [], favorites)).sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
  );
}

export async function addRadioFavorite(id: string, context: RadioContext) {
  await getRadioStation(id, context);
  const { error } = await supabaseAdmin
    .from("radio_favorite")
    .upsert({ user_id: context.userId, station_id: id }, { onConflict: "user_id,station_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function removeRadioFavorite(id: string, context: RadioContext) {
  await getRadioStation(id, context);
  const { error } = await supabaseAdmin
    .from("radio_favorite")
    .delete()
    .eq("user_id", context.userId)
    .eq("station_id", id);
  if (error) throw error;
}

function resultStreamUrl(result: RadioCheckResult | RadioResolveResult) {
  return "streamUrl" in result ? result.streamUrl : result.resolvedUrl;
}

function unavailableSourceResult(
  sourceUrl: string,
  status: RadioStreamStatus,
  message: string,
): RadioCheckResult {
  return {
    inputUrl: sourceUrl,
    resolvedUrl: null,
    status,
    streamType: null,
    playlistFormat: null,
    httpStatus: null,
    checkedAt: new Date().toISOString(),
    metadata: { ...EMPTY_RADIO_METADATA },
    message,
  };
}

export async function upsertGlobalThematicChannelDefinition(
  entry: ThematicChannelCatalogEntry,
) {
  const definition = {
    name: entry.name,
    slug: entry.slug,
    channel_type: "THEMATIC",
    frequency: null,
    city: null,
    state: null,
    country: "Brasil",
    neighborhood: null,
    description: entry.description,
    genres: entry.genres,
    website_url: entry.sourcePage,
    source_page: entry.sourcePage,
    active: true,
    system_default: true,
    company_id: null,
  };

  const { data: current, error: findError } = await supabaseAdmin
    .from("radio_station")
    .select("id")
    .eq("slug", entry.slug)
    .is("company_id", null)
    .maybeSingle();
  if (findError) throw findError;

  const query = current
    ? supabaseAdmin.from("radio_station").update(definition).eq("id", current.id)
    : supabaseAdmin.from("radio_station").insert({
        ...definition,
        stream_url: null,
        playlist_url: null,
        playlist_format: null,
        stream_type: null,
        stream_status: "UNKNOWN",
        last_checked_at: null,
        last_online_at: null,
      });
  const { data, error } = await query.select(RADIO_FIELDS).single();
  if (error) throwDatabaseError(error);
  if (!data) throw httpError("O canal tematico foi importado sem retorno do banco.", 500);
  return mapStation(data);
}

export async function checkAndUpsertThematicSource(
  stationId: string,
  sourceEntry: ThematicSourceCatalogEntry,
) {
  const active = sourceEntry.active !== false;
  let result: RadioCheckResult | RadioResolveResult;

  if (!active) {
    result = unavailableSourceResult(
      sourceEntry.url,
      "UNKNOWN",
      "Fonte inativa; validação externa ignorada.",
    );
  } else {
    try {
      result = await radioStreamService.test({ url: sourceEntry.url });
    } catch (error) {
      result = unavailableSourceResult(
        sourceEntry.url,
        "INVALID",
        error instanceof Error ? error.message : "Fonte inválida.",
      );
    }
  }

  const resolvedUrl = resultStreamUrl(result);
  const online = result.status === "ONLINE" && Boolean(resolvedUrl);
  const { data: current, error: findError } = await supabaseAdmin
    .from("radio_stream_source")
    .select("id,source_url,last_online_at")
    .eq("station_id", stationId)
    .eq("priority", sourceEntry.priority)
    .maybeSingle();
  if (findError) throw findError;

  const payload = {
    station_id: stationId,
    source_url: sourceEntry.url,
    label: sourceEntry.label,
    priority: sourceEntry.priority,
    resolved_stream_url: online ? resolvedUrl : null,
    playlist_format: result.playlistFormat,
    stream_type: online ? result.streamType : null,
    codec: online ? result.metadata.codec : null,
    bitrate: online ? result.metadata.bitrate : null,
    stream_status: active ? result.status : "UNKNOWN",
    last_checked_at: active ? result.checkedAt : null,
    last_online_at: online
      ? result.checkedAt
      : current?.source_url === sourceEntry.url
        ? current.last_online_at
        : null,
    active,
    notes: sourceEntry.notes ?? null,
  };

  const query = current
    ? supabaseAdmin.from("radio_stream_source").update(payload).eq("id", current.id)
    : supabaseAdmin.from("radio_stream_source").insert(payload);
  const { data, error } = await query.select(RADIO_SOURCE_FIELDS).single();
  if (error) throwDatabaseError(error);
  if (!data) throw httpError("A fonte tematica foi importada sem retorno do banco.", 500);
  return { source: mapSource(data), result };
}

export async function refreshThematicStationFromSources(stationId: string) {
  const [{ data: station, error: stationError }, { data: rows, error: sourcesError }] =
    await Promise.all([
      supabaseAdmin
        .from("radio_station")
        .select(RADIO_FIELDS)
        .eq("id", stationId)
        .eq("channel_type", "THEMATIC")
        .single(),
      supabaseAdmin
        .from("radio_stream_source")
        .select(RADIO_SOURCE_FIELDS)
        .eq("station_id", stationId)
        .order("priority", { ascending: true }),
    ]);
  if (stationError) throw stationError;
  if (sourcesError) throw sourcesError;

  const sources = (rows ?? []).map(mapSource);
  const best = selectBestRadioSource(sources);
  const lastCheckedAt = sources
    .map((source) => source.lastCheckedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? station.last_checked_at;

  const payload = best
    ? {
        stream_url: best.resolvedStreamUrl,
        playlist_url: best.playlistFormat ? best.sourceUrl : null,
        playlist_format: best.playlistFormat,
        stream_type: best.streamType,
        codec: best.codec,
        bitrate: best.bitrate,
        stream_status: "ONLINE",
        last_checked_at: lastCheckedAt,
        last_online_at: best.lastOnlineAt ?? station.last_online_at,
      }
    : {
        stream_url: null,
        playlist_url: null,
        playlist_format: null,
        stream_type: null,
        codec: null,
        bitrate: null,
        stream_status: thematicStatusFromSources(sources),
        last_checked_at: lastCheckedAt,
        last_online_at: station.last_online_at,
      };

  const { data, error } = await supabaseAdmin
    .from("radio_station")
    .update(payload)
    .eq("id", stationId)
    .eq("channel_type", "THEMATIC")
    .select(RADIO_FIELDS)
    .single();
  if (error) throw error;
  return applyThematicSources(mapStation(data), sources);
}

export async function checkRadioStation(id: string, context: RadioContext) {
  const current = await getRadioStation(id, context);
  if (current.type === "THEMATIC") {
    const { data, error } = await supabaseAdmin
      .from("radio_stream_source")
      .select(RADIO_SOURCE_FIELDS)
      .eq("station_id", id)
      .eq("active", true)
      .order("priority", { ascending: true });
    if (error) throw error;

    const checked: Awaited<ReturnType<typeof checkAndUpsertThematicSource>>[] = [];
    for (const row of data ?? []) {
      const source = mapSource(row);
      checked.push(
        await checkAndUpsertThematicSource(id, {
          url: source.sourceUrl,
          priority: source.priority,
          label: source.label ?? `Fonte ${source.priority}`,
          active: source.active,
          notes: source.notes ?? undefined,
        }),
      );
    }

    const station = await refreshThematicStationFromSources(id);
    const selected = checked.find(
      ({ source }) => source.resolvedStreamUrl === station.streamUrl,
    );
    const result =
      selected?.result ??
      checked.at(-1)?.result ??
      unavailableSourceResult(
        current.sourcePage ?? "https://radio.invalid/sem-fonte",
        station.streamStatus,
        "Canal sem fontes ativas.",
      );
    return { station, result, sources: checked.map((item) => item.source) };
  }

  const result = current.playlistUrl
    ? await radioStreamService.resolvePlaylist(current.playlistUrl)
    : await radioStreamService.checkStream(current.streamUrl!);
  const assessment = assessmentFromResult(result, current.streamUrl);

  const { data, error } = await supabaseAdmin
    .from("radio_station")
    .update({
      ...assessment,
      last_online_at: assessment.last_online_at ?? current.lastOnlineAt,
    })
    .eq("id", id)
    .or(`company_id.is.null,company_id.eq.${context.companyId}`)
    .select(RADIO_FIELDS)
    .single();
  if (error) throw error;
  return { station: mapStation(data), result };
}

export async function upsertGlobalCatalogStation(
  entry: RadioCatalogEntry,
  result: RadioResolveResult | RadioCheckResult,
) {
  const resolvedStreamUrl = "streamUrl" in result ? result.streamUrl : result.resolvedUrl;
  const payload = {
    name: entry.name,
    slug: entry.id,
    channel_type: "RADIO",
    frequency: entry.frequency,
    city: entry.city,
    state: entry.state,
    country: entry.country,
    neighborhood: entry.neighborhood ?? null,
    genres: entry.genres,
    website_url: entry.websiteUrl,
    source_page: entry.sourcePage,
    playlist_url: entry.playlistUrl,
    playlist_format: result.playlistFormat ?? entry.playlistFormat,
    stream_url: result.status === "ONLINE" ? entry.streamUrl ?? resolvedStreamUrl : null,
    stream_type: result.streamType,
    codec: result.metadata.codec,
    bitrate: result.metadata.bitrate,
    stream_status: result.status,
    last_checked_at: result.checkedAt,
    last_online_at: result.status === "ONLINE" ? result.checkedAt : null,
    active: true,
    system_default: true,
    company_id: null,
    notes: entry.notes ?? null,
  };

  const { data: current, error: findError } = await supabaseAdmin
    .from("radio_station")
    .select("id,last_online_at")
    .eq("slug", entry.id)
    .is("company_id", null)
    .maybeSingle();
  if (findError) throw findError;

  const query = current
    ? supabaseAdmin
        .from("radio_station")
        .update({ ...payload, last_online_at: payload.last_online_at ?? current.last_online_at })
        .eq("id", current.id)
    : supabaseAdmin.from("radio_station").insert(payload);
  const { data, error } = await query.select(RADIO_FIELDS).single();
  if (error) throwDatabaseError(error);
  if (!data) throw httpError("A radio foi importada sem retorno do banco.", 500);
  return mapStation(data);
}
