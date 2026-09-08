import { isAxiosError } from "axios";
import type {
  Decisao,
  MovimentoAnalisado,
  MovimentoGravado,
  SugestaoMatch,
} from "./types";

export function formatarDia(valor?: string | null): string {
  if (!valor) return "Não informado";
  const [ano, mes, dia] = valor.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function dataDaTransacao(valor: string): string {
  if (valor.length === 10) return formatarDia(valor);
  return new Date(valor).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

export function resolvido(m: MovimentoAnalisado): boolean {
  return m.statusGravado === "CONCILIADO" || m.statusGravado === "IGNORADO";
}

export function decisaoCompleta(d?: Decisao): boolean {
  if (!d) return false;
  if (d.acao === "IGNORAR") return true;
  if (d.acao === "VINCULAR") return Boolean(d.transacaoId);
  if (d.acao === "LIQUIDAR") return Boolean(d.transacaoId && d.metodopagamento);
  return Boolean(d.nova?.descricao?.trim() && d.nova.tipo && d.metodopagamento);
}

/** Apenas correspondências exatas entram na seleção rápida. Títulos exigem revisão. */
export function decisoesIniciais(
  linhas: MovimentoAnalisado[],
): Record<string, Decisao> {
  const decisoes: Record<string, Decisao> = {};
  for (const m of linhas) {
    if (resolvido(m) || m.analise.situacao !== "MATCH_EXATO") continue;
    const s = m.analise.sugestoes[0];
    if (m.analise.acaoSugerida !== "VINCULAR" || !s) continue;
    decisoes[m.fingerprint] = {
      fingerprint: m.fingerprint,
      movimentoId: m.movimentoId ?? undefined,
      acao: "VINCULAR",
      transacaoId: s.transacaoId,
    };
  }
  return decisoes;
}

export function comoMovimentoAnalisado(
  l: MovimentoGravado,
): MovimentoAnalisado {
  return {
    sequencia: l.sequencia,
    tipoOfx: l.tipo_ofx,
    dataPostagem: l.data_postagem.slice(0, 10),
    dataDisponivel: l.data_disponivel ?? null,
    valorCentavos: Number(l.valor_centavos),
    fitid: l.fitid,
    checknum: l.checknum,
    refnum: l.refnum,
    nome: l.nome,
    memo: l.memo,
    fingerprint: l.fingerprint,
    analise: l.analise,
    metodoSugerido: l.metodoSugerido,
    jaImportado: true,
    movimentoId: l.id,
    statusGravado: l.status,
    transacaoId: l.transacao_id,
    tituloOrigemId: l.titulo_origem_id,
    acaoGravada: l.acao_conciliacao,
    conciliadoEm: l.conciliado_em,
  };
}

export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

/** Separa somente prefixos conhecidos; o texto original permanece nos detalhes. */
export function descricaoMovimento(m: MovimentoAnalisado): {
  titulo: string;
  complemento: string;
} {
  const texto = (m.memo || m.nome || "Sem descrição")
    .replace(/\s+/g, " ")
    .trim();
  const prefixo =
    /^(PAGAMENTO DE BOLETO|PIX ENVIADO|PIX RECEBIDO|DEBITO DE IOF|DÉBITO DE IOF|TARIFA BANCARIA|TARIFA BANCÁRIA)\b[\s:-]*(.*)$/i.exec(
      texto,
    );
  if (!prefixo)
    return {
      titulo: texto,
      complemento: m.nome && m.nome !== texto ? m.nome : "",
    };
  const titulo = prefixo[1]
    .toLocaleLowerCase("pt-BR")
    .replace(/pix/i, "PIX")
    .replace(/iof/i, "IOF");
  return {
    titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1),
    complemento: prefixo[2],
  };
}

export function explicacaoMatch(s: SugestaoMatch): string {
  const valor = s.parcial ? "Pagamento parcial do saldo" : "Mesmo valor";
  const dias =
    s.diferencaEmDias === 0
      ? "mesmo dia"
      : `${s.diferencaEmDias} dia${s.diferencaEmDias === 1 ? "" : "s"} de diferença`;
  return `${valor} · ${dias}`;
}

export function mensagemDeErro(erro: unknown, padrao: string): string {
  if (isAxiosError(erro)) return erro.response?.data?.error ?? padrao;
  return erro instanceof Error ? erro.message : padrao;
}

/** Conflitos de vínculo são bloqueados antes do envio; baixas parciais podem compartilhar título. */
export function conflitosDeSelecao(decisoes: Decisao[]): Set<string> {
  const grupos = new Map<number, Decisao[]>();
  for (const d of decisoes) {
    if (!d.transacaoId || (d.acao !== "VINCULAR" && d.acao !== "LIQUIDAR"))
      continue;
    const grupo = grupos.get(d.transacaoId) ?? [];
    grupo.push(d);
    grupos.set(d.transacaoId, grupo);
  }
  const conflitos = new Set<string>();
  for (const grupo of grupos.values()) {
    if (
      grupo.length > 1 &&
      grupo.some((d) => d.acao === "VINCULAR" || !d.valor)
    ) {
      grupo.forEach((d) => conflitos.add(d.fingerprint));
    }
  }
  return conflitos;
}
