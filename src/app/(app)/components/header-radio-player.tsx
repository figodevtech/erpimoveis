"use client";

import * as React from "react";
import Hls, { ErrorTypes } from "hls.js";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  RadioTower,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type RadioStation = {
  id: string;
  name: string;
  type: "RADIO" | "THEMATIC";
  frequency: string | null;
  city: string | null;
  state: string | null;
  genres: string[];
  streamUrl: string | null;
  streamType: "DIRECT_STREAM" | "HLS" | null;
  streamStatus: "ONLINE" | "OFFLINE" | "UNKNOWN" | "INVALID" | "PLAYLIST_FOUND" | "RESOLVING";
};

type CatalogState = "loading" | "ready" | "error";
type PlaybackState = "idle" | "loading" | "playing" | "error";
type CatalogTab = RadioStation["type"];

const EQUALIZER_BARS = Array.from({ length: 5 }, (_, index) => index);
const SAVED_STATION_KEY = "erpimoveis:radio-station";
const SAVED_VOLUME_KEY = "erpimoveis:radio-volume";
const DEFAULT_VOLUME = 0.7;

function stationDetail(station: RadioStation | undefined) {
  if (!station) return "Aguardando catálogo";
  if (station.genres.length) return station.genres.slice(0, 2).join(" · ");
  return [station.city, station.state].filter(Boolean).join(" · ") || "Rádio online";
}

function playbackLabel(
  catalogState: CatalogState,
  playbackState: PlaybackState,
  station: RadioStation | undefined,
) {
  if (catalogState === "loading") return "Buscando rádios";
  if (catalogState === "error") return "Catálogo indisponível";
  if (!station?.streamUrl) return "Sinal offline";
  if (playbackState === "loading") return "Conectando";
  if (playbackState === "playing") return "No ar";
  if (playbackState === "error") return "Falha no áudio";
  return "Pausado";
}

