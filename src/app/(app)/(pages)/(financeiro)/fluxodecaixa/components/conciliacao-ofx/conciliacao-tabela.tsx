"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Layers, MoreHorizontal, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import formatarEmReal from "@/utils/formatarEmReal";
import { type Decisao, type MovimentoAnalisado } from "./types";
import {
  decisaoCompleta,
  ehAgrupada,
  descricaoMovimento,
  explicacaoMatch,
  formatarDia,
  normalizarBusca,
  resolvido,
} from "./apresentacao";
import { SituacaoBadge, ValorMovimento } from "./movimento-detalhes";

type Filtro =
  | "TODOS"
  | "PENDENTES"
  | "MATCH_EXATO"
  | "REVISAO"
  | "MATCH_PROVAVEL"
  | "SEM_CORRESPONDENCIA"
  | "CONCILIADO"
  | "IGNORADO";
const filtros: [Filtro, string][] = [
  ["TODOS", "Todos"],
  ["PENDENTES", "Pendentes"],
  ["MATCH_EXATO", "Encontrados"],
  ["MATCH_PROVAVEL", "Prováveis"],
  ["REVISAO", "Revisão"],
  ["SEM_CORRESPONDENCIA", "Não encontrados"],
  ["CONCILIADO", "Conciliados"],
  ["IGNORADO", "Ignorados"],
];
function corresponde(m: MovimentoAnalisado, filtro: Filtro) {
  if (filtro === "TODOS") return true;
  if (filtro === "CONCILIADO" || filtro === "IGNORADO")
    return m.statusGravado === filtro;
  if (resolvido(m)) return false;
  if (filtro === "PENDENTES") return true;
  if (filtro === "REVISAO")
    return ["MATCH_PROVAVEL", "AMBIGUO", "REVISAO_MANUAL"].includes(
      m.analise.situacao,
    );
  return m.analise.situacao === filtro;
}

