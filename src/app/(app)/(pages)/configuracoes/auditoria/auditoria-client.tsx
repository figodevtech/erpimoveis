"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Usuario = { id: string; nome: string | null; email: string | null };
type TabelaFiltro = { nome: string; modulo: string };
type Evento = {
  id: number;
  ocorrido_em: string;
  operacao: "INSERT" | "UPDATE" | "DELETE";
  modulo: string;
  tabela: string;
  registro_id: string | null;
  usuario_id: string | null;
  dados_anteriores: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
  campos_alterados: string[];
  origem: "usuario" | "sistema";
  usuario: Usuario | Usuario[] | null;
};

type Resposta = {
  eventos: Evento[];
  paginacao: { pagina: number; porPagina: number; total: number; totalPaginas: number };
};

type Filtros = {
  operacao: string;
  modulo: string;
  tabela: string;
  usuarioId: string;
  busca: string;
  inicio: string;
  fim: string;
};

const FILTROS_INICIAIS: Filtros = {
  operacao: "todas",
  modulo: "todos",
  tabela: "todas",
  usuarioId: "todos",
  busca: "",
  inicio: "",
  fim: "",
};

const ACAO = {
  INSERT: {
    texto: "Criação",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  },
  UPDATE: {
    texto: "Alteração",
    className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  },
  DELETE: {
    texto: "Exclusão",
    className: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  },
} as const;

const MODULOS = [
  "agendamentos",
  "clientes",
  "configuracoes",
  "desmanche",
  "estoque",
  "financeiro",
  "fiscal",
  "marketplace",
  "ordens",
  "usuarios",
  "veiculos",
  "vendas",
  "outros",
] as const;

function tituloTabela(nome: string) {
  return nome
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letra) => letra.toUpperCase());
}

function tituloModulo(nome: string) {
  const titulos: Record<string, string> = {
    agendamentos: "Agendamentos",
    clientes: "Clientes",
    configuracoes: "Configurações",
    desmanche: "Desmanche",
    estoque: "Estoque",
    financeiro: "Financeiro",
    fiscal: "Fiscal",
    marketplace: "Marketplace",
    ordens: "Ordens de serviço",
    usuarios: "Usuários",
    veiculos: "Veículos",
    vendas: "Vendas",
    outros: "Outros",
  };
  return titulos[nome] ?? tituloTabela(nome);
}

function nomeUsuario(evento: Evento) {
  const usuario = Array.isArray(evento.usuario) ? evento.usuario[0] : evento.usuario;
  return usuario?.nome || usuario?.email || (evento.usuario_id ? "Usuário removido" : "Sistema");
}

function formatarValor(valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return "-";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "object") return JSON.stringify(valor, null, 2);
  return String(valor);
}

