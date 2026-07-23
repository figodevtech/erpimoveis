"use client";

import * as React from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Eye,
  Loader2,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { toast } from "@/lib/toast";

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
  fonte: "evento" | "legado";
  usuario: Usuario | Usuario[] | null;
};

type Resposta = {
  eventos: Evento[];
  referencias: Record<string, Record<string, string>>;
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
  const titulos: Record<string, string> = {
    agendamento: "Agendamento",
    categoriavenda: "Categoria de venda",
    cliente: "Cliente",
    cliente_endereco: "Endereço do cliente",
    config_geral: "Configurações gerais",
    entrada: "Entrada de estoque",
    entradaitens: "Itens da entrada",
    lote_pecas: "Peças do lote",
    lotes: "Lote de desmanche",
    ordemservico: "Ordem de serviço",
    osanexo: "Anexo da ordem de serviço",
    osaprovacao: "Aprovação da ordem de serviço",
    osproduto: "Produto da ordem de serviço",
    osservico: "Serviço da ordem de serviço",
    perfil: "Perfil de acesso",
    perfilpermissao: "Permissão do perfil",
    produto: "Produto",
    setor: "Setor",
    usuario: "Usuário",
    veiculo: "Veículo",
    venda: "Venda",
    vendaanexo: "Anexo da venda",
    vendaproduto: "Produto da venda",
  };

  if (titulos[nome]) return titulos[nome];
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
  return usuario?.nome
    || usuario?.email
    || (evento.usuario_id ? "Usuário removido" : evento.fonte === "legado" ? "Não identificado" : "Sistema");
}

const ROTULOS_CAMPOS: Record<string, string> = {
  ativo: "Ativo",
  bairro: "Bairro",
  canal: "Canal",
  cep: "CEP",
  cidade: "Cidade",
  clienteid: "Cliente",
  codigobarras: "Código de barras",
  comissao_percent: "Comissão",
  comissao_venda_percent: "Comissão sobre vendas",
  cpfcnpj: "CPF / CNPJ",
  created_by: "Cadastrado por",
  createdat: "Cadastrado em",
  data_admissao: "Data de admissão",
  data_demissao: "Data de demissão",
  dataentrada: "Data de entrada",
  datasaida: "Data de saída",
  datavenda: "Data da venda",
  deleted_at: "Excluído em",
  deleted_by: "Excluído por",
  desconto_tipo: "Tipo de desconto",
  desconto_valor: "Valor do desconto",
  descricao: "Descrição",
  email: "E-mail",
  endereco: "Endereço",
  enderecocomplemento: "Complemento",
  endereconumero: "Número",
  estado: "Estado",
  estoque: "Estoque",
  estoqueminimo: "Estoque mínimo",
  fabricante: "Fabricante",
  forma_pagamento: "Forma de pagamento",
  grupo: "Grupo",
  id: "ID",
  inscricaoestadual: "Inscrição estadual",
  inscricaomunicipal: "Inscrição municipal",
  is_deleted: "Excluído",
  is_root: "Administrador principal",
  nome: "Nome",
  nomerazaosocial: "Nome / razão social",
  observacoes: "Observações",
  orcamentototal: "Total do orçamento",
  perfilid: "Perfil de acesso",
  permissaoid: "Permissão",
  precocompra: "Preço de compra",
  ultimovalordecompra: "Último valor de compra",
  precovenda: "Preço de venda",
  referencia: "Referência",
  setorid: "Setor",
  status: "Status",
  sub_total: "Subtotal",
  telefone: "Telefone",
  tipopessoa: "Tipo de pessoa",
  titulo: "Título",
  updated_by: "Alterado por",
  updatedat: "Alterado em",
  usuarioid: "Usuário",
  usuariocriadorid: "Criado por",
  valortotal: "Valor total",
  veiculoid: "Veículo",
};

function tituloCampo(campo: string) {
  if (ROTULOS_CAMPOS[campo]) return ROTULOS_CAMPOS[campo];

  const separado = campo
    .replaceAll("_", " ")
    .replace(/([a-zà-ú])([A-Z])/g, "$1 $2")
    .replace(/id$/i, " ID")
    .trim();

  return separado.charAt(0).toUpperCase() + separado.slice(1);
}

function valorEhData(campo: string, valor: unknown) {
  if (typeof valor !== "string" || !valor) return false;
  if (!/(data|_at$|at$|_em$)/i.test(campo)) return false;
  return !Number.isNaN(new Date(valor).getTime());
}

function formatarValor(campo: string, valor: unknown) {
  if (valor === null || valor === undefined || valor === "") return "Não informado";
  if (valor === "[PROTEGIDO]") return "Dado protegido";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number" && /(valor|preco|salario|orcamento|subtotal|sub_total|desconto)/i.test(campo)) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
  }
  if (valorEhData(campo, valor)) {
    const data = new Date(valor as string);
    const possuiHorario = (valor as string).includes("T");
    return new Intl.DateTimeFormat("pt-BR", possuiHorario
      ? { dateStyle: "short", timeStyle: "medium" }
      : { dateStyle: "short", timeZone: "UTC" }).format(data);
  }
  if (typeof valor === "object") return JSON.stringify(valor, null, 2);
  if (typeof valor === "string" && /^(status|tipo|canal|origem|prioridade)/i.test(campo)) {
    const texto = valor.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
    return texto.charAt(0).toLocaleUpperCase("pt-BR") + texto.slice(1);
  }
  return String(valor);
}

