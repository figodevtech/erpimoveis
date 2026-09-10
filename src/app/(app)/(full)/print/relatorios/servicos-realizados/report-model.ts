import { AGRUPAMENTOS, agruparServicos, duracaoSegundos, duracaoTexto, NOTA_COMPARTILHADOS, somarServicos, type FiltrosServicos, type GrupoServicos, type LinhaServico, type TotaisServicos } from "@/lib/relatorios/servicos-realizados";
import type { MetadadosServicos } from "@/lib/relatorios/servicos-realizados-workbook";

/**
 * Modelo da folha de serviços realizados.
 *
 * A folha é rasterizada uma seção por vez pelo `A4PdfActions`, então a altura de
 * cada bloco é decidida aqui, em milímetros, e não pelo fluxo do navegador: o
 * que não couber precisa ir para a próxima folha antes de ser desenhado.
 *
 * Por isso o texto também é quebrado aqui. A medida usa os avanços reais da
 * Arial em `em`, e não uma contagem de caracteres: "mmm" e "iii" ocupam larguras
 * muito diferentes, e a estimativa por caractere ora estourava a coluna, ora
 * desperdiçava meia folha.
 */

/** 297mm − 20mm de margem − 15mm de cabeçalho − 6mm de rodapé, com folga. */
export const ALTURA_CONTEUDO = 250;
/** Da segunda folha em diante o cabeçalho é só a linha de página: sobram 10mm. */
export const ALTURA_CONTEUDO_SEGUINTE = 260;
/** Capacidade da folha pela posição: só a primeira carrega o cabeçalho inteiro. */
export const capacidadeDaFolha = (indice: number) => indice === 0 ? ALTURA_CONTEUDO : ALTURA_CONTEUDO_SEGUINTE;
/** Altura de uma linha de texto corrido do corpo (9px). */
export const MM_LINHA = 3.4;
/** Faixa de identificação da OS, no topo de cada serviço. */
export const MM_IDENTIFICACAO = 5.4;
/** Faixa de valores e comissão, no pé do serviço. */
export const MM_VALORES = 6;
/** Respiro entre um serviço e o próximo. */
export const MM_ESPACO = 1.8;
/** Moldura do cartão do serviço: as duas bordas e o respiro acima do texto. */
export const MM_MOLDURA = 1.6;
/** Linha da nota de rodapé (8px). */
export const MM_LINHA_NOTA = 3.1;
/** Largura útil do corpo do serviço, em `em` de 9px sobre 190mm de folha. */
export const EM_CORPO = 74;
/** A descrição sai em negrito, e a Arial Bold é ~8% mais larga que a normal. */
export const EM_TITULO = 68;
/** Largura do nome dentro da faixa de grupo, em `em` de 10px. */
export const EM_GRUPO = 33;
/** Largura da nota e da fileira de chips, em `em` de 8px. */
export const EM_NOTA = 84;

