/**
 * Dá plano de conta aos lançamentos do Garage Premium que estavam sem nenhum.
 *
 * Em 15/09/2026 eram 51 lançamentos, R$ 46.396,54, que não apareciam em linha
 * nenhuma da DRE porque ninguém escolheu a conta deles. Classificar o cadastro
 * não resolvia: sem conta, não há de onde herdar destino.
 *
 * Cada destino abaixo vem da descrição do lançamento, da categoria escolhida por
 * quem lançou e do fornecedor — não de palpite sobre o valor. Três casos são
 * suposição declarada, marcados com `confirmar: true`: o nome da empresa não diz
 * o que foi comprado, e a categoria é genérica.
 *
 * Duas contas novas, porque o cadastro do Garage não tinha onde pôr:
 *
 * - "Recuperações e devoluções de compras" (4.9): estorno de compra devolve
 *   dinheiro e abate custo. Lançar como receita financeira inflaria o resultado
 *   financeiro; como receita da atividade, o faturamento.
 * - "Perdas não operacionais" (11.2): a cobrança de golpe é perda, não despesa
 *   da operação. Fica depois do resultado operacional, como "Despesas não
 *   identificadas" já ficava.
 *
 * O que acontece em cada linha, pelos mesmos gatilhos da tela do financeiro: o
 * nome da conta acompanha o id, o evento da DRE passa a ter linha (ou é
 * cancelado, se a conta ficar fora do resultado) e a troca entra na auditoria.
 * Valor, data, competência e banco não mudam.
 *
 * Uso:
 *   npm run db:classificar:garage-lancamentos
 *   npm run db:classificar:garage-lancamentos -- --aplicar
 */
import fs from "node:fs";
import path from "node:path";

import { montarArvore, type LinhaDre } from "../../src/app/api/dre/_arvore";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

const APLICAR = process.argv.slice(2).includes("--aplicar");

/** Conta que precisa existir antes de receber lançamento. Criada só uma vez. */
type ContaNova = { nome: string; codigo: string; grupo: string; classificacao: string; porque: string };

const CONTAS_NOVAS: ContaNova[] = [
  {
    nome: "Recuperações e devoluções de compras",
    codigo: "3.10",
    grupo: "Custos diretos",
    classificacao: "RECUPERACAO_COMPRA",
    porque: "Estorno de compra abate o custo (4.9); não é faturamento nem receita financeira.",
  },
  {
    nome: "Perdas não operacionais",
    codigo: "15.7",
    grupo: "Transferências e ajustes",
    classificacao: "OUTRA_PERDA",
    porque: "Perda fora da atividade (11.2), depois do resultado operacional.",
  },
];

type Destino = { transacao: number; valor: number; conta: string; porque: string; confirmar?: boolean };

