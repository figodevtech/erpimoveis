/**
 * Dá a cada grupo e a cada conta do plano de contas do Garage Premium a linha da
 * DRE que corresponde ao que é lançado nela.
 *
 * Mesmo formato do Demir (`classificar-plano-contas-demir.ts`), decisões de
 * 15/09/2026. O cadastro do Garage é o padrão semeado e quase não tem uso: 9 das
 * 103 contas têm lançamento. Por isso a maior parte das decisões vale para o que
 * vem pela frente, e não muda número nenhum hoje.
 *
 * Duas diferenças de estrutura em relação ao Demir mudam a leitura:
 *
 * - os tributos sobre a receita ficam no grupo "Deduções de receita", e o grupo
 *   "Tributos e taxas" só tem tributo que NÃO incide sobre faturamento (IRPJ,
 *   CSLL, IPVA, IPTU, taxas). Por isso o padrão desse grupo é despesa
 *   administrativa, e não dedução — hoje ele inteiro cai em 2.1;
 * - "Despesas administrativas" e "Oficina e estrutura" são grupos separados, o
 *   que já deixa ocupação fora do administrativo.
 *
 * Tudo vale para o histórico inteiro (decisão de 15/09/2026): a DRE dos meses
 * passados é refeita. O script mostra o antes e o depois e só grava com
 * `--aplicar`.
 *
 * Uso:
 *   npm run db:classificar:garage-dre
 *   npm run db:classificar:garage-dre -- --aplicar
 */
import fs from "node:fs";
import path from "node:path";

import { montarArvore, type LinhaDre } from "../../src/app/api/dre/_arvore";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

const APLICAR = process.argv.slice(2).includes("--aplicar");

const MIGRATION = "supabase/migrations/20260915140000_linha_da_dre_por_plano_de_conta.sql";

type Decisao = { nome: string; classificacao: string; porque: string };
type DecisaoConta = Decisao & { id: number };

