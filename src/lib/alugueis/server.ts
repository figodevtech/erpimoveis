import "server-only";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const SELECT_LISTA_ALUGUEL = `
  id, status, data_inicio, data_limite, pausado_em, encerrado_em,
  cliente_id, cliente_nome, cliente_documento, cliente_telefone, cliente_email,
  observacao, valor_total, created_at, updated_at,
  cliente:cliente_id ( id, nomerazaosocial, cpfcnpj, telefone, email ),
  itens:aluguel_item ( id, tipo, descricao, identificacao, quantidade, valor, devolvido_em ),
  checklists:aluguel_checklist ( id, tipo )
`;

export const SELECT_DETALHE_ALUGUEL = `
  id, status, data_inicio, data_limite, pausado_em, encerrado_em, observacao_encerramento,
  cliente_id, cliente_nome, cliente_documento, cliente_telefone, cliente_email,
  observacao, valor_total, created_at, updated_at,
  cliente:cliente_id ( id, nomerazaosocial, cpfcnpj, telefone, email ),
  criador:created_by ( id, nome ),
  encerrador:encerrado_por ( id, nome ),
  itens:aluguel_item (
    id, tipo, produto_id, usoconsumo_item_id, veiculo_id, descricao, identificacao,
    quantidade, valor, estoque_saida_id, usoconsumo_saida_id, devolvido_em,
    produto:produto_id ( id, titulo, referencia, estoque ),
    usoconsumo:usoconsumo_item_id ( id, titulo, referencia, estoque, escopo ),
    veiculo:veiculo_id ( id, placa, marca, modelo )
  ),
  checklists:aluguel_checklist (
    id, tipo, checklist_modelo_id, observacao, realizado_em,
    realizador:realizado_por ( id, nome ),
    itens:aluguel_checklist_item (
      id, titulo, descricao, status, observacao, ordem, modelo_item_id,
      imagens:aluguel_checklist_imagem ( id, url, descricao )
    )
  ),
  eventos:aluguel_evento ( id, tipo, dados, created_at, usuario:usuario_id ( id, nome ) )
`;

export class ErroAluguel extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

export async function usuarioDaSessao(): Promise<string> {
  const session = await auth();
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) throw new ErroAluguel("Não autenticado.", 401);
  return id;
}

export function idDaRota(valor: string): number {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ErroAluguel("Aluguel inválido.", 400);
  return id;
}

/** SQLSTATE das RPCs do módulo -> status HTTP. */
const STATUS_POR_SQLSTATE: Record<string, number> = {
  "22023": 400, // dado inválido
  "22P02": 400, // conversão de tipo
  "22007": 400, // data inválida
  "22008": 400,
  P0002: 404, // não encontrado
  P0001: 409, // trava de regra
  "23505": 409, // veículo já alugado
  "23514": 409, // estoque insuficiente
};

export function respostaDeErro(error: unknown, fallback: string) {
  const falha = error as { message?: string; statusCode?: number; code?: string };
  const status =
    falha?.statusCode ??
    (falha?.code ? STATUS_POR_SQLSTATE[falha.code] : undefined) ??
    (/autenticado|permiss/i.test(falha?.message ?? "") ? 403 : 500);
  if (status >= 500) console.error(fallback, error);
  return NextResponse.json({ error: falha?.message || fallback }, { status });
}
