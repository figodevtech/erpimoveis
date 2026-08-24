export type ThematicSourceCatalogEntry = {
  url: string;
  priority: number;
  label: string;
  active?: boolean;
  notes?: string;
};

export type ThematicChannelCatalogEntry = {
  name: string;
  slug: string;
  description: string;
  genres: string[];
  sourcePage: string;
  sources: ThematicSourceCatalogEntry[];
};

const vagalume = (url: string, priority = 1): ThematicSourceCatalogEntry => ({
  url,
  priority,
  label: "Vagalume FM",
});

const zeno = (url: string, priority: number): ThematicSourceCatalogEntry => ({
  url,
  priority,
  label: "Zeno FM",
});

export const THEMATIC_RADIO_CATALOG: ThematicChannelCatalogEntry[] = [
  {
    name: "MPB",
    slug: "mpb",
    description: "Música Popular Brasileira",
    genres: ["MPB", "Música Brasileira"],
    sourcePage: "https://vagalume.fm/mpb/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1470154983100588/aac.m3u8")],
  },
  {
    name: "Forró",
    slug: "forro",
    description: "Clássicos e sucessos do forró",
    genres: ["Forró", "Piseiro", "Nordeste"],
    sourcePage: "https://vagalume.fm/forro/",
    sources: [
      vagalume("https://stream.vagalume.fm/hls/147015501223418/aac.m3u8"),
      zeno("https://stream.zeno.fm/1k5m0vv5w0hvv", 2),
      zeno("https://stream.zeno.fm/uh7p2mkb86wtv", 3),
    ],
  },
  {
    name: "Sertanejo",
    slug: "sertanejo",
    description: "Sucessos da música sertaneja",
    genres: ["Sertanejo"],
    sourcePage: "https://vagalume.fm/sertanejo/",
    sources: [
      vagalume("https://stream.vagalume.fm/hls/14619606471054026608/aac.m3u8"),
      zeno("https://stream.zeno.fm/6kumndewqbruv", 2),
    ],
  },
  {
    name: "Sertanejo Romântico",
    slug: "sertanejo-romantico",
    description: "Baladas e clássicos românticos do sertanejo",
    genres: ["Sertanejo", "Românticas"],
    sourcePage: "https://vagalume.fm/sertanejo-romantico/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1499715905423293/aac.m3u8")],
  },
  {
    name: "Samba & Pagode",
    slug: "samba-pagode",
    description: "Samba e pagode brasileiro",
    genres: ["Samba", "Pagode"],
    sourcePage: "https://vagalume.fm/samba-e-pagode/",
    sources: [
      vagalume("https://stream.vagalume.fm/hls/147015499779090/aac.m3u8"),
      zeno("https://stream.zeno.fm/10tft0s9qs8uv", 2),
      {
        url: "http://stream.zeno.fm/hfqaq0bhfg8uv.m3u",
        priority: 3,
        label: "Zeno FM (HTTP legado)",
        active: false,
        notes: "Mantida apenas como referência; inativa para evitar Mixed Content no ERP HTTPS.",
      },
    ],
  },
  {
    name: "Rock",
    slug: "rock",
    description: "Clássicos e sucessos do rock",
    genres: ["Rock"],
    sourcePage: "https://vagalume.fm/rock/",
    sources: [
      vagalume("https://stream.vagalume.fm/hls/14647977281792658143/aac.m3u8"),
      vagalume("https://stream.vagalume.fm/hls/1464201608479108132/aac.m3u8", 2),
      zeno("https://stream.zeno.fm/fspaefq5b8luv", 3),
    ],
  },
  {
    name: "Pop",
    slug: "pop",
    description: "Hits da música pop",
    genres: ["Pop"],
    sourcePage: "https://vagalume.fm/pop/",
    sources: [vagalume("https://stream.vagalume.fm/hls/14660050141766497579/aac.m3u8")],
  },
  {
    name: "Pop Nacional",
    slug: "pop-nacional",
    description: "Hits da música pop brasileira",
    genres: ["Pop", "Brasil"],
    sourcePage: "https://vagalume.fm/pop-nacional/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1470169276225492/aac.m3u8")],
  },
  {
    name: "Pop Rock Nacional",
    slug: "pop-rock-nacional",
    description: "Rock e pop rock brasileiro",
    genres: ["Rock", "Pop Rock", "Brasil"],
    sourcePage: "https://vagalume.fm/pop-rock-br/",
    sources: [vagalume("https://stream.vagalume.fm/hls/14671417541091220806/aac.m3u8")],
  },
  {
    name: "Para Trabalhar",
    slug: "para-trabalhar",
    description: "Hits de pop, rock e eletrônica para animar o ambiente de trabalho",
    genres: ["Pop", "Rock", "Eletrônica", "Hits"],
    sourcePage: "https://vagalume.fm/musicas-para-trabalhar/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1489516250733476/aac.m3u8")],
  },
  {
    name: "Top 50 Brasil",
    slug: "top-50-brasil",
    description:
      "Um termômetro com os sucessos nacionais do momento, baseado no Top Vagalume e músicas mais ouvidas nas rádios e serviços de streaming",
    genres: ["Brasil", "Hits", "Top 50"],
    sourcePage: "https://vagalume.fm/top-50-brasil/",
    sources: [vagalume("https://stream.vagalume.fm/hls/147017028452123/aac.m3u8")],
  },
  {
    name: "Top 50 Internacional",
    slug: "top-50-internacional",
    description:
      "Um termômetro com os sucessos internacionais do momento, baseado no Top Vagalume e músicas mais ouvidas nas rádios e serviços de streaming",
    genres: ["Internacional", "Hits", "Top 50"],
    sourcePage: "https://vagalume.fm/top-50-internacional/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1470170299760930/aac.m3u8")],
  },
  {
    name: "Hits Anos 80",
    slug: "anos-80",
    description: "Sucessos que marcaram os anos 80",
    genres: ["Anos 80", "Flashback"],
    sourcePage: "https://vagalume.fm/hits-anos-80/",
    sources: [
      vagalume("https://stream.vagalume.fm/hls/1507663468882713/aac.m3u8"),
      zeno("https://stream.zeno.fm/tm0owvzi6fqtv", 2),
    ],
  },
  {
    name: "Hits Anos 90",
    slug: "anos-90",
    description: "Sucessos que marcaram os anos 90",
    genres: ["Anos 90", "Flashback"],
    sourcePage: "https://vagalume.fm/hits-anos-90/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1478022035646498/aac.m3u8")],
  },
  {
    name: "Hits Anos 2000",
    slug: "anos-2000",
    description: "Sucessos que marcaram os anos 2000",
    genres: ["Anos 2000", "Flashback"],
    sourcePage: "https://vagalume.fm/hits-anos-2000/",
    sources: [vagalume("https://stream.vagalume.fm/hls/147396460892793/aac.m3u8")],
  },
  {
    name: "Gospel",
    slug: "gospel",
    description: "Música gospel nacional",
    genres: ["Gospel", "Cristã"],
    sourcePage: "https://vagalume.fm/gospel/",
    sources: [vagalume("https://stream.vagalume.fm/hls/14658544132100453351/aac.m3u8")],
  },
  {
    name: "Gospel Internacional",
    slug: "gospel-internacional",
    description: "Música gospel internacional",
    genres: ["Gospel", "Internacional"],
    sourcePage: "https://vagalume.fm/gospel-internacional/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1470245767122628/aac.m3u8")],
  },
  {
    name: "Músicas Católicas",
    slug: "musicas-catolicas",
    description: "Música católica, louvor e adoração",
    genres: ["Cristã", "Católica", "Louvor", "Adoração"],
    sourcePage: "https://vagalume.fm/musicas-catolicas/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1520610908163452/aac.m3u8")],
  },
  {
    name: "Reggae",
    slug: "reggae",
    description: "Clássicos e sucessos do reggae",
    genres: ["Reggae"],
    sourcePage: "https://vagalume.fm/reggae/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1465840912218182609/aac.m3u8")],
  },
  {
    name: "Eletrônica",
    slug: "eletronica",
    description: "Música eletrônica e dance",
    genres: ["Eletrônica", "Dance"],
    sourcePage: "https://vagalume.fm/eletronica/",
    sources: [vagalume("https://stream.vagalume.fm/hls/146411300413492499/aac.m3u8")],
  },
  {
    name: "Hip-Hop",
    slug: "hip-hop",
    description: "Hip-Hop e rap",
    genres: ["Hip-Hop", "Rap"],
    sourcePage: "https://vagalume.fm/hip-hop/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1470155107337444/aac.m3u8")],
  },
  {
    name: "R&B",
    slug: "rnb",
    description: "R&B e soul",
    genres: ["R&B", "Soul"],
    sourcePage: "https://vagalume.fm/rnb/",
    sources: [vagalume("https://stream.vagalume.fm/hls/1467745876337223/aac.m3u8")],
  },
  {
    name: "Bossa Nova",
    slug: "bossa-nova",
    description: "Bossa Nova, samba e música brasileira",
    genres: ["Bossa Nova", "MPB", "Jazz"],
    sourcePage: "https://somafm.com/bossa/",
    sources: [
      {
        url: "https://ice6.somafm.com/bossa-128-aac",
        priority: 1,
        label: "SomaFM",
      },
    ],
  },
];
