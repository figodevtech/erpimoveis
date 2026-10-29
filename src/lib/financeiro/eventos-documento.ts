import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { analisarExclusaoEventoFinanceiro } from "@/lib/ordens/exclusao-evento-financeiro";
import { mesesDeCompetenciaFechada } from "@/lib/financeiro/eventos-financeiros/competencia";
import {
  analisarExclusaoDoEvento, editarEventoDaOs, excluirEventoDaOs,
  idValido, type Resultado,
} from "@/lib/financeiro/eventos-financeiros/servico";
import type { DocumentoFinanceiro } from "./documento-evento";

export async function documentoDoEvento(eventoId: number): Promise<Resultado<DocumentoFinanceiro>> {
  const { data, error } = await supabaseAdmin.from("eventos_financeiros")
    .select("ordemservicoid,source_type,source_id").eq("id", eventoId).maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: "Evento financeiro não encontrado.", status: 404 };
  const osId = idValido(data.ordemservicoid);
  if (osId) return { ok: true, corpo: { tipo: "ORDEM_SERVICO", id: osId } };
  const vendaId = idValido(data.source_id);
  if (data.source_type === "VENDA" && vendaId) return { ok: true, corpo: { tipo: "VENDA", id: vendaId } };
  return { ok: false, error: "Este evento não pertence a uma OS ou venda.", status: 409 };
}

export function resultadoRpc(error: { code?: string; message: string }) {
  return { ok: false as const, error: error.message,
    status: error.code === "P0002" ? 404 : ["22023", "22P02"].includes(error.code ?? "") ? 400
      : error.code === "P0001" ? 409 : 500 };
}

export async function criarEventoDaVenda(vendaId: number, body: any, usuarioId: string) {
  // Payload discriminado: uma receita vinculada nunca vira avulso por acidente.
  if (body?.modalidade === "AVULSO" && (body.eventoReceitaId != null || body.eventoReceitaServicoId != null)) {
    return { ok: false as const, error: "Um evento avulso não aceita vínculo de receita.", status: 400 };
  }
  const { data, error } = await supabaseAdmin.rpc("criar_evento_financeiro_manual_venda", {
    p_venda_id: vendaId, p_natureza: body?.natureza ?? null, p_tipo: body?.tipo ?? null,
    p_descricao: typeof body?.descricao === "string" ? body.descricao : null,
    p_detalhe: typeof body?.detalhe === "string" ? body.detalhe : null,
    p_valor: Number.isFinite(Number(body?.valor)) ? Number(body.valor) : null, p_usuario: usuarioId,
  });
  return error ? resultadoRpc(error) : { ok: true as const, corpo: { evento: data } };
}

async function impactoDaVenda(vendaId: number, eventoId: number) {
  const [{ data: venda, error: vendaError }, { data: evento, error }] = await Promise.all([
    supabaseAdmin.from("venda").select("id").eq("id", vendaId).maybeSingle(),
    supabaseAdmin.from("eventos_financeiros").select("*").eq("id", eventoId)
      .eq("source_type", "VENDA").eq("source_id", vendaId).is("ordemservicoid", null).maybeSingle(),
  ]);
  if (error || vendaError) throw error || vendaError;
  if (!venda || !evento) return { ok: false as const, error: "Venda ou evento financeiro não encontrado.", status: 404 };
  return { ok: true as const, corpo: { impacto: analisarExclusaoEventoFinanceiro(evento, {
    documentoTipo: "VENDA", mesesFechados: mesesDeCompetenciaFechada([evento.competencia_em]),
  }) } };
}

export async function analisarExclusaoDoDocumento(documento: DocumentoFinanceiro, eventoId: number) {
  return documento.tipo === "ORDEM_SERVICO"
    ? analisarExclusaoDoEvento(documento.id, eventoId) : impactoDaVenda(documento.id, eventoId);
}

export async function editarEventoDoDocumento(documento: DocumentoFinanceiro, eventoId: number, body: any, usuarioId: string | null) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false as const, error: "Informe os dados do evento financeiro.", status: 400 };
  }
  if (documento.tipo === "ORDEM_SERVICO") return editarEventoDaOs(documento.id, eventoId, body, usuarioId);
  const valor = Number(body?.valor);
  if (body.valor == null || !["string", "number"].includes(typeof body.valor)
    || (typeof body.valor === "string" && !body.valor.trim())
    || !Number.isFinite(valor) || valor < 0) return { ok: false as const, error: "Informe um valor válido, igual ou maior que zero.", status: 400 };
  const { data, error } = await supabaseAdmin.rpc("editar_evento_financeiro_venda", {
    p_venda_id: documento.id, p_evento_id: eventoId,
    p_payload: { valor, ...(body.descricao !== undefined ? { descricao: String(body.descricao ?? "") } : {}),
      ...(body.detalhe !== undefined ? { detalhe: body.detalhe } : {}) }, p_usuario: usuarioId,
  });
  if (error) return resultadoRpc(error);
  const meses = mesesDeCompetenciaFechada([data.competencia_em]);
  return { ok: true as const, corpo: { evento: data,
    aviso: meses.length ? `Este lançamento tem competência em ${meses.join(", ")}. A DRE desse período foi recalculada.` : null } };
}

export async function excluirEventoDoDocumento(documento: DocumentoFinanceiro, eventoId: number, motivo: string, usuarioId: string | null) {
  if (documento.tipo === "ORDEM_SERVICO") return excluirEventoDaOs(documento.id, eventoId, motivo, usuarioId);
  const contexto = await impactoDaVenda(documento.id, eventoId);
  if (!contexto.ok) return contexto;
  if (!contexto.corpo.impacto.podeExcluir) return { ok: false as const,
    error: contexto.corpo.impacto.bloqueio!, status: 409, extra: contexto.corpo };
  const { data, error } = await supabaseAdmin.rpc("alterar_evento_financeiro_manual_venda", {
    p_venda_id: documento.id, p_evento_id: eventoId, p_operacao: "EXCLUIR", p_payload: {}, p_usuario: usuarioId,
  });
  if (error) return resultadoRpc(error);
  const meses = mesesDeCompetenciaFechada([contexto.corpo.impacto.competenciaEm]);
  return { ok: true as const, corpo: { excluido: true, resultado: data, ...contexto.corpo,
    aviso: meses.length ? `A DRE de ${meses.join(", ")} foi recalculada.` : null } };
}
