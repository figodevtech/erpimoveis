import { z } from "zod";

export const channelConfigSchema = z.object({
  imovel_id: z.number().int().positive(),
  canal: z.enum(["AIRBNB", "BOOKING"]),
  anuncio: z.string().trim().max(200).default(""),
  responsavel: z.string().trim().max(200).default(""),
  calendario_url: z.string().trim().max(2048).url().superRefine((value, ctx) => {
    let url: URL;
    try { url = new URL(value); } catch { return; }
    const channelHost = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
        !["www.airbnb.com", "airbnb.com", "ical.booking.com"].includes(channelHost)) {
      ctx.addIssue({ code: "custom", message: "Use o link HTTPS de exportação do Airbnb ou ical.booking.com." });
    }
  }),
  exportacao_confirmada: z.boolean().default(false),
}).superRefine((value, ctx) => {
  let url: URL;
  try { url = new URL(value.calendario_url); } catch { return; }
  const valid = value.canal === "AIRBNB"
    ? ["www.airbnb.com", "airbnb.com"].includes(url.hostname) && /^\/calendar\/ical\/[^/]+\.ics$/.test(url.pathname)
    : url.hostname === "ical.booking.com" && url.pathname.startsWith("/v1/export");
  if (!valid) ctx.addIssue({ code: "custom", path: ["calendario_url"], message: "O link precisa ser o calendário exportado pelo canal escolhido, não a página do anúncio." });
});
