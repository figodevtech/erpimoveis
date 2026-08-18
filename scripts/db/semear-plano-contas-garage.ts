/**
 * Semeia o plano de contas do Garage Premium a partir do Demir.
 *
 * O DEMIR NAO E TOCADO. Esta rotina so LE dele; toda escrita vai para o Garage.
 * O plano do Demir foi cadastrado pela equipe de la e fica como esta.
 *
 * O PROBLEMA
 * O Garage tem os 15 grupos e ZERO contas — nenhuma das 122 transacoes dele tem
 * conta escolhida, porque nao ha o que escolher. Toda despesa avulsa fica fora
 * da DRE por falta de classificacao, nao por esquecimento.
 *
 * POR QUE NAO E COPIA LITERAL
 * O Demir tem 9 grupos e o Garage tem 15 — e os 15 sao melhores: separam
 * deducoes de receita, despesa administrativa, comercial, de veiculos e de
 * ocupacao, emprestimos, socios e transferencias. O Demir junta tudo isso em
 * "Despesas operacionais" e "Movimentacoes nao operacionais".
 *
 * Copiar a estrutura do Demir por cima rebaixaria a do Garage e ainda exigiria
 * refazer o mapeamento da DRE, que ja esta certo. Entao o que se copia sao as
 * CONTAS, distribuidas nos grupos que o Garage ja tem.
 *
 * Dois grupos do Demir se abrem em varios:
 *
 *   Despesas operacionais  ->  Administrativas, Comerciais, Veiculos, Oficina
 *   Movimentacoes nao op.  ->  Emprestimos, Socios, Transferencias
 *
 * O mapa abaixo e explicito conta a conta nesses casos. Onde o grupo e 1:1, a
 * conta vai inteira.
 *
 * O codigo de cada conta e renumerado para seguir o codigo do grupo no Garage —
 * manter "4.1 Aluguel" dentro de um grupo de codigo 8 confundiria quem le.
 *
 * Uso:
 *   npm run db:semear:plano-garage                # simula
 *   npm run db:semear:plano-garage -- --aplicar   # grava
 */
import { connectDatabase, loadDatabaseConfigs } from "./lib";

const APLICAR = process.argv.slice(2).includes("--aplicar");

/** Conta do Demir -> grupo do Garage, quando o grupo de origem se divide. */
const DESTINO_POR_CONTA: Record<string, string> = {
  // "Despesas operacionais" do Demir
  Aluguel: "Oficina e estrutura",
  "Energia eletrica": "Oficina e estrutura",
  "Agua e esgoto": "Oficina e estrutura",
  "Materiais de limpeza": "Oficina e estrutura",
  "Manutencao de maquinas, equipamentos e ferramentas": "Oficina e estrutura",
  "Manutencao predial": "Oficina e estrutura",
  "Seguranca e monitoramento": "Oficina e estrutura",
  Telefone: "Despesas administrativas",
  Internet: "Despesas administrativas",
  "Materiais de escritorio": "Despesas administrativas",
  "Sistemas e softwares": "Despesas administrativas",
  Contabilidade: "Despesas administrativas",
  "Servicos juridicos": "Despesas administrativas",
  Seguros: "Despesas administrativas",
  "Despesas diversas da oficina": "Despesas administrativas",
  "Marketing e publicidade": "Despesas comerciais",
  "Correios, entregas e transportes": "Despesas comerciais",
  "Combustiveis e deslocamentos": "Veiculos e logistica",

  // "Movimentacoes nao operacionais" do Demir
  "Emprestimos recebidos": "Emprestimos e financiamentos",
  "Pagamento de emprestimos": "Emprestimos e financiamentos",
  "Aporte de socios": "Socios e patrimonio",
  "Retirada de socios": "Socios e patrimonio",
  "Transferencia entre contas": "Transferencias e ajustes",
  "Transferencia entre empresas do mesmo grupo": "Transferencias e ajustes",
  "Adiantamento de clientes": "Transferencias e ajustes",
  "Adiantamento a fornecedores": "Transferencias e ajustes",
  "Estornos e ajustes financeiros": "Transferencias e ajustes",
  "Despesas nao identificadas": "Transferencias e ajustes",

  // Imposto que incide sobre a venda e deducao de receita; o resto e tributo.
  "Simples Nacional": "Deducoes de receita",
  ICMS: "Deducoes de receita",
  ISS: "Deducoes de receita",
  PIS: "Deducoes de receita",
  COFINS: "Deducoes de receita",

  // Devolucao reduz a receita, nao e custo.
  Devolucao: "Deducoes de receita",
};

/** Grupo do Demir -> grupo do Garage, para o que nao esta no mapa acima. */
const DESTINO_POR_GRUPO: Record<string, string> = {
  Receitas: "Receitas",
  "Custos diretos": "Custos diretos",
  Pessoal: "Pessoal",
  "Despesas operacionais": "Despesas administrativas",
  "Impostos e taxas": "Tributos e taxas",
  "Despesas financeiras": "Despesas financeiras",
  "Receitas financeiras e outras receitas": "Receitas financeiras",
  "Investimentos e imobilizado": "Investimentos e imobilizado",
  "Movimentacoes nao operacionais": "Transferencias e ajustes",
};

