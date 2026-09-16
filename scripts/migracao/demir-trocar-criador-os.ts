/**
 * Troca o criador de OS nomeadas no banco do Demir, levando junto a comissao de
 * criacao.
 *
 * Uso:
 *   npm run migracao:demir:trocar-criador -- --usuario=<uuid> 411 412
 *   npm run migracao:demir:trocar-criador -- --usuario=<uuid> 411 412 --aplicar
 *
 * Sem `--aplicar` termina em ROLLBACK e so mostra o que faria.
 *
 * A REGRA MORA NO BANCO
 * Quem troca e `trocar_criador_os` (20260917100000), a mesma funcao que o card
 * "Criado por" dos detalhes da OS chama: recusa OS cancelada e comissao ja
 * lancada ou corrigida a mao, reapura pela taxa de quem entra e republica os
 * eventos quando a OS ja os tem. Este script existe para trocar varias OS de uma
 * vez, com o antes e depois de todos os eventos na tela.
 *
 * A funcao reconcilia o conjunto INTEIRO de eventos da OS. Linha fora de
 * COMISSAO que mude e sinal para parar e investigar antes de aplicar.
 */
import { connectDatabase, loadDatabaseConfigs } from "../db/lib";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const USUARIO = args.find((arg) => arg.startsWith("--usuario="))?.slice("--usuario=".length) ?? "";
const IDS = args
  .filter((arg) => !arg.startsWith("--"))
  .map((arg) => Number(arg))
  .filter((id) => Number.isInteger(id) && id > 0);

type Evento = {
  origem: string;
  natureza: string;
  chave_origem: string;
  status: string;
  valor: string;
  usuario: string | null;
};

const real = (valor: unknown) =>
  Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O uuid na chave nao diz nada a quem le; o nome do dono ja vai ao lado. */
const chaveLegivel = (chave: string) => chave.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, (uuid) => uuid.slice(0, 8));

function descreverEvento(evento: Evento | undefined) {
  if (!evento) return "—";
  return `${evento.status} ${real(evento.valor)}${evento.usuario ? ` (${evento.usuario})` : ""}`;
}

async function main() {
  if (!USUARIO || !IDS.length) {
    throw new Error("Informe --usuario=<uuid> e ao menos uma OS. Ex.: --usuario=ccb0ca64-... 411 412");
  }

  const config = loadDatabaseConfigs().find((item) => item.key === "demir");
  if (!config) throw new Error("Banco do Demir nao encontrado.");

  const { client } = await connectDatabase(config);
  try {
    const eventosDaOs = async (id: number) => {
      const { rows } = await client.query<Evento>(
        `SELECT e.origem, e.natureza, e.chave_origem, e.status, e.valor::text, u.nome AS usuario
           FROM public.eventos_financeiros e
           LEFT JOIN public.usuario u ON u.id = e.usuarioid
          WHERE e.ordemservicoid = $1`,
        [id],
      );
      return new Map(rows.map((evento) => [`${evento.origem} ${evento.natureza} ${evento.chave_origem}`, evento]));
    };

    await client.query("BEGIN");

    const avisos: string[] = [];

    for (const id of IDS) {
      console.log(`\n#${id}`);
      await client.query(`SAVEPOINT os_${id}`);
      try {
        const antes = await eventosDaOs(id);

        const { rows } = await client.query("SELECT public.trocar_criador_os($1, $2) AS resultado", [id, USUARIO]);
        const resultado = rows[0].resultado;
        console.log(
          `  criador: ${resultado.criador_anterior?.nome ?? "—"} -> ${resultado.criador_novo.nome}` +
            ` · comissao de criacao ${real(resultado.comissao_anterior)} -> ${real(resultado.comissao_nova)}`,
        );
        if (!resultado.eventos_publicados) {
          console.log("  evento: sai quando a OS entrar em execucao ou pagamento, pelo fluxo normal");
        }

        const depois = await eventosDaOs(id);
        const mudancas = [...new Set([...antes.keys(), ...depois.keys()])]
          .filter((chave) => descreverEvento(antes.get(chave)) !== descreverEvento(depois.get(chave)))
          .sort();
        if (mudancas.length) {
          console.log("  eventos que mudam:");
          for (const chave of mudancas) {
            console.log(
              `    ${chaveLegivel(chave)}: ${descreverEvento(antes.get(chave))} -> ${descreverEvento(depois.get(chave))}`,
            );
          }
        } else {
          console.log("  nenhum evento muda");
        }

        await client.query(`RELEASE SAVEPOINT os_${id}`);
      } catch (erro) {
        await client.query(`ROLLBACK TO SAVEPOINT os_${id}`);
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        console.log(`  RECUSADA — ${mensagem}`);
        avisos.push(`#${id}: ${mensagem}`);
      }
    }

    if (avisos.length) {
      console.log(`\n${avisos.length} aviso(s):`);
      for (const aviso of avisos) console.log(`  ${aviso}`);
    }

    if (APLICAR) {
      await client.query("COMMIT");
      console.log("\nAPLICADO.\n");
    } else {
      await client.query("ROLLBACK");
      console.log("\nSimulacao — nada foi gravado. Repita com --aplicar.\n");
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
