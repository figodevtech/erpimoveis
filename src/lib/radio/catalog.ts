import type { RadioPlaylistFormat, RadioStreamStatus } from "./types";

export type RadioCatalogEntry = {
  id: string;
  name: string;
  frequency: string;
  city: string;
  state: string;
  country: string;
  neighborhood?: string;
  genres: string[];
  websiteUrl: string | null;
  sourcePage: string;
  playlistUrl: string | null;
  playlistFormat: RadioPlaylistFormat | null;
  streamUrl: string | null;
  streamStatus: RadioStreamStatus;
  active: true;
  systemDefault: true;
  notes?: string;
};

const catalog = (
  id: string,
  name: string,
  frequency: string,
  genres: string[],
  radiosComId: string,
  sourceSlug: string,
  websiteUrl: string | null = null,
  extras: Pick<RadioCatalogEntry, "neighborhood" | "notes"> & { streamUrl?: string } = {},
): RadioCatalogEntry => {
  const { streamUrl = null, ...catalogExtras } = extras;
  return {
    id,
    name,
    frequency,
    city: "João Pessoa",
    state: "PB",
    country: "Brasil",
    genres,
    websiteUrl,
    sourcePage: `https://www.radios.com.br/aovivo/${sourceSlug}/${radiosComId}`,
    playlistUrl: streamUrl ? null : `https://www.radios.com.br/play/playlist/${radiosComId}/listen-radio.m3u`,
    playlistFormat: streamUrl ? null : "M3U",
    streamUrl,
    streamStatus: "UNKNOWN",
    active: true,
    systemDefault: true,
    ...catalogExtras,
  };
};

export const JOAO_PESSOA_RADIO_CATALOG: RadioCatalogEntry[] = [
  catalog("radio-camara-887", "Rádio Câmara", "88.7 FM", ["Pública"], "68919", "radio-camara-887-fm", "https://www.joaopessoa.pb.leg.br/"),
  catalog("radio-pop-893", "Rádio Pop", "89.3 FM", ["Popular", "Eclética", "Debates", "Entrevistas"], "39537", "radio-pop-893-fm", "https://portalpopnoticias.com.br/"),
  catalog("cabo-branco-915", "Rádio Cabo Branco", "91.5 FM", ["MPB"], "10563", "radio-cabo-branco-915-fm"),
  catalog("sucesso-929", "Rádio Sucesso", "92.9 FM", ["Popular", "Eclética", "Hits"], "14705", "radio-sucesso-929-fm", "https://www.sucesso92fm.com.br/", {
    notes: "O stream já apresentou instabilidade. Validar antes de marcar como ONLINE.",
  }),
  catalog("mix-fm-937", "Mix FM João Pessoa", "93.7 FM", ["Pop", "Pop-Rock", "Hits", "Jovem"], "13959", "radio-mix-937-fm", "https://aovivo.radiomixfm.com.br/joaopessoa"),
  catalog("arapuan-953", "Arapuan FM", "95.3 FM", ["Hits", "Românticas", "Forró"], "9627", "radio-arapuan-953-fm", "https://www.arapuanfm.com.br/"),
  catalog("cpad-961", "Rádio CPAD", "96.1 FM", ["Gospel"], "12233", "radio-cpad-961-fm"),
  catalog("joao-pessoa-fm-977", "Rádio João Pessoa", "97.7 FM", ["Popular", "Adulta", "MPB"], "178614", "radio-joao-pessoa-977-fm", "https://joaopessoafm.com.br/"),
  catalog("correio-983", "Rádio 98 Correio", "98.3 FM", ["Hits", "Eclética"], "8886", "radio-98-correio-fm", "https://www.correiosat.com.br/", {
    streamUrl: "https://play.wisestream.io/98correiofm",
  }),
  catalog("rede-aleluia-997", "Rede Aleluia João Pessoa", "99.7 FM", ["Gospel"], "24493", "radio-rede-aleluia-997-fm", "https://redealeluia.com.br/"),
  catalog("bandnews-1011", "BandNews FM João Pessoa", "101.1 FM", ["Jornalismo", "Notícias"], "234749", "radio-bandnews-1011-fm", "https://www.bandnewsfm.com.br/"),
  catalog("cbn-1017", "CBN João Pessoa", "101.7 FM", ["Jornalismo", "Notícias", "Futebol", "Entrevistas"], "16734", "radio-cbn-joao-pessoa-1017-fm", "https://cbnparaiba.com.br/"),
  catalog("novabrasil-1025", "Novabrasil FM João Pessoa", "102.5 FM", ["MPB", "Música Brasileira"], "14757", "radio-nova-brasil-1025-fm", "https://novabrasilfm.com.br/"),
  catalog("liga-fm-1033", "Liga FM João Pessoa", "103.3 FM", ["Popular", "Eclética", "Notícias"], "11829", "radio-liga-1033-fm", "https://joaopessoa.ligafm.com.br/", {
    streamUrl: "https://ice.fabricahost.com.br/103fmjoaopessoa",
  }),
  catalog("parahyba-fm-1039", "Parahyba FM", "103.9 FM", ["Pop-Rock", "MPB", "Música Brasileira"], "14505", "radio-parahyba-1039-fm", "https://epc.pb.gov.br/radio-ao-vivo/parahyba-fm"),
  catalog("rede-master-1045", "Rede Master", "104.5 FM", ["Gospel"], "113634", "radio-rede-master-1045-fm"),
  catalog("tabajara-1055", "Rádio Tabajara", "105.5 FM", ["Eclética", "MPB", "Cultura"], "14751", "radio-tabajara-1055-fm", "https://epc.pb.gov.br/"),
  catalog("ceu-fm-1071", "Rádio Céu", "107.1 FM", ["Gospel"], "17889", "radio-ceu-1071-fm", "https://www.correiosat.com.br/", {
    streamUrl: "https://play.wisestream.io/ceufm1071",
  }),
  catalog("deus-e-amor-1077", "Rádio Deus é Amor", "107.7 FM", ["Gospel"], "115539", "radio-deus-e-amor-1077-fm", "https://www.ipdapb.com.br/"),
  catalog("mangabeira-879", "Rádio Mangabeira", "87.9 FM", ["Comunitária"], "33961", "radio-mangabeira-879-fm", null, { neighborhood: "Mangabeira" }),
  catalog("valentina-879", "Rádio Valentina", "87.9 FM", ["Comunitária", "Hits", "Adulta"], "35977", "radio-valentina-879-fm", null, { neighborhood: "Valentina" }),
  catalog("cruz-das-armas-879", "Rádio Cruz das Armas", "87.9 FM", ["Comunitária", "Popular"], "12258", "radio-cruz-das-armas-879-fm", null, { neighborhood: "Cruz das Armas" }),
];