export const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const percentual = (n: number | null) => n == null ? "Não cadastrado" : `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
export const inteiro = (n: number) => n.toLocaleString("pt-BR");
export const quantidadeTexto = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
export const STATUS_LABEL: Record<string, string> = {
  AGUARDANDO_CHECKLIST: "Aguardando checklist", ORCAMENTO: "Em orçamento", APROVACAO_ORCAMENTO: "Aguardando aprovação",
  ORCAMENTO_APROVADO: "Orçamento aprovado", ORCAMENTO_RECUSADO: "Orçamento recusado", EM_ANDAMENTO: "Em andamento",
  PAGAMENTO: "Pagamento", FATURAMENTO: "Faturamento", SEM_COBRANCA: "Sem cobrança", CONCLUIDO: "Concluída", CANCELADO: "Cancelada",
};
export const SITUACAO_LABEL: Record<string, string> = { PENDENTE: "Pendente", EM_EXECUCAO: "Em execução", FINALIZADO: "Finalizado" };
export const rotuloStatus = (codigo: string) => STATUS_LABEL[codigo] ?? (codigo ? codigo.replaceAll("_", " ") : "—");
export const rotuloSituacao = (codigo: string) => SITUACAO_LABEL[codigo] ?? (codigo ? codigo.replaceAll("_", " ") : "—");

/** dd/mm/aaaa. A hora só aparece onde decide alguma coisa: no apontamento. */
export function dataCurta(iso: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short" }).format(new Date(iso));
}
export function dataHoraCurta(iso: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  // O separador do pt-BR ("12/03/2026, 14:20") vira espaço: a linha já é lida
  // como um intervalo, e a vírgula só some com a legibilidade em corpo 9.
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)).replace(/,\s*/, " ");
}

/**
 * Avanços da Arial em `em`, por caractere. A acentuação não muda a largura da
 * letra base, então "Ó" mede o mesmo que "O".
 */
const AVANCOS: Record<string, number> = {
  " ": 0.278, "!": 0.278, "#": 0.556, $: 0.556, "%": 0.889, "&": 0.667, "(": 0.333, ")": 0.333, "*": 0.389,
  "+": 0.584, ",": 0.278, "-": 0.333, ".": 0.278, "/": 0.278, ":": 0.278, ";": 0.278, "<": 0.584, "=": 0.584,
  ">": 0.584, "?": 0.556, "@": 1.015, "[": 0.278, "]": 0.278, "^": 0.469, _: 0.556, "{": 0.334, "|": 0.26, "}": 0.334,
  "~": 0.584, A: 0.667, B: 0.667, C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722, I: 0.278, J: 0.5,
  K: 0.667, L: 0.556, M: 0.833, N: 0.722, O: 0.778, P: 0.667, Q: 0.778, R: 0.722, S: 0.667, T: 0.611, U: 0.722,
  V: 0.667, W: 0.944, X: 0.667, Y: 0.667, Z: 0.611, a: 0.556, b: 0.556, c: 0.5, d: 0.556, e: 0.556, f: 0.278,
  g: 0.556, h: 0.556, i: 0.222, j: 0.222, k: 0.5, l: 0.222, m: 0.833, n: 0.556, o: 0.556, p: 0.556, q: 0.556,
  r: 0.333, s: 0.5, t: 0.278, u: 0.556, v: 0.5, w: 0.722, x: 0.5, y: 0.5, z: 0.5,
  "0": 0.556, "1": 0.556, "2": 0.556, "3": 0.556, "4": 0.556, "5": 0.556, "6": 0.556, "7": 0.556, "8": 0.556, "9": 0.556,
  "·": 0.333, "—": 1, "–": 0.556, "→": 0.8, "×": 0.584, "º": 0.365, "ª": 0.37,
  "'": 0.191, '"': 0.355, "`": 0.333, "\\": 0.278,
};
function avanco(caractere: string) {
  const base = caractere.normalize("NFD").replace(/[\u0300-\u036f]/g, "")[0] ?? caractere;
  return AVANCOS[base] ?? (base === base.toUpperCase() ? 0.722 : 0.556);
}
/** Largura do texto em `em`. Multiplicada pelo corpo da fonte, dá milímetros. */
export function larguraTexto(texto: string) {
  let total = 0;
  for (const caractere of texto) total += avanco(caractere);
  return total;
}

/** Quebra o texto em linhas que cabem em `limite` `em`, sem descartar conteúdo. */
export function quebrarTexto(texto: string, limite = EM_CORPO): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.replace(/\r/g, "").split("\n")) {
    let restante = paragrafo.trim();
    if (!restante) { linhas.push(""); continue; }
    while (restante) {
      let largura = 0, corte = 0;
      while (corte < restante.length && largura + avanco(restante[corte]) <= limite) largura += avanco(restante[corte++]);
      if (!corte) corte = 1;
      if (corte < restante.length) {
        const espaco = restante.lastIndexOf(" ", corte);
        if (espaco > corte / 2) corte = espaco;
      }
      linhas.push(restante.slice(0, corte)); restante = restante.slice(corte).trimStart();
    }
  }
  return linhas;
}

export type BlocoGrupo = {
  tipo: "grupo"; chave: string; linhas: string[]; altura: number; nivel: number;
  nome: string[]; rotulo: string; categoria: GrupoServicos["tipo"]; totais: TotaisServicos; percentualAtual: number | null;
};
export type BlocoServico = {
  tipo: "servico"; chave: string; linha: LinhaServico; linhas: string[]; altura: number; continuacao: boolean; valores: boolean;
  titulo: string[]; complemento: string[]; contexto: string[]; execucao: string[];
};
export type BlocoPainel = {
  tipo: "painel"; chave: string; linhas: string[]; altura: number;
  totais: TotaisServicos; participacoes: number; realizadores: number; agrupamento: string;
};
export type BlocoFiltros = { tipo: "filtros"; chave: string; linhas: string[]; altura: number; chips: string[][] };
export type BlocoNota = { tipo: "nota"; chave: string; linhas: string[]; altura: number; vazio: boolean };
export type BlocoRelatorio = BlocoGrupo | BlocoServico | BlocoPainel | BlocoFiltros | BlocoNota;
export type PaginaServicos = { blocos: BlocoRelatorio[]; altura: number; periodo: string; eixo: string; cnpj: string; agrupamento: string };

const ROTULO_GRUPO: Record<GrupoServicos["tipo"], string> = { realizador: "Realizador", setor: "Setor", criador: "Criador da OS" };

