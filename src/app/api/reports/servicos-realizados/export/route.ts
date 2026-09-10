import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireRelatoriosAccess } from "@/app/api/_authz/perms";
import { CAMPOS_DATA, dataHora, FiltroInvalido, lerFiltrosServicos, SITUACOES } from "@/lib/relatorios/servicos-realizados";
import { carregarEmpresaRelatorio, carregarOpcoesServicos, carregarServicosRealizados } from "@/lib/relatorios/servicos-realizados-server";
import { criarWorkbookServicos, type MetadadosServicos } from "@/lib/relatorios/servicos-realizados-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    await requireRelatoriosAccess();
    const filtros = lerFiltrosServicos(new URL(req.url).searchParams);
    const [linhas, empresa, opcoes] = await Promise.all([carregarServicosRealizados(filtros), carregarEmpresaRelatorio(), carregarOpcoesServicos()]);
    const pessoa = (id: string) => id ? opcoes.pessoas.find(p => p.id === id)?.nome || "Usuário não identificado" : "Todos";
    const dia = (value: string) => value ? value.split("-").reverse().join("/") : "Sem limite";
    const metadados: MetadadosServicos = [
      ["Empresa", empresa.nome], ["CNPJ", empresa.cnpj], ["Emitido em", dataHora(new Date().toISOString())],
      ["Período", `${dia(filtros.dateFrom)} a ${dia(filtros.dateTo)}`], ["Filtrar período por", CAMPOS_DATA[filtros.campoData]],
      ["Status da OS", filtros.status.length ? filtros.status.map(s => s.replaceAll("_", " ")).join(", ") : "Todos"],
      ["Criador da OS", pessoa(filtros.criadorId)], ["Realizador", pessoa(filtros.realizadorId)],
      ["Setor da OS", filtros.setorId === "SEM_SETOR" ? "Sem setor" : filtros.setorId ? opcoes.setores.find(s => s.id === filtros.setorId)?.nome || `Setor #${filtros.setorId}` : "Todos"],
      ["Número da OS", filtros.ordemId || "Todas"], ["Cliente", filtros.clienteId ? linhas[0]?.cliente || `Cliente #${filtros.clienteId}` : "Todos"],
      ["Situação da execução", SITUACOES[filtros.situacao as keyof typeof SITUACOES] || "Todas"],
    ];
    const wb = criarWorkbookServicos(linhas, filtros.agruparPor, metadados);
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    return new NextResponse(buffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="servicos_realizados.xlsx"', "Cache-Control": "no-store" } });
  } catch (e) {
    const status = Number((e as { statusCode?: number }).statusCode) || 500;
    console.error("[servicos-realizados/export]", e);
    return NextResponse.json({ error: e instanceof FiltroInvalido ? e.message : status === 403 ? "Sem permissão para acessar relatórios." : "Não foi possível gerar o relatório de serviços." }, { status });
  }
}
