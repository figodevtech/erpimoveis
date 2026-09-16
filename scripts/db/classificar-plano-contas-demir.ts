/**
 * Dá a cada grupo e a cada conta do plano de contas do Demir Diesel a linha da
 * DRE que corresponde ao que é lançado nela.
 *
 * As decisões estão uma a uma abaixo, com o motivo. Foram tomadas em 15/09/2026
 * lendo a descrição dos lançamentos reais de cada conta, e não só o nome: a
 * conta "Devolução" estava em custos, mas o que se lança nela é reembolso a
 * cliente; "Outras receitas" é aluguel recebido; "Venda de ativo imobilizado" é
 * a venda de um carro em 20 parcelas.
 *
 * O grupo recebe a linha da maioria das contas dele — é o que uma conta nova
 * herda. A conta só ganha classificação própria quando difere do grupo.
 *
 * Tudo vale para o histórico inteiro (decisão de 15/09/2026): a DRE dos meses
 * passados é refeita. O script mostra o antes e o depois, mês a mês, e só grava
 * com `--aplicar`.
 *
 * Uso:
 *   npm run db:classificar:demir
 *   npm run db:classificar:demir -- --aplicar
 */
import fs from "node:fs";
import path from "node:path";

import { montarArvore, type LinhaDre } from "../../src/app/api/dre/_arvore";
import { connectDatabase, loadDatabaseConfigs, projectRoot } from "./lib";

const APLICAR = process.argv.slice(2).includes("--aplicar");

const MIGRATION = "supabase/migrations/20260915140000_linha_da_dre_por_plano_de_conta.sql";

type Decisao = { nome: string; classificacao: string; porque: string };
type DecisaoConta = Decisao & { id: number };

