import * as XLSX from "xlsx";
import { AGRUPAMENTOS, agruparServicos, duracaoSegundos, duracaoTexto, linhasOrdenadas, NOTA_COMPARTILHADOS, numero, somarServicos, texto, type FiltrosServicos, type GrupoServicos, type LinhaServico } from "./servicos-realizados";

type Coluna = { key: keyof LinhaServico; label: string; tipo?: "numero" | "moeda" | "data" | "percentual"; largura: number };
const COLUNAS: Coluna[] = [
  { key: "ordemId", label: "OS", tipo: "numero", largura: 10 },
  { key: "statusOS", label: "Status da OS", largura: 24 },
  { key: "cliente", label: "Cliente", largura: 32 },
  { key: "servicoId", label: "Serviço ID", tipo: "numero", largura: 12 },
  { key: "descricao", label: "Serviço", largura: 45 },
  { key: "complemento", label: "Complemento", largura: 45 },
  { key: "quantidade", label: "Quantidade", tipo: "numero", largura: 12 },
  { key: "realizadorId", label: "Realizador ID", largura: 38 },
  { key: "realizador", label: "Realizador", largura: 28 },
  { key: "percentualAtual", label: "Comissão atual do cadastro (%)", tipo: "percentual", largura: 28 },
  { key: "setorRealizadorId", label: "Setor do realizador ID", largura: 14 },
  { key: "setorRealizador", label: "Setor do realizador", largura: 24 },
  { key: "setorId", label: "Setor ID", largura: 12 },
  { key: "setor", label: "Setor da OS", largura: 24 },
  { key: "criadorId", label: "Criador ID", largura: 38 },
  { key: "criador", label: "Criador da OS", largura: 28 },
  { key: "atribuidoPor", label: "Atribuído por", largura: 28 },
  { key: "valorServico", label: "Valor integral do serviço (R$)", tipo: "moeda", largura: 28 },
  { key: "baseComissao", label: "Base individual (R$)", tipo: "moeda", largura: 24 },
  { key: "percentualAplicado", label: "Percentual aplicado (%)", tipo: "percentual", largura: 24 },
  { key: "comissao", label: "Comissão sugerida (R$)", tipo: "moeda", largura: 24 },
  { key: "situacao", label: "Situação da execução", largura: 24 },
  { key: "inicio", label: "Início individual", tipo: "data", largura: 24 },
  { key: "fim", label: "Término individual", tipo: "data", largura: 24 },
  { key: "dataReferencia", label: "Data de referência", tipo: "data", largura: 24 },
];
export type MetadadosServicos = Array<[string, string]>;

export function criarWorkbookServicos(linhas: LinhaServico[], por: FiltrosServicos["agruparPor"], metadados: MetadadosServicos) {
  const grupos = agruparServicos(linhas, por);
  const ordenadas = linhasOrdenadas(grupos);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    [...COLUNAS.map(c => c.label), "Tempo de execução"],
    ...ordenadas.map(l => [...COLUNAS.map(c => c.tipo === "data" ? dataExcel(String(l[c.key] ?? "")) : l[c.key] ?? ""), duracaoTexto(duracaoSegundos(l.inicio, l.fim))]),
  ]);
  ws["!cols"] = [...COLUNAS.map(c => ({ wch: c.largura })), { wch: 24 }];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: ordenadas.length, c: COLUNAS.length }) };
  COLUNAS.forEach((c, index) => {
    if (c.tipo !== "moeda" && c.tipo !== "percentual" && c.tipo !== "data") return;
    for (let row = 1; row <= ordenadas.length; row++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: index })];
      if (cell?.t === "n") cell.z = c.tipo === "data" ? "dd/mm/yyyy hh:mm:ss" : c.tipo === "moeda" ? '"R$" #,##0.00' : '0.00"%"';
    }
  });
  XLSX.utils.book_append_sheet(wb, ws, "Serviços");
  const resumo: (string | number)[][] = [["Nível", "Grupo", "Realizador", "Comissão atual (%)", "Serviços distintos", "Valor dos serviços (R$)", "Base individual total (R$)", "Comissão sugerida (R$)"]];
  const adicionar = (g: GrupoServicos, pai = "") => {
    resumo.push([AGRUPAMENTOS[g.tipo], pai || g.nome, g.tipo === "realizador" ? g.nome : "", g.percentualAtual ?? "", g.totais.servicos, g.totais.valor, g.totais.base, g.totais.comissao]);
    g.filhos.forEach(filho => adicionar(filho, g.nome));
  };
  grupos.forEach(g => adicionar(g));
  const total = somarServicos(linhas);
  resumo.push(["Total geral", "", "", "", total.servicos, total.valor, total.base, total.comissao]);
  const rs = XLSX.utils.aoa_to_sheet(resumo);
  rs["!cols"] = [20, 32, 32, 24, 20, 26, 28, 26].map(wch => ({ wch }));
  for (let r = 1; r < resumo.length; r++) for (let c = 5; c <= 7; c++) rs[XLSX.utils.encode_cell({ r, c })].z = '"R$" #,##0.00';
  XLSX.utils.book_append_sheet(wb, rs, "Resumo dos grupos");
  const ms = XLSX.utils.aoa_to_sheet([["Filtro", "Valor"], ...metadados, ["Agrupamento", AGRUPAMENTOS[por]], ["Como ler os totais", NOTA_COMPARTILHADOS]]);
  ms["!cols"] = [{ wch: 32 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, ms, "Filtros");
  return wb;
}

// Serial Excel no horário da oficina, preservando milissegundos para duração/ordem.
function dataExcel(v: string): number | string {
  return v && Number.isFinite(Date.parse(v)) ? Date.parse(v) / 86_400_000 + 25569 - 3 / 24 : "";
}
function dataDaPlanilha(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? new Date(Math.round((v - 25569 + 3 / 24) * 86_400_000)).toISOString() : "";
}
/** A impressão lê as mesmas colunas exportadas para o usuário, sem outra consulta. */
export function lerWorkbookServicos(buffer: ArrayBuffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  if (!wb.Sheets["Serviços"] || !wb.Sheets["Filtros"]) throw new Error("Planilha de serviços inválida.");
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Serviços"], { header: 1, defval: "", raw: true });
  if (!COLUNAS.every(c => matriz[0]?.includes(c.label))) throw new Error("Colunas do relatório incompletas.");
  const registros = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Serviços"], { defval: "", raw: true });
  const linhas = registros.map(r => Object.fromEntries(COLUNAS.map(c => {
    const v = r[c.label];
    return [c.key, c.tipo === "data" ? dataDaPlanilha(v) : c.key === "percentualAtual" && v === "" ? null : c.tipo ? numero(v) : texto(v)];
  })) as LinhaServico);
  const metadados = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Filtros"], { header: 1, defval: "" }).slice(1).map(r => [texto(r[0]), texto(r[1])] as [string, string]);
  const agrupamento = metadados.find(([k]) => k === "Agrupamento")?.[1];
  const por = (Object.keys(AGRUPAMENTOS) as FiltrosServicos["agruparPor"][]).find(k => AGRUPAMENTOS[k] === agrupamento);
  if (!por) throw new Error("Agrupamento do relatório inválido.");
  return { linhas, metadados, por };
}
