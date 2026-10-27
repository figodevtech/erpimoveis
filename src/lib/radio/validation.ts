import { z } from "zod";

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.string().trim().max(max).nullable(),
  );

const nullableHttpUrl = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z
    .string()
    .trim()
    .url()
    .max(2_048)
    .refine((value) => {
      try { return ["http:", "https:"].includes(new URL(value).protocol); }
      catch { return false; }
    }, "Use uma URL HTTP ou HTTPS.")
    .nullable(),
);

const slug = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug invalido.");

const radioFields = {
  name: z.string().trim().min(1).max(160),
  slug: slug.optional(),
  type: z.enum(["RADIO", "THEMATIC"]),
  frequency: nullableText(40),
  city: nullableText(100),
  state: nullableText(40),
  country: z.string().trim().min(1).max(80),
  neighborhood: nullableText(120),
  description: nullableText(1_000),
  genres: z.array(z.string().trim().min(1).max(60)).max(20),
  logoUrl: nullableHttpUrl,
  websiteUrl: nullableHttpUrl,
  sourcePage: nullableHttpUrl,
  streamUrl: nullableHttpUrl,
  playlistUrl: nullableHttpUrl,
  playlistFormat: z.enum(["M3U", "M3U8", "PLS"]).nullable(),
  active: z.boolean(),
  notes: nullableText(1_000),
};

export const radioCreateSchema = z
  .object({
    ...radioFields,
    type: radioFields.type.default("RADIO"),
    frequency: radioFields.frequency.default(null),
    city: radioFields.city.default(null),
    state: radioFields.state.default(null),
    country: radioFields.country.default("Brasil"),
    neighborhood: radioFields.neighborhood.default(null),
    description: radioFields.description.default(null),
    genres: radioFields.genres.default([]),
    logoUrl: radioFields.logoUrl.default(null),
    websiteUrl: radioFields.websiteUrl.default(null),
    sourcePage: radioFields.sourcePage.default(null),
    streamUrl: radioFields.streamUrl.default(null),
    playlistUrl: radioFields.playlistUrl.default(null),
    playlistFormat: radioFields.playlistFormat.default(null),
    active: radioFields.active.default(true),
    notes: radioFields.notes.default(null),
  })
  .superRefine((value, context) => {
    if (value.active && !value.streamUrl && !value.playlistUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["streamUrl"],
        message: "Informe streamUrl ou playlistUrl para uma radio ativa.",
      });
    }
  });

// PATCH nao aplica defaults de criacao aos campos ausentes.
export const radioPatchSchema = z.object(radioFields).partial().refine(
  (value) => Object.keys(value).length > 0,
  "Informe ao menos um campo para atualizar.",
);

export const radioTestSchema = z
  .object({
    url: nullableHttpUrl.optional().default(null),
    streamUrl: nullableHttpUrl.optional().default(null),
    playlistUrl: nullableHttpUrl.optional().default(null),
  })
  .refine((value) => Boolean(value.url || value.streamUrl || value.playlistUrl), {
    message: "Informe url, streamUrl ou playlistUrl.",
  });

export const radioListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  search: z.string().trim().max(100).optional().default(""),
  name: z.string().trim().max(160).optional(),
  frequency: z.string().trim().max(40).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(40).optional(),
  genre: z.string().trim().max(60).optional(),
  active: z.enum(["true", "false"]).optional(),
  systemDefault: z.enum(["true", "false"]).optional(),
  type: z.enum(["RADIO", "THEMATIC"]).optional(),
});

export type RadioCreateInput = z.infer<typeof radioCreateSchema>;
export type RadioPatchInput = z.infer<typeof radioPatchSchema>;
export type RadioListQuery = z.infer<typeof radioListQuerySchema>;

export function slugifyRadioName(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}
