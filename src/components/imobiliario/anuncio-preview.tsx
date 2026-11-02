"use client";

import { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { DM_Sans, Playfair_Display } from "next/font/google";
import {
  ArrowLeft,
  ArrowRight,
  Bath,
  BedDouble,
  Check,
  Heart,
  Images,
  MapPin,
  Ruler,
  Share2,
  ShieldCheck,
  Users,
  Wifi,
} from "lucide-react";
import type { Entity } from "./model";

/*
 * Réplica do catálogo do site Cespedes Living, com os dados do formulário ainda não salvos:
 * card = components/flat-card.tsx; página = app/flats/[slug]/page.tsx (+ gallery, booking-form,
 * property-interest), estilos de globals.css + refinements.css. Mudou lá, mude aqui também.
 * Só mostra: nada aqui reserva, envia mensagem ou sai do ERP.
 */

const display = Playfair_Display({ subsets: ["latin"], weight: ["500"], display: "swap" });
const body = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });

const MODALITY_LABELS: Record<string, string> = { TEMPORADA: "Temporada", LOCACAO: "Aluguel", VENDA: "Venda" };
const GOLD_DARK = "#8a682e";

/** Mesma regra do site (domain/amenities.ts): "Wi-Fi", "Wifi", "Wi-Fi de alta velocidade"... */
function hasWifi(amenities: string[]) {
  return amenities.some((a) =>
    /^wi-?\s?fi\b/.test(a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim())
  );
}

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Dados do formulário no formato que o site recebe (data.ts → publicFlats). */
function flatFrom(value: Entity, gallery: string[]) {
  const modalidades: string[] = value.modalidades?.length ? value.modalidades : ["TEMPORADA"];
  const endereco = value.endereco ?? {};
  const text = (v: unknown) => String(v ?? "").trim();
  return {
    title: text(value.titulo) || "Título do anúncio",
    slug: text(value.slug),
    neighborhood: text(endereco.bairro),
    city: text(endereco.cidade),
    state: text(endereco.estado).toUpperCase(),
    description: text(value.descricao),
    locationDetails: text(value.endereco_publico?.localizacao_aproximada),
    gallery,
    realPhotos: value.fotos_reais !== false && gallery.length > 0,
    maxGuests: Number(value.capacidade ?? 1),
    bedrooms: Number(value.quartos ?? 0),
    bathrooms: Number(value.banheiros ?? 0),
    areaSqm: Number(value.area ?? 0),
    amenities: ((value.comodidades ?? []) as string[]).filter(Boolean),
    tag: text(value.selo_anuncio),
    modalidades,
    // O site mostra só a diária por enquanto (ONLY_NIGHTLY_PRICE no site).
    nightly: modalidades.includes("TEMPORADA") ? Number(value.diaria ?? 0) : null,
    rules: text(value.regras),
    checkinTime: text(value.horario_checkin).slice(0, 5) || null,
    checkoutTime: text(value.horario_checkout).slice(0, 5) || null,
  };
}
type PreviewFlat = ReturnType<typeof flatFrom>;

