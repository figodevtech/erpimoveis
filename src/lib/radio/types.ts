export const RADIO_STREAM_STATUSES = [
  "ONLINE",
  "OFFLINE",
  "UNKNOWN",
  "INVALID",
  "PLAYLIST_FOUND",
  "RESOLVING",
] as const;

export type RadioStreamStatus = (typeof RADIO_STREAM_STATUSES)[number];
export type RadioPlaylistFormat = "M3U" | "M3U8" | "PLS";
export type RadioStreamType = "DIRECT_STREAM" | "HLS";
export type RadioChannelType = "RADIO" | "THEMATIC";

export type RadioMetadata = {
  name: string | null;
  description: string | null;
  genre: string | null;
  bitrate: number | null;
  websiteUrl: string | null;
  contentType: string | null;
  codec: string | null;
};

export type RadioCheckResult = {
  inputUrl: string;
  resolvedUrl: string | null;
  status: RadioStreamStatus;
  streamType: RadioStreamType | null;
  playlistFormat: RadioPlaylistFormat | null;
  httpStatus: number | null;
  checkedAt: string;
  metadata: RadioMetadata;
  message: string | null;
};

export type RadioResolveCandidate = RadioCheckResult & {
  candidateUrl: string;
};

export type RadioResolveResult = {
  playlistUrl: string;
  playlistFormat: RadioPlaylistFormat | null;
  streamUrl: string | null;
  streamType: RadioStreamType | null;
  status: RadioStreamStatus;
  checkedAt: string;
  metadata: RadioMetadata;
  candidates: RadioResolveCandidate[];
  message: string | null;
};

export type RadioStationRecord = {
  id: string;
  name: string;
  slug: string;
  type: RadioChannelType;
  frequency: string | null;
  city: string | null;
  state: string | null;
  country: string;
  neighborhood: string | null;
  description: string | null;
  genres: string[];
  logoUrl: string | null;
  websiteUrl: string | null;
  sourcePage: string | null;
  streamUrl: string | null;
  playlistUrl: string | null;
  playlistFormat: RadioPlaylistFormat | null;
  streamType: RadioStreamType | null;
  codec: string | null;
  bitrate: number | null;
  streamStatus: RadioStreamStatus;
  lastCheckedAt: string | null;
  lastOnlineAt: string | null;
  active: boolean;
  systemDefault: boolean;
  companyId: number | null;
  createdById: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
};

export type RadioStreamSourceRecord = {
  id: string;
  stationId: string;
  sourceUrl: string;
  label: string | null;
  priority: number;
  resolvedStreamUrl: string | null;
  playlistFormat: RadioPlaylistFormat | null;
  streamType: RadioStreamType | null;
  codec: string | null;
  bitrate: number | null;
  streamStatus: RadioStreamStatus;
  lastCheckedAt: string | null;
  lastOnlineAt: string | null;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export const EMPTY_RADIO_METADATA: RadioMetadata = {
  name: null,
  description: null,
  genre: null,
  bitrate: null,
  websiteUrl: null,
  contentType: null,
  codec: null,
};
