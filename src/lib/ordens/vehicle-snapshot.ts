export type OrdemVehicleSnapshot = {
  placa?: string | null;
  marca?: string | null;
  modelo?: string | null;
  ano_fabricacao?: number | null;
  ano_modelo?: number | null;
  chassi?: string | null;
  renavam?: string | null;
  cor?: string | null;
  combustivel?: string | null;
  km?: number | null;
  descricao_veiculo?: string | null;
};

type LinkedVehicle = {
  id?: number | null;
  placa?: string | null;
  placa_formatada?: string | null;
  marca?: string | null;
  modelo?: string | null;
  ano?: number | null;
  ano_modelo?: number | null;
  cor?: string | null;
  kmatual?: number | null;
  chassi?: string | null;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseOrdemVehicleSnapshot(value: unknown): OrdemVehicleSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const placa = text(raw.placa);
  if (!placa) return null;

  return {
    placa,
    marca: text(raw.marca),
    modelo: text(raw.modelo),
    ano_fabricacao: number(raw.ano_fabricacao),
    ano_modelo: number(raw.ano_modelo),
    chassi: text(raw.chassi),
    renavam: text(raw.renavam),
    cor: text(raw.cor),
    combustivel: text(raw.combustivel),
    km: number(raw.km),
    descricao_veiculo: text(raw.descricao_veiculo),
  };
}

/**
 * Em uma OS migrada, o snapshot e a fonte historica. O cadastro atual entra
 * apenas com o id navegavel e como fallback para campos ausentes na exportacao.
 */
export function resolveOrdemVehicle(linked: LinkedVehicle | null | undefined, snapshotValue: unknown) {
  const snapshot = parseOrdemVehicleSnapshot(snapshotValue);
  if (!snapshot) {
    if (!linked) return null;
    return {
      id: linked.id ?? null,
      placa: linked.placa ?? null,
      placa_formatada: linked.placa_formatada ?? null,
      marca: linked.marca ?? null,
      modelo: linked.modelo ?? null,
      ano: linked.ano ?? null,
      ano_modelo: linked.ano_modelo ?? null,
      cor: linked.cor ?? null,
      kmatual: linked.kmatual ?? null,
      chassi: linked.chassi ?? null,
      renavam: null,
      combustivel: null,
      descricao_veiculo: null,
      historico: false,
    };
  }

  return {
    id: linked?.id ?? null,
    placa: snapshot.placa ?? linked?.placa ?? null,
    placa_formatada: linked?.placa_formatada ?? null,
    marca: snapshot.marca ?? linked?.marca ?? null,
    modelo: snapshot.modelo ?? linked?.modelo ?? null,
    ano: snapshot.ano_fabricacao ?? linked?.ano ?? null,
    ano_modelo: snapshot.ano_modelo ?? linked?.ano_modelo ?? null,
    cor: snapshot.cor ?? linked?.cor ?? null,
    kmatual: snapshot.km ?? linked?.kmatual ?? null,
    chassi: snapshot.chassi ?? linked?.chassi ?? null,
    renavam: snapshot.renavam ?? null,
    combustivel: snapshot.combustivel ?? null,
    descricao_veiculo: snapshot.descricao_veiculo ?? null,
    historico: true,
  };
}
