import { createHash } from "node:crypto";
import type {
  ChecklistDocumentoMudancas,
  ChecklistSnapshotItem,
  ChecklistSnapshotV1,
} from "./checklist-documento";

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function sha256(value: string | Buffer | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function snapshotHash(snapshot: ChecklistSnapshotV1) {
  return sha256(stableJson(snapshot));
}

export function conteudoDoSnapshot(snapshot: ChecklistSnapshotV1) {
  const content: Partial<ChecklistSnapshotV1> = { ...snapshot };
  delete content.documento;
  return content;
}

export function conteudoHash(snapshot: ChecklistSnapshotV1) {
  return sha256(stableJson(conteudoDoSnapshot(snapshot)));
}

function itemComparable(item: ChecklistSnapshotItem) {
  return {
    titulo: item.titulo,
    descricao: item.descricao,
    categoria: item.categoria,
    ordem: item.ordem,
    resposta: item.resposta,
    observacao: item.observacao,
    responsavel: item.responsavel,
    fotos: item.fotos.map((foto) => ({
      sha256: foto.sha256,
      descricao: foto.descricao,
      registradoEm: foto.registradoEm,
    })),
  };
}

export function resumirMudancas(
  atual: ChecklistSnapshotV1,
  anterior: ChecklistSnapshotV1 | null,
): ChecklistDocumentoMudancas {
  if (!anterior) {
    return {
      primeiraVersao: true,
      conteudoIdentico: false,
      adicionados: atual.checklist.itens.map((item) => item.titulo),
      removidos: [],
      alterados: [],
      fotosAdicionadas: atual.checklist.itens.reduce((sum, item) => sum + item.fotos.length, 0),
      fotosRemovidas: 0,
    };
  }

  const byKey = (items: ChecklistSnapshotItem[]) =>
    new Map(items.map((item, index) => [`${item.origemId}:${index}`, item]));
  const oldItems = byKey(anterior.checklist.itens);
  const newItems = byKey(atual.checklist.itens);
  const adicionados: string[] = [];
  const removidos: string[] = [];
  const alterados: string[] = [];

  for (const [key, item] of newItems) {
    const old = oldItems.get(key);
    if (!old) adicionados.push(item.titulo);
    else if (stableJson(itemComparable(old)) !== stableJson(itemComparable(item))) alterados.push(item.titulo);
  }
  for (const [key, item] of oldItems) {
    if (!newItems.has(key)) removidos.push(item.titulo);
  }

  const oldPhotos = anterior.checklist.itens.reduce((sum, item) => sum + item.fotos.length, 0);
  const newPhotos = atual.checklist.itens.reduce((sum, item) => sum + item.fotos.length, 0);

  return {
    primeiraVersao: false,
    conteudoIdentico: conteudoHash(atual) === conteudoHash(anterior),
    adicionados,
    removidos,
    alterados,
    fotosAdicionadas: Math.max(0, newPhotos - oldPhotos),
    fotosRemovidas: Math.max(0, oldPhotos - newPhotos),
  };
}
