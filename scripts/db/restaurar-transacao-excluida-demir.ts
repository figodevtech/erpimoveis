/**
 * Restaura no Demir uma transacao excluida por engano, a partir da auditoria.
 *
 * A exclusao de transacao e fisica, mas a tabela tem o trigger `auditoria_linha`:
 * a linha inteira sobrevive em auditoria_evento.dados_anteriores. A restauracao
 * e o INSERT dessa linha de volta, com o mesmo id — assim a baixa orfa em
 * transacao_baixa_historico volta a casar e a auditoria fica coerente.
 *
 * Uso:
 *   npm run db:restaurar:transacao                 # lista os candidatos
 *   npm run db:restaurar:transacao -- <evento_id>  # simula a restauracao
 *   npm run db:restaurar:transacao -- <evento_id> --aplicar
 *
 * Por seguranca, a rotina:
 * - conecta exclusivamente ao banco Demir;
 * - simula por padrao (so grava com --aplicar);
 * - restaura uma unica transacao, a do evento informado;
 * - recusa se o id ja existir, se a transacao tiver vinculo operacional
 *   (OS, venda, entrada, adiantamento) ou se houver outro evento posterior
 *   sobre o mesmo registro;
 * - confere a linha restaurada dentro da transacao antes do COMMIT.
 */
import { connectDatabase, loadDatabaseConfigs } from "./lib";

const ARGUMENTOS = process.argv.slice(2);
const APLICAR = ARGUMENTOS.includes("--aplicar");
const EVENTO_ID = ARGUMENTOS.find((valor) => /^\d+$/.test(valor));
const JANELA_DIAS = 30;

type Candidato = {
  evento_id: string;
  ocorrido_em: string;
  transacao_id: string;
  excluido_por: string | null;
  descricao: string | null;
  tipo: string | null;
  valor: string | null;
  valor_base: string | null;
  valor_acrescimos: string | null;
  pendente: string | null;
  pago_em: string | null;
  vencimento_em: string | null;
  banco_id: string | null;
  origem: string | null;
  ordemservicoid: string | null;
  vendaid: string | null;
  entrada_id: string | null;
  adiantamento_id: string | null;
};

const emReais = (valor: string | null) =>
  valor == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor));

const SELECT_CANDIDATOS = `
  select
    a.id::text                                    as evento_id,
    a.ocorrido_em::text                           as ocorrido_em,
    a.registro_id                                 as transacao_id,
    u.nome                                        as excluido_por,
    a.dados_anteriores ->> 'descricao'            as descricao,
    a.dados_anteriores ->> 'tipo'                 as tipo,
    a.dados_anteriores ->> 'valor'                as valor,
    a.dados_anteriores ->> 'valor_base'           as valor_base,
    a.dados_anteriores ->> 'valor_acrescimos'     as valor_acrescimos,
    a.dados_anteriores ->> 'pendente'             as pendente,
    a.dados_anteriores ->> 'pago_em'              as pago_em,
    a.dados_anteriores ->> 'vencimento_em'        as vencimento_em,
    a.dados_anteriores ->> 'banco_id'             as banco_id,
    a.dados_anteriores ->> 'origem'               as origem,
    a.dados_anteriores ->> 'ordemservicoid'       as ordemservicoid,
    a.dados_anteriores ->> 'vendaid'              as vendaid,
    a.dados_anteriores ->> 'entrada_id'           as entrada_id,
    a.dados_anteriores ->> 'adiantamento_id'      as adiantamento_id
  from public.auditoria_evento a
  left join public.usuario u on u.id = a.usuario_id
  where a.tabela = 'transacao'
    and a.operacao = 'DELETE'
`;

