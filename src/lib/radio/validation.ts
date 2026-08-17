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
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Use uma URL HTTP ou HTTPS.")
    .nullable(),
);

const slug = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug invalido.");

export const radioCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    slug: slug.optional(),
    type: z.enum(["RADIO", "THEMATIC"]).optional().default("RADIO"),
    frequency: nullableText(40).optional().default(null),
    city: nullableText(100).optional().default(null),
    state: nullableText(40).optional().default(null),
    country: z.string().trim().min(1).max(80).optional().default("Brasil"),
    neighborhood: nullableText(120).optional().default(null),
    description: nullableText(1_000).optional().default(null),
    genres: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
    logoUrl: nullableHttpUrl.optional().default(null),
    websiteUrl: nullableHttpUrl.optional().default(null),
    sourcePage: nullableHttpUrl.optional().default(null),
    streamUrl: nullableHttpUrl.optional().default(null),
    playlistUrl: nullableHttpUrl.optional().default(null),
    playlistFormat: z.enum(["M3U", "M3U8", "PLS"]).nullable().optional().default(null),
    active: z.boolean().optional().default(true),
    notes: nullableText(1_000).optional().default(null),
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

export const radioPatchSchema = radioCreateSchema._def.schema.partial().refine(
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