function ValorAuditoria({ campo, valor, referencia }: { campo: string; valor: unknown; referencia?: string }) {
  const vazio = valor === null || valor === undefined || valor === "";
  const complexo = typeof valor === "object" && valor !== null;

  if (referencia) {
    return (
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-foreground">{referencia}</p>
        <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">ID: {String(valor)}</p>
      </div>
    );
  }

  return (
    <div
      className={`break-words text-sm ${vazio ? "italic text-muted-foreground" : "text-foreground"} ${complexo ? "max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-mono text-xs" : ""}`}
    >
      {formatarValor(campo, valor)}
    </div>
  );
}

function DetalhesEvento({
  evento,
  referencias,
  aberto,
  onOpenChange,
}: {
  evento: Evento | null;
  referencias: Record<string, Record<string, string>>;
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
}) {
  if (!evento) return null;
  const dadosReferencia = evento.operacao === "DELETE" ? evento.dados_anteriores : evento.dados_novos;
  const campos = (evento.campos_alterados?.length
    ? evento.campos_alterados
    : Object.keys(dadosReferencia ?? {}))
    .filter((campo, indice, lista) => lista.indexOf(campo) === indice);
  const ehAlteracao = evento.operacao === "UPDATE";
  const descricaoAcao = evento.operacao === "INSERT"
    ? "Dados cadastrados"
    : evento.operacao === "DELETE"
      ? "Dados excluídos"
      : "Alterações realizadas";

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-5 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-7">
            <DialogTitle>{ACAO[evento.operacao].texto} em {tituloTabela(evento.tabela)}</DialogTitle>
            <Badge variant="outline" className={ACAO[evento.operacao].className}>{ACAO[evento.operacao].texto}</Badge>
            {evento.fonte === "legado" ? <Badge variant="secondary">Registro anterior à auditoria</Badge> : null}
          </div>
          <DialogDescription className="mt-1">
            Evento #{evento.id} · {tituloModulo(evento.modulo)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-3 border-b bg-muted/20 p-4 sm:grid-cols-3 sm:px-6">
            <div className="flex min-w-0 items-start gap-3 rounded-lg border bg-background p-3">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Data e hora</p>
                <p className="truncate text-sm font-medium">
                  {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(evento.ocorrido_em))}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-3 rounded-lg border bg-background p-3">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Responsável</p>
                <p className="truncate text-sm font-medium">{nomeUsuario(evento)}</p>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-3 rounded-lg border bg-background p-3">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Registro</p>
                <p className="truncate font-mono text-sm font-medium">{evento.registro_id || "Sem identificador"}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{descricaoAcao}</h3>
              <span className="text-xs text-muted-foreground">{campos.length} {campos.length === 1 ? "campo" : "campos"}</span>
            </div>

            {campos.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Nenhum detalhe foi armazenado para este evento.
              </div>
            ) : ehAlteracao ? (
              <div className="space-y-3">
                {campos.map((campo) => (
                  <div key={campo} className="rounded-lg border p-4">
                    <div className="mb-3 flex flex-wrap items-baseline gap-2">
                      <p className="text-sm font-medium">{tituloCampo(campo)}</p>
                      <span className="font-mono text-[10px] text-muted-foreground">{campo}</span>
                    </div>
                    <div className="grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                      <div className="min-w-0 rounded-md border border-red-200/70 bg-red-50/40 p-3 dark:border-red-950 dark:bg-red-950/20">
                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Antes</p>
                        <ValorAuditoria
                          campo={campo}
                          valor={evento.dados_anteriores?.[campo]}
                          referencia={referencias[campo]?.[String(evento.dados_anteriores?.[campo])]}
                        />
                      </div>
                      <div className="flex items-center justify-center text-muted-foreground">
                        <ArrowRight className="h-4 w-4 rotate-90 sm:rotate-0" />
                      </div>
                      <div className="min-w-0 rounded-md border border-emerald-200/70 bg-emerald-50/40 p-3 dark:border-emerald-950 dark:bg-emerald-950/20">
                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Depois</p>
                        <ValorAuditoria
                          campo={campo}
                          valor={evento.dados_novos?.[campo]}
                          referencia={referencias[campo]?.[String(evento.dados_novos?.[campo])]}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {campos.map((campo) => (
                  <div key={campo} className="min-w-0 rounded-lg border bg-muted/10 p-3">
                    <div className="mb-1 flex flex-wrap items-baseline gap-2">
                      <p className="text-xs font-medium text-muted-foreground">{tituloCampo(campo)}</p>
                      <span className="font-mono text-[9px] text-muted-foreground/70">{campo}</span>
                    </div>
                    <ValorAuditoria
                      campo={campo}
                      valor={dadosReferencia?.[campo]}
                      referencia={referencias[campo]?.[String(dadosReferencia?.[campo])]}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
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
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className={ACAO[evento.operacao].className}>{ACAO[evento.operacao].texto}</Badge>
                        {evento.fonte === "legado" ? <Badge variant="secondary">Legado</Badge> : null}
                      </div>
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
        referencias={resposta?.referencias ?? {}}
        aberto={Boolean(eventoSelecionado)}
        onOpenChange={(aberto) => {
          if (!aberto) setEventoSelecionado(null);
        }}
      />
    </div>
  );
}