/** Compara ignorando acento e caixa: os nomes vem digitados dos dois bancos. */
function chave(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function acharDestino(nomeConta: string, nomeGrupo: string) {
  const porConta = Object.entries(DESTINO_POR_CONTA).find(
    ([origem]) => chave(origem) === chave(nomeConta),
  );
  if (porConta) return porConta[1];

  const porGrupo = Object.entries(DESTINO_POR_GRUPO).find(
    ([origem]) => chave(origem) === chave(nomeGrupo),
  );
  return porGrupo ? porGrupo[1] : null;
}

async function main() {
  const configs = loadDatabaseConfigs();
  const origem = configs.find((item) => item.key === "demir");
  const destino = configs.find((item) => item.key === "garage");
  if (!origem || !destino) throw new Error("Demir e Garage Premium precisam estar configurados.");

  const { client: demir } = await connectDatabase(origem);
  const { client: garage } = await connectDatabase(destino);

  try {
    const { rows: contasDemir } = await demir.query(
      `SELECT pc.nome, pc.descricao, g.nome AS grupo
         FROM public.planosdeconta pc
         JOIN public.planosdecontagrupos g ON g.id = pc.grupo_id
        WHERE coalesce(pc.ativo, true)
        ORDER BY g.codigo::int, pc.codigo`,
    );
    console.log(`Contas lidas do Demir: ${contasDemir.length} (somente leitura)`);

    await garage.query("BEGIN");

    const { rows: gruposGarage } = await garage.query(
      `SELECT id, codigo, nome FROM public.planosdecontagrupos ORDER BY codigo::int`,
    );
    const porNomeDoGrupo = new Map(
      gruposGarage.map((grupo: { id: number; codigo: string; nome: string }) => [
        chave(String(grupo.nome)),
        grupo,
      ]),
    );

    const { rows: jaTem } = await garage.query("SELECT count(*) AS n FROM public.planosdeconta");
    if (Number(jaTem[0].n) > 0) {
      throw new Error(`O Garage ja tem ${jaTem[0].n} conta(s). Esta rotina so semeia plano vazio.`);
    }

    const porGrupo = new Map<string, Array<{ nome: string; descricao: string | null }>>();
    const semDestino: string[] = [];

    for (const conta of contasDemir) {
      const alvo = acharDestino(String(conta.nome), String(conta.grupo));
      const grupo = alvo ? porNomeDoGrupo.get(chave(alvo)) : undefined;
      if (!grupo) {
        semDestino.push(`${conta.grupo} / ${conta.nome}`);
        continue;
      }
      const id = String(grupo.id);
      if (!porGrupo.has(id)) porGrupo.set(id, []);
      porGrupo.get(id)!.push({ nome: conta.nome, descricao: conta.descricao });
    }

    if (semDestino.length > 0) {
      throw new Error(`Contas sem destino:\n  - ${semDestino.join("\n  - ")}`);
    }

    console.log("\nDistribuicao nos grupos do Garage:");
    let total = 0;
    for (const grupo of gruposGarage) {
      const contas = porGrupo.get(String(grupo.id)) ?? [];
      total += contas.length;
      console.log(
        `  ${String(grupo.codigo).padStart(2)} ${String(grupo.nome).padEnd(30)} ${String(contas.length).padStart(3)}`,
      );
    }
    console.log(`     ${"TOTAL".padEnd(30)} ${String(total).padStart(3)}`);

    for (const grupo of gruposGarage) {
      const contas = porGrupo.get(String(grupo.id)) ?? [];
      let n = 0;
      for (const conta of contas) {
        n += 1;
        await garage.query(
          `INSERT INTO public.planosdeconta (codigo, nome, descricao, ativo, grupo_id)
           VALUES ($1, $2, $3, true, $4)`,
          [`${grupo.codigo}.${n}`, conta.nome, conta.descricao, grupo.id],
        );
      }
    }

    const { rows: conferencia } = await garage.query(
      `SELECT (SELECT count(*) FROM public.planosdeconta) AS contas,
              (SELECT count(*) FROM public.planosdecontagrupos g
                WHERE NOT EXISTS (SELECT 1 FROM public.planosdeconta pc WHERE pc.grupo_id = g.id))
                AS grupos_ainda_vazios`,
    );
    console.log("\nConferencia:", conferencia[0]);

    if (APLICAR) {
      await garage.query("COMMIT");
      console.log("\nAplicado.");
    } else {
      await garage.query("ROLLBACK");
      console.log("\nSimulacao — nada foi gravado. Rode com --aplicar para valer.");
    }
  } catch (erro) {
    await garage.query("ROLLBACK").catch(() => undefined);
    console.error(`\nNada foi gravado: ${erro instanceof Error ? erro.message : erro}`);
    process.exitCode = 1;
  } finally {
    await demir.end().catch(() => undefined);
    await garage.end().catch(() => undefined);
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