function DetalhesEvento({
  evento,
  aberto,
  onOpenChange,
}: {
  evento: Evento | null;
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
}) {
  if (!evento) return null;
  const campos = evento.campos_alterados ?? [];

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Detalhes do evento #{evento.id}</DialogTitle>
          <DialogDescription>
            {ACAO[evento.operacao].texto} em {tituloTabela(evento.tabela)} · registro {evento.registro_id || "sem identificador"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">Data e hora</span>
            <p className="font-medium">
              {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(evento.ocorrido_em))}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Responsável</span>
            <p className="font-medium">{nomeUsuario(evento)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Campos afetados</span>
            <p className="font-medium">{campos.length}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-[24%]">Campo</TableHead>
                <TableHead>Antes</TableHead>
                <TableHead>Depois</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campos.map((campo) => (
                <TableRow key={campo}>
                  <TableCell className="font-mono text-xs font-medium">{campo}</TableCell>
                  <TableCell>
                    <pre className="max-w-[300px] whitespace-pre-wrap break-words font-sans text-xs">
                      {formatarValor(evento.dados_anteriores?.[campo])}
                    </pre>
                  </TableCell>
                  <TableCell>
                    <pre className="max-w-[300px] whitespace-pre-wrap break-words font-sans text-xs">
                      {formatarValor(evento.dados_novos?.[campo])}
                    </pre>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FiltrosAuditoria({
  aberto,
  onOpenChange,
  filtros,
  setFiltros,
  tabelas,
  usuarios,
  onAplicar,
  onLimpar,
}: {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  filtros: Filtros;
  setFiltros: React.Dispatch<React.SetStateAction<Filtros>>;
  tabelas: TabelaFiltro[];
  usuarios: Usuario[];
  onAplicar: () => void;
  onLimpar: () => void;
}) {
  const alterar = (campo: keyof Filtros, valor: string) => {
    setFiltros((atuais) => ({ ...atuais, [campo]: valor }));
  };
  const tabelasDisponiveis = filtros.modulo === "todos"
    ? tabelas
    : tabelas.filter((item) => item.modulo === filtros.modulo);

  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1 hover:cursor-pointer">
          <SlidersHorizontal className="h-4 w-4" />
          Filtros
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filtros da auditoria</SheetTitle>
        </SheetHeader>

        <div className="grid flex-1 auto-rows-min gap-6 px-4">
          <div className="space-y-2">
            <Label htmlFor="busca-auditoria">ID do registro</Label>
            <Input
              id="busca-auditoria"
              value={filtros.busca}
              onChange={(event) => alterar("busca", event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onAplicar();
              }}
              placeholder="Ex.: 1042"
            />
          </div>

          <div className="space-y-2">
            <Label>Ação</Label>
            <Select value={filtros.operacao} onValueChange={(valor) => alterar("operacao", valor)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="INSERT">Criações</SelectItem>
                <SelectItem value="UPDATE">Alterações</SelectItem>
                <SelectItem value="DELETE">Exclusões</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Módulo</Label>
            <Select
              value={filtros.modulo}
              onValueChange={(valor) => setFiltros((atuais) => ({ ...atuais, modulo: valor, tabela: "todas" }))}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {MODULOS.map((item) => <SelectItem key={item} value={item}>{tituloModulo(item)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Tabela</Label>
            <Select value={filtros.tabela} onValueChange={(valor) => alterar("tabela", valor)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {tabelasDisponiveis.map((item) => <SelectItem key={item.nome} value={item.nome}>{tituloTabela(item.nome)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Responsável</Label>
            <Select value={filtros.usuarioId} onValueChange={(valor) => alterar("usuarioId", valor)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="sistema">Sistema</SelectItem>
                {usuarios.map((usuario) => (
                  <SelectItem key={usuario.id} value={usuario.id}>{usuario.nome || usuario.email || usuario.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Início</Label>
              <DatePicker
                value={filtros.inicio}
                onChange={(valor) => alterar("inicio", valor)}
                placeholder="Data inicial"
                max={filtros.fim || undefined}
              />
            </div>
            <div className="space-y-2">
              <Label>Fim</Label>
              <DatePicker
                value={filtros.fim}
                onChange={(valor) => alterar("fim", valor)}
                placeholder="Data final"
                min={filtros.inicio || undefined}
              />
            </div>
          </div>

          <div className="mt-2 flex justify-between gap-2">
            <Button type="button" variant="outline" className="w-30" onClick={onLimpar}>Limpar</Button>
            <Button type="button" className="w-30" onClick={onAplicar}>Aplicar</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AuditoriaClient() {
  const [resposta, setResposta] = React.useState<Resposta | null>(null);
  const [tabelas, setTabelas] = React.useState<TabelaFiltro[]>([]);
  const [usuarios, setUsuarios] = React.useState<Usuario[]>([]);
  const [carregando, setCarregando] = React.useState(true);
  const [eventoSelecionado, setEventoSelecionado] = React.useState<Evento | null>(null);
  const [filtrosOpen, setFiltrosOpen] = React.useState(false);
  const [filtros, setFiltros] = React.useState<Filtros>(FILTROS_INICIAIS);
  const [rascunhoFiltros, setRascunhoFiltros] = React.useState<Filtros>(FILTROS_INICIAIS);
  const [pagina, setPagina] = React.useState(1);
  const [porPagina, setPorPagina] = React.useState(25);
  const [recarregarId, setRecarregarId] = React.useState(0);

  React.useEffect(() => {
    fetch("/api/auditoria?metadata=1", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Falha ao carregar filtros");
        return response.json();
      })
      .then((data) => {
        setTabelas(data.tabelas ?? []);
        setUsuarios(data.usuarios ?? []);
      })
      .catch((error) => toast.error(error.message));
  }, [recarregarId]);

  React.useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ pagina: String(pagina), porPagina: String(porPagina) });
    if (filtros.operacao !== "todas") params.set("operacao", filtros.operacao);
    if (filtros.modulo !== "todos") params.set("modulo", filtros.modulo);
    if (filtros.tabela !== "todas") params.set("tabela", filtros.tabela);
    if (filtros.usuarioId !== "todos") params.set("usuarioId", filtros.usuarioId);
    if (filtros.busca.trim()) params.set("busca", filtros.busca.trim());
    if (filtros.inicio) params.set("inicio", filtros.inicio);
    if (filtros.fim) params.set("fim", filtros.fim);

    setCarregando(true);
    fetch(`/api/auditoria?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || "Falha ao carregar auditoria");
        return response.json();
      })
      .then(setResposta)
      .catch((error) => {
        if (error.name !== "AbortError") toast.error(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });
    return () => controller.abort();
  }, [pagina, porPagina, filtros, recarregarId]);

  function abrirFiltros(aberto: boolean) {
    if (aberto) setRascunhoFiltros(filtros);
    setFiltrosOpen(aberto);
  }

  function aplicarFiltros() {
    setFiltros({ ...rascunhoFiltros, busca: rascunhoFiltros.busca.trim() });
    setPagina(1);
    setFiltrosOpen(false);
  }

  function limparFiltros() {
    setRascunhoFiltros(FILTROS_INICIAIS);
    setFiltros(FILTROS_INICIAIS);
    setPagina(1);
    setFiltrosOpen(false);
  }

  const eventos = resposta?.eventos ?? [];
  const paginacao = resposta?.paginacao;
  const totalPaginas = paginacao?.totalPaginas ?? 1;
  const total = paginacao?.total ?? 0;
  const inicioResultado = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const fimResultado = total === 0 ? 0 : Math.min(pagina * porPagina, total);
  const quantidadeFiltros = [
    filtros.operacao !== "todas",
    filtros.modulo !== "todos",
    filtros.tabela !== "todas",
    filtros.usuarioId !== "todos",
    Boolean(filtros.busca),
    Boolean(filtros.inicio),
    Boolean(filtros.fim),
  ].filter(Boolean).length;

  return (
    <div>
      <Card>
        <CardHeader className="border-b-2 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Histórico de auditoria</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRecarregarId((atual) => atual + 1)}
                  className="inline-flex items-center gap-1 text-foreground/50 hover:cursor-pointer hover:text-foreground/70"
                >
                  <span>Recarregar</span>
                  <Loader2 width={12} className={carregando ? "animate-spin" : ""} />
                </button>
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              {quantidadeFiltros > 0 ? <Badge variant="secondary">{quantidadeFiltros} filtro(s)</Badge> : null}
              <FiltrosAuditoria
                aberto={filtrosOpen}
                onOpenChange={abrirFiltros}
                filtros={rascunhoFiltros}
                setFiltros={setRascunhoFiltros}
                tabelas={tabelas}
                usuarios={usuarios}
                onAplicar={aplicarFiltros}
                onLimpar={limparFiltros}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative -mt-[24px] min-h-[300px] px-4 pb-4 pt-0 sm:px-6">
          <div className={`${carregando ? "opacity-100" : "opacity-0"} absolute left-0 right-0 top-0 h-0.5 overflow-hidden bg-slate-400 transition-all`}>
            <div className={`${carregando ? "animate-slideIn" : ""} absolute left-0 h-full w-1/2 -translate-x-full rounded-lg bg-primary`} />
          </div>

          <div className="mt-6 overflow-x-auto rounded-md border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="min-w-[140px]">Data e hora</TableHead>
                  <TableHead className="min-w-[100px]">Ação</TableHead>
                  <TableHead className="min-w-[150px]">Tabela</TableHead>
                  <TableHead className="min-w-[90px]">Registro</TableHead>
                  <TableHead className="min-w-[180px]">Responsável</TableHead>
                  <TableHead className="min-w-[70px]">Campos</TableHead>
                  <TableHead className="w-[70px] text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {carregando && !resposta
                  ? Array.from({ length: 6 }).map((_, index) => (
                      <TableRow key={index}>
                        {Array.from({ length: 7 }).map((__, coluna) => (
                          <TableCell key={coluna}><Skeleton className="h-5 w-full" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  : null}
                {!carregando && eventos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-40 text-center text-muted-foreground">
                      Nenhum evento encontrado com esses filtros.
                    </TableCell>
                  </TableRow>
                ) : null}
                {eventos.map((evento) => (
                  <TableRow key={evento.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(evento.ocorrido_em))}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ACAO[evento.operacao].className}>{ACAO[evento.operacao].texto}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{tituloTabela(evento.tabela)}</TableCell>
                    <TableCell className="font-mono">{evento.registro_id || "-"}</TableCell>
                    <TableCell><div className="max-w-48 truncate">{nomeUsuario(evento)}</div></TableCell>
                    <TableCell className="text-muted-foreground">{evento.campos_alterados?.length ?? 0}</TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 hover:cursor-pointer"
                        onClick={() => setEventoSelecionado(evento)}
                        aria-label={`Ver detalhes do evento ${evento.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex flex-nowrap text-xs text-muted-foreground">
              <span>{inicioResultado}</span>&nbsp;-&nbsp;<span>{fimResultado}</span>
              <span className="ml-1 hidden sm:block">de {total}</span>
              <Loader2 className={`h-4 w-4 transition-opacity ${carregando ? "animate-spin opacity-100" : "opacity-0"}`} />
            </div>

            <div className="flex items-center justify-center space-x-1 sm:space-x-3">
              <Button variant="outline" size="sm" className="hover:cursor-pointer" onClick={() => setPagina(1)} disabled={carregando || pagina === 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="hover:cursor-pointer" onClick={() => setPagina((atual) => Math.max(1, atual - 1))} disabled={carregando || pagina === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-nowrap text-[10px] font-medium sm:text-xs">Pg. {pagina} de {totalPaginas}</span>
              <Button variant="outline" size="sm" className="hover:cursor-pointer" onClick={() => setPagina((atual) => Math.min(totalPaginas, atual + 1))} disabled={carregando || pagina >= totalPaginas}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" className="hover:cursor-pointer" onClick={() => setPagina(totalPaginas)} disabled={carregando || pagina >= totalPaginas}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>

            <Select
              value={String(porPagina)}
              onValueChange={(valor) => {
                setPorPagina(Number(valor));
                setPagina(1);
              }}
            >
              <SelectTrigger size="sm" className="ml-2 w-[70px] hover:cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((quantidade) => (
                  <SelectItem key={quantidade} value={String(quantidade)}>{quantidade}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <DetalhesEvento
        evento={eventoSelecionado}
        aberto={Boolean(eventoSelecionado)}
        onOpenChange={(aberto) => {
          if (!aberto) setEventoSelecionado(null);
        }}
      />
    </div>
  );
}
