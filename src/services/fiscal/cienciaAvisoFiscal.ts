// Ciência de avisos fiscais registrada pelo servidor (tabela nfe_ciencia_aviso).
//
// O fingerprint (`chaveCiencia`) prova que uma confirmação é da situação atual,
// mas é calculável no navegador: sozinho não prova que alguém clicou em "estou
// ciente". Por isso a ciência deixou de viajar no payload da NF-e. O clique
// chama POST /api/fiscal/nfe/ciencias, que roda o mesmo motor da emissão em modo
// de registro e grava aqui só avisos pendentes de verdade, com quem, quando e
// sob qual regra. Salvar o rascunho consulta esta tabela.

import { chaveCiencia, type CienciaRegistrada, type PedidoCiencia } from "@/lib/nfe/issuesFiscais";
import type { IcmsIssue } from "@/lib/nfe/icms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const TABELA = "nfe_ciencia_aviso";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type { PedidoCiencia };

/** Só a rota de ciência monta isto: é ela que conhece o usuário autenticado. */
export type RegistroDeCiencia = { atorId: string; pedidos: PedidoCiencia[] };

export type ResultadoRegistroCiencia = {
  registradas: Array<PedidoCiencia & { id: number }>;
  jaRegistradas: PedidoCiencia[];
  recusadas: Array<PedidoCiencia & { motivo: string }>;
};

/** Ciências registradas por item (`item_ref`) e chave `code@fingerprint`. */
export type CienciasPorItem = Map<string, Map<string, CienciaRegistrada>>;

type LinhaCiencia = {
  id: number;
  item_ref: string;
  code: string;
  fingerprint: string;
  usuario_id: string;
  confirmado_em: string;
};

export function escopoCienciaValido(valor: unknown): string | null {
  const texto = String(valor ?? "").trim();
  return UUID.test(texto) ? texto.toLowerCase() : null;
}

/** Identidade do item na nota: o sourceItemId da origem, ou a posição na avulsa. */
export function itemRefDaCiencia(item: { sourceItemId?: string | null }, index: number) {
  return String(item.sourceItemId ?? "").trim() || `#${index}`;
}

/**
 * Ciências válidas para este salvamento: as da sessão de emissão e as já
 * ligadas à NF-e que está sendo editada (reabertura, correção de rejeitada).
 */
export async function carregarCiencias(filtro: {
  escopo: string | null;
  nfeId?: number | null;
}): Promise<CienciasPorItem> {
  const linhas: LinhaCiencia[] = [];
  const colunas = "id, item_ref, code, fingerprint, usuario_id, confirmado_em";
  if (filtro.escopo) {
    const { data, error } = await supabaseAdmin.from(TABELA).select(colunas).eq("escopo", filtro.escopo);
    if (error) throw error;
    linhas.push(...((data ?? []) as LinhaCiencia[]));
  }
  if (filtro.nfeId) {
    const { data, error } = await supabaseAdmin.from(TABELA).select(colunas).eq("nfe_id", filtro.nfeId);
    if (error) throw error;
    linhas.push(...((data ?? []) as LinhaCiencia[]));
  }

  const porItem: CienciasPorItem = new Map();
  for (const linha of linhas) {
    const doItem = porItem.get(linha.item_ref) ?? new Map<string, CienciaRegistrada>();
    doItem.set(`${linha.code}@${linha.fingerprint}`, {
      id: Number(linha.id),
      usuarioId: linha.usuario_id,
      confirmadoEm: linha.confirmado_em,
    });
    porItem.set(linha.item_ref, doItem);
  }
  return porItem;
}

/**
 * Grava a ciência de cada pedido que corresponde a um aviso que o servidor
 * acabou de calcular para aquele item. Pedido de aviso inexistente, de outra
 * situação (fingerprint diferente) ou de INFO/BLOQUEIO é recusado.
 */
export async function registrarCiencias(input: {
  escopo: string;
  atorId: string;
  nfeId?: number | null;
  origemTipo: string;
  origemId?: number | null;
  versaoRegra: string;
  itens: Array<{ itemRef: string; avisos: IcmsIssue[] }>;
  registradas: CienciasPorItem;
  pedidos: PedidoCiencia[];
}): Promise<ResultadoRegistroCiencia> {
  const resultado: ResultadoRegistroCiencia = { registradas: [], jaRegistradas: [], recusadas: [] };
  const novas: Array<{ pedido: PedidoCiencia; linha: Record<string, unknown> }> = [];
  const vistas = new Set<string>();

  for (const pedido of input.pedidos) {
    const item = Number.isInteger(pedido.itemIndex) ? input.itens[pedido.itemIndex] : undefined;
    if (!item) {
      resultado.recusadas.push({ ...pedido, motivo: "Item inexistente na nota." });
      continue;
    }
    const aviso = item.avisos.find(
      (candidato) => candidato.code === pedido.code && candidato.fingerprint === pedido.fingerprint,
    );
    const chave = aviso ? chaveCiencia(aviso) : null;
    if (!aviso || !chave) {
      resultado.recusadas.push({
        ...pedido,
        motivo: "O servidor não encontrou este aviso pendente para o item com os dados atuais.",
      });
      continue;
    }
    const identidade = `${item.itemRef}|${chave}`;
    if (vistas.has(identidade)) continue;
    vistas.add(identidade);
    if (input.registradas.get(item.itemRef)?.has(chave)) {
      resultado.jaRegistradas.push(pedido);
      continue;
    }
    novas.push({
      pedido,
      linha: {
        escopo: input.escopo,
        nfe_id: input.nfeId ?? null,
        origem_tipo: input.origemTipo,
        origem_id: input.origemId ?? null,
        item_ref: item.itemRef,
        item_numero: pedido.itemIndex + 1,
        code: aviso.code,
        fingerprint: aviso.fingerprint,
        versao_regra: input.versaoRegra,
        // Mensagem, fontes e dados como o servidor os calculou.
        mensagem: aviso.message,
        fontes: aviso.fontes ?? [],
        dados: aviso.dadosFingerprint ?? {},
        usuario_id: input.atorId,
      },
    });
  }

  for (const { pedido, linha } of novas) {
    const { data, error } = await supabaseAdmin.from(TABELA).insert(linha).select("id").single();
    if (error) {
      // Dois cliques simultâneos: o índice único já guardou a mesma ciência.
      if ((error as { code?: string }).code === "23505") {
        resultado.jaRegistradas.push(pedido);
        continue;
      }
      throw error;
    }
    resultado.registradas.push({ ...pedido, id: Number((data as { id: number }).id) });
  }
  return resultado;
}

/** Depois do salvamento, a ciência da sessão fica ligada à NF-e que a usou. */
export async function vincularCienciasANfe(escopo: string | null, nfeId: number) {
  if (!escopo) return;
  const { error } = await supabaseAdmin
    .from(TABELA)
    .update({ nfe_id: nfeId })
    .eq("escopo", escopo)
    .is("nfe_id", null);
  if (error) throw error;
}
