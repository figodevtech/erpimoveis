type LinhaGarantiaNfe = {
  incluir_garantia_venda?: unknown;
  incluir_garantia_os?: unknown;
} | null | undefined;

type EntradaGarantiaNfe = {
  incluirGarantiaVendaNFe?: unknown;
  incluirGarantiaVendaNFCe?: unknown;
  incluirGarantiaOsNFe?: unknown;
  incluirGarantiaOsNFCe?: unknown;
};

function booleanoInformado(valor: unknown): boolean | undefined {
  return typeof valor === "boolean" ? valor : undefined;
}

/** Parte pública do GET /api/config/nfe relativa à garantia. */
export function serializarConfigGarantiaNfe(
  nfe: LinhaGarantiaNfe,
  nfce: LinhaGarantiaNfe,
) {
  return {
    incluirGarantiaVendaNFe: Boolean(nfe?.incluir_garantia_venda),
    incluirGarantiaVendaNFCe: Boolean(nfce?.incluir_garantia_venda),
    incluirGarantiaOsNFe: Boolean(nfe?.incluir_garantia_os),
    incluirGarantiaOsNFCe: Boolean(nfce?.incluir_garantia_os),
  };
}

/** Patches independentes das linhas NFE e NFCE usados pelo PUT de configuração. */
export function prepararPatchesGarantiaNfe(entrada: EntradaGarantiaNfe) {
  const vendaNFe = booleanoInformado(entrada.incluirGarantiaVendaNFe);
  const vendaNFCe = booleanoInformado(entrada.incluirGarantiaVendaNFCe);
  const osNFe = booleanoInformado(entrada.incluirGarantiaOsNFe);
  const osNFCe = booleanoInformado(entrada.incluirGarantiaOsNFCe);

  return {
    nfe: {
      ...(vendaNFe !== undefined ? { incluir_garantia_venda: vendaNFe } : {}),
      ...(osNFe !== undefined ? { incluir_garantia_os: osNFe } : {}),
    },
    nfce: {
      ...(vendaNFCe !== undefined ? { incluir_garantia_venda: vendaNFCe } : {}),
      ...(osNFCe !== undefined ? { incluir_garantia_os: osNFCe } : {}),
    },
  };
}

/** Parte pública do GET /api/config/nfse relativa à garantia. */
export function serializarConfigGarantiaNfse(
  linha: { incluir_garantia_os?: unknown } | null | undefined,
) {
  return { incluirGarantiaOs: Boolean(linha?.incluir_garantia_os) };
}

/** Patch opcional do PUT /api/config/nfse; campo omitido não altera o gravado. */
export function prepararPatchGarantiaNfse(
  entrada: { incluirGarantiaOs?: unknown },
) {
  const incluir = booleanoInformado(entrada.incluirGarantiaOs);
  return incluir === undefined ? {} : { incluir_garantia_os: incluir };
}