function cabecalhoGrupo(grupo: GrupoServicos, nivel: number, pai = ""): BlocoGrupo {
  const nome = quebrarTexto(grupo.nome, EM_GRUPO);
  return {
    tipo: "grupo", chave: `${pai}/${grupo.tipo}:${grupo.id}`, linhas: nome, nome, rotulo: ROTULO_GRUPO[grupo.tipo],
    // A faixa leva o nome à esquerda e os totais à direita; nome longo só
    // empurra a coluna da esquerda, então a altura cresce por linha extra.
    altura: (nivel ? 9 : 11) + Math.max(0, nome.length - 1) * MM_LINHA,
    nivel, categoria: grupo.tipo, totais: grupo.totais, percentualAtual: grupo.percentualAtual,
  };
}

/** Contexto do serviço: de quem é a OS, em que setor, e quem atribuiu. */
function textoContexto(l: LinhaServico) {
  const partes = [`Cliente ${l.cliente}`, `Setor ${l.setor}`, `Atribuído por ${l.atribuidoPor}`];
  if (l.quantidade && l.quantidade !== 1) partes.push(`Qtd. ${quantidadeTexto(l.quantidade)}`);
  return partes.join("  ·  ");
}
/** Execução: apontamento individual, duração e a data que põe a linha no período. */
function textoExecucao(l: LinhaServico) {
  const inicio = dataHoraCurta(l.inicio), fim = dataHoraCurta(l.fim);
  const segundos = duracaoSegundos(l.inicio, l.fim);
  // Sem os dois carimbos não há duração para exibir, e "sem apontamento" duas
  // vezes na mesma linha não diz nada além do que a primeira metade já disse.
  const duracao = segundos != null ? duracaoTexto(segundos) : inicio || fim ? "Duração em aberto" : "";
  const apontamento = inicio || fim ? `${inicio || "sem início"} → ${fim || "em aberto"}` : "Sem apontamento de execução";
  const referencia = dataCurta(l.dataReferencia);
  return [apontamento, duracao, referencia ? `Referência ${referencia}` : ""].filter(Boolean).join("  ·  ");
}

/** Quantas linhas de corpo cabem numa folha inteira, já descontadas as faixas. */
const LINHAS_POR_FRAGMENTO = Math.floor((ALTURA_CONTEUDO - MM_IDENTIFICACAO - MM_VALORES - MM_ESPACO - 22) / MM_LINHA);

export function fragmentosServico(linha: LinhaServico): BlocoServico[] {
  const titulo = quebrarTexto(linha.descricao, EM_TITULO);
  const complemento = linha.complemento ? quebrarTexto(linha.complemento, EM_CORPO) : [];
  const contexto = quebrarTexto(textoContexto(linha), EM_CORPO);
  const execucao = quebrarTexto(textoExecucao(linha), EM_CORPO);
  // Nenhum campo é truncado: descrições e nomes extensos viram linhas, e as
  // linhas atravessam folhas em fragmentos que repetem só a identificação.
  const partes = [
    ...titulo.map(texto => ({ campo: "titulo" as const, texto })),
    ...complemento.map(texto => ({ campo: "complemento" as const, texto })),
    ...contexto.map(texto => ({ campo: "contexto" as const, texto })),
    ...execucao.map(texto => ({ campo: "execucao" as const, texto })),
  ];
  const fragmentos: BlocoServico[] = [];
  for (let i = 0; i < partes.length; i += LINHAS_POR_FRAGMENTO) {
    const parte = partes.slice(i, i + LINHAS_POR_FRAGMENTO), valores = i + LINHAS_POR_FRAGMENTO >= partes.length;
    const campo = (nome: typeof partes[number]["campo"]) => parte.filter(p => p.campo === nome).map(p => p.texto);
    fragmentos.push({
      tipo: "servico", chave: `${linha.ordemId}:${linha.servicoId}:${linha.realizadorId}:${i}`, linha,
      titulo: campo("titulo"), complemento: campo("complemento"), contexto: campo("contexto"), execucao: campo("execucao"),
      linhas: parte.map(p => p.texto), continuacao: i > 0, valores,
      altura: MM_IDENTIFICACAO + parte.length * MM_LINHA + (valores ? MM_VALORES : 0) + MM_MOLDURA + MM_ESPACO,
    });
  }
  return fragmentos;
}

/** Chips de filtro empacotados em fileiras que cabem na largura da folha. */
function fileirasDeChips(chips: string[]): string[][] {
  const fileiras: string[][] = [];
  let atual: string[] = [], largura = 0;
  for (const chip of chips) {
    // 3,2 `em` cobrem o padding do chip e o intervalo até o próximo.
    const espaco = larguraTexto(chip) + 3.2;
    if (atual.length && largura + espaco > EM_NOTA) { fileiras.push(atual); atual = []; largura = 0; }
    atual.push(chip); largura += espaco;
  }
  if (atual.length) fileiras.push(atual);
  return fileiras;
}