/** Grupo -> linha padrão. É o que uma conta nova do grupo herda. */
const GRUPOS: Decisao[] = [
  { nome: "Receitas", classificacao: "RECEITA_SERVICOS", porque: "A maioria das contas é serviço de oficina." },
  { nome: "Deduções de receita", classificacao: "TRIBUTO_RECEITA", porque: "Simples, ICMS, ISS, PIS e COFINS incidem sobre o faturamento." },
  { nome: "Custos diretos", classificacao: "CUSTO_SERVICO", porque: "Custo de executar o serviço; as contas específicas ganham linha própria." },
  { nome: "Pessoal", classificacao: "DESPESA_PESSOAL", porque: "Salário, encargo e benefício de empregado." },
  { nome: "Despesas administrativas", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Contabilidade, jurídico, seguros e material de escritório." },
  { nome: "Despesas comerciais", classificacao: "DESPESA_COMERCIAL", porque: "Divulgação e entrega ao cliente." },
  { nome: "Veículos e logística", classificacao: "DESPESA_OPERACIONAL_OUTRA", porque: "Veículo da empresa no dia a dia, sem linha própria no relatório." },
  { nome: "Oficina e estrutura", classificacao: "DESPESA_OCUPACAO", porque: "Aluguel, energia, água e manutenção do prédio." },
  { nome: "Tributos e taxas", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Aqui não há tributo sobre faturamento — esses estão em Deduções de receita. Sobra taxa e tributo de patrimônio, que é despesa." },
  { nome: "Despesas financeiras", classificacao: "DESPESA_FINANCEIRA", porque: "Tarifa, juros e taxa de meio de pagamento." },
  { nome: "Receitas financeiras", classificacao: "RECEITA_FINANCEIRA", porque: "Rendimento e juros recebidos." },
  { nome: "Investimentos e imobilizado", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Compra de bem troca caixa por patrimônio; entra no resultado pela depreciação." },
  { nome: "Empréstimos e financiamentos", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Principal de dívida não é resultado." },
  { nome: "Sócios e patrimônio", classificacao: "PATRIMONIAL_SOCIOS", porque: "Aporte e retirada mexem no patrimônio, não no resultado." },
  { nome: "Transferências e ajustes", classificacao: "TRANSFERENCIA_INTERNA", porque: "Dinheiro mudando de lugar; o que é resultado tem linha própria." },
  { nome: "EQUIPAMENTOS DE SEGURANÇA", classificacao: "DESPESA_OCUPACAO", porque: "Grupo vazio, criado pela oficina; extintor e afins são estrutura. Sem conta e sem lançamento, não muda número nenhum — e tira o grupo da fila de pendências." },
];

const CONTAS: DecisaoConta[] = [
  // ------------------------------------------------------------- Receitas
  { id: 104, nome: "Mão de obra mecânica", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 109, nome: "Serviço de Programação", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 110, nome: "Serviço Reparo Bico/Unidade", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 111, nome: "Serviço Reparo de Modulo", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 112, nome: "Teste de Bomba", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 113, nome: "Diagnóstico e avaliação", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 114, nome: "Serviços elétricos", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 115, nome: "Funilaria e pintura", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 116, nome: "Alinhamento e balanceamento", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 117, nome: "Instalação de peças e acessórios", classificacao: "RECEITA_SERVICOS", porque: "Serviço de instalação; a peça em si é receita de produto." },
  { id: 118, nome: "Serviços terceirizados faturados", classificacao: "RECEITA_SERVICOS", porque: "Serviço faturado ao cliente, ainda que executado por terceiro." },
  { id: 119, nome: "Outros serviços da oficina", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 120, nome: "Venda de peças", classificacao: "RECEITA_PRODUTOS", porque: "Venda de mercadoria, não serviço." },
  { id: 105, nome: "Venda de pneus", classificacao: "RECEITA_PRODUTOS", porque: "Venda de mercadoria." },
  { id: 106, nome: "Venda de lubrificantes e fluidos", classificacao: "RECEITA_PRODUTOS", porque: "Venda de mercadoria." },
  { id: 107, nome: "Venda de acessórios", classificacao: "RECEITA_PRODUTOS", porque: "Venda de mercadoria." },
  { id: 108, nome: "Venda de produtos diversos", classificacao: "RECEITA_PRODUTOS", porque: "Venda de mercadoria." },

  // -------------------------------------------------- Deduções de receita
  { id: 122, nome: "Simples Nacional", classificacao: "TRIBUTO_RECEITA", porque: "DAS incide sobre o faturamento." },
  { id: 123, nome: "ICMS", classificacao: "TRIBUTO_RECEITA", porque: "Sobre venda." },
  { id: 124, nome: "ISS", classificacao: "TRIBUTO_RECEITA", porque: "Sobre serviço." },
  { id: 125, nome: "PIS", classificacao: "TRIBUTO_RECEITA", porque: "Sobre faturamento." },
  { id: 126, nome: "COFINS", classificacao: "TRIBUTO_RECEITA", porque: "Sobre faturamento." },
  { id: 121, nome: "Devolução", classificacao: "DEVOLUCAO_COMERCIAL", porque: "Devolução de venda reduz a receita, em linha própria." },

  // ------------------------------------------------------- Custos diretos
  { id: 127, nome: "Compra de peças para revenda", classificacao: "CUSTO_MERCADORIA", porque: "Peça comprada fora da entrada de estoque e aplicada ou revendida: custo da mercadoria." },
  { id: 130, nome: "Compra de lubrificantes e fluidos", classificacao: "CUSTO_MERCADORIA", porque: "Lubrificante é revendido (há conta de venda dele)." },
  { id: 131, nome: "Materiais aplicados nos serviços", classificacao: "CUSTO_MATERIAL_DIRETO", porque: "Material consumido na execução." },
  { id: 132, nome: "Serviços terceirizados", classificacao: "CUSTO_TERCEIRO_DIRETO", porque: "Serviço contratado para executar a OS." },
  { id: 133, nome: "Fretes", classificacao: "CUSTO_DIRETO_OUTRO", porque: "Logística de peça da operação." },
  { id: 134, nome: "Perdas, avarias e ajustes de estoque", classificacao: "CUSTO_DIRETO_OUTRO", porque: "Perda normal de estoque compõe o custo." },
  { id: 135, nome: "Garantias e retrabalhos", classificacao: "CUSTO_DIRETO_OUTRO", porque: "Custo de cobrir garantia de serviço já vendido." },
  { id: 129, nome: "Custos com socorro", classificacao: "CUSTO_SERVICO", porque: "Custo de ir até o cliente executar o serviço." },
  { id: 128, nome: "Comissão de terceiros", classificacao: "DESPESA_COMERCIAL", porque: "Comissão paga a quem trouxe cliente ou venda." },

  // --------------------------------------------------------------- Pessoal
  { id: 136, nome: "Salários", classificacao: "DESPESA_PESSOAL", porque: "Pessoal." },
  { id: 137, nome: "Farmácia", classificacao: "DESPESA_PESSOAL", porque: "Benefício." },
  { id: 139, nome: "Pró-labore", classificacao: "DESPESA_PESSOAL", porque: "Remuneração do sócio pelo trabalho é despesa; distribuição de lucro não." },
  { id: 140, nome: "Comissões", classificacao: "DESPESA_PESSOAL", porque: "Folha de comissão dos colaboradores, junto com o salário deles." },
  { id: 141, nome: "Horas extras", classificacao: "DESPESA_PESSOAL", porque: "Pessoal." },
  { id: 142, nome: "Encargos trabalhistas", classificacao: "DESPESA_PESSOAL", porque: "INSS e FGTS da folha." },
  { id: 143, nome: "Benefícios", classificacao: "DESPESA_PESSOAL", porque: "Lanche e benefício dos colaboradores." },
  { id: 144, nome: "Uniformes e equipamentos de proteção", classificacao: "DESPESA_PESSOAL", porque: "Fardamento e EPI da equipe." },
  { id: 145, nome: "Treinamentos", classificacao: "DESPESA_PESSOAL", porque: "Pessoal." },
  { id: 138, nome: "Mão de obra terceirizada", classificacao: "CUSTO_TERCEIRO_DIRETO", porque: "Quem executa serviço sem vínculo é custo direto, não folha." },
  { id: 146, nome: "Serviços de profissionais autônomos", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Autônomo de apoio administrativo; o que executa serviço da oficina tem conta própria." },

  // ----------------------------------------------- Despesas administrativas
  { id: 147, nome: "Seguros", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Administrativo." },
  { id: 149, nome: "Contabilidade", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Administrativo." },
  { id: 150, nome: "Serviços jurídicos", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Administrativo." },
  { id: 154, nome: "Materiais de escritório", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Administrativo." },
  { id: 148, nome: "Sistemas e softwares", classificacao: "DESPESA_TECNOLOGIA", porque: "Tecnologia." },
  { id: 152, nome: "Internet", classificacao: "DESPESA_TECNOLOGIA", porque: "Tecnologia." },
  { id: 153, nome: "Telefone", classificacao: "DESPESA_TECNOLOGIA", porque: "Telefonia." },
  { id: 151, nome: "Despesas diversas da oficina", classificacao: "DESPESA_OPERACIONAL_OUTRA", porque: "Conta genérica: café da recepção, extintor, abastecimento. Não é administração." },

  // ---------------------------------------------------- Despesas comerciais
  { id: 155, nome: "Marketing e publicidade", classificacao: "DESPESA_COMERCIAL", porque: "Comercial." },
  { id: 156, nome: "Correios, entregas e transportes", classificacao: "DESPESA_COMERCIAL", porque: "Envio ao cliente." },

  // --------------------------------------------------- Veículos e logística
  { id: 157, nome: "Combustíveis e deslocamentos", classificacao: "DESPESA_OPERACIONAL_OUTRA", porque: "Veículo da empresa no dia a dia." },

  // ---------------------------------------------------- Oficina e estrutura
  { id: 158, nome: "Aluguel", classificacao: "DESPESA_OCUPACAO", porque: "Ocupação." },
  { id: 159, nome: "Segurança e monitoramento", classificacao: "DESPESA_OCUPACAO", porque: "Estrutura do prédio." },
  { id: 160, nome: "Energia elétrica", classificacao: "DESPESA_OCUPACAO", porque: "Ocupação." },
  { id: 161, nome: "Água e esgoto", classificacao: "DESPESA_OCUPACAO", porque: "Ocupação." },
  { id: 162, nome: "Materiais de limpeza", classificacao: "DESPESA_OCUPACAO", porque: "Manutenção do espaço." },
  { id: 163, nome: "Manutenção de máquinas, equipamentos e ferramentas", classificacao: "DESPESA_OCUPACAO", porque: "Estrutura e equipamentos da oficina." },
  { id: 164, nome: "Manutenção predial", classificacao: "DESPESA_OCUPACAO", porque: "Ocupação." },

  // ------------------------------------------------------- Tributos e taxas
  { id: 166, nome: "IRPJ", classificacao: "IRPJ_RESULTADO", porque: "Tributo sobre o lucro: reduz o resultado, não a receita." },
  { id: 165, nome: "CSLL", classificacao: "CSLL_RESULTADO", porque: "Tributo sobre o lucro." },
  { id: 167, nome: "Tarifa sobre importação", classificacao: "TRIBUTO_COMPRA_RESULTADO", porque: "Imposto de importação na compra de peça." },
  { id: 169, nome: "IPTU", classificacao: "DESPESA_OCUPACAO", porque: "Tributo do imóvel: custo de ocupação." },
  { id: 172, nome: "Multas e juros tributários", classificacao: "DESPESA_FINANCEIRA", porque: "Encargo por atraso, não o tributo." },
  { id: 168, nome: "IPVA", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Tributo sobre veículo, não sobre receita." },
  { id: 170, nome: "Taxas municipais e alvarás", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Taxa administrativa." },
  { id: 171, nome: "Licenciamento e órgãos reguladores", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Taxa administrativa." },
  { id: 173, nome: "Outros impostos e taxas", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Os tributos sobre receita e sobre lucro já têm conta própria; o que sobra é taxa." },

  // --------------------------------------------------- Despesas financeiras
  { id: 174, nome: "Tarifas bancárias", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 175, nome: "Taxas de cartão", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 176, nome: "Taxas de PIX e meios de pagamento", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 177, nome: "Juros pagos", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 179, nome: "Descontos concedidos", classificacao: "DESPESA_FINANCEIRA", porque: "Desconto financeiro no recebimento; o comercial já sai da OS e da venda." },
  { id: 180, nome: "Multas financeiras", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 181, nome: "Outras despesas financeiras", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 178, nome: "Antecipação de recebíveis", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Valor antecipado é dívida garantida pelos títulos, não receita." },

  // --------------------------------------------------- Receitas financeiras
  { id: 182, nome: "Juros recebidos", classificacao: "RECEITA_FINANCEIRA", porque: "Financeiro." },
  { id: 183, nome: "Rendimentos financeiros", classificacao: "RECEITA_FINANCEIRA", porque: "Financeiro." },
  { id: 184, nome: "Descontos obtidos", classificacao: "RECEITA_FINANCEIRA", porque: "Desconto de pagamento antecipado a fornecedor." },
  { id: 185, nome: "Venda de sucata", classificacao: "RECEITA_OPERACIONAL_OUTRA", porque: "Sucata nasce da própria atividade da oficina." },
  { id: 186, nome: "Venda de ativo imobilizado", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "O preço de um bem vendido não é ganho, e o custo dele nunca passou pela DRE." },
  { id: 187, nome: "Outras receitas", classificacao: "OUTRO_GANHO", porque: "Entrada fora da atividade, depois do resultado operacional." },

  // ---------------------------------------------- Investimentos e imobilizado
  { id: 188, nome: "Compra de máquinas", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 189, nome: "Compra de ferramentas", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 190, nome: "Equipamentos de diagnóstico", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 191, nome: "Computadores e equipamentos", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 192, nome: "Móveis e instalações", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 193, nome: "Veículos da empresa", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 194, nome: "Obras e melhorias", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Benfeitoria." },
  { id: 196, nome: "Consórcios", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Poupança para adquirir bem; a taxa de administração embutida não é separável na conta." },
  { id: 195, nome: "Depreciação de imobilizado", classificacao: "DEPRECIACAO", porque: "Linha 8." },

  // -------------------------------------------- Empréstimos e financiamentos
  { id: 197, nome: "Empréstimos recebidos", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Principal de dívida." },
  { id: 198, nome: "Pagamento de empréstimos", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Amortização do principal." },

  // --------------------------------------------------- Sócios e patrimônio
  { id: 199, nome: "Aporte de sócios", classificacao: "PATRIMONIAL_SOCIOS", porque: "Capital." },
  { id: 200, nome: "Retirada de sócios", classificacao: "PATRIMONIAL_SOCIOS", porque: "Distribuição aos sócios." },

  // ---------------------------------------------- Transferências e ajustes
  { id: 202, nome: "Transferência entre contas", classificacao: "TRANSFERENCIA_INTERNA", porque: "Mesmo dinheiro, outra conta." },
  { id: 205, nome: "Estornos e ajustes financeiros", classificacao: "TRANSFERENCIA_INTERNA", porque: "Passa pelo caixa sem ser resultado; estorno de fato econômico vai na conta do fato." },
  { id: 201, nome: "Transferência entre empresas do mesmo grupo", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Entre CNPJs diferentes é mútuo: direito ou dívida com a outra empresa." },
  { id: 203, nome: "Adiantamento de clientes", classificacao: "ADIANTAMENTO", porque: "Receita nasce no serviço." },
  { id: 204, nome: "Adiantamento a fornecedores", classificacao: "ADIANTAMENTO", porque: "Custo nasce na compra." },
  { id: 206, nome: "Despesas não identificadas", classificacao: "OUTRA_PERDA", porque: "Decisão de 08/09/2026: sai do caixa sem natureza conhecida, entra depois do resultado operacional." },
];

const MESES = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

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
  const { plano } = montarArvore(linhas, soma, new Map());
  return new Map<string, LinhaDre>(plano.map((l) => [l.codigo, l]));
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
      if (APLICAR) {
        throw new Error("A migration 20260915140000 não está publicada no Garage. Publique antes de gravar.");
      }
      // Simulação antes do deploy: a migration roda só dentro desta transação,
      // que termina em ROLLBACK. Nada chega ao banco.
      const sql = fs.readFileSync(path.join(projectRoot, MIGRATION), "utf8").replace(/^﻿/, "");
      const corpo = sql.match(/\bbegin\s*;([\s\S]*)commit\s*;\s*$/i);
      if (!corpo) throw new Error("Envelope da migration inesperado: esperado BEGIN ... COMMIT.");
      await client.query(corpo[1]);
      console.log("Migration ainda não publicada: simulando com ela aplicada só nesta transação.");
    }

    const { rows: classificacoes } = await client.query(
      "SELECT id, codigo FROM public.classificacoes_resultado WHERE ativo",
    );
    const idDaClassificacao = new Map(classificacoes.map((c) => [String(c.codigo), Number(c.id)]));
    for (const decisao of [...GRUPOS, ...CONTAS]) {
      if (!idDaClassificacao.has(decisao.classificacao)) {
        throw new Error(`Classificação ${decisao.classificacao} (${decisao.nome}) não existe no catálogo.`);
      }
    }

    const { rows: grupos } = await client.query(
      "SELECT id, codigo, nome, descricao, versao_registro, classificacao_padrao_id FROM public.planosdecontagrupos",
    );
    const { rows: contas } = await client.query(
      "SELECT id, codigo, nome, descricao, grupo_id, versao_registro, classificacao_especifica_id FROM public.planosdeconta",
    );

    // Cadastro novo desde a análise, ou nome trocado, é decisão que ninguém tomou.
    const grupoPorNome = new Map(grupos.map((g) => [String(g.nome), g]));
    const faltando = [
      ...GRUPOS.filter((g) => !grupoPorNome.has(g.nome)).map((g) => `grupo "${g.nome}" não existe`),
      ...grupos.filter((g) => !GRUPOS.some((d) => d.nome === g.nome)).map((g) => `grupo "${g.nome}" sem decisão`),
      ...CONTAS.filter((d) => !contas.some((c) => Number(c.id) === d.id && c.nome === d.nome))
        .map((d) => `conta #${d.id} "${d.nome}" não confere`),
      ...contas.filter((c) => !CONTAS.some((d) => d.id === Number(c.id))).map((c) => `conta #${c.id} "${c.nome}" sem decisão`),
    ];
    if (faltando.length) {
      throw new Error(`O cadastro mudou desde a análise:\n  ${faltando.join("\n  ")}`);
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

    // ------------------------------------------------------------- grava
    const classDoGrupo = new Map<number, number>();
    for (const decisao of GRUPOS) {
      const grupo = grupoPorNome.get(decisao.nome)!;
      const classificacaoId = idDaClassificacao.get(decisao.classificacao)!;
      classDoGrupo.set(Number(grupo.id), classificacaoId);
      await client.query(
        `SELECT public.plano_contas_salvar_grupo(
           $1, $2, $3, $4, NULL, $5, $6, NULL, NULL, $7, 'RECLASSIFICACAO')`,
        [grupo.id, grupo.codigo, grupo.nome, grupo.descricao, classificacaoId, grupo.versao_registro,
         `Classificação do plano do Garage em 15/09/2026: ${decisao.porque}`],
      );
    }

    let excecoes = 0;
    for (const decisao of CONTAS) {
      const conta = contas.find((c) => Number(c.id) === decisao.id)!;
      const escolhida = idDaClassificacao.get(decisao.classificacao)!;
      // Igual ao grupo, a conta herda: é o que a tela chama de "seguir o grupo".
      const excecao = escolhida === classDoGrupo.get(Number(conta.grupo_id)) ? null : escolhida;
      if (excecao !== null) excecoes += 1;
      if (excecao === (conta.classificacao_especifica_id == null ? null : Number(conta.classificacao_especifica_id))) {
        continue;
      }
      await client.query(
        `SELECT public.plano_contas_salvar_conta(
           $1, $2, $3, $4, NULL, $5, $6, $7, NULL, NULL, $8, 'RECLASSIFICACAO')`,
        [conta.id, conta.codigo, conta.nome, conta.descricao, conta.grupo_id, excecao, conta.versao_registro,
         `Classificação do plano do Garage em 15/09/2026: ${decisao.porque}`],
      );
    }

    const depois = new Map<string, Map<string, LinhaDre>>();
    for (const p of periodos) depois.set(p.rotulo, await apurar(client, templateId, linhas, p.de, p.ate));

    // ------------------------------------------------------------ mostra
    console.log(`\nGrupos classificados: ${GRUPOS.length}. Contas: ${CONTAS.length}, ${excecoes} com linha própria.\n`);

    const indicadores = [
      ["3", "Receita líquida"],
      ["5", "Lucro bruto"],
      ["7", "EBITDA"],
      ["14", "Resultado líquido"],
    ] as const;

    console.log("Indicadores por mês (antes -> depois):");
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
          return a === d
            ? null
            : { codigo, linha: String(l.nome), antes: brl(a), depois: brl(d), diferenca: brl(d - a) };
        })
        .filter((l) => l !== null),
    );

    const { rows: fila } = await client.query(
      `SELECT motivo, quantidade, valor FROM public.dre_pendencias(
         timestamptz '2026-08-01T00:00:00Z', timestamptz '2026-09-30T23:59:59.999Z') ORDER BY motivo`,
    );
    console.log("\nFila de pendências de agosto e setembro/2026 depois:");
    console.table(fila);

    if (APLICAR) {
      await client.query("COMMIT");
      console.log("\nGravado.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nSimulação — nada gravado. Rode com --aplicar para gravar.");
    }
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
