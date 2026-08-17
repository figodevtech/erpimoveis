import type { RadioStreamStatus, RadioStreamType, RadioPlaylistFormat } from "./types";

export type SelectableRadioSource = {
  id: string;
  priority: number;
  active: boolean;
  sourceUrl: string;
  resolvedStreamUrl: string | null;
  playlistFormat: RadioPlaylistFormat | null;
  streamType: RadioStreamType | null;
  streamStatus: RadioStreamStatus;
  lastCheckedAt: string | null;
  lastOnlineAt: string | null;
  codec: string | null;
  bitrate: number | null;
};

export function selectBestRadioSource<T extends SelectableRadioSource>(sources: T[]): T | null {
  return (
    sources
      .filter(
        (source) =>
          source.active &&
          source.streamStatus === "ONLINE" &&
          Boolean(source.resolvedStreamUrl),
      )
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))[0] ?? null
  );
}

export function thematicStatusFromSources(sources: SelectableRadioSource[]): RadioStreamStatus {
  const active = sources.filter((source) => source.active);
  if (selectBestRadioSource(active)) return "ONLINE";
  if (!active.length) return "UNKNOWN";
  if (active.some((source) => source.streamStatus === "RESOLVING")) return "RESOLVING";
  if (active.some((source) => source.streamStatus === "UNKNOWN" || !source.lastCheckedAt)) return "UNKNOWN";
  return "OFFLINE";
}
