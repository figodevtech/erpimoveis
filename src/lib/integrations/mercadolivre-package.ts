export type MercadoLivrePackageSnapshot = {
  package_length_cm: number | null;
  package_width_cm: number | null;
  package_height_cm: number | null;
  package_weight_grams: number | null;
};

function positiveNumber(value: unknown) {
  const normalized = typeof value === "string"
    ? value.replace(",", ".").match(/[\d.]+/)?.[0]
    : value;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function attributeNumber(attributes: unknown, id: string) {
  if (!Array.isArray(attributes)) return null;
  const attribute = attributes.find((entry: any) => String(entry?.id ?? "").toUpperCase() === id);
  return positiveNumber(attribute?.value_struct?.number ?? attribute?.value_name);
}

/** Reads LxWxH,W shipping dimensions and falls back to SELLER_PACKAGE_* attributes. */
export function extractMercadoLivrePackageSnapshot(item: any): MercadoLivrePackageSnapshot {
  const rawDimensions = String(item?.shipping?.dimensions ?? "").trim();
  const match = rawDimensions.match(/^([\d.,]+)x([\d.,]+)x([\d.,]+),([\d.,]+)$/i);
  const length = positiveNumber(match?.[1]);
  const width = positiveNumber(match?.[2]);
  const height = positiveNumber(match?.[3]);
  const weight = positiveNumber(match?.[4]);

  return {
    package_length_cm: length ?? attributeNumber(item?.attributes, "SELLER_PACKAGE_LENGTH"),
    package_width_cm: width ?? attributeNumber(item?.attributes, "SELLER_PACKAGE_WIDTH"),
    package_height_cm: height ?? attributeNumber(item?.attributes, "SELLER_PACKAGE_HEIGHT"),
    package_weight_grams: weight ?? attributeNumber(item?.attributes, "SELLER_PACKAGE_WEIGHT"),
  };
}