/** Link do site que, na prévia, não leva a lugar nenhum (ou volta ao card). */
function FakeLink({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return onClick ? (
    <button type="button" onClick={onClick} className={`cursor-pointer hover:text-[#8a682e] ${className}`}>
      {children}
    </button>
  ) : (
    <span className={className}>{children}</span>
  );
}

function Cover({ src, alt, className = "" }: { src?: string; alt: string; className?: string }) {
  return src ? (
    <Image unoptimized fill src={src} alt={alt} className={`object-cover ${className}`} />
  ) : (
    <div className="grid h-full place-items-center bg-[#edf0f1] text-sm text-[#55636c]">Foto indisponível</div>
  );
}

function PreviewCard({ flat, onOpen }: { flat: PreviewFlat; onOpen: () => void }) {
  const cover = flat.gallery[0];
  const tag = flat.tag || flat.modalidades.map((m) => MODALITY_LABELS[m] ?? m).join(" · ");
  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Abrir a página de ${flat.title} na prévia`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group w-full max-w-[370px] cursor-pointer overflow-hidden rounded-[9px] border border-[#ececeb] bg-white text-[#1a2830] outline-none transition-[transform,box-shadow] duration-[250ms] hover:-translate-y-[3px] hover:shadow-[0_14px_40px_#132d3b14] focus-visible:ring-[3px] focus-visible:ring-[#d3a750]"
    >
      <div className="relative h-[235px] overflow-hidden bg-[#dadbd9]">
        <Cover
          src={cover}
          alt={flat.realPhotos ? `Foto do ${flat.title}` : `Sala ilustrativa do ${flat.title}`}
          className="transition-transform duration-500 group-hover:scale-[1.06]"
        />
        <span className="absolute bottom-[15px] left-[14px] rounded-full bg-white/95 px-2.5 py-[5px] text-[0.62rem] font-bold text-[#1a2830]">
          {tag}
        </span>
        {!flat.realPhotos && cover ? (
          <span className="absolute bottom-2 right-[9px] rounded-[3px] bg-[#0b2029c9] px-[5px] py-px text-[9px] text-white">
            Imagem de ambientação
          </span>
        ) : null}
        <span className="absolute right-[13px] top-[13px] grid h-[38px] w-[38px] place-items-center rounded-full bg-[rgba(15,45,61,0.52)] text-white backdrop-blur-[5px]">
          <Heart size={19} />
        </span>
      </div>

      <div className="px-[23px] py-6">
        <p className="m-0 flex items-center gap-1.5 text-[0.72rem] text-[#58636b]">
          <MapPin size={14} />
          {[flat.neighborhood, flat.city].filter(Boolean).join(" · ") || "Bairro · Cidade"}
        </p>
        <h3 className={`${display.className} mb-[9px] mt-[13px] text-[1.4rem] font-medium leading-tight`}>{flat.title}</h3>
        <div className="my-5 flex flex-wrap items-center gap-[13px] text-[0.7rem] text-[#5d6970]">
          <span className="inline-flex items-center gap-1.5">
            <Users size={15} />
            {flat.maxGuests} hóspedes
          </span>
          <span className="inline-flex items-center gap-1.5">
            <BedDouble size={15} />
            {flat.bedrooms} quarto{flat.bedrooms > 1 ? "s" : ""}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Wifi size={15} />
            {hasWifi(flat.amenities) ? "Wi-Fi" : `${flat.areaSqm} m²`}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[#eceeed] pt-4">
          <div className="text-[1.3rem] font-bold leading-[1.15] tracking-[-0.03em]">
            <small className="mb-1.5 block text-[0.66rem] font-medium tracking-normal text-[#58636b]">A partir de</small>
            {flat.nightly != null ? money(flat.nightly) : "Sob consulta"}{" "}
            <span className="text-[0.74rem] font-medium text-[#58636b]">{flat.nightly != null ? "/ noite" : ""}</span>
          </div>
          <span className="inline-flex min-h-[38px] items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#c9a96a] px-[13px] py-[9px] text-[0.69rem] font-bold text-[#12222a] transition-colors group-hover:bg-[#dbbc80]">
            Ver detalhes <ArrowRight size={15} />
          </span>
        </div>
      </div>
    </article>
  );
}

/** Campo de formulário do site, só para ver (nada é digitado na prévia). */
function FakeField({ label, value, tall = false, className = "" }: { label: string; value?: string; tall?: boolean; className?: string }) {
  return (
    <div className={`flex flex-col gap-[7px] ${className}`}>
      <span className="text-[0.74rem] font-bold text-[#48545c]">{label}</span>
      <span
        className={`flex w-full items-start rounded-lg border border-[#d9dfde] bg-white px-3 py-[11px] text-[0.87rem] text-[#24333a] ${
          tall ? "min-h-[118px]" : "min-h-[46px] items-center"
        }`}
      >
        {value ?? ""}
      </span>
    </div>
  );
}

const GOLD_BUTTON =
  "inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-[#c9a96a] px-[22px] py-[13px] text-[0.85rem] font-bold text-[#12222a]";
const H2 = `${display.className} mb-6 text-[1.9rem] font-medium leading-[1.2] tracking-[-0.025em]`;

function PreviewPage({ flat, onBack }: { flat: PreviewFlat; onBack: () => void }) {
  const others = flat.modalidades.filter((m) => m !== "TEMPORADA");
  const images = flat.gallery;
  return (
    <div className="@container">
      <div className="mx-auto w-[calc(100%-36px)] max-w-[1250px] pt-[30px] text-[15px] leading-[1.65] text-[#1a2830] @[700px]:w-[calc(100%-80px)]">
        <nav className="flex flex-wrap items-center gap-[9px] text-[0.75rem] text-[#57656e]" aria-label="Trilha de navegação">
          <FakeLink>Início</FakeLink>
          <span>/</span>
          <FakeLink onClick={onBack}>Flats</FakeLink>
          <span>/</span>
          <span>{flat.neighborhood || "Bairro"}</span>
        </nav>

        <div className="my-7 flex items-end justify-between gap-3 @[560px]:gap-[18px]">
          <div className="min-w-0">
            <p className="mb-3.5 text-[0.69rem] font-bold uppercase tracking-[0.25em]" style={{ color: GOLD_DARK }}>
              SEU REFÚGIO NA CIDADE
            </p>
            <h1 className={`${display.className} mb-4 text-[clamp(2.3rem,6cqw,3.3rem)] font-medium leading-[1.2] tracking-[-0.025em]`}>
              {flat.title}
            </h1>
            <p className="m-0 flex items-center gap-1.5 text-[0.72rem] text-[#58636b]">
              <MapPin size={16} />
              {[flat.neighborhood, flat.city, flat.state].filter(Boolean).join(" · ") || "Bairro · Cidade · UF"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="inline-flex h-11 items-center gap-2 rounded-full border border-[#0f2d3d] px-[18px] text-[0.85rem] font-semibold text-[#0f2d3d]">
              <Share2 size={18} />
              <span className="hidden @[560px]:inline">Compartilhar</span>
            </span>
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[#0f2d3d] text-white">
              <Heart size={19} />
            </span>
          </div>
        </div>

        {images.length ? (
          <>
            <div className="grid grid-cols-3 grid-rows-[250px_100px] gap-[5px] overflow-hidden rounded-[10px] @[700px]:grid-cols-[2fr_1fr_1fr] @[700px]:grid-rows-[190px_190px] @[700px]:gap-2">
              {images.slice(0, 4).map((src, i) => (
                <div
                  key={src}
                  className={`relative min-w-0 bg-[#e7dfd3] ${
                    i === 0 ? "col-span-3 @[700px]:col-span-1 @[700px]:row-span-2" : i === 3 ? "@[700px]:col-span-2" : ""
                  }`}
                >
                  <Cover src={src} alt={`Foto ${i + 1} de ${flat.title}`} />
                  {i === 0 ? (
                    <span className="absolute bottom-4 left-4 flex items-center gap-[7px] rounded-md bg-white px-[13px] py-2 text-[0.75rem] text-[#1a2830]">
                      <Images size={16} />
                      {images.length > 4 ? `Ver as ${images.length} fotos` : "Ver fotos"}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            {!flat.realPhotos ? (
              <p className="m-0 mt-4 text-[11px] leading-[1.6] text-[#58636b]">
                Imagens de ambientação geradas por IA. Solicite ao atendimento fotos atualizadas e informações do
                imóvel antes de reservar.
              </p>
            ) : null}
          </>
        ) : (
          <p className="my-6 rounded-[7px] border border-[#e5d8bb] bg-[#faf7ee] px-[19px] py-[17px] text-xs leading-[1.75] text-[#645233]">
            As fotos deste imóvel estão sendo atualizadas. Fale com o atendimento para mais informações.
          </p>
        )}

        <div className="mb-[50px] mt-[26px] grid grid-cols-1 gap-[30px] @[840px]:mb-20 @[840px]:mt-[34px] @[840px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] @[840px]:gap-[25px] @[1080px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] @[1080px]:gap-[35px]">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-[15px] border-b border-[#e4e7e6] pb-[27px] text-[0.73rem] @[840px]:gap-5 @[840px]:text-[0.8rem]">
              <span className="flex items-center gap-[7px]">
                <Users size={19} />
                Até {flat.maxGuests} hóspedes
              </span>
              <span className="flex items-center gap-[7px]">
                <BedDouble size={19} />
                {flat.bedrooms} quarto{flat.bedrooms > 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-[7px]">
                <Bath size={19} />
                {flat.bathrooms} banheiro{flat.bathrooms > 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-[7px]">
                <Ruler size={19} />
                {flat.areaSqm} m²
              </span>
            </div>

            <section className="border-b border-[#e4e7e6] py-[27px] @[840px]:py-8">
              <h2 className={H2}>Um espaço para se sentir bem.</h2>
              <p className="max-w-[640px] whitespace-pre-line text-[0.92rem] leading-[1.8] text-[#58636b] @[840px]:text-[1.04rem]">
                {flat.description || "A descrição do imóvel aparece aqui."}
              </p>
              <p className="text-[0.9rem] text-[#58636b]">
                Consulte o atendimento para confirmar as características do imóvel, o endereço e as condições
                disponíveis para sua estadia.
              </p>
            </section>

            <section className="border-b border-[#e4e7e6] py-[27px] @[840px]:py-8">
              <h2 className={H2}>O conforto está nos detalhes.</h2>
              <ul className="m-0 grid list-none grid-cols-2 gap-x-2.5 gap-y-[17px] p-0 text-[0.72rem] @[840px]:gap-[18px] @[840px]:text-[0.82rem]">
                {flat.amenities.map((a) => (
                  <li key={a} className="flex items-center gap-[9px]">
                    <Check size={18} className="shrink-0" style={{ color: GOLD_DARK }} />
                    {a}
                  </li>
                ))}
              </ul>
            </section>

            <section className="border-b border-[#e4e7e6] py-[27px] @[840px]:py-8">
              <h2 className={H2}>Seu entorno</h2>
              <p className="text-[0.9rem]">
                {flat.locationDetails ||
                  `Na região de ${flat.neighborhood || "—"}, em ${flat.city || "—"}, a proposta é estar perto da vida local: gastronomia, serviços e passeios pelo litoral. As distâncias e o endereço exato serão confirmados no catálogo oficial.`}
              </p>
              <FakeLink
                onClick={onBack}
                className="inline-flex items-center gap-[7px] text-[0.82rem] underline underline-offset-[3px]"
              >
                <span style={{ color: GOLD_DARK }} className="inline-flex items-center gap-[7px]">
                  Conheça outros flats na região <ArrowRight size={16} />
                </span>
              </FakeLink>
            </section>

            <section className="border-b border-[#e4e7e6] py-[27px] @[840px]:py-8">
              <h2 className={H2}>Antes de chegar</h2>
              <div className="grid grid-cols-1 gap-5 text-[0.83rem] @[560px]:grid-cols-2 @[840px]:gap-[30px]">
                <div>
                  <h3 className="mb-2 text-base font-semibold">Regras da estadia</h3>
                  <ul className="list-disc pl-[18px]">
                    <li className="mb-2">Check-in: {flat.checkinTime ?? "confirme com o atendimento"}.</li>
                    <li className="mb-2">Check-out: {flat.checkoutTime ?? "confirme com o atendimento"}.</li>
                    <li className="mb-2">Respeite o limite de {flat.maxGuests} hóspedes.</li>
                  </ul>
                  {flat.rules ? <p className="whitespace-pre-line">{flat.rules}</p> : null}
                </div>
                <div>
                  <h3 className="mb-2 text-base font-semibold">Solicitação e confirmação</h3>
                  <p>
                    Confirme com o atendimento a política de cancelamento e as condições específicas do imóvel antes
                    de concluir sua reserva.
                  </p>
                  <span className="inline-flex items-center gap-[7px] text-[0.82rem] underline underline-offset-[3px]" style={{ color: GOLD_DARK }}>
                    Tire suas dúvidas
                  </span>
                </div>
              </div>
            </section>
          </div>

          <aside aria-label="Planejar reserva" className="min-w-0">
            {others.map((m) => (
              <section key={m} className="mb-[25px] rounded-[10px] border border-[#e4e7e6] bg-white px-[18px] py-6 @[840px]:p-[30px]">
                <h2 className={`${display.className} mb-[19px] text-[1.7rem] font-medium leading-[1.2] @[840px]:text-[1.9rem]`}>
                  {MODALITY_LABELS[m] ?? m}
                </h2>
                <p>Valor sob consulta</p>
              </section>
            ))}

            {flat.modalidades.includes("TEMPORADA") ? (
              <div className="rounded-[10px] border border-[#e4e7e6] bg-white p-[19px] shadow-[0_12px_40px_#162d3910] @[560px]:p-[25px] @[840px]:p-[22px]">
                <div className="mb-[22px] border-b border-[#e4e7e6] pb-[23px]">
                  <span className="mb-[17px] block text-[0.6rem] font-bold uppercase tracking-[0.25em]" style={{ color: GOLD_DARK }}>
                    PLANEJE SUA ESTADIA
                  </span>
                  <div>
                    <strong className="text-[1.8rem]">{money(flat.nightly ?? 0)}</strong>
                    <span className="text-[0.76rem] text-[#58636b]"> / noite, a partir de</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 @[560px]:grid-cols-2">
                  <FakeField label="Entrada" value="dd/mm/aaaa" />
                  <FakeField label="Saída" value="dd/mm/aaaa" />
                  <FakeField label="Hóspedes" value="1 hóspede" className="@[560px]:col-span-2" />
                </div>
                <span className={`${GOLD_BUTTON} mt-5 opacity-60`}>
                  Reservar <ArrowRight size={18} />
                </span>
                <p className="mt-4 flex items-center gap-1.5 text-[0.72rem] text-[#58636b]">
                  <ShieldCheck size={15} className="shrink-0" />O pagamento é combinado com o atendimento. A confirmação
                  bloqueia o período.
                </p>
              </div>
            ) : null}

            {others.length ? (
              <div className="mt-[25px] flex flex-col gap-4 rounded-[10px] border border-[#e4e7e6] bg-white p-[19px] shadow-[0_12px_40px_#162d3910] @[560px]:p-[25px]">
                <h2 className={`${display.className} m-0 text-[1.7rem] font-medium leading-[1.2]`}>Conheça este imóvel</h2>
                <FakeField label="Como podemos ajudar?" value="Tenho interesse" />
                {others.length > 1 ? <FakeField label="Interesse em" value={MODALITY_LABELS[others[0]]} /> : null}
                <FakeField label="Nome" />
                <FakeField label="Mensagem" tall />
                <span className={GOLD_BUTTON}>
                  Preparar mensagem <ArrowRight size={17} />
                </span>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * Prévia navegável do anúncio: o card do catálogo e, ao clicar nele, a página do imóvel.
 * A navegação para aí — só card ↔ página.
 */
export function AnuncioPreview({ value, gallery }: { value: Entity; gallery: string[] }) {
  const [view, setView] = useState<"card" | "page">("card");
  const frame = useRef<HTMLDivElement>(null);
  const flat = flatFrom(value, gallery);

  const go = (next: "card" | "page") => {
    setView(next);
    // Leva o topo da "janela" para a vista: a página é bem mais alta que o card.
    requestAnimationFrame(() => frame.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  return (
    <div ref={frame} className={`${body.className} scroll-mt-4 overflow-hidden rounded-lg border border-[#dfe3e2] bg-white`}>
      {/* Barra de "navegador": deixa claro o que é prévia e onde se está. */}
      <div className="flex items-center gap-2 border-b border-[#e4e7e6] bg-[#f3f4f3] px-3 py-2">
        <button
          type="button"
          onClick={() => go("card")}
          disabled={view === "card"}
          aria-label="Voltar para o card do catálogo"
          className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full text-[#1a2830] transition-colors hover:bg-black/5 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1 truncate rounded-full bg-white px-3 py-1 text-xs text-[#58636b]">
          {view === "card" ? "/flats" : `/flats/${flat.slug || "endereco-do-anuncio"}`}
        </div>
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-[#8a682e]">Prévia</span>
      </div>

      {view === "card" ? (
        <div className="flex flex-col items-center gap-3 bg-[#f6f6f1] p-4 sm:p-8">
          <PreviewCard flat={flat} onOpen={() => go("page")} />
          <p className="text-xs text-[#58636b]">Clique no card para ver a página do imóvel.</p>
        </div>
      ) : (
        <PreviewPage flat={flat} onBack={() => go("card")} />
      )}
    </div>
  );
}
