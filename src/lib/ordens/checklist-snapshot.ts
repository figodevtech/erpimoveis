import type { ChecklistCampo } from "./checklist-documento";
import { resolveOrdemVehicle } from "./vehicle-snapshot";

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function field(rotulo: string, value: unknown): ChecklistCampo | null {
  const valor = text(value);
  return valor ? { rotulo, valor } : null;
}

function fields(...values: Array<ChecklistCampo | null>) {
  return values.filter((value): value is ChecklistCampo => Boolean(value));
}

export function buildChecklistObjectSnapshot(os: any) {
  const type = String(os.alvo_tipo ?? (first(os.veiculo) ? "VEICULO" : first(os.peca) ? "PECA" : "OUTRO"));
  if (type === "VEICULO") {
    const linked = first<any>(os.veiculo);
    const vehicle = resolveOrdemVehicle(linked, os.veiculo_snapshot);
    const title = [vehicle?.marca, vehicle?.modelo].map(text).filter(Boolean).join(" ") || text(vehicle?.placa) || "Veículo";
    return {
      tipo: "VEICULO",
      titulo: title,
      campos: fields(
        field("Placa", vehicle?.placa),
        field("Marca", vehicle?.marca),
        field("Modelo", vehicle?.modelo),
        field("Ano de fabricação", vehicle?.ano),
        field("Ano/modelo", vehicle?.ano_modelo),
        field("Cor", vehicle?.cor),
        field("Quilometragem", vehicle?.kmatual),
        field("Chassi", vehicle?.chassi),
        field("Renavam", vehicle?.renavam),
        field("Combustível", vehicle?.combustivel),
        field("Descrição", vehicle?.descricao_veiculo),
      ),
    };
  }
  if (type === "PECA") {
    const part = first<any>(os.peca);
    return {
      tipo: "PECA",
      titulo: text(part?.titulo) ?? "Peça",
      campos: fields(
        field("Peça", part?.titulo),
        field("Descrição", part?.descricao),
        field("Lacre", part?.lacre),
      ),
    };
  }
  if (type === "EQUIPAMENTO") {
    return {
      tipo: "EQUIPAMENTO",
      titulo: text(os.equipamento_nome) ?? "Equipamento",
      campos: fields(
        field("Equipamento", os.equipamento_nome),
        field("Patrimônio", os.equipamento_patrimonio),
        field("Ano", os.equipamento_ano),
        field("Horímetro", os.equipamento_horimetro),
      ),
    };
  }
  return {
    tipo: type || "OUTRO",
    titulo: text(os.descricao) ?? "Objeto inspecionado",
    campos: fields(field("Descrição", os.descricao)),
  };
}