const DESTINOS: Destino[] = [
  // --------------------------------------------------- sócios e estrutura
  { transacao: 337, valor: 10000, conta: "Retirada de sócios", porque: '"Retirada Bira": distribuição ao sócio, fora do resultado.' },
  { transacao: 336, valor: 10000, conta: "Retirada de sócios", porque: '"Retirada osvaldo": distribuição ao sócio, fora do resultado.' },
  { transacao: 442, valor: 8000, conta: "Aluguel", porque: "Aluguel do galpão: ocupação." },
  { transacao: 323, valor: 751.51, conta: "IPTU", porque: "IPTU do imóvel da oficina." },
  { transacao: 497, valor: 406.77, conta: "Segurança e monitoramento", porque: "Emive Patrulha: segurança eletrônica da oficina." },
  { transacao: 488, valor: 46, conta: "Manutenção predial", porque: "Material de pedreiro para encanamento." },
  { transacao: 444, valor: 20.9, conta: "Manutenção de máquinas, equipamentos e ferramentas", porque: "Corrediça para o carrinho de ferramentas." },

  // ------------------------------------------------------------- peças
  { transacao: 371, valor: 1737.18, conta: "Compra de peças para revenda", porque: 'Categoria "PEÇA": compra de peça no cartão do sócio.' },
  { transacao: 533, valor: 585.01, conta: "Compra de peças para revenda", porque: "Fortgiro Distribuidora: peças, como os lançamentos iguais categorizados como PEÇA." },
  { transacao: 530, valor: 470, conta: "Compra de peças para revenda", porque: "Termoklia: peças de ar-condicionado automotivo." },
  { transacao: 460, valor: 386.05, conta: "Compra de peças para revenda", porque: "Fortgiro Distribuidora." },
  { transacao: 534, valor: 386.05, conta: "Compra de peças para revenda", porque: "Fortgiro Distribuidora." },
  { transacao: 545, valor: 384.6, conta: "Compra de peças para revenda", porque: 'Categoria "PEÇA".' },
  { transacao: 544, valor: 346.5, conta: "Compra de peças para revenda", porque: 'Categoria "PEÇA".' },
  { transacao: 457, valor: 346.5, conta: "Compra de peças para revenda", porque: "Fortgiro Distribuidora." },
  { transacao: 459, valor: 266.67, conta: "Compra de peças para revenda", porque: "Nacional Turbo: peça de turbo." },
  { transacao: 461, valor: 258.29, conta: "Compra de peças para revenda", porque: "Ekko Parts: distribuidora de peças." },
  { transacao: 532, valor: 215.35, conta: "Compra de peças para revenda", porque: "Ekko Parts: distribuidora de peças." },

  // ------------------------------------------- material aplicado no serviço
  { transacao: 531, valor: 504.68, conta: "Materiais aplicados nos serviços", porque: "Würth: consumível e químico de oficina, não peça de revenda." },
  { transacao: 455, valor: 457.95, conta: "Materiais aplicados nos serviços", porque: "Würth." },
  { transacao: 529, valor: 290.25, conta: "Materiais aplicados nos serviços", porque: "Würth." },
  { transacao: 466, valor: 50, conta: "Materiais aplicados nos serviços", porque: "Material de consumo da oficina." },
  { transacao: 420, valor: 6.49, conta: "Materiais aplicados nos serviços", porque: "Gasolina usada para limpar peças." },
  { transacao: 526, valor: 4, conta: "Materiais aplicados nos serviços", porque: "Óleo de banana para limpar circuito elétrico." },

  // ----------------------------------------------------------- pessoal
  { transacao: 322, valor: 1575, conta: "Benefícios", porque: "Cartão iFood dos funcionários." },
  { transacao: 495, valor: 100.75, conta: "Benefícios", porque: "Seguro de vida dos funcionários." },
  { transacao: 241, valor: 75, conta: "Benefícios", porque: "Almoço da semana do mecânico." },
  { transacao: 390, valor: 40.03, conta: "Benefícios", porque: "Lanche da equipe." },
  { transacao: 513, valor: 33.45, conta: "Benefícios", porque: "Lanche da equipe." },
  { transacao: 333, valor: 58.86, conta: "Uniformes e equipamentos de proteção", porque: "Bota de EPI de funcionário." },

  // -------------------------------------------------- veículos e sistemas
  { transacao: 301, valor: 1344.68, conta: "IPVA", porque: "IPVA da Saveiro." },
  { transacao: 302, valor: 255.58, conta: "Licenciamento e órgãos reguladores", porque: "Licenciamento da Saveiro." },
  { transacao: 391, valor: 100, conta: "Combustíveis e deslocamentos", porque: "Abastecimento da Saveiro." },
  { transacao: 298, valor: 100, conta: "Combustíveis e deslocamentos", porque: "Abastecimento da Saveiro." },
  { transacao: 493, valor: 85.12, conta: "Combustíveis e deslocamentos", porque: "Abastecimento da moto da loja." },
  { transacao: 443, valor: 50, conta: "Combustíveis e deslocamentos", porque: "Abastecimento da Saveiro." },
  { transacao: 422, valor: 77.89, conta: "Combustíveis e deslocamentos", porque: "Uber para devolver carro de cliente: deslocamento." },
  { transacao: 300, valor: 51.4, conta: "Combustíveis e deslocamentos", porque: "Rastreador da Saveiro: custo do veículo da empresa." },
  { transacao: 299, valor: 51.4, conta: "Combustíveis e deslocamentos", porque: "Rastreador da moto." },
  { transacao: 537, valor: 1000, conta: "Sistemas e softwares", porque: "Figo Softwares: sistema da oficina." },
  { transacao: 458, valor: 100, conta: "Sistemas e softwares", porque: "VM Ponto: sistema de ponto eletrônico." },
  { transacao: 498, valor: 95.8, conta: "Sistemas e softwares", porque: "Assistência Google." },

  // ------------------------------------------------ administrativo e taxas
  { transacao: 496, valor: 1385.96, conta: "Seguros", porque: "Allianz: seguro da empresa." },
  { transacao: 499, valor: 11.85, conta: "Taxas municipais e alvarás", porque: "Imposto municipal da segurança eletrônica." },

  // ------------------------------------------------------- perda e estorno
  { transacao: 454, valor: 754.69, conta: "Perdas não operacionais", porque: 'Descrito como golpe: perda, não despesa da operação.' },
  { transacao: 453, valor: 670, conta: "Recuperações e devoluções de compras", porque: "Estorno de compra no Mercado Livre: devolve dinheiro e abate custo." },
  { transacao: 452, valor: 283.23, conta: "Recuperações e devoluções de compras", porque: "Estorno de compra no Mercado Livre." },

  // ------------------------------------------------------ a confirmar
  {
    transacao: 500, valor: 1250, conta: "Despesas diversas da oficina", confirmar: true,
    porque: 'Ecocare Ambiental, categoria "SERVIÇO": parece destinação de resíduos da oficina. Se for licenciamento ambiental, vai para Licenciamento e órgãos reguladores.',
  },
  {
    transacao: 456, valor: 425.1, conta: "Despesas diversas da oficina", confirmar: true,
    porque: "Casa Norte: o nome não diz o que foi comprado. Se for peça, vai para Compra de peças para revenda; se for material de obra, para Manutenção predial.",
  },
  {
    transacao: 465, valor: 300, conta: "Serviços terceirizados", confirmar: true,
    porque: "Jonas Teixeira, CNPJ de prestador: parece serviço contratado. Se for outra coisa, muda.",
  },
  {
    transacao: 536, valor: 200, conta: "Despesas diversas da oficina",
    porque: "Aluguel da máquina de café da recepção: não é aluguel do imóvel nem serviço da OS.",
  },
];