/** Grupo -> linha padrão. Chave pelo nome: os ids de grupo não aparecem na tela. */
const GRUPOS: Decisao[] = [
  { nome: "Receitas", classificacao: "RECEITA_SERVICOS", porque: "A maior parte das contas é serviço de oficina." },
  { nome: "Custos diretos", classificacao: "CUSTO_SERVICO", porque: "Custo de executar o serviço; as contas específicas ganham linha própria." },
  { nome: "Pessoal", classificacao: "DESPESA_PESSOAL", porque: "Salário, encargo e benefício de empregado." },
  { nome: "Despesas operacionais", classificacao: "DESPESA_OPERACIONAL_OUTRA", porque: "Grupo amplo: fica em 6.6 só o que não cabe em ocupação, administrativo, comercial ou tecnologia." },
  { nome: "Impostos e taxas", classificacao: "TRIBUTO_RECEITA", porque: "Simples, ICMS, ISS, PIS e COFINS incidem sobre o faturamento." },
  { nome: "Despesas financeiras", classificacao: "DESPESA_FINANCEIRA", porque: "Tarifa, juros e taxa de meio de pagamento." },
  { nome: "Receitas financeiras e outras receitas", classificacao: "RECEITA_FINANCEIRA", porque: "Rendimento e juros recebidos." },
  { nome: "Investimentos e imobilizado", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Compra de bem troca caixa por patrimônio; entra no resultado pela depreciação." },
  { nome: "Movimentações não operacionais", classificacao: "TRANSFERENCIA_INTERNA", porque: "Dinheiro mudando de lugar; as exceções de resultado (não identificadas) têm linha própria." },
];

const CONTAS: DecisaoConta[] = [
  // ------------------------------------------------------------- Receitas
  { id: 1, nome: "Mão de obra mecânica", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 2, nome: "Diagnóstico e avaliação", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 3, nome: "Serviços elétricos", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 4, nome: "Funilaria e pintura", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 5, nome: "Alinhamento e balanceamento", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 6, nome: "Instalação de peças e acessórios", classificacao: "RECEITA_SERVICOS", porque: "Serviço de instalação; a peça em si é receita de produto." },
  { id: 7, nome: "Serviços terceirizados faturados", classificacao: "RECEITA_SERVICOS", porque: "Serviço faturado ao cliente, ainda que executado por terceiro." },
  { id: 8, nome: "Outros serviços da oficina", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 91, nome: "Serviço de Programação", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 92, nome: "Serviço Reparo Bico/Unidade", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 93, nome: "Serviço Reparo de Modulo", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 94, nome: "Teste de Bomba", classificacao: "RECEITA_SERVICOS", porque: "Serviço." },
  { id: 9, nome: "Venda de peças", classificacao: "RECEITA_PRODUTOS", porque: "Venda de mercadoria, não serviço." },
  { id: 10, nome: "Venda de pneus", classificacao: "RECEITA_PRODUTOS", porque: "Venda de mercadoria." },
  { id: 11, nome: "Venda de lubrificantes e fluidos", classificacao: "RECEITA_PRODUTOS", porque: "Venda de mercadoria." },
  { id: 12, nome: "Venda de acessórios", classificacao: "RECEITA_PRODUTOS", porque: "Venda de mercadoria." },
  { id: 13, nome: "Venda de produtos diversos", classificacao: "RECEITA_PRODUTOS", porque: "Venda de mercadoria." },

  // ------------------------------------------------------- Custos diretos
  { id: 14, nome: "Compra de peças para revenda", classificacao: "CUSTO_MERCADORIA", porque: "Peça comprada fora da entrada de estoque e aplicada ou revendida: custo da mercadoria." },
  { id: 16, nome: "Compra de lubrificantes e fluidos", classificacao: "CUSTO_MERCADORIA", porque: "Lubrificante é revendido (há conta de venda dele): custo da mercadoria." },
  { id: 17, nome: "Materiais aplicados nos serviços", classificacao: "CUSTO_MATERIAL_DIRETO", porque: "Material consumido na execução." },
  { id: 18, nome: "Serviços terceirizados", classificacao: "CUSTO_TERCEIRO_DIRETO", porque: "Reparo de módulo e interface feito por terceiro para OS." },
  { id: 15, nome: "Custos com socorro", classificacao: "CUSTO_SERVICO", porque: "Combustível e hospedagem para atender socorro: custo de executar o serviço." },
  { id: 19, nome: "Fretes", classificacao: "CUSTO_DIRETO_OUTRO", porque: "Coleta e envio de peças e módulos da operação (táxi, lotação, aeroporto)." },
  { id: 20, nome: "Perdas, avarias e ajustes de estoque", classificacao: "CUSTO_DIRETO_OUTRO", porque: "Perda normal de estoque compõe o custo." },
  { id: 21, nome: "Garantias e retrabalhos", classificacao: "CUSTO_DIRETO_OUTRO", porque: "Custo de cobrir garantia de serviço já vendido." },
  { id: 96, nome: "Devolução", classificacao: "DEVOLUCAO_COMERCIAL", porque: "O lançado é reembolso a cliente por peça ou serviço que não deu certo: reduz a receita." },
  { id: 101, nome: "Comissão de terceiros", classificacao: "DESPESA_COMERCIAL", porque: "Comissão paga a quem trouxe cliente ou venda." },

  // --------------------------------------------------------------- Pessoal
  { id: 22, nome: "Salários", classificacao: "DESPESA_PESSOAL", porque: "Pessoal." },
  { id: 23, nome: "Pró-labore", classificacao: "DESPESA_PESSOAL", porque: "Remuneração do sócio pelo trabalho é despesa; distribuição de lucro não." },
  { id: 24, nome: "Comissões", classificacao: "DESPESA_PESSOAL", porque: "Folha de comissão dos colaboradores, junto com o salário deles." },
  { id: 25, nome: "Horas extras", classificacao: "DESPESA_PESSOAL", porque: "Pessoal." },
  { id: 26, nome: "Encargos trabalhistas", classificacao: "DESPESA_PESSOAL", porque: "INSS e FGTS da folha." },
  { id: 27, nome: "Benefícios", classificacao: "DESPESA_PESSOAL", porque: "Plano de saúde e passagens dos colaboradores." },
  { id: 28, nome: "Uniformes e equipamentos de proteção", classificacao: "DESPESA_PESSOAL", porque: "Pessoal." },
  { id: 29, nome: "Treinamentos", classificacao: "DESPESA_PESSOAL", porque: "Pessoal." },
  { id: 95, nome: "Farmácia", classificacao: "DESPESA_PESSOAL", porque: "Benefício." },
  { id: 104, nome: "Exames", classificacao: "DESPESA_PESSOAL", porque: "Exame ocupacional." },
  { id: 107, nome: "Rescisões", classificacao: "DESPESA_PESSOAL", porque: "Pessoal." },
  { id: 102, nome: "Mão de obra terceirizada", classificacao: "CUSTO_TERCEIRO_DIRETO", porque: "Mecânico contratado por semana (sem vínculo) executando serviço: custo direto, não folha." },
  { id: 30, nome: "Serviços de profissionais autônomos", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Diárias de contagem de estoque para implantação do sistema: apoio administrativo." },

  // ------------------------------------------------- Despesas operacionais
  { id: 31, nome: "Aluguel", classificacao: "DESPESA_OCUPACAO", porque: "Ocupação." },
  { id: 32, nome: "Energia elétrica", classificacao: "DESPESA_OCUPACAO", porque: "Ocupação." },
  { id: 33, nome: "Água e esgoto", classificacao: "DESPESA_OCUPACAO", porque: "Ocupação." },
  { id: 35, nome: "Materiais de limpeza", classificacao: "DESPESA_OCUPACAO", porque: "Manutenção do espaço." },
  { id: 37, nome: "Manutenção de máquinas, equipamentos e ferramentas", classificacao: "DESPESA_OCUPACAO", porque: "Ar-condicionado, barreira do terreno, estrutura da oficina." },
  { id: 38, nome: "Manutenção predial", classificacao: "DESPESA_OCUPACAO", porque: "Ocupação." },
  { id: 41, nome: "Segurança e monitoramento", classificacao: "DESPESA_OCUPACAO", porque: "Estrutura do prédio." },
  { id: 36, nome: "Materiais de escritório", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Administrativo." },
  { id: 40, nome: "Seguros", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Seguro do prédio, de vida em grupo e de crédito: administrativo." },
  { id: 43, nome: "Contabilidade", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Administrativo." },
  { id: 44, nome: "Serviços jurídicos", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Administrativo." },
  { id: 42, nome: "Sistemas e softwares", classificacao: "DESPESA_TECNOLOGIA", porque: "Software e arquivos de reparo de módulo." },
  { id: 86, nome: "Internet", classificacao: "DESPESA_TECNOLOGIA", porque: "Tecnologia." },
  { id: 34, nome: "Telefone", classificacao: "DESPESA_TECNOLOGIA", porque: "Telefonia." },
  { id: 45, nome: "Marketing e publicidade", classificacao: "DESPESA_COMERCIAL", porque: "Comercial." },
  { id: 108, nome: "Feira e Eventos", classificacao: "DESPESA_COMERCIAL", porque: "Participação na Autonor: divulgação." },
  { id: 46, nome: "Correios, entregas e transportes", classificacao: "DESPESA_COMERCIAL", porque: "Envio de peça vendida ao cliente." },
  { id: 39, nome: "Combustíveis e deslocamentos", classificacao: "DESPESA_OPERACIONAL_OUTRA", porque: "Veículo da empresa no dia a dia." },
  { id: 47, nome: "Despesas diversas da oficina", classificacao: "DESPESA_OPERACIONAL_OUTRA", porque: "Genérica: inclui faturas de cartão sem detalhe." },
  { id: 106, nome: "Manut. Veículos", classificacao: "DESPESA_OPERACIONAL_OUTRA", porque: "Veículo da empresa." },
  { id: 165, nome: "Infração de Trânsito", classificacao: "DESPESA_OPERACIONAL_OUTRA", porque: "Multa de veículo em operação." },

  // ------------------------------------------------------ Impostos e taxas
  { id: 48, nome: "Simples Nacional", classificacao: "TRIBUTO_RECEITA", porque: "DAS incide sobre o faturamento." },
  { id: 49, nome: "ICMS", classificacao: "TRIBUTO_RECEITA", porque: "Sobre venda." },
  { id: 50, nome: "ISS", classificacao: "TRIBUTO_RECEITA", porque: "Sobre serviço." },
  { id: 51, nome: "PIS", classificacao: "TRIBUTO_RECEITA", porque: "Sobre faturamento." },
  { id: 87, nome: "COFINS", classificacao: "TRIBUTO_RECEITA", porque: "Sobre faturamento." },
  { id: 89, nome: "IRPJ", classificacao: "IRPJ_RESULTADO", porque: "Tributo sobre o lucro: reduz o resultado, não a receita." },
  { id: 88, nome: "CSLL", classificacao: "CSLL_RESULTADO", porque: "Tributo sobre o lucro." },
  { id: 90, nome: "Tarifa sobre importação", classificacao: "TRIBUTO_COMPRA_RESULTADO", porque: "Imposto de importação na compra de peça." },
  { id: 98, nome: "IPVA", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Tributo sobre veículo, não sobre receita." },
  { id: 99, nome: "IPTU", classificacao: "DESPESA_OCUPACAO", porque: "Tributo do imóvel: custo de ocupação." },
  { id: 52, nome: "Taxas municipais e alvarás", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Taxa administrativa." },
  { id: 53, nome: "Licenciamento e órgãos reguladores", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Taxa administrativa." },
  { id: 54, nome: "Multas e juros tributários", classificacao: "DESPESA_FINANCEIRA", porque: "Encargo por atraso, não o tributo." },
  { id: 55, nome: "Outros impostos e taxas", classificacao: "DESPESA_ADMINISTRATIVA", porque: "Os tributos sobre receita e lucro já têm conta própria; o que sobra é taxa." },

  // -------------------------------------------------- Despesas financeiras
  { id: 56, nome: "Tarifas bancárias", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 57, nome: "Taxas de cartão", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 58, nome: "Taxas de PIX e meios de pagamento", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 59, nome: "Juros pagos", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 61, nome: "Descontos concedidos", classificacao: "DESPESA_FINANCEIRA", porque: "Desconto financeiro no recebimento; o comercial já sai da OS e da venda." },
  { id: 62, nome: "Multas financeiras", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 63, nome: "Outras despesas financeiras", classificacao: "DESPESA_FINANCEIRA", porque: "Financeiro." },
  { id: 60, nome: "Antecipação de recebíveis", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Valor antecipado é dívida garantida pelos títulos, não receita." },
  { id: 105, nome: "Estorno de Antecipação", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Banco tomando de volta o valor antecipado de boleto não pago: devolução do principal, não despesa." },

  // --------------------------------------- Receitas financeiras e outras
  { id: 64, nome: "Juros recebidos", classificacao: "RECEITA_FINANCEIRA", porque: "Financeiro." },
  { id: 65, nome: "Rendimentos financeiros", classificacao: "RECEITA_FINANCEIRA", porque: "Financeiro." },
  { id: 66, nome: "Descontos obtidos", classificacao: "RECEITA_FINANCEIRA", porque: "Desconto de pagamento antecipado a fornecedor." },
  { id: 67, nome: "Venda de sucata", classificacao: "RECEITA_OPERACIONAL_OUTRA", porque: "Sucata nasce da própria atividade da oficina." },
  { id: 68, nome: "Venda de ativo imobilizado", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Venda de carro: o preço não é ganho, e o custo do carro nunca passou pela DRE." },
  { id: 69, nome: "Outras receitas", classificacao: "OUTRO_GANHO", porque: "Aluguel recebido (Trevisana): ganho fora da atividade." },

  // --------------------------------------------- Investimentos e imobilizado
  { id: 70, nome: "Compra de máquinas", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 71, nome: "Compra de ferramentas", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 72, nome: "Equipamentos de diagnóstico", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 73, nome: "Computadores e equipamentos", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 74, nome: "Móveis e instalações", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 75, nome: "Veículos da empresa", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Imobilizado." },
  { id: 76, nome: "Obras e melhorias", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Benfeitoria." },
  { id: 103, nome: "Consórcios", classificacao: "PATRIMONIAL_IMOBILIZADO", porque: "Poupança para adquirir bem; a taxa de administração embutida não é separável na conta." },
  { id: 77, nome: "Depreciação de imobilizado", classificacao: "DEPRECIACAO", porque: "Linha 8." },

  // ------------------------------------------- Movimentações não operacionais
  { id: 82, nome: "Transferência entre contas", classificacao: "TRANSFERENCIA_INTERNA", porque: "Mesmo dinheiro, outra conta." },
  { id: 85, nome: "Estornos e ajustes financeiros", classificacao: "TRANSFERENCIA_INTERNA", porque: "PIX recebido por engano e devolvido: passa pelo caixa sem ser resultado." },
  { id: 78, nome: "Aporte de sócios", classificacao: "PATRIMONIAL_SOCIOS", porque: "Capital." },
  { id: 79, nome: "Retirada de sócios", classificacao: "PATRIMONIAL_SOCIOS", porque: "Distribuição aos sócios, inclusive despesa pessoal paga pela empresa." },
  { id: 80, nome: "Empréstimos recebidos", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Principal de dívida." },
  { id: 81, nome: "Pagamento de empréstimos", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Amortização do principal." },
  { id: 100, nome: "Transferência entre empresas do mesmo grupo", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Entre CNPJs diferentes é mútuo: direito ou dívida com a outra empresa." },
  { id: 172, nome: "Parcelamentos", classificacao: "PATRIMONIAL_EMPRESTIMO", porque: "Parcela de tributo de período anterior: pagamento de dívida, não despesa deste período." },
  { id: 83, nome: "Adiantamento de clientes", classificacao: "ADIANTAMENTO", porque: "Receita nasce no serviço." },
  { id: 84, nome: "Adiantamento a fornecedores", classificacao: "ADIANTAMENTO", porque: "Custo nasce na compra." },
  { id: 97, nome: "Despesas não identificadas", classificacao: "OUTRA_PERDA", porque: "Decisão de 08/09/2026: sai do caixa sem natureza conhecida, entra depois do resultado operacional." },
  { id: 166, nome: "Receitas não identificadas", classificacao: "OUTRO_GANHO", porque: "Espelho da anterior." },
];

/** Meses mostrados no antes e depois. Limites UTC, os mesmos da rota da DRE. */
const MESES = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];

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
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "demir");
  if (!configuracao) throw new Error("O Demir não está configurado.");

  const { client } = await connectDatabase(configuracao);

  try {
    await client.query("BEGIN");

    const { rows: funcao } = await client.query(
      "SELECT to_regprocedure('public.dre_destino_do_cadastro(integer, integer, date, text, integer)') AS f",
    );
    if (!funcao[0].f) {
      if (APLICAR) {
        throw new Error("A migration 20260915140000 não está publicada no Demir. Publique antes de gravar.");
      }
      // Simulação antes do deploy: a migration roda só dentro desta transação,
      // que termina em ROLLBACK. Nada chega ao banco.
      const sql = fs.readFileSync(path.join(projectRoot, MIGRATION), "utf8").replace(/^﻿/, "");
      const corpo = sql.match(/\bbegin\s*;([\s\S]*)commit\s*;\s*$/i);
      if (!corpo) throw new Error("Envelope da migration inesperado: esperado BEGIN ... COMMIT.");
      await client.query(corpo[1]);
      console.log("Migration ainda não publicada no Demir: simulando com ela aplicada só nesta transação.");
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
      { rotulo: "2026 (jan-set)", de: "2026-01-01T00:00:00.000Z", ate: "2026-09-30T23:59:59.999Z" },
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
         `Classificação do plano do Demir em 15/09/2026: ${decisao.porque}`],
      );
    }

    let excecoes = 0;
    for (const decisao of CONTAS) {
      const conta = contas.find((c) => Number(c.id) === decisao.id)!;
      const escolhida = idDaClassificacao.get(decisao.classificacao)!;
      // Igual ao grupo, a conta herda: é o que a tela chama de "segue o grupo".
      const excecao = escolhida === classDoGrupo.get(Number(conta.grupo_id)) ? null : escolhida;
      if (excecao !== null) excecoes += 1;
      if (excecao === (conta.classificacao_especifica_id == null ? null : Number(conta.classificacao_especifica_id))) {
        continue;
      }
      await client.query(
        `SELECT public.plano_contas_salvar_conta(
           $1, $2, $3, $4, NULL, $5, $6, $7, NULL, NULL, $8, 'RECLASSIFICACAO')`,
        [conta.id, conta.codigo, conta.nome, conta.descricao, conta.grupo_id, excecao, conta.versao_registro,
         `Classificação do plano do Demir em 15/09/2026: ${decisao.porque}`],
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
      ["9", "Resultado operacional"],
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

    for (const rotulo of ["2026-08", "2026 (jan-set)"]) {
      console.log(`\nLinhas que mudaram em ${rotulo}:`);
      console.table(
        linhas
          .map((l) => {
            const codigo = String(l.codigo);
            const a = antes.get(rotulo)!.get(codigo)?.valor ?? 0;
            const d = depois.get(rotulo)!.get(codigo)?.valor ?? 0;
            return a === d
              ? null
              : { codigo, linha: String(l.nome), antes: brl(a), depois: brl(d), diferenca: brl(d - a) };
          })
          .filter((l) => l !== null),
      );
    }

    const { rows: fila } = await client.query(
      `SELECT motivo, quantidade, valor FROM public.dre_pendencias(
         timestamptz '2026-08-01T00:00:00Z', timestamptz '2026-08-31T23:59:59.999Z')`,
    );
    console.log("\nFila de pendências de agosto/2026 depois:");
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