const META_DO_CABECALHO = ["Empresa", "CNPJ", "Período", "Filtrar período por", "Como ler os totais", "Emitido em", "Agrupamento"];

/**
 * Cada faixa de grupo é impressa uma única vez, junto do seu primeiro serviço.
 * Quando a lista quebra a folha, a continuação segue direto na linha seguinte —
 * repetir setor e realizador no topo de cada folha comia o espaço útil e não
 * dizia nada que a folha anterior já não tivesse dito.
 */
export function paginarServicos(linhas: LinhaServico[], por: FiltrosServicos["agruparPor"], metadados: MetadadosServicos, capacidadeFixa?: number): PaginaServicos[] {
  const valorMeta = (k: string) => metadados.find(([nome]) => nome === k)?.[1] || "";
  const contexto = {
    periodo: valorMeta("Período") || "Todo o período", eixo: valorMeta("Filtrar período por") || "Entrada da OS",
    cnpj: valorMeta("CNPJ"), agrupamento: valorMeta("Agrupamento") || AGRUPAMENTOS[por],
  };
  const paginas: PaginaServicos[] = [];
  const criarPagina = (): PaginaServicos => ({ blocos: [], altura: 0, ...contexto });
  let pagina = criarPagina();
  // Os grupos abertos atravessam a quebra de folha: é o que impede a faixa de
  // ser reimpressa só porque a lista continuou na folha seguinte.
  let gruposAtuais: string[] = [];
  const capacidade = () => capacidadeFixa ?? capacidadeDaFolha(paginas.length);
  const adicionar = (bloco: BlocoRelatorio) => { pagina.blocos.push(bloco); pagina.altura += bloco.altura; };
  const novaPagina = () => { if (pagina.blocos.length) paginas.push(pagina); pagina = criarPagina(); };

  adicionar({
    tipo: "painel", chave: "painel-totais", linhas: [], altura: 27, totais: somarServicos(linhas),
    participacoes: linhas.length, realizadores: new Set(linhas.map(l => l.realizadorId)).size, agrupamento: contexto.agrupamento,
  });
  const chips = metadados
    .filter(([k, v]) => !META_DO_CABECALHO.includes(k) && v && !["Todos", "Todas"].includes(v))
    .map(([k, v]) => `${k}: ${v}`);
  const fileiras = fileirasDeChips(chips.length ? chips : ["Sem filtros adicionais: todos os criadores, realizadores, setores e status"]);
  const blocoFiltros: BlocoFiltros = { tipo: "filtros", chave: "filtros", chips: fileiras, linhas: fileiras.flat(), altura: fileiras.length * 5 + 2 };
  if (pagina.altura + blocoFiltros.altura > capacidade()) novaPagina();
  adicionar(blocoFiltros);

  const incluir = (servico: BlocoServico, cabecalhos: BlocoGrupo[]) => {
    // Só entram as faixas que mudaram de fato. A quebra de folha não recria
    // nenhuma: o grupo aberto continua aberto na folha seguinte.
    const novos = cabecalhos.filter((g, i) => g.chave !== gruposAtuais[i]);
    const alturaDasFaixas = novos.reduce((s, g) => s + g.altura, 0);
    if (pagina.altura + servico.altura + alturaDasFaixas > capacidade()) novaPagina();
    if (servico.altura + alturaDasFaixas > capacidade()) throw new Error("Cabeçalho excede o espaço disponível na folha.");
    novos.forEach(g => adicionar(g));
    adicionar(servico); gruposAtuais = cabecalhos.map(g => g.chave);
  };
  for (const grupo of agruparServicos(linhas, por)) {
    const pai = cabecalhoGrupo(grupo, 0);
    const folhas = grupo.filhos.length ? grupo.filhos : [grupo];
    for (const realizador of folhas) {
      const cabecalhos = grupo.filhos.length ? [pai, cabecalhoGrupo(realizador, 1, pai.chave)] : [pai];
      realizador.linhas.forEach(l => fragmentosServico(l).forEach(f => incluir(f, cabecalhos)));
    }
  }
  const vazio = !linhas.length;
  const nota = quebrarTexto(vazio ? "Nenhum serviço encontrado para os filtros selecionados." : NOTA_COMPARTILHADOS, EM_NOTA);
  const blocoNota: BlocoNota = { tipo: "nota", chave: "nota-final", vazio, linhas: nota, altura: nota.length * MM_LINHA_NOTA + 8 };
  if (pagina.altura + blocoNota.altura > capacidade()) novaPagina();
  adicionar(blocoNota);
  novaPagina();
  return paginas;
}

export function endpointServicosValido(endpoint: string) {
  return endpoint === "/api/reports/servicos-realizados/export" || endpoint.startsWith("/api/reports/servicos-realizados/export?");
}