const MESES = ["2026-08", "2026-09"];

const brl = (valor: number) =>
  valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Cliente = Awaited<ReturnType<typeof connectDatabase>>["client"];

async function apurar(client: Cliente, template: number, linhas: Record<string, unknown>[], de: string, ate: string) {
  const { rows } = await client.query(
    "SELECT linha_id, valor, lancamentos FROM public.dre_somar_por_linha($1, $2, $3)",
    [template, de, ate],
  );
  const soma = new Map<number, { valor: number; lancamentos: number }>(
    rows.map((r) => [Number(r.linha_id), { valor: Number(r.valor), lancamentos: Number(r.lancamentos) }]),
  );
  return new Map<string, LinhaDre>(montarArvore(linhas, soma, new Map()).plano.map((l) => [l.codigo, l]));
}

function ultimoDia(mes: string) {
  const [ano, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(ano, m, 0)).toISOString().slice(0, 10);
}

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "garage");
  if (!configuracao) throw new Error("O Garage Premium não está configurado.");

  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN");

    const { rows: funcao } = await client.query(
      "SELECT to_regprocedure('public.dre_destino_do_cadastro(integer, integer, date, text, integer)') AS f",
    );
    if (!funcao[0].f) {
      throw new Error("A migration 20260915140000 não está publicada no Garage. Publique antes.");
    }

    // ------------------------------------------------ o que está sem conta
    const { rows: semConta } = await client.query(
      `SELECT t.id, round(t.valor, 2)::float8 AS valor, coalesce(t.descricao, '') AS descricao
         FROM public.transacao t
        WHERE t.plano_de_conta_id IS NULL
          AND NOT coalesce(t.is_deleted, false)
          AND public.transacao_gera_evento_de_resultado(t.id)
        ORDER BY t.id`,
    );
    const porId = new Map(semConta.map((t) => [Number(t.id), t]));

    const problemas: string[] = [];
    for (const destino of DESTINOS) {
      const atual = porId.get(destino.transacao);
      if (!atual) {
        problemas.push(`#${destino.transacao} não está mais sem conta (ou não existe)`);
        continue;
      }
      if (Math.abs(Number(atual.valor) - destino.valor) > 0.005) {
        problemas.push(`#${destino.transacao} mudou de valor: R$ ${brl(Number(atual.valor))}, esperado R$ ${brl(destino.valor)}`);
      }
    }
    if (problemas.length) {
      throw new Error(`O financeiro mudou desde a análise:\n  ${problemas.join("\n  ")}`);
    }

    // Lançamento novo sem conta, feito depois da análise: não decido por ele.
    const novos = semConta.filter((t) => !DESTINOS.some((d) => d.transacao === Number(t.id)));
    if (novos.length) {
      console.log(`\nSem decisão (lançados depois da análise): ${novos.length}`);
      console.table(novos.map((t) => ({ id: t.id, valor: brl(Number(t.valor)), descricao: String(t.descricao).slice(0, 60) })));
    }

    const { rows: template } = await client.query(
      "SELECT id FROM public.dre_template WHERE ativo ORDER BY versao DESC LIMIT 1",
    );
    const templateId = Number(template[0].id);
    const { rows: linhas } = await client.query(
      `SELECT id, codigo, nome, nivel, parent_id, tipo, natureza_dre, formula, sinal, sem_fonte
         FROM public.dre_linha WHERE template_id = $1 AND ativo ORDER BY ordem`,
      [templateId],
    );

    const periodos = [
      ...MESES.map((mes) => ({ rotulo: mes, de: `${mes}-01T00:00:00.000Z`, ate: `${ultimoDia(mes)}T23:59:59.999Z` })),
      { rotulo: "histórico", de: "2000-01-01T00:00:00.000Z", ate: "2100-01-01T00:00:00.000Z" },
    ];
    const antes = new Map<string, Map<string, LinhaDre>>();
    for (const p of periodos) antes.set(p.rotulo, await apurar(client, templateId, linhas, p.de, p.ate));

    // ------------------------------------------------- contas que faltavam
    const { rows: grupos } = await client.query("SELECT id, nome FROM public.planosdecontagrupos");
    const { rows: classificacoes } = await client.query(
      "SELECT id, codigo FROM public.classificacoes_resultado WHERE ativo",
    );
    const idDaClassificacao = new Map(classificacoes.map((c) => [String(c.codigo), Number(c.id)]));

    for (const nova of CONTAS_NOVAS) {
      const grupo = grupos.find((g) => String(g.nome) === nova.grupo);
      if (!grupo) throw new Error(`Grupo "${nova.grupo}" não existe no Garage.`);
      const classificacao = idDaClassificacao.get(nova.classificacao);
      if (!classificacao) throw new Error(`Classificação ${nova.classificacao} não existe no catálogo.`);

      const { rows: existente } = await client.query(
        "SELECT id FROM public.planosdeconta WHERE nome = $1 AND grupo_id = $2",
        [nova.nome, grupo.id],
      );
      if (existente.length) continue;

      await client.query(
        `SELECT public.plano_contas_salvar_conta(
           NULL, $1, $2, $3, true, $4, $5, NULL, NULL, NULL, $6, 'RECLASSIFICACAO')`,
        [nova.codigo, nova.nome, null, grupo.id, classificacao, `Criada em 15/09/2026: ${nova.porque}`],
      );
    }

    const { rows: contas } = await client.query("SELECT id, nome FROM public.planosdeconta");
    const idDaConta = new Map<string, number>();
    for (const conta of contas) {
      const nome = String(conta.nome);
      if (idDaConta.has(nome)) throw new Error(`Há mais de uma conta chamada "${nome}": o destino ficaria ambíguo.`);
      idDaConta.set(nome, Number(conta.id));
    }

    // ----------------------------------------------------------- classifica
    for (const destino of DESTINOS) {
      const conta = idDaConta.get(destino.conta);
      if (!conta) throw new Error(`Conta "${destino.conta}" não existe no Garage.`);
      const { rowCount } = await client.query(
        `UPDATE public.transacao SET plano_de_conta_id = $1, updated_at = now()
          WHERE id = $2 AND plano_de_conta_id IS NULL`,
        [conta, destino.transacao],
      );
      if (rowCount !== 1) throw new Error(`#${destino.transacao} não foi atualizado. Nada gravado.`);
    }

    const { rows: conferencia } = await client.query(
      `SELECT count(*) FILTER (WHERE t.plano_de_conta_id IS NULL) AS sem_conta,
              count(*) FILTER (WHERE e.id IS NOT NULL AND e.dre_linha_id IS NULL AND e.status = 'ATIVO') AS sem_linha,
              count(*) FILTER (WHERE e.id IS NULL OR e.status <> 'ATIVO') AS fora_do_resultado
         FROM public.transacao t
         LEFT JOIN public.eventos_financeiros e
           ON e.source_type = 'TRANSACAO' AND e.source_id = t.id AND e.status IN ('ATIVO', 'CANCELADO')
        WHERE t.id = ANY($1)`,
      [DESTINOS.map((d) => d.transacao)],
    );
    console.log("\nDepois de classificar:", conferencia[0]);

    const depois = new Map<string, Map<string, LinhaDre>>();
    for (const p of periodos) depois.set(p.rotulo, await apurar(client, templateId, linhas, p.de, p.ate));

    const indicadores = [
      ["3", "Receita líquida"],
      ["5", "Lucro bruto"],
      ["7", "EBITDA"],
      ["14", "Resultado líquido"],
    ] as const;
    console.log("\nDRE antes -> depois:");
    console.table(
      periodos.map((p) => {
        const linha: Record<string, string> = { periodo: p.rotulo };
        for (const [codigo, rotulo] of indicadores) {
          const a = antes.get(p.rotulo)!.get(codigo)?.valor ?? 0;
          const d = depois.get(p.rotulo)!.get(codigo)?.valor ?? 0;
          linha[rotulo] = a === d ? brl(a) : `${brl(a)} -> ${brl(d)}`;
        }
        return linha;
      }),
    );

    console.log("\nLinhas que mudaram no histórico:");
    console.table(
      linhas
        .map((l) => {
          const codigo = String(l.codigo);
          const a = antes.get("histórico")!.get(codigo)?.valor ?? 0;
          const d = depois.get("histórico")!.get(codigo)?.valor ?? 0;
          return a === d ? null : { codigo, linha: String(l.nome), antes: brl(a), depois: brl(d), diferenca: brl(d - a) };
        })
        .filter((l) => l !== null),
    );

    const { rows: fila } = await client.query(
      `SELECT motivo, quantidade, valor FROM public.dre_pendencias(
         timestamptz '2026-08-01T00:00:00Z', timestamptz '2026-09-30T23:59:59.999Z') ORDER BY motivo`,
    );
    console.log("\nFila de pendências de agosto e setembro depois:");
    console.table(fila);

    const aConfirmar = DESTINOS.filter((d) => d.confirmar);
    console.log(`\n${DESTINOS.length} lançamentos classificados, ${aConfirmar.length} por suposição declarada:`);
    for (const d of aConfirmar) console.log(`  #${d.transacao} R$ ${brl(d.valor)} -> ${d.conta}: ${d.porque}`);

    if (!APLICAR) {
      await client.query("ROLLBACK");
      console.log("\nSimulação — nada gravado. Rode com --aplicar para gravar.");
      return;
    }

    await client.query("COMMIT");

    const pasta = path.join(projectRoot, "artifacts", "captures", "dre-plano-contas");
    fs.mkdirSync(pasta, { recursive: true });
    const arquivo = path.join(pasta, `lancamentos-classificados-garage-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(arquivo, JSON.stringify({ gravadoEm: new Date().toISOString(), destinos: DESTINOS }, null, 2));
    console.log(`\nGravado. Registro em ${path.relative(projectRoot, arquivo)}.`);
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