function descrever(candidato: Candidato) {
  const liquidada = candidato.pendente === "false";
  return [
    `  evento ${candidato.evento_id} — transacao ${candidato.transacao_id}`,
    `    excluida em ${candidato.ocorrido_em} por ${candidato.excluido_por ?? "(desconhecido)"}`,
    `    ${candidato.tipo ?? "?"} · ${candidato.descricao ?? "(sem descricao)"}`,
    `    valor ${emReais(candidato.valor)} (base ${emReais(candidato.valor_base)} + acrescimos ${emReais(candidato.valor_acrescimos)})`,
    `    ${liquidada ? `liquidada em ${candidato.pago_em ?? "?"}, banco ${candidato.banco_id ?? "—"}` : "pendente"}`,
    `    origem ${candidato.origem ?? "—"}`,
  ].join("\n");
}

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "demir");
  if (!configuracao) throw new Error("Banco Demir nao configurado.");

  const { client } = await connectDatabase(configuracao);
  console.log(`Banco: ${configuracao.label}\n`);

  try {
    if (!EVENTO_ID) {
      const candidatos = await client.query<Candidato>(
        `${SELECT_CANDIDATOS}
           and a.ocorrido_em > now() - interval '${JANELA_DIAS} days'
         order by a.ocorrido_em desc`,
      );

      if (candidatos.rowCount === 0) {
        console.log(`Nenhuma transacao excluida nos ultimos ${JANELA_DIAS} dias.`);
        return;
      }

      console.log(`Transacoes excluidas nos ultimos ${JANELA_DIAS} dias:\n`);
      for (const candidato of candidatos.rows) console.log(`${descrever(candidato)}\n`);
      console.log("Escolha o evento e rode de novo passando o evento_id.");
      return;
    }

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    const encontrados = await client.query<Candidato>(
      `${SELECT_CANDIDATOS} and a.id = $1::bigint`,
      [EVENTO_ID],
    );
    const alvo = encontrados.rows[0];
    if (!alvo) {
      throw new Error(`Evento ${EVENTO_ID} nao e uma exclusao de transacao.`);
    }

    console.log(`${descrever(alvo)}\n`);

    // Um INSERT sobre id ocupado falharia na chave primaria, mas o erro cru nao
    // diria que o registro ja voltou por outro caminho.
    const existente = await client.query(
      `select 1 from public.transacao where id = $1::bigint`,
      [alvo.transacao_id],
    );
    if ((existente.rowCount ?? 0) > 0) {
      throw new Error(`A transacao ${alvo.transacao_id} ja existe. Nada a restaurar.`);
    }

    // Restaurar o estado de um DELETE so vale se ele for o ultimo capitulo do
    // registro. Havendo evento posterior, o JSON deste aqui esta velho.
    const posteriores = await client.query<{ quantidade: string }>(
      `select count(*)::text quantidade
         from public.auditoria_evento
        where tabela = 'transacao'
          and registro_id = $1
          and id > $2::bigint`,
      [alvo.transacao_id, EVENTO_ID],
    );
    if (Number(posteriores.rows[0].quantidade) > 0) {
      throw new Error(
        `Ha evento(s) de auditoria posterior(es) a este DELETE para a transacao ${alvo.transacao_id}. Operacao recusada.`,
      );
    }

    const vinculos = [
      ["ordem de servico", alvo.ordemservicoid],
      ["venda", alvo.vendaid],
      ["entrada", alvo.entrada_id],
      ["adiantamento", alvo.adiantamento_id],
    ].filter(([, valor]) => valor != null);
    if (vinculos.length > 0) {
      throw new Error(
        `A transacao tem vinculo operacional (${vinculos.map(([nome]) => nome).join(", ")}). ` +
          "Restaurar por aqui deixaria o documento de origem fora da conta. Operacao recusada.",
      );
    }

    const restaurada = await client.query<{ id: string }>(
      `insert into public.transacao
       select (jsonb_populate_record(null::public.transacao, a.dados_anteriores)).*
         from public.auditoria_evento a
        where a.id = $1::bigint
       returning id::text`,
      [EVENTO_ID],
    );
    if (restaurada.rowCount !== 1) {
      throw new Error(`Esperado restaurar 1 transacao; foram ${restaurada.rowCount ?? 0}.`);
    }

    const conferencia = await client.query<{
      valor: string;
      valor_base: string;
      valor_acrescimos: string;
      pendente: boolean;
      pago_em: string | null;
      banco_id: string | null;
    }>(
      `select valor::text, valor_base::text, valor_acrescimos::text,
              pendente, pago_em::text, banco_id::text
         from public.transacao where id = $1::bigint`,
      [alvo.transacao_id],
    );
    const linha = conferencia.rows[0];

    // O JSON da auditoria e a unica fonte: se qualquer numero saiu diferente,
    // algum gatilho reescreveu a linha e o que voltou nao e o que foi excluido.
    const comoNumero = (valor: string | null) => (valor == null ? null : Number(valor));
    const comoInstante = (valor: string | null) => (valor == null ? null : Date.parse(valor));

    const divergencias = (
      [
        ["valor", comoNumero(linha.valor), comoNumero(alvo.valor)],
        ["valor_base", comoNumero(linha.valor_base), comoNumero(alvo.valor_base)],
        ["valor_acrescimos", comoNumero(linha.valor_acrescimos), comoNumero(alvo.valor_acrescimos)],
        ["pendente", String(linha.pendente), alvo.pendente],
        ["pago_em", comoInstante(linha.pago_em), comoInstante(alvo.pago_em)],
      ] as Array<[string, string | number | null, string | number | null]>
    ).filter(([, obtido, esperado]) => obtido !== esperado);

    if (divergencias.length > 0) {
      throw new Error(
        `A linha restaurada nao confere com a auditoria: ${divergencias
          .map(([campo, obtido, esperado]) => `${campo} = ${obtido} (esperado ${esperado})`)
          .join("; ")}. COMMIT recusado.`,
      );
    }

    const baixa = await client.query<{ quantidade: string }>(
      `select count(*)::text quantidade
         from public.transacao_baixa_historico where transacao_id = $1::bigint`,
      [alvo.transacao_id],
    );

    console.log(`Transacao ${alvo.transacao_id} restaurada: ${emReais(linha.valor)}, ${
      linha.pendente ? "pendente" : `liquidada em ${linha.pago_em}`
    }, banco ${linha.banco_id ?? "—"}.`);
    console.log(
      `Historico de baixa: ${baixa.rows[0].quantidade} linha(s) — ${
        Number(baixa.rows[0].quantidade) > 0 ? "voltou a casar com a transacao" : "sem registro de baixa"
      }.`,
    );

    if (!APLICAR) {
      await client.query("ROLLBACK");
      console.log("\nSimulacao concluida. Nenhuma alteracao foi gravada. Use --aplicar para gravar.");
      return;
    }

    await client.query("COMMIT");
    console.log("\nRestauracao gravada.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