export function ConciliacaoTabela({
  movimentos,
  decisoes,
  marcadas,
  bloqueado,
  falhas,
  onMarcar,
  onMarcarVarios,
  onEditar,
  onDetalhes,
  onIgnorar,
  onAgrupar,
}: {
  movimentos: MovimentoAnalisado[];
  decisoes: Record<string, Decisao>;
  marcadas: Set<string>;
  bloqueado: boolean;
  falhas: Map<string, string>;
  onMarcar: (chave: string) => void;
  onMarcarVarios: (chaves: string[], marcar: boolean) => void;
  onEditar: (m: MovimentoAnalisado, modo?: "CRIAR" | "BUSCAR") => void;
  onDetalhes: (m: MovimentoAnalisado) => void;
  onIgnorar: (m: MovimentoAnalisado) => void;
  onAgrupar: (linhas: MovimentoAnalisado[]) => void;
}) {
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  const [tipo, setTipo] = useState("TODOS");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const dados = useMemo(() => {
    const contagens = Object.fromEntries(
      filtros.map(([f]) => [f, 0]),
    ) as Record<Filtro, number>;
    let entradas = 0,
      saidas = 0,
      resolvidos = 0;
    const indice = movimentos.map((m) => {
      for (const [f] of filtros) if (corresponde(m, f)) contagens[f]++;
      if (resolvido(m)) resolvidos++;
      if (m.valorCentavos > 0) entradas += m.valorCentavos;
      else saidas += Math.abs(m.valorCentavos);
      const texto = normalizarBusca(
        [
          m.memo,
          m.nome,
          m.transacaoId,
          m.valorCentavos / 100,
          formatarEmReal(Math.abs(m.valorCentavos) / 100),
          ...m.analise.sugestoes.flatMap((s) => [
            s.descricao,
            s.contraparte,
            s.transacaoId,
            s.ordemservicoid ? `OS ${s.ordemservicoid}` : "",
            s.vendaid ? `Venda ${s.vendaid}` : "",
          ]),
        ].join(" "),
      );
      return { m, texto };
    });
    return { contagens, entradas, saidas, resolvidos, indice };
  }, [movimentos]);
  const filtrados = useMemo(() => {
    const termos = normalizarBusca(busca).split(/\s+/).filter(Boolean);
    return dados.indice
      .filter(
        ({ m, texto }) =>
          corresponde(m, filtro) &&
          (tipo === "TODOS" ||
            (tipo === "ENTRADA" ? m.valorCentavos > 0 : m.valorCentavos < 0)) &&
          termos.every((termo) => texto.includes(termo)),
      )
      .map(({ m }) => m);
  }, [dados, busca, filtro, tipo]);
  const paginas = Math.max(1, Math.ceil(filtrados.length / 50));
  const atual = Math.min(pagina, paginas);
  const visiveis = filtrados.slice((atual - 1) * 50, atual * 50);
  const selecionaveis = visiveis.filter((m) => !resolvido(m));
  const marcadasVisiveis = selecionaveis.filter((m) =>
    marcadas.has(m.fingerprint),
  ).length;
  const progresso = movimentos.length
    ? Math.round((dados.resolvidos / movimentos.length) * 100)
    : 0;
  const encontrados = movimentos.filter(
    (m) =>
      !resolvido(m) &&
      m.analise.situacao === "MATCH_EXATO" &&
      decisoes[m.fingerprint]?.acao === "VINCULAR" &&
      decisaoCompleta(decisoes[m.fingerprint]),
  );
  /*
   * As linhas marcadas que podem virar uma conciliação N:1.
   *
   * Vale sobre o extrato inteiro, não sobre a página: as duas linhas do mesmo
   * fato costumam estar lado a lado, mas nada garante isso — e perder a seleção
   * ao paginar seria pior do que não ter o recurso.
   */
  const marcadosParaAgrupar = movimentos.filter(
    (m) => marcadas.has(m.fingerprint) && !resolvido(m),
  );
  const somaDoGrupo = marcadosParaAgrupar.reduce((total, m) => total + m.valorCentavos, 0);
  const mesmoSentido =
    marcadosParaAgrupar.length > 0 &&
    marcadosParaAgrupar.every((m) => m.valorCentavos > 0 === marcadosParaAgrupar[0].valorCentavos > 0);
  const podeAgrupar = marcadosParaAgrupar.length > 1 && mesmoSentido;

  function filtrar(f: Filtro) {
    setFiltro(f);
    setPagina(1);
  }
  function correspondencia(m: MovimentoAnalisado) {
    const d = decisoes[m.fingerprint];
    if (resolvido(m))
      return (
        <span className="text-xs text-muted-foreground">
          {m.transacaoId
            ? `Conciliado com a transação #${m.transacaoId}`
            : m.statusGravado === "IGNORADO"
              ? "Sem lançamento financeiro"
              : "Já conciliado nesta conta"}
        </span>
      );
    if (d?.acao === "CRIAR")
      return (
        <>
          <p className="truncate text-xs font-medium">{d.nova?.descricao}</p>
          <p className="text-[11px] text-muted-foreground">
            Nova transação · aguarda confirmação
          </p>
        </>
      );
    if (d?.acao === "IGNORAR")
      return (
        <p className="text-xs text-muted-foreground">
          Ignorar · aguarda confirmação
        </p>
      );
    if (m.analise.situacao === "AMBIGUO" && !d?.transacaoId)
      return (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {m.analise.sugestoes.length} correspondências possíveis
        </p>
      );
    const s =
      m.analise.sugestoes.find((s) => s.transacaoId === d?.transacaoId) ??
      (!d?.transacaoId ? m.analise.sugestoes[0] : null);
    if (!s)
      return (
        <p className="text-xs text-muted-foreground">
          {d?.transacaoId
            ? `Transação #${d.transacaoId} · escolha manual`
            : "Procure no ERP ou crie uma transação"}
        </p>
      );
    return (
      <>
        <p className="truncate text-xs font-medium">
          {s.descricao || `Transação #${s.transacaoId}`}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {s.contraparte ||
            (s.origem === "FLUXO" ? "Fluxo de Caixa" : "Título em aberto")}{" "}
          · {formatarEmReal(s.valorCentavos / 100)}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {explicacaoMatch(s)}
        </p>
        {d && (
          <p className="text-[11px] text-primary">
            {d.acao === "LIQUIDAR" ? "Baixa revisada" : "Vínculo definido"} ·
            aguarda confirmação
          </p>
        )}
      </>
    );
  }
  /**
   * O aviso de que esta linha não responde sozinha.
   *
   * Sem ele, a linha de R$ 161,01 apareceria conciliada com um lançamento de
   * R$ 904,17 e pareceria erro. Dizer que ela divide o lançamento com outra
   * explica a diferença antes de alguém tentar "corrigir".
   */
  function notaDoGrupo(m: MovimentoAnalisado) {
    const d = decisoes[m.fingerprint];
    if (resolvido(m) || !ehAgrupada(d)) return null;
    const total = d?.grupo?.length ?? 0;
    return (
      <p className="mt-1 text-[11px] text-primary">
        Conciliada junto com {total - 1} outra{total > 2 ? "s" : ""} linha
        {total > 2 ? "s" : ""} do extrato
      </p>
    );
  }

  function acoes(m: MovimentoAnalisado) {
    return (
      <div className="flex items-center justify-end gap-1">
        {!resolvido(m) && (
          <Button
            size="sm"
            variant="outline"
            disabled={bloqueado}
            onClick={() =>
              onEditar(
                m,
                m.analise.situacao === "SEM_CORRESPONDENCIA" &&
                  !decisoes[m.fingerprint]
                  ? "CRIAR"
                  : undefined,
              )
            }
          >
            {decisoes[m.fingerprint]
              ? "Revisar"
              : m.analise.situacao === "SEM_CORRESPONDENCIA"
                ? "Criar transação"
                : m.analise.situacao === "AMBIGUO"
                  ? "Escolher"
                  : "Comparar"}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={bloqueado}
              aria-label={`Ações do movimento ${m.sequencia}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onDetalhes(m)}>
              Ver detalhes
            </DropdownMenuItem>
            {!resolvido(m) && (
              <>
                <DropdownMenuItem onSelect={() => onEditar(m, "BUSCAR")}>
                  Procurar manualmente
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onEditar(m, "CRIAR")}>
                  Criar transação
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onIgnorar(m)}>
                  Marcar para ignorar
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }
  const cards: [Filtro, string][] = [
    ["TODOS", "Movimentos"],
    ["MATCH_EXATO", "Encontrados"],
    ["REVISAO", "Precisam de revisão"],
    ["SEM_CORRESPONDENCIA", "Não encontrados"],
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map(([f, label]) => (
          <button
            key={f}
            type="button"
            aria-pressed={filtro === f}
            onClick={() => filtrar(f)}
            className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring ${filtro === f ? "border-primary/50 bg-primary/5" : "bg-card"}`}
          >
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {dados.contagens[f]}
            </p>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-lg bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-sm">
          <div className="mb-2 flex justify-between text-xs">
            <span>
              {dados.resolvidos} de {movimentos.length} movimentos resolvidos
            </span>
            <span>{progresso}%</span>
          </div>
          <Progress
            value={progresso}
            aria-label="Progresso da conciliação"
            className="h-2"
          />
        </div>
        <div className="flex gap-5 text-xs">
          <div>
            <p className="text-muted-foreground">Entradas no extrato</p>
            <p className="mt-1 font-medium tabular-nums">
              {formatarEmReal(dados.entradas / 100)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Saídas no extrato</p>
            <p className="mt-1 font-medium tabular-nums">
              {formatarEmReal(dados.saidas / 100)}
            </p>
          </div>
        </div>
      </div>
      {movimentos.length > 0 && dados.resolvidos === movimentos.length && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3"
        >
          <CheckCircle2 className="size-5 text-emerald-700 dark:text-emerald-400" />
          <div>
            <p className="text-sm font-semibold">Tudo conciliado</p>
            <p className="text-xs text-muted-foreground">
              Todos os movimentos deste extrato já foram resolvidos, incluindo
              os ignorados.
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1" aria-label="Filtrar por situação">
        {filtros.map(([f, label]) => (
          <Button
            key={f}
            size="sm"
            variant={filtro === f ? "secondary" : "ghost"}
            aria-pressed={filtro === f}
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={() => filtrar(f)}
          >
            {label}
            <span className="tabular-nums text-muted-foreground">
              {dados.contagens[f]}
            </span>
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Buscar no extrato ou no ERP"
            className="pl-9"
            placeholder="Buscar no extrato ou no ERP..."
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setPagina(1);
            }}
          />
        </div>
        <Select
          value={tipo}
          onValueChange={(t) => {
            setTipo(t);
            setPagina(1);
          }}
        >
          <SelectTrigger
            aria-label="Tipo de movimento"
            className="w-full sm:w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TODOS">Entradas e saídas</SelectItem>
            <SelectItem value="ENTRADA">Entradas</SelectItem>
            <SelectItem value="SAIDA">Saídas</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {encontrados.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-auto whitespace-normal py-2 text-xs"
          disabled={bloqueado}
          onClick={() =>
            onMarcarVarios(
              encontrados.map((m) => m.fingerprint),
              true,
            )
          }
        >
          Selecionar todos os encontrados ({encontrados.length})
        </Button>
      )}
      {marcadosParaAgrupar.length > 1 && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs">
            <p className="font-medium">
              {marcadosParaAgrupar.length} linhas selecionadas ·{" "}
              <span className="tabular-nums">
                {formatarEmReal(Math.abs(somaDoGrupo) / 100)}
              </span>
            </p>
            <p className="text-muted-foreground">
              {mesmoSentido
                ? "Se estas linhas são um único lançamento no ERP, concilie-as juntas pela soma."
                : "Para conciliar juntas, selecione só entradas ou só saídas — o extrato precisa mostrar as duas pontas separadas."}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 hover:cursor-pointer"
            disabled={bloqueado || !podeAgrupar}
            onClick={() => onAgrupar(marcadosParaAgrupar)}
          >
            <Layers className="size-4" />
            Conciliar juntas
          </Button>
        </div>
      )}
      {filtrados.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {movimentos.length === 0
              ? "Esta importação não possui movimentos novos. Os repetidos permanecem nas importações de origem."
              : "Nenhum movimento encontrado com estes filtros."}
          </p>
          {movimentos.length > 0 && (
            <Button
              variant="link"
              onClick={() => {
                filtrar("TODOS");
                setTipo("TODOS");
                setBusca("");
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table className="text-xs">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Selecionar movimentos desta página"
                      checked={
                        marcadasVisiveis === 0
                          ? false
                          : marcadasVisiveis === selecionaveis.length
                            ? true
                            : "indeterminate"
                      }
                      disabled={bloqueado || !selecionaveis.length}
                      onCheckedChange={(checked) =>
                        onMarcarVarios(
                          selecionaveis.map((m) => m.fingerprint),
                          checked === true,
                        )
                      }
                    />
                  </TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Movimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Correspondência</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiveis.map((m) => (
                  <TableRow
                    key={m.fingerprint}
                    data-state={
                      marcadas.has(m.fingerprint) ? "selected" : undefined
                    }
                  >
                    <TableCell>
                      <Checkbox
                        checked={marcadas.has(m.fingerprint)}
                        disabled={bloqueado || resolvido(m)}
                        aria-label={`Selecionar movimento ${m.sequencia}`}
                        onCheckedChange={() => onMarcar(m.fingerprint)}
                      />
                    </TableCell>
                    <TableCell>{formatarDia(m.dataPostagem)}</TableCell>
                    <TableCell className="max-w-[220px]">
                      <button
                        className="block w-full cursor-pointer text-left hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => onDetalhes(m)}
                      >
                        <span className="block truncate font-medium">
                          {descricaoMovimento(m).titulo}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {descricaoMovimento(m).complemento}
                        </span>
                      </button>
                      {falhas.has(m.fingerprint) && (
                        <p className="mt-1 whitespace-normal text-xs text-destructive">
                          {falhas.get(m.fingerprint)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <ValorMovimento centavos={m.valorCentavos} />
                    </TableCell>
                    <TableCell>
                      <SituacaoBadge movimento={m} />
                    </TableCell>
                    <TableCell className="max-w-[230px]">
                      {correspondencia(m)}
                      {notaDoGrupo(m)}
                    </TableCell>
                    <TableCell>{acoes(m)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-2 md:hidden">
            {visiveis.map((m) => (
              <div
                key={m.fingerprint}
                className="space-y-3 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={marcadas.has(m.fingerprint)}
                      disabled={bloqueado || resolvido(m)}
                      aria-label={`Selecionar movimento ${m.sequencia}`}
                      onCheckedChange={() => onMarcar(m.fingerprint)}
                    />
                    <span className="text-xs text-muted-foreground">
                      {formatarDia(m.dataPostagem)}
                    </span>
                  </div>
                  <SituacaoBadge movimento={m} />
                </div>
                <div className="flex justify-between gap-3">
                  <button
                    className="min-w-0 text-left text-sm font-medium"
                    onClick={() => onDetalhes(m)}
                  >
                    <span className="block break-words">
                      {descricaoMovimento(m).titulo}
                    </span>
                    <span className="block break-words text-xs font-normal text-muted-foreground">
                      {descricaoMovimento(m).complemento}
                    </span>
                  </button>
                  <ValorMovimento centavos={m.valorCentavos} />
                </div>
                <div className="min-w-0">
                  {correspondencia(m)}
                  {notaDoGrupo(m)}
                </div>
                {falhas.has(m.fingerprint) && (
                  <p className="text-xs text-destructive">
                    {falhas.get(m.fingerprint)}
                  </p>
                )}
                {acoes(m)}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {filtrados.length} movimentos · Página {atual} de {paginas}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={atual === 1}
                onClick={() => setPagina(atual - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={atual === paginas}
                onClick={() => setPagina(atual + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
