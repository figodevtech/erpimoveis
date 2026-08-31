export type ShopeeLogisticsChannel = {
  id: number;
  name: string;
  enabled: boolean;
  compulsory: boolean;
  minWeight: number | null;
  maxWeight: number | null;
  maxLength: number | null;
  maxWidth: number | null;
  maxHeight: number | null;
  raw: Record<string, unknown>;
};

export type ShopeeAttributeDefinition = {
  id: number;
  name: string;
  required: boolean;
  inputType: string;
  inputTypeCode: number | null;
  maxValueCount: number;
  allowCustomValue: boolean;
  units: string[];
  values: Array<{ id: number | null; name: string; originalName: string; unit: string | null }>;
  raw: Record<string, unknown>;
};

export function normalizeShopeeLogisticsChannel(channel: any): ShopeeLogisticsChannel | null {
  const id = Number(channel?.logistics_channel_id ?? channel?.logistic_id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const dimensions = channel?.item_max_dimension ?? {};
  const weight = channel?.weight_limit ?? {};
  return {
    id,
    name: String(channel?.logistics_channel_name ?? channel?.logistic_name ?? `Canal ${id}`).trim(),
    enabled: channel?.enabled !== false,
    compulsory: Boolean(channel?.compulsory_channel),
    minWeight: nullablePositiveOrZero(weight?.item_min_weight),
    maxWeight: nullablePositive(weight?.item_max_weight),
    maxLength: nullablePositive(dimensions?.length),
    maxWidth: nullablePositive(dimensions?.width),
    maxHeight: nullablePositive(dimensions?.height),
    raw: channel ?? {},
  };
}

export function normalizeShopeeAttribute(attribute: any, language = "pt-BR"): ShopeeAttributeDefinition | null {
  const id = Number(attribute?.attribute_id ?? attribute?.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const info = attribute?.attribute_info ?? {};
  const inputTypeCode = finiteInteger(info?.input_type ?? attribute?.input_type);
  const maxValueCount = Math.max(1, finiteInteger(info?.max_value_count ?? attribute?.max_value_count) ?? 1);
  const rawValues = Array.isArray(attribute?.attribute_value_list) ? attribute.attribute_value_list : Array.isArray(attribute?.values) ? attribute.values : [];
  const values = rawValues.map((value: any) => {
    const originalName = String(value?.original_value_name ?? value?.value_name ?? value?.name ?? "").trim();
    return {
      id: nullableInteger(value?.value_id ?? value?.id),
      name: localizedValue(value, language) || String(value?.display_value_name ?? originalName).trim(),
      originalName,
      unit: String(value?.value_unit ?? value?.unit ?? "").trim() || null,
    };
  }).filter((value: { name: string }) => value.name);
  const units = Array.from(new Set((attribute?.attribute_unit ?? attribute?.unit_list ?? [])
    .map((unit: any) => String(unit?.value_unit ?? unit?.unit ?? unit ?? "").trim())
    .filter(Boolean))) as string[];
  return {
    id,
    name: localizedValue(attribute, language) || String(attribute?.display_attribute_name ?? attribute?.original_attribute_name ?? attribute?.attribute_name ?? attribute?.name ?? id).trim(),
    required: Boolean(attribute?.is_mandatory ?? attribute?.mandatory ?? attribute?.required),
    inputType: inputTypeLabel(inputTypeCode, maxValueCount, values.length),
    inputTypeCode,
    maxValueCount,
    allowCustomValue: Boolean(attribute?.is_customized ?? attribute?.allow_custom_value ?? values.length === 0),
    units,
    values,
    raw: attribute ?? {},
  };
}

export function buildShopeeAttributeList(definitions: ShopeeAttributeDefinition[], values: Record<string, unknown>) {
  return definitions.flatMap((attribute) => {
    const rawValue = values[String(attribute.id)];
    const enteredValues = Array.isArray(rawValue)
      ? rawValue.map(String)
      : String(rawValue ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (!enteredValues.length) return [];
    const attributeValues = enteredValues.slice(0, attribute.maxValueCount).map((entered) => {
      const selected = attribute.values.find((option) => String(option.id) === entered || option.originalName === entered || option.name === entered);
      if (selected) {
        return {
          ...(selected.id !== null ? { value_id: selected.id } : {}),
          original_value_name: selected.originalName || selected.name,
          ...(selected.unit ? { value_unit: selected.unit } : {}),
        };
      }
      const unit = String(values[`${attribute.id}__unit`] ?? attribute.units[0] ?? "").trim();
      return { original_value_name: entered, ...(unit ? { value_unit: unit } : {}) };
    });
    return [{ attribute_id: attribute.id, attribute_value_list: attributeValues }];
  });
}

export function validateShopeePackage(params: {
  weight: number;
  length: number;
  width: number;
  height: number;
  channels: ShopeeLogisticsChannel[];
}) {
  const errors: string[] = [];
  for (const channel of params.channels) {
    if (!channel.enabled) errors.push(`${channel.name} não está habilitado para a loja.`);
    if (channel.minWeight !== null && params.weight < channel.minWeight) errors.push(`${channel.name} exige peso mínimo de ${channel.minWeight} kg.`);
    if (channel.maxWeight !== null && params.weight > channel.maxWeight) errors.push(`${channel.name} aceita no máximo ${channel.maxWeight} kg.`);
    if (channel.maxLength !== null && params.length > channel.maxLength) errors.push(`${channel.name} aceita comprimento máximo de ${channel.maxLength} cm.`);
    if (channel.maxWidth !== null && params.width > channel.maxWidth) errors.push(`${channel.name} aceita largura máxima de ${channel.maxWidth} cm.`);
    if (channel.maxHeight !== null && params.height > channel.maxHeight) errors.push(`${channel.name} aceita altura máxima de ${channel.maxHeight} cm.`);
  }
  return errors;
}

export function validateShopeeListingLimits(params: {
  title: string;
  description: string;
  price: number;
  stock: number;
  imageCount: number;
  limits: any;
}) {
  const errors: string[] = [];
  validateRange("O título", params.title.length, params.limits?.item_name_length_limit, "caracteres", errors);
  validateRange("A descrição", params.description.length, params.limits?.item_description_length_limit, "caracteres", errors);
  validateRange("O preço", params.price, params.limits?.price_limit, "", errors);
  validateRange("O estoque", params.stock, params.limits?.stock_limit, "unidades", errors);
  validateRange("A quantidade de imagens", params.imageCount, params.limits?.item_image_count_limit, "imagens", errors);
  return errors;
}

function localizedValue(value: any, language: string) {
  const target = language.toLowerCase();
  const localized = (Array.isArray(value?.multi_lang) ? value.multi_lang : []).find((entry: any) => String(entry?.language ?? "").toLowerCase() === target);
  return String(localized?.value ?? "").trim();
}

function inputTypeLabel(code: number | null, maxValueCount: number, optionCount: number) {
  if (maxValueCount > 1) return "MULTI_SELECT";
  if (optionCount > 0) return "SELECT";
  return ({ 2: "SELECT", 3: "TEXT", 4: "MULTI_SELECT", 5: "TEXT" } as Record<number, string>)[code ?? -1] ?? "TEXT";
}

function finiteInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function nullableInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function nullablePositive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nullablePositiveOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validateRange(label: string, value: number, limit: any, unit: string, errors: string[]) {
  const min = Number(limit?.min_limit);
  const max = Number(limit?.max_limit);
  const suffix = unit ? ` ${unit}` : "";
  if (Number.isFinite(min) && value < min) errors.push(`${label} deve ter no mínimo ${min}${suffix}.`);
  if (Number.isFinite(max) && value > max) errors.push(`${label} deve ter no máximo ${max}${suffix}.`);
}