function CatalogTabs({
  value,
  onValueChange,
  radioCount,
  playlistCount,
  layoutId,
  compact = false,
}: {
  value: CatalogTab;
  onValueChange: (value: CatalogTab) => void;
  radioCount: number;
  playlistCount: number;
  layoutId: string;
  compact?: boolean;
}) {
  const tabs = [
    { value: "RADIO" as const, label: "Rádio", count: radioCount, icon: RadioTower },
    { value: "THEMATIC" as const, label: "Playlist", count: playlistCount, icon: ListMusic },
  ];

  return (
    <div
      role="tablist"
      aria-label="Tipo de conteúdo"
      className={`grid grid-cols-2 rounded-lg border bg-muted/60 p-1 ${compact ? "gap-0.5" : "gap-1"}`}
    >
      {tabs.map((tab) => {
        const active = value === tab.value;
        const TabIcon = tab.icon;

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={tab.count === 0}
            onClick={() => onValueChange(tab.value)}
            className={`relative isolate flex items-center justify-center rounded-md font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 ${
              compact ? "h-8 gap-1.5 px-2 text-[11px]" : "h-10 gap-2 px-3 text-sm"
            } ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                aria-hidden="true"
                className="absolute inset-0 -z-10 rounded-md border bg-background shadow-sm dark:bg-accent"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            ) : null}
            <TabIcon aria-hidden="true" className={compact ? "size-3.5" : "size-4"} />
            <span>{tab.label}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] tabular-nums ${
                active ? "bg-primary/10 text-primary" : "bg-background/70 text-muted-foreground"
              }`}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function HeaderRadioPlayer() {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const hlsRef = React.useRef<Hls | null>(null);
  const playbackRequestRef = React.useRef(0);
  const recoveredMediaErrorRef = React.useRef(false);
  const wantsToPlayRef = React.useRef(false);
  const volumeRef = React.useRef(DEFAULT_VOLUME);
  const lastAudibleVolumeRef = React.useRef(DEFAULT_VOLUME);
  const [stations, setStations] = React.useState<RadioStation[]>([]);
  const [stationId, setStationId] = React.useState("");
  const [catalogState, setCatalogState] = React.useState<CatalogState>("loading");
  const [playbackState, setPlaybackState] = React.useState<PlaybackState>("idle");
  const [playerError, setPlayerError] = React.useState<string | null>(null);
  const [volume, setVolume] = React.useState(DEFAULT_VOLUME);
  const [accessDenied, setAccessDenied] = React.useState(false);
  const [catalogTab, setCatalogTab] = React.useState<CatalogTab>("RADIO");

  const station = stations.find(({ id }) => id === stationId) ?? stations[0];
  const isPlaying = playbackState === "playing";
  const isConnecting = playbackState === "loading";
  const availableStations = stations.filter(({ streamUrl }) => Boolean(streamUrl)).length;
  const statusLabel = playbackLabel(catalogState, playbackState, station);
  const catalogGroups = [
    {
      key: "RADIO" as const,
      label: "Rádios",
      stations: stations.filter(({ type }) => type !== "THEMATIC"),
      icon: RadioTower,
    },
    {
      key: "THEMATIC" as const,
      label: "Playlists",
      stations: stations.filter(({ type }) => type === "THEMATIC"),
      icon: ListMusic,
    },
  ];
  const activeCatalogGroup =
    catalogGroups.find(({ key }) => key === catalogTab) ?? catalogGroups[0];
  const ActiveCatalogIcon = activeCatalogGroup.icon;
  const activeCatalogAvailable = activeCatalogGroup.stations.filter(({ streamUrl }) =>
    Boolean(streamUrl),
  ).length;
  const radioCount = catalogGroups[0].stations.length;
  const playlistCount = catalogGroups[1].stations.length;

  const destroyHls = React.useCallback(() => {
    const hls = hlsRef.current;
    hlsRef.current = null;
    hls?.destroy();
  }, []);

  const clearAudioSource = React.useCallback(
    (audio: HTMLAudioElement) => {
      destroyHls();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
    [destroyHls],
  );

  React.useEffect(() => {
    const controller = new AbortController();

    async function loadStations() {
      try {
        const response = await fetch("/api/radios?active=true&limit=200", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          return;
        }
        if (!response.ok) throw new Error(`Falha ao carregar rádios (${response.status}).`);

        const payload = (await response.json()) as { data?: RadioStation[] };
        const items = Array.isArray(payload.data) ? payload.data : [];
        if (!items.length) throw new Error("Nenhuma rádio disponível.");

        let savedId: string | null = null;
        try {
          savedId = window.localStorage.getItem(SAVED_STATION_KEY);
        } catch {
          // O catalogo continua utilizavel mesmo se o navegador bloquear storage.
        }
        const initial =
          items.find(({ id, streamUrl }) => id === savedId && Boolean(streamUrl)) ??
          items.find(({ streamUrl, streamStatus }) => Boolean(streamUrl) && streamStatus === "ONLINE") ??
          items.find(({ streamUrl }) => Boolean(streamUrl)) ??
          items[0];

        setStations(items);
        setStationId(initial.id);
        setCatalogTab(initial.type === "THEMATIC" ? "THEMATIC" : "RADIO");
        setCatalogState("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[radio-player] falha ao carregar catálogo", error);
        setCatalogState("error");
      }
    }

    void loadStations();
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    try {
      const rawSavedVolume = window.localStorage.getItem(SAVED_VOLUME_KEY);
      if (rawSavedVolume === null) return;
      const saved = Number(rawSavedVolume);
      if (!Number.isFinite(saved) || saved < 0 || saved > 1) return;
      volumeRef.current = saved;
      if (saved > 0) lastAudibleVolumeRef.current = saved;
      setVolume(saved);
      if (audioRef.current) audioRef.current.volume = saved;
    } catch {
      // O volume padrao continua disponivel quando storage estiver bloqueado.
    }
  }, []);

  React.useEffect(
    () => () => {
      playbackRequestRef.current += 1;
      wantsToPlayRef.current = false;
      const audio = audioRef.current;
      if (audio) clearAudioSource(audio);
    },
    [clearAudioSource],
  );

  const playStation = React.useCallback(
    async (nextStation: RadioStation) => {
      const audio = audioRef.current;
      if (!audio || !nextStation.streamUrl) return;

      const requestId = playbackRequestRef.current + 1;
      playbackRequestRef.current = requestId;
      wantsToPlayRef.current = false;
      clearAudioSource(audio);

      wantsToPlayRef.current = true;
      recoveredMediaErrorRef.current = false;
      audio.volume = volumeRef.current;
      setPlayerError(null);
      setPlaybackState("loading");

      const nativeHlsSupport = Boolean(
        audio.canPlayType("application/vnd.apple.mpegurl") ||
          audio.canPlayType("application/x-mpegURL"),
      );
      // O hls.js vem antes do suporte nativo: ele busca os segmentos por conta
      // propria e recupera erro de midia, enquanto a pilha nativa depende de
      // Range por segmento. O nativo fica como saida para quem nao tem MSE,
      // caso do Safari no iPhone.
      const useHlsJs = nextStation.streamType === "HLS" && Hls.isSupported();

      if (nextStation.streamType === "HLS" && !useHlsJs && !nativeHlsSupport) {
        wantsToPlayRef.current = false;
        setPlaybackState("error");
        setPlayerError("Este navegador não oferece suporte à reprodução HLS.");
        return;
      }

      if (useHlsJs) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (
            !data.fatal ||
            playbackRequestRef.current !== requestId ||
            hlsRef.current !== hls
          ) {
            return;
          }

          if (data.type === ErrorTypes.MEDIA_ERROR && !recoveredMediaErrorRef.current) {
            recoveredMediaErrorRef.current = true;
            hls.recoverMediaError();
            return;
          }

          wantsToPlayRef.current = false;
          audio.pause();
          setPlaybackState("error");
          setPlayerError(
            data.type === ErrorTypes.NETWORK_ERROR
              ? "Não foi possível acessar a transmissão desta emissora."
              : "O formato de áudio desta emissora não pôde ser reproduzido.",
          );
          hlsRef.current = null;
          hls.destroy();
        });

        hls.attachMedia(audio);
        hls.loadSource(nextStation.streamUrl);
      } else {
        audio.src = nextStation.streamUrl;
        audio.load();
      }

      try {
        await audio.play();
      } catch (error) {
        if (!wantsToPlayRef.current || playbackRequestRef.current !== requestId) return;
        wantsToPlayRef.current = false;
        console.info("[radio-player] reprodução recusada", error);
        setPlaybackState("error");
        setPlayerError("A emissora não permitiu a reprodução neste navegador.");
        clearAudioSource(audio);
      }
    },
    [clearAudioSource],
  );

  const updateVolume = React.useCallback((nextVolume: number) => {
    const normalized = Math.min(1, Math.max(0, nextVolume));
    volumeRef.current = normalized;
    if (normalized > 0) lastAudibleVolumeRef.current = normalized;
    setVolume(normalized);
    if (audioRef.current) audioRef.current.volume = normalized;
    try {
      window.localStorage.setItem(SAVED_VOLUME_KEY, String(normalized));
    } catch {
      // O controle continua funcionando sem persistencia local.
    }
  }, []);

  const toggleMute = React.useCallback(() => {
    updateVolume(volumeRef.current > 0 ? 0 : lastAudibleVolumeRef.current || DEFAULT_VOLUME);
  }, [updateVolume]);

  const togglePlayback = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !station?.streamUrl) return;

    if (wantsToPlayRef.current || isPlaying || isConnecting) {
      playbackRequestRef.current += 1;
      wantsToPlayRef.current = false;
      hlsRef.current?.stopLoad();
      audio.pause();
      setPlaybackState("idle");
      return;
    }

    void playStation(station);
  }, [isConnecting, isPlaying, playStation, station]);

  const selectStation = React.useCallback(
    (nextId: string) => {
      const nextStation = stations.find(({ id }) => id === nextId);
      if (!nextStation) return;

      setStationId(nextId);
      setCatalogTab(nextStation.type === "THEMATIC" ? "THEMATIC" : "RADIO");
      setPlayerError(null);
      try {
        window.localStorage.setItem(SAVED_STATION_KEY, nextId);
      } catch {
        // A selecao atual ainda funciona sem persistencia local.
      }

      if (nextStation.streamUrl) {
        void playStation(nextStation);
      } else {
        playbackRequestRef.current += 1;
        wantsToPlayRef.current = false;
        const audio = audioRef.current;
        if (audio) clearAudioSource(audio);
        setPlaybackState("idle");
      }
    },
    [clearAudioSource, playStation, stations],
  );

  const canPlay = catalogState === "ready" && Boolean(station?.streamUrl);
  const detail = stationDetail(station);
  const frequency = station?.type === "THEMATIC" ? "Playlist" : station?.frequency || "Rádio";
  const volumePercent = Math.round(volume * 100);
  const VolumeIcon = volumePercent === 0 ? VolumeX : volumePercent < 50 ? Volume1 : Volume2;

  if (accessDenied) return null;

  return (
    <>
      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={`Abrir player de áudio. ${statusLabel}`}
              className="relative grid size-9 shrink-0 place-items-center rounded-md border bg-muted/40 text-primary shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15 dark:bg-muted/70"
            >
              <RadioTower aria-hidden="true" className="size-[18px]" />
              <span
                aria-hidden="true"
                className={`absolute right-1.5 top-1.5 size-1.5 rounded-full border border-background ${
                  isPlaying
                    ? "animate-pulse bg-emerald-500 motion-reduce:animate-none"
                    : isConnecting
                      ? "animate-pulse bg-primary motion-reduce:animate-none"
                      : "bg-muted-foreground/45"
                }`}
              />
            </button>
          </SheetTrigger>

          <SheetContent
            side="bottom"
            className="h-[88svh] max-h-[88svh] gap-0 overflow-hidden rounded-t-2xl border-t bg-background p-0 lg:hidden"
          >
            <SheetHeader className="shrink-0 border-b px-5 py-4 text-left">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <RadioTower aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <SheetTitle>Rádios e playlists</SheetTitle>
                  <SheetDescription>
                    {availableStations} de {stations.length || "—"} itens disponíveis
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/15 via-card to-card p-5 shadow-sm">
                <div
                  aria-hidden="true"
                  className="absolute -right-10 -top-12 size-36 rounded-full bg-primary/10 blur-2xl"
                />
                <div className="relative flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                        isPlaying
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : playbackState === "error"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`size-1.5 rounded-full ${isPlaying ? "animate-pulse bg-current" : "bg-current/60"}`}
                      />
                      {statusLabel}
                    </span>
                    <h3 className="mt-3 truncate text-xl font-bold tracking-tight text-foreground">
                      {station?.name ?? "Carregando rádios"}
                    </h3>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{detail}</p>
                  </div>
                  <span className="shrink-0 rounded-lg border bg-background/70 px-2.5 py-1.5 text-sm font-bold tabular-nums text-primary shadow-sm backdrop-blur">
                    {frequency}
                  </span>
                </div>

                <div className="relative mt-6 flex items-center justify-center gap-6">
                  <div
                    aria-hidden="true"
                    data-playing={isPlaying}
                    className="radio-equalizer flex h-9 w-8 items-center justify-between"
                  >
                    {EQUALIZER_BARS.map((bar) => (
                      <span key={bar} className="radio-equalizer-bar h-full w-1 rounded-full bg-primary/70" />
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label={`${isPlaying || isConnecting ? "Pausar" : "Reproduzir"} ${station?.name ?? "rádio"}`}
                    aria-pressed={isPlaying}
                    disabled={!canPlay}
                    onClick={togglePlayback}
                    className="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none motion-reduce:transform-none"
                  >
                    {isConnecting ? (
                      <LoaderCircle aria-hidden="true" className="size-7 animate-spin motion-reduce:animate-none" />
                    ) : isPlaying ? (
                      <Pause aria-hidden="true" className="size-7 fill-current" />
                    ) : (
                      <Play aria-hidden="true" className="size-7 translate-x-0.5 fill-current" />
                    )}
                  </button>
                  <div aria-hidden="true" className="w-8" />
                </div>

                {playerError ? (
                  <p role="alert" className="relative mt-4 text-center text-xs font-medium text-destructive">
                    {playerError}
                  </p>
                ) : null}
              </section>

              <section className="mt-4 rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <VolumeIcon aria-hidden="true" className="size-4 text-primary" />
                    <span className="text-sm font-semibold">Volume</span>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">{volumePercent}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={volumePercent}
                    onChange={(event) => updateVolume(Number(event.currentTarget.value) / 100)}
                    aria-label="Volume da rádio"
                    aria-valuetext={`${volumePercent}%`}
                    className="radio-volume-slider h-5 min-w-0 flex-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ "--radio-volume": `${volumePercent}%` } as React.CSSProperties}
                  />
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="h-9 rounded-md border bg-background px-3 text-xs font-semibold text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {volumePercent === 0 ? "Ativar som" : "Silenciar"}
                  </button>
                </div>
              </section>

              <section className="mt-5">
                <div className="mb-2 flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Catálogo de áudio
                  </h3>
                  <span className="text-xs text-muted-foreground">{availableStations} online</span>
                </div>
                <CatalogTabs
                  value={catalogTab}
                  onValueChange={setCatalogTab}
                  radioCount={radioCount}
                  playlistCount={playlistCount}
                  layoutId="radio-catalog-tab-mobile"
                />
                <div className="mt-3">
                  {catalogState === "loading" ? (
                    <div className="flex items-center justify-center gap-2 rounded-xl border bg-card py-8 text-sm text-muted-foreground">
                      <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                      Carregando catálogo
                    </div>
                  ) : catalogState === "error" ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-center text-sm text-destructive">
                      Não foi possível carregar as rádios.
                    </div>
                  ) : (
                    <>
                      <div className="mb-2 flex items-center justify-between px-1">
                        <div className="flex items-center gap-2 text-foreground">
                          <ActiveCatalogIcon aria-hidden="true" className="size-4 text-primary" />
                          <h4 className="text-sm font-semibold">{activeCatalogGroup.label}</h4>
                        </div>
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {activeCatalogAvailable}/{activeCatalogGroup.stations.length} disponíveis
                        </span>
                      </div>

                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={catalogTab}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                          className="space-y-2"
                        >
                          {activeCatalogGroup.stations.map((radioStation) => {
                            const available = Boolean(radioStation.streamUrl);
                            const selected = radioStation.id === station?.id;
                            return (
                              <button
                                key={radioStation.id}
                                type="button"
                                disabled={!available}
                                onClick={() => selectStation(radioStation.id)}
                                aria-pressed={selected}
                                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                                  selected
                                    ? "border-primary/40 bg-primary/10"
                                    : "bg-card hover:border-primary/25 hover:bg-accent/50"
                                }`}
                              >
                                <span
                                  aria-hidden="true"
                                  className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                                    selected
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  <ActiveCatalogIcon className="size-4" />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold">{radioStation.name}</span>
                                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                    {available ? stationDetail(radioStation) : "Sinal indisponível"}
                                  </span>
                                </span>
                                <span className="shrink-0 text-xs font-bold tabular-nums text-primary">
                                  {radioStation.type === "THEMATIC"
                                    ? "Playlist"
                                    : radioStation.frequency || "Online"}
                                </span>
                              </button>
                            );
                          })}
                        </motion.div>
                      </AnimatePresence>
                    </>
                  )}
                </div>
              </section>
            </div>
          </SheetContent>
        </Sheet>
      </div>

    <div
      role="group"
      aria-label="Player de áudio"
      title={playerError ?? undefined}
      className="hidden h-9 w-[330px] shrink-0 items-stretch overflow-hidden rounded-md border bg-muted/40 text-foreground shadow-sm lg:flex xl:w-[360px] dark:border-white/15 dark:bg-muted/70"
    >
      <audio
        ref={audioRef}
        preload="none"
        onPlaying={() => {
          if (wantsToPlayRef.current) setPlaybackState("playing");
        }}
        onWaiting={() => {
          if (wantsToPlayRef.current) setPlaybackState("loading");
        }}
        onPause={() => {
          if (!wantsToPlayRef.current) setPlaybackState("idle");
        }}
        onEnded={() => {
          wantsToPlayRef.current = false;
          setPlaybackState("idle");
        }}
        onError={() => {
          if (!wantsToPlayRef.current) return;
          // Em HLS o hls.js e a fonte da verdade: ele recupera erros de midia
          // antes de desistir e avisa pelo proprio handler de erro. Reportar
          // falha aqui interromperia uma recuperacao que iria dar certo.
          if (hlsRef.current) return;
          wantsToPlayRef.current = false;
          setPlaybackState("error");
          setPlayerError("Não foi possível carregar o áudio desta emissora.");
        }}
      />

      <button
        type="button"
        aria-label={`${isPlaying || isConnecting ? "Pausar" : "Reproduzir"} ${station?.name ?? "rádio"}`}
        aria-pressed={isPlaying}
        disabled={!canPlay}
        onClick={togglePlayback}
        className="group relative grid w-9 shrink-0 touch-manipulation place-items-center border-r bg-primary text-primary-foreground outline-none transition-[transform,filter] duration-150 hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.94] disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <span
          aria-hidden="true"
          className={`absolute right-1.5 top-1.5 size-1 rounded-full bg-primary-foreground transition-opacity motion-reduce:transition-none ${
            isPlaying ? "opacity-100" : "opacity-30"
          }`}
        />
        <span className="transition-transform group-hover:scale-110 motion-reduce:transform-none motion-reduce:transition-none">
          {isConnecting ? (
            <LoaderCircle aria-hidden="true" className="size-[18px] animate-spin motion-reduce:animate-none" />
          ) : isPlaying ? (
            <Pause aria-hidden="true" className="size-[18px] fill-current" />
          ) : (
            <Play aria-hidden="true" className="size-[18px] translate-x-px fill-current" />
          )}
        </span>
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
        <div
          aria-hidden="true"
          data-playing={isPlaying}
          className="radio-equalizer flex h-5 w-[18px] shrink-0 items-center justify-between"
        >
          {EQUALIZER_BARS.map((bar) => (
            <span key={bar} className="radio-equalizer-bar h-full w-0.5 rounded-full bg-primary" />
          ))}
        </div>

        <div className="min-w-0 leading-none">
          <p className="truncate text-[11px] font-semibold tracking-[0.02em] text-foreground">
            {station?.name ?? (catalogState === "loading" ? "Carregando rádios" : "Rádio indisponível")}
          </p>
          <p
            aria-live="polite"
            className={`mt-1 truncate text-[9px] font-semibold uppercase tracking-[0.12em] ${
              isPlaying ? "text-primary" : playbackState === "error" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {statusLabel} · {detail}
          </p>
        </div>
      </div>

      <div className="flex w-[86px] shrink-0 items-center gap-1 border-l px-1.5 xl:w-[96px]">
        <button
          type="button"
          onClick={toggleMute}
          aria-label={volumePercent === 0 ? "Ativar som" : "Silenciar rádio"}
          title={volumePercent === 0 ? "Ativar som" : "Silenciar"}
          className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <VolumeIcon aria-hidden="true" className="size-3.5" />
        </button>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={volumePercent}
          onChange={(event) => updateVolume(Number(event.currentTarget.value) / 100)}
          aria-label="Volume da rádio"
          aria-valuetext={`${volumePercent}%`}
          title={`Volume: ${volumePercent}%`}
          className="radio-volume-slider min-w-0 flex-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ "--radio-volume": `${volumePercent}%` } as React.CSSProperties}
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={catalogState !== "ready" || !stations.length}
            aria-label={`Selecionar rádio ou playlist. Atual: ${station?.name ?? "nenhuma"}, ${frequency}`}
            className="group flex w-[72px] shrink-0 touch-manipulation items-center justify-center gap-1 border-l bg-background/50 px-1.5 text-primary outline-none transition-colors hover:bg-accent focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:text-muted-foreground xl:w-[82px] dark:bg-background/20"
          >
            <span className="shrink-0 transition-transform duration-200 group-data-[state=open]:scale-110 motion-reduce:transform-none motion-reduce:transition-none">
              {station?.type === "THEMATIC" ? (
                <ListMusic aria-hidden="true" className="size-3.5" />
              ) : (
                <RadioTower aria-hidden="true" className="size-3.5" />
              )}
            </span>
            <span className="truncate text-[10px] font-bold tabular-nums tracking-[0.05em]">
              {frequency}
            </span>
            <span className="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transform-none motion-reduce:transition-none">
              <ChevronDown aria-hidden="true" className="size-3" />
            </span>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] w-80 overflow-y-auto rounded-md border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          <DropdownMenuLabel className="flex items-center justify-between px-2 py-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              Catálogo de áudio
            </span>
            <span className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
              {availableStations}/{stations.length} online
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="-mx-1.5 bg-border" />
          <div className="px-1 py-1.5">
            <CatalogTabs
              value={catalogTab}
              onValueChange={setCatalogTab}
              radioCount={radioCount}
              playlistCount={playlistCount}
              layoutId="radio-catalog-tab-desktop"
              compact
            />
          </div>
          <DropdownMenuRadioGroup value={stationId} onValueChange={selectStation}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={catalogTab}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              >
                <DropdownMenuLabel className="flex items-center justify-between px-2 py-1.5">
                  <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-foreground">
                    <ActiveCatalogIcon aria-hidden="true" className="size-3.5 text-primary" />
                    {activeCatalogGroup.label}
                  </span>
                  <span className="text-[9px] font-medium text-muted-foreground">
                    {activeCatalogAvailable}/{activeCatalogGroup.stations.length}
                  </span>
                </DropdownMenuLabel>

                {activeCatalogGroup.stations.map((radioStation) => {
                  const available = Boolean(radioStation.streamUrl);
                  return (
                    <DropdownMenuRadioItem
                      key={radioStation.id}
                      value={radioStation.id}
                      disabled={!available}
                      className="group rounded-sm py-2.5 pr-2 pl-8 text-foreground focus:bg-accent focus:text-accent-foreground data-[state=checked]:text-primary"
                    >
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold">{radioStation.name}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {available ? stationDetail(radioStation) : "Sinal indisponível"}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] font-bold tabular-nums tracking-wider">
                          {radioStation.type === "THEMATIC"
                            ? "Playlist"
                            : radioStation.frequency || "Online"}
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    </>
  );
}
