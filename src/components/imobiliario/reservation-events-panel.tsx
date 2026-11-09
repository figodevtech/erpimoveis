"use client";

import { useState, type ElementType, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tipo_transacao } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/types";
import type { EscopoDeEstoque } from "@/lib/usoconsumo/escopo";
import { RemoteState, requestJson, useModulePermission, useRemote } from "./shared";
import { ConsumoEstoqueReservaDialog } from "./consumo-estoque-reserva-dialog";
import {
  LancamentoReservaDialog,
  TIPOS,
  formularioNovo,
  type ContextoDaReserva,
  type Formulario,
  type TipoNovo,
} from "./lancamento-reserva-dialog";
import { type Entity, dateInput, dateLabel, money } from "./model";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Eye,
  Info,
  Landmark,
  Loader2,
  MoreHorizontal,
  PackageMinus,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  WalletCards,
} from "lucide-react";

const TransactionDialog = dynamic(
  () => import("@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/transactionDialog"),
  { ssr: false }
);

/** Situação no financeiro de um custo (evento) ou de um lançamento do proprietário. */
function SituacaoFinanceira({ automatico, estoque, parcelas, lancado }: { automatico?: boolean; estoque?: boolean; parcelas: Entity[]; lancado: boolean }) {
  const [classe, Icon, rotulo] = automatico
    ? ["border-border bg-muted text-muted-foreground", Sparkles, "Automático"]
    : estoque && !lancado
      // Pago quando o item entrou no estoque: não vai ao caixa de novo.
      ? ["border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300", PackageMinus, "Do estoque"]
    : !lancado
      ? ["border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", Clock3, "A lançar"]
      : parcelas.length && parcelas.every((parcela) => parcela.pendente === false)
        ? ["border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", CheckCircle2, "Pago"]
        : ["border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300", WalletCards, parcelas.some((parcela) => parcela.tipo === "RECEITA" && parcela.pendente) ? "A pagar/receber" : "A pagar"];
  return (
    <Badge variant="outline" className={`gap-1 whitespace-nowrap ${classe}`}>
      <Icon className="size-3 shrink-0" />
      {rotulo}
    </Badge>
  );
}

function Acoes({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={label}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Linha({
  badge,
  titulo,
  subtitulo,
  data,
  dataRotulo,
  situacao,
  valor,
  sinal,
  acoes,
  alerta,
  valorClasse,
}: {
  badge: ReactNode;
  titulo: string;
  subtitulo?: string | null;
  alerta?: ReactNode;
  /** Cor do valor no lugar da padrão (verde para entrada, vermelho para saída). */
  valorClasse?: string;
  data: unknown;
  dataRotulo: string;
  situacao: ReactNode;
  valor: number;
  sinal: "+" | "-";
  acoes?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 lg:grid-cols-[minmax(0,1fr)_110px_110px_130px_32px] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {badge}
          <p className="truncate text-sm font-medium text-foreground">{titulo}</p>
        </div>
        {subtitulo ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{subtitulo}</p> : null}
        {alerta ? (
          <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>{alerta}</span>
          </p>
        ) : null}
      </div>
      <div className="row-span-2 self-start lg:hidden">{acoes}</div>
      <div className="text-xs lg:text-sm">
        <span className="text-foreground">{dateLabel(data)}</span>
        <span className="ml-1 text-[11px] text-muted-foreground lg:ml-0 lg:block">{dataRotulo}</span>
      </div>
      <div className="hidden lg:block">{situacao}</div>
      <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
        <span className="lg:hidden">{situacao}</span>
        <span className={`text-sm font-semibold tabular-nums ${valorClasse ?? (sinal === "+" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}`}>
          {sinal === "+" ? "" : "− "}
          {money(valor)}
        </span>
      </div>
      <div className="hidden lg:block">{acoes}</div>
    </div>
  );
}

function Cabecalho({ colunaData }: { colunaData: string }) {
  return (
    <div className="hidden grid-cols-[minmax(0,1fr)_110px_110px_130px_32px] gap-x-3 border-b bg-muted/40 px-4 py-2.5 text-[11px] font-medium text-muted-foreground lg:grid">
      <span>Lançamento</span>
      <span>{colunaData}</span>
      <span>Situação</span>
      <span className="text-right">Valor</span>
      <span />
    </div>
  );
}

function Secao({
  icon: Icon,
  titulo,
  descricao,
  nota,
  acoes,
  children,
}: {
  icon: ElementType;
  titulo: string;
  descricao: string;
  nota?: string;
  acoes?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-col gap-4 border-b p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold tracking-tight text-foreground">{titulo}</h3>
            <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{descricao}</p>
            {nota ? <p className="mt-1 text-[11px] text-muted-foreground/80">{nota}</p> : null}
          </div>
        </div>
        {acoes ? <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Cartão de indicador: valor em destaque e o detalhamento em linhas rótulo/valor. */
function Indicador({
  icon: Icon,
  titulo,
  valor,
  loading,
  iconeClasse,
  valorClasse,
  cardClasse = "bg-card",
  selo,
  linhas,
  extra,
  rodape,
}: {
  icon: ElementType;
  titulo: string;
  valor: number;
  loading: boolean;
  iconeClasse: string;
  valorClasse: string;
  cardClasse?: string;
  selo?: ReactNode;
  linhas: { rotulo: string; valor: string; classe?: string }[];
  extra?: ReactNode;
  rodape?: ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-2xl border p-3.5 shadow-sm transition-colors sm:px-4 ${cardClasse}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex size-7 items-center justify-center rounded-lg ${iconeClasse}`}>
            <Icon className="size-3.5" />
          </span>
          <span className="text-sm font-medium text-muted-foreground">{titulo}</span>
        </div>
        {selo}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-32" />
      ) : (
        <p className={`mt-2 text-xl font-bold tracking-tight tabular-nums ${valorClasse}`}>{money(valor)}</p>
      )}
      {extra}
      <dl className="mt-2 space-y-1 border-t pt-2 text-xs">
        {linhas.map((linha) => (
          <div key={linha.rotulo} className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{linha.rotulo}</dt>
            <dd className={`font-medium tabular-nums text-foreground ${linha.classe ?? ""}`}>{linha.valor}</dd>
          </div>
        ))}
      </dl>
      {rodape ? <div className="mt-auto pt-2 text-xs">{rodape}</div> : null}
    </div>
  );
}

/** Opção do menu "Novo lançamento": ícone, título e uma linha explicando quando usar. */
function OpcaoNovo({ icon: Icon, titulo, descricao, tom, onSelect }: {
  icon: ElementType;
  titulo: string;
  descricao: string;
  tom: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="items-start gap-3 rounded-lg px-2 py-2">
      <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${tom}`}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
      </span>
    </DropdownMenuItem>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="p-8 text-center text-sm text-muted-foreground">{texto}</p>;
}

/**
 * Aba "Eventos financeiros" da reserva, como a da OS na oficina: numa tabela só, o valor da
 * reserva, os custos da imobiliária e o que sai para o proprietário (repasses e despesas que ele
 * arca), de modo que a soma das linhas seja o resultado da imobiliária. A conta do proprietário
 * continua fora da DRE; a tabela é uma visão de gestão da reserva.
 *
 * O pagamento do hóspede não aparece aqui: ele é do proprietário e fica na aba Pagamentos.
 * A taxa de administração não é lançada na lista: ela é o resultado da reserva (o valor menos
 * repasses e despesas do proprietário), mostrado nos cartões. O "Valor da reserva" só entra na
 * lista no check-out, quando a hospedagem foi prestada (migration 20261109010000).
 */
export function ReservationEventsPanel({ reservaId }: { reservaId: number }) {
  const { can } = useModulePermission();
  const podeVer = can("reservas:financeiro") || can("financeiro:visualizar");
  const remote = useRemote(podeVer ? `/api/reservas/${reservaId}/eventos` : null);

  // Registrar segue a regra do servidor (financeAccess): financeiro da reserva ou financeiro:criar.
  const podeRegistrar = can("reservas:financeiro") || can("financeiro:criar");
  // Levar ao caixa e mexer em transação são do financeiro.
  const podeLancar = can("financeiro:criar");
  const podeVerTransacao = can("financeiro:visualizar");
  const podeEditarTransacao = can("financeiro:editar");
  const podeExcluirFinanceiro = can("financeiro:excluir");

  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluir, setExcluir] = useState<{ linha: Entity; fonte: "EVENTO" | "CONTA" } | null>(null);
  // O texto da confirmação usa o último lançamento até o fim da animação de fechamento.
  const [excluirExibido, setExcluirExibido] = useState(excluir);
  if (excluir && excluir !== excluirExibido) setExcluirExibido(excluir);
  const [confirmando, setConfirmando] = useState(false);
  const [lancarCustos, setLancarCustos] = useState<{ ids: number[]; descricao: string; valor: number } | null>(null);
  const [lancarConta, setLancarConta] = useState<Entity | null>(null);
  const [transacaoAberta, setTransacaoAberta] = useState<number | null>(null);
  const [consumoAberto, setConsumoAberto] = useState(false);
  // Baixa no estoque exige a permissão daquele estoque, além do financeiro da reserva.
  const escoposDoConsumo: EscopoDeEstoque[] = [
    ...(can("estoque:editar") ? (["PRODUTO"] as const) : []),
    ...(can("usoconsumo:saida") ? (["USOCONSUMO", "GERAL"] as const) : []),
  ];

  if (!podeVer) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
        Seu perfil não tem acesso aos eventos financeiros desta reserva.
      </div>
    );
  }
  if (remote.error && !remote.data) return <RemoteState error={remote.error} retry={remote.reload} />;

  const loading = remote.loading && !remote.data;
  const reserva: Entity = remote.data?.reserva ?? {};
  const totais: Entity = remote.data?.totais ?? {};
  const eventos: Entity[] = remote.data?.eventos ?? [];
  const lancamentos: Entity[] = remote.data?.lancamentos ?? [];
  const contaDisponivel = remote.data?.contaProprietarioDisponivel !== false;
  const cancelada = reserva.status === "CANCELADA";
  const concluida = reserva.status === "CONCLUIDA";
  const aceitaLancamentos = podeRegistrar && !cancelada;
  const custosALancar = eventos.filter(
    (evento) => !evento.automatico && evento.lancamento_id == null && evento.status === "ATIVO" && evento.pode_gerar_transacao === true
  );

  // Visão de gestão da reserva: o total cobrado do hóspede (pago ou não) contra tudo o que sai
  // por causa dela, custos da imobiliária e repasses. Registrado tudo, o que sobra é a taxa de
  // administração menos os custos, que é o lucro da imobiliária na DRE.
  const centavos = (valor: unknown) => Math.round(Number(valor ?? 0) * 100);
  const receitaReserva = Number(totais.receita_reserva ?? 0);
  const recebido = Number(totais.recebido ?? 0);
  const aReceber = Math.max((centavos(receitaReserva) - centavos(recebido)) / 100, 0);
  const pctRecebido = receitaReserva > 0 ? Math.min(100, Math.max(0, Math.round((recebido / receitaReserva) * 100))) : 0;
  const custos = Number(totais.custos ?? 0);
  const repasses = Number(totais.repasses ?? 0);
  const despesasProprietario = Number(totais.despesas_proprietario ?? 0);
  const taxa = Number(totais.receita_prevista ?? 0);
  // Resultado da reserva: o valor menos tudo o que sai por causa dela (custos, despesas do
  // proprietário e repasses). Com o repasse exato, é a taxa menos os custos.
  const resultado = Number(totais.resultado_previsto ?? 0);
  const lucroDre = (centavos(taxa) - centavos(custos)) / 100;
  // A parte do proprietário é o total menos a taxa e as despesas que ele arca; o que dela ainda
  // não saiu falta repassar.
  const repasseDevido = (centavos(receitaReserva) - centavos(taxa) - centavos(despesasProprietario)) / 100;
  const faltaRepassar = (centavos(repasseDevido) - centavos(repasses)) / 100;
  const margem = receitaReserva > 0 ? (resultado / receitaReserva) * 100 : 0;
  // Repasse acima da parte do proprietário: o aviso vai na linha do repasse mais recente.
  const repasseComAviso = faltaRepassar < 0
    ? lancamentos.filter((linha) => linha.natureza === "REPASSE").sort((a, b) => Number(b.id) - Number(a.id))[0]?.id ?? null
    : null;
  // A tabela de resultado reúne o valor da reserva, os custos e a conta do proprietário; com o
  // valor da reserva lançado (check-out), a soma das linhas fecha com o resultado.
  const temValorDaReserva = eventos.some((evento) => evento.informativo);
  const somaDaLista = (
    eventos.reduce((total, evento) => total + (evento.natureza === "RECEITA" ? 1 : -1) * centavos(evento.valor), 0)
    - lancamentos.reduce((total, linha) => total + centavos(linha.valor), 0)
  ) / 100;
  const tom = !concluida ? "neutro" : resultado < 0 ? "negativo" : faltaRepassar !== 0 ? "atencao" : "positivo";
  const tons = {
    neutro: { card: "bg-card", icone: "bg-primary/10 text-primary", valor: resultado < 0 ? "text-red-600" : "text-primary", selo: "" },
    positivo: { card: "border-emerald-500/30 bg-emerald-500/5", icone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", valor: "text-emerald-600 dark:text-emerald-400", selo: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
    negativo: { card: "border-red-500/30 bg-red-500/5", icone: "bg-red-500/15 text-red-600 dark:text-red-400", valor: "text-red-600 dark:text-red-400", selo: "bg-red-500/15 text-red-700 dark:text-red-300" },
    atencao: { card: "border-amber-500/30 bg-amber-500/5", icone: "bg-amber-500/15 text-amber-600 dark:text-amber-400", valor: "text-amber-600 dark:text-amber-400", selo: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  }[tom];

  const hoje = new Date().toLocaleDateString("en-CA");
  const datas = { inicio: dateInput(reserva.inicio), hoje };
  const percentual = Number(reserva.percentual_admin ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  // O formulário mostra o efeito do lançamento nestes números e sugere o repasse.
  const contexto: ContextoDaReserva = {
    reservaId,
    proprietario: reserva.proprietario?.nomerazaosocial ?? null,
    receitaReserva,
    taxa,
    percentual,
    custos,
    despesasProprietario,
    repasses,
    faltaRepassar,
    lucroDre,
  };
  const abrirNovo = (tipo: TipoNovo) => setFormulario(formularioNovo(tipo, contexto, datas));

  const salvar = async () => {
    if (!formulario) return;
    if (!formulario.descricao.trim()) return toast.error("Informe o título do lançamento.");
    if (!(formulario.valor > 0)) return toast.error("Informe um valor maior que zero.");
    setSalvando(true);
    try {
      const corpo = {
        descricao: formulario.descricao.trim(),
        detalhe: formulario.detalhe.trim() || null,
        valor: formulario.valor,
        data: formulario.data || null,
        atualizado_em: formulario.atualizadoEm,
      };
      const resposta = formulario.modo === "editar"
        ? await requestJson(`/api/reservas/${reservaId}/${formulario.fonte === "CONTA" ? "lancamentos" : "eventos"}/${formulario.id}`, { method: "PATCH", body: JSON.stringify(corpo) })
        : await requestJson(`/api/reservas/${reservaId}/eventos`, {
            method: "POST",
            body: JSON.stringify({ ...corpo, tipo: formulario.tipo, idempotency_key: crypto.randomUUID() }),
          });
      toast.success(formulario.modo === "editar" ? "Lançamento atualizado." : `${TIPOS[formulario.tipo].titulo} registrado.`, {
        description: resposta?.aviso ?? undefined,
      });
      setFormulario(null);
      remote.reload();
    } catch (error) {
      toast.error("Não foi possível salvar o lançamento", { description: (error as Error).message });
    } finally {
      setSalvando(false);
    }
  };

  const confirmar = async (acao: () => Promise<unknown>, sucesso: string, fechar: () => void) => {
    setConfirmando(true);
    try {
      const resposta: any = await acao();
      toast.success(sucesso, { description: resposta?.aviso ?? undefined });
      fechar();
      remote.reload();
    } catch (error) {
      toast.error("Não foi possível concluir", { description: (error as Error).message });
    } finally {
      setConfirmando(false);
    }
  };

  const editarEvento = (evento: Entity) => setFormulario({
    modo: "editar", fonte: "EVENTO",
    tipo: evento.informativo ? "VALOR_RESERVA" : "CUSTO",
    id: Number(evento.id), descricao: evento.descricao ?? "", detalhe: evento.detalhe ?? "",
    valor: Number(evento.valor ?? 0), valorOriginal: Number(evento.valor ?? 0),
    data: dateInput(evento.competencia_em), atualizadoEm: evento.updated_at,
    vinculado: evento.lancamento_id != null || evento.transacaoid != null,
  });

  const menuDoEvento = (evento: Entity) => {
    if (evento.automatico) return podeRegistrar ? (
      <Acoes label={`Ações do evento ${evento.id}`}>
        <DropdownMenuItem onSelect={() => editarEvento(evento)}><Pencil className="mr-2 size-4" /> Editar</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={() => setExcluir({ linha: evento, fonte: "EVENTO" })}>
          <Trash2 className="mr-2 size-4" /> Excluir
        </DropdownMenuItem>
      </Acoes>
    ) : null;
    // Editar o custo mantém a quantidade consumida; excluir devolve o item ao estoque.
    if (evento.origem === "CONSUMO") {
      return podeRegistrar ? (
        <Acoes label={`Ações do consumo ${evento.id}`}>
          <DropdownMenuItem onSelect={() => editarEvento(evento)}><Pencil className="mr-2 size-4" /> Editar</DropdownMenuItem>
          {escoposDoConsumo.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                onSelect={() => setExcluir({ linha: evento, fonte: "EVENTO" })}
              >
                <Trash2 className="mr-2 size-4" /> Excluir
              </DropdownMenuItem>
            </>
          ) : null}
        </Acoes>
      ) : null;
    }
    const lancado = evento.lancamento_id != null;
    const primeira = (evento.parcelas ?? [])[0];
    const itens: ReactNode[] = [];
    if (!lancado && podeLancar && !cancelada) {
      itens.push(
        <DropdownMenuItem key="lancar" onSelect={() => setLancarCustos({ ids: [Number(evento.id)], descricao: `${evento.descricao} · Reserva #${reservaId}`, valor: Number(evento.valor) })}>
          <Send className="mr-2 size-4" /> Lançar no financeiro
        </DropdownMenuItem>
      );
    }
    if (lancado && primeira && podeVerTransacao) {
      itens.push(
        <DropdownMenuItem key="ver" onSelect={() => setTransacaoAberta(Number(primeira.id))}>
          <Eye className="mr-2 size-4" /> Ver transação{(evento.parcelas ?? []).length > 1 ? " (1ª parcela)" : ""}
        </DropdownMenuItem>
      );
      for (const parcela of (evento.parcelas ?? []).slice(1)) {
        itens.push(<DropdownMenuItem key={`parcela-${parcela.id}`} onSelect={() => setTransacaoAberta(Number(parcela.id))}>
          <Eye className="mr-2 size-4" /> Ver parcela/ajuste #{parcela.id}
        </DropdownMenuItem>);
      }
    }
    if (podeRegistrar && (!lancado || podeEditarTransacao)) {
      itens.push(
        <DropdownMenuItem
          key="editar"
          onSelect={() => editarEvento(evento)}
        >
          <Pencil className="mr-2 size-4" /> Editar
        </DropdownMenuItem>
      );
    }
    if (podeRegistrar && (!lancado || podeExcluirFinanceiro)) {
      itens.push(
        <DropdownMenuSeparator key="sep" />,
        <DropdownMenuItem key="excluir" className="text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={() => setExcluir({ linha: evento, fonte: "EVENTO" })}>
          <Trash2 className="mr-2 size-4" /> Excluir
        </DropdownMenuItem>
      );
    }
    return itens.length ? <Acoes label={`Ações do custo ${evento.id}`}>{itens}</Acoes> : null;
  };

  const menuDaConta = (linha: Entity) => {
    const transacao = linha.transacao;
    const itens: ReactNode[] = [];
    if (podeRegistrar && (!transacao || podeEditarTransacao)) {
      itens.push(<DropdownMenuItem key="editar" onSelect={() => setFormulario({
        modo: "editar", fonte: "CONTA", tipo: linha.natureza, id: Number(linha.id),
        descricao: linha.descricao ?? "", detalhe: "", valor: Number(linha.valor), valorOriginal: Number(linha.valor),
        data: dateInput(linha.data), atualizadoEm: linha.updated_at, vinculado: Boolean(transacao),
      })}><Pencil className="mr-2 size-4" /> Editar</DropdownMenuItem>);
    }
    if (!transacao && podeLancar) {
      itens.push(
        <DropdownMenuItem key="lancar" onSelect={() => setLancarConta(linha)}>
          <Send className="mr-2 size-4" /> Lançar no financeiro
        </DropdownMenuItem>
      );
    }
    if (transacao && podeVerTransacao) {
      itens.push(
        <DropdownMenuItem key="ver" onSelect={() => setTransacaoAberta(Number(transacao.id))}>
          <Eye className="mr-2 size-4" /> Ver transação
        </DropdownMenuItem>
      );
      for (const ajuste of (linha.parcelas ?? []).filter((parcela: Entity) => parcela.id !== transacao.id)) {
        itens.push(<DropdownMenuItem key={`ajuste-${ajuste.id}`} onSelect={() => setTransacaoAberta(Number(ajuste.id))}>
          <Eye className="mr-2 size-4" /> Ver ajuste #{ajuste.id}
        </DropdownMenuItem>);
      }
    }
    if (podeRegistrar && (!transacao || podeExcluirFinanceiro)) {
      itens.push(
        <DropdownMenuSeparator key="sep" />,
        <DropdownMenuItem key="excluir" className="text-destructive focus:bg-destructive/10 focus:text-destructive" onSelect={() => setExcluir({ linha, fonte: "CONTA" })}>
          <Trash2 className="mr-2 size-4" /> Excluir
        </DropdownMenuItem>
      );
    }
    return itens.length ? <Acoes label={`Ações do lançamento ${linha.id}`}>{itens}</Acoes> : null;
  };


  return (
    <div className="space-y-4" aria-busy={remote.loading}>
      <div className="grid gap-3 md:grid-cols-3">
        <Indicador
          icon={ArrowUp}
          titulo="Receitas"
          valor={receitaReserva}
          loading={loading}
          iconeClasse="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          valorClasse="text-emerald-600 dark:text-emerald-400"
          extra={
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${loading ? 0 : pctRecebido}%` }} />
              </div>
              <span className="text-[11px] tabular-nums text-muted-foreground">{pctRecebido}% recebido</span>
            </div>
          }
          linhas={[
            { rotulo: "Recebido", valor: money(recebido) },
            { rotulo: "A receber", valor: money(aReceber), classe: aReceber > 0 ? "text-amber-700 dark:text-amber-400" : undefined },
            { rotulo: `Taxa de administração (${percentual}%)`, valor: money(taxa) },
          ]}
        />
        <Indicador
          icon={ArrowDown}
          titulo="Custos e repasses"
          valor={Number(totais.saidas ?? 0)}
          loading={loading}
          iconeClasse="bg-red-500/10 text-red-600 dark:text-red-400"
          valorClasse="text-red-600 dark:text-red-400"
          linhas={[
            { rotulo: "Custos da imobiliária", valor: money(custos) },
            ...(Number(totais.consumo_estoque ?? 0) > 0 ? [{ rotulo: "Consumo de estoque", valor: money(totais.consumo_estoque) }] : []),
            { rotulo: "Despesas do proprietário", valor: money(despesasProprietario) },
            { rotulo: "Repasses", valor: money(repasses) },
            ...(Number(totais.custos_a_lancar ?? 0) > 0
              ? [{ rotulo: "Custos a lançar no financeiro", valor: money(totais.custos_a_lancar), classe: "text-amber-700 dark:text-amber-400" }]
              : []),
          ]}
        />
        <Indicador
          icon={Calculator}
          titulo={concluida ? "Resultado" : "Resultado previsto"}
          valor={resultado}
          loading={loading}
          cardClasse={tons.card}
          iconeClasse={tons.icone}
          valorClasse={tons.valor}
          selo={concluida && receitaReserva > 0 ? (
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${tons.selo}`}>
              {margem.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
            </span>
          ) : null}
          linhas={[
            { rotulo: `Taxa de administração (${percentual}%)`, valor: money(taxa) },
            { rotulo: "Custos da imobiliária", valor: custos > 0 ? `− ${money(custos)}` : money(0) },
            { rotulo: "Repasse devido ao proprietário", valor: money(repasseDevido) },
          ]}
          rodape={
            faltaRepassar > 0 ? (
              <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                <Clock3 className="size-3.5 shrink-0" /> Falta repassar {money(faltaRepassar)} ao proprietário
              </span>
            ) : faltaRepassar < 0 ? null : (
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5 shrink-0" /> Repasse completo
              </span>
            )
          }
        />
      </div>

      {cancelada ? (
        <div className="flex items-center gap-3 rounded-xl border bg-muted/60 px-4 py-3 text-xs font-medium text-muted-foreground">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background"><Info className="size-4" /></span>
          Reserva cancelada: não recebe novos lançamentos.
        </div>
      ) : null}

      <Secao
        icon={Calculator}
        titulo="Resultado da imobiliária"
        descricao="Valor da reserva menos repasses, despesas do proprietário e custos."
        nota="Repasses e despesas do proprietário abatem o saldo dele no extrato e não entram na DRE."
        acoes={
          <>
            <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label="Atualizar eventos" disabled={remote.loading} onClick={remote.reload}>
              <RefreshCw className={`size-4 ${remote.loading ? "animate-spin" : ""}`} />
            </Button>
            {podeLancar && !cancelada && custosALancar.length > 1 ? (
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() =>
                  setLancarCustos({
                    ids: custosALancar.map((evento) => Number(evento.id)),
                    descricao: `Custos da Reserva #${reservaId} (${custosALancar.length} lançamentos)`,
                    valor: Number(totais.custos_a_lancar ?? 0),
                  })
                }
              >
                <Send className="size-4" /> Lançar {custosALancar.length} custos juntos
              </Button>
            ) : null}
            {aceitaLancamentos ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="gap-1.5 shadow-sm">
                    <Plus className="size-4" /> Novo lançamento <ChevronDown className="size-4 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 p-1.5">
                  <DropdownMenuLabel className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Da imobiliária</DropdownMenuLabel>
                  <OpcaoNovo
                    icon={Receipt}
                    titulo="Custo"
                    descricao="Faxina, lavanderia, comissão de canal"
                    tom="bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    onSelect={() => abrirNovo("CUSTO")}
                  />
                  {escoposDoConsumo.length ? (
                    <OpcaoNovo
                      icon={PackageMinus}
                      titulo="Consumo de estoque"
                      descricao="Baixa de itens pelo preço de custo"
                      tom="bg-violet-500/10 text-violet-600 dark:text-violet-400"
                      onSelect={() => setConsumoAberto(true)}
                    />
                  ) : null}
                  {contaDisponivel ? (
                    <>
                      <DropdownMenuSeparator className="my-1.5" />
                      <DropdownMenuLabel className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Do proprietário</DropdownMenuLabel>
                      <OpcaoNovo
                        icon={UserRound}
                        titulo="Despesa do proprietário"
                        descricao="Paga por ele, deduzida do repasse"
                        tom="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        onSelect={() => abrirNovo("DESPESA_PROPRIETARIO")}
                      />
                      <OpcaoNovo
                        icon={Landmark}
                        titulo="Repasse"
                        descricao="Transferência da parte do proprietário"
                        tom="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        onSelect={() => abrirNovo("REPASSE")}
                      />
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      >
        {loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !eventos.length && !lancamentos.length ? (
          <Vazio texto="Nenhum lançamento registrado nesta reserva." />
        ) : (
          <>
            <Cabecalho colunaData="Data" />
            <div className="divide-y">
              {eventos.map((evento) => (
                <Linha
                  key={evento.id}
                  badge={
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        evento.informativo
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : evento.origem === "CONSUMO"
                            ? "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                            : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                      }`}
                    >
                      {evento.informativo ? "Valor da reserva" : evento.origem === "CONSUMO" ? "Consumo de estoque" : "Custo"}
                    </Badge>
                  }
                  titulo={evento.descricao}
                  subtitulo={[evento.detalhe, evento.criado_por?.nome ? `por ${evento.criado_por.nome}` : null].filter(Boolean).join(" · ")}
                  data={evento.competencia_em}
                  dataRotulo="Data"
                  situacao={
                    <SituacaoFinanceira
                      automatico={evento.automatico}
                      estoque={evento.origem === "CONSUMO"}
                      parcelas={evento.parcelas ?? []}
                      lancado={evento.lancamento_id != null}
                    />
                  }
                  valor={Number(evento.valor)}
                  sinal={evento.natureza === "RECEITA" ? "+" : "-"}
                  acoes={menuDoEvento(evento)}
                />
              ))}
              {/* Conta do proprietário: deduções do valor da reserva, fora da DRE. */}
              {lancamentos.map((linha) => (
                <Linha
                  key={`conta-${linha.id}`}
                  badge={
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        linha.natureza === "REPASSE"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      }`}
                    >
                      {linha.natureza === "REPASSE" ? "Repasse" : "Despesa do proprietário"}
                    </Badge>
                  }
                  titulo={linha.descricao}
                  subtitulo={linha.transacao ? `Transação #${linha.transacao.id}` : "No extrato do proprietário"}
                  data={linha.data}
                  dataRotulo="Data"
                  situacao={<SituacaoFinanceira parcelas={linha.parcelas ?? []} lancado={Boolean(linha.transacao)} />}
                  valor={Number(linha.valor)}
                  sinal="-"
                  // Dinheiro do proprietário: âmbar escuro, para não parecer custo da imobiliária.
                  valorClasse="text-amber-700 dark:text-amber-500"
                  alerta={linha.id === repasseComAviso
                    ? `Repassado ${money(-faltaRepassar)} acima da parte do proprietário (devido: ${money(repasseDevido)}).`
                    : null}
                  acoes={menuDaConta(linha)}
                />
              ))}
            </div>
            {/* Com o valor da reserva na lista (após o check-out), a soma das linhas é o resultado. */}
            {temValorDaReserva ? (
              <div className="flex items-center justify-between gap-3 border-t bg-gradient-to-r from-primary/[0.06] to-transparent px-4 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Calculator className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Resultado da imobiliária</p>
                    <p className="text-[11px] text-muted-foreground">Soma dos lançamentos acima.</p>
                  </div>
                </div>
                <span className={`rounded-lg px-3 py-1.5 text-base font-bold tabular-nums ${somaDaLista < 0 ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}>
                  {somaDaLista < 0 ? "− " : ""}
                  {money(Math.abs(somaDaLista))}
                </span>
              </div>
            ) : null}
          </>
        )}
      </Secao>

      <LancamentoReservaDialog
        formulario={formulario}
        onChange={setFormulario}
        onClose={() => setFormulario(null)}
        onSalvar={() => void salvar()}
        salvando={salvando}
        contexto={contexto}
        datas={datas}
      />

      <ConsumoEstoqueReservaDialog
        open={consumoAberto}
        onOpenChange={setConsumoAberto}
        reservaId={reservaId}
        competenciaPadrao={dateInput(reserva.inicio) || hoje}
        escopos={escoposDoConsumo}
        onSuccess={remote.reload}
      />

      <AlertDialog open={Boolean(excluir)} onOpenChange={(open) => {
        if (!open && !confirmando) setExcluir(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir lançamento?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {excluirExibido ? `“${excluirExibido.linha.descricao}” será excluído e os totais da reserva serão atualizados. ` : ""}
              {excluirExibido?.linha.origem === "CONSUMO"
                ? "O item será devolvido ao estoque."
                : excluirExibido?.linha.informativo
                  ? "O registro informativo será retirado do painel."
                  : "Transações em aberto serão ajustadas. Se já houve pagamento, a diferença ficará a pagar ou receber."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={confirmando}
              onClick={(event) => {
                event.preventDefault();
                if (!excluir) return;
                void confirmar(() => requestJson(`/api/reservas/${reservaId}/${excluir.fonte === "CONTA" ? "lancamentos" : "eventos"}/${excluir.linha.id}`, {
                  method: "DELETE", body: JSON.stringify({ atualizado_em: excluir.linha.updated_at }),
                }), "Lançamento excluído.", () => setExcluir(null));
              }}
            >
              {confirmando ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Custos da imobiliária: o lançamento de eventos da OS (à vista, a prazo ou boleto parcelado). */}
      {lancarCustos ? (
        <TransactionDialog
          key={lancarCustos.ids.join("-")}
          open
          setOpen={(open) => {
            if (!open) setLancarCustos(null);
          }}
          handleGetTransactions={() => remote.reload()}
          internalCompanyExpense
          lockValue
          lancamentoDeEventos={{ eventosIds: lancarCustos.ids, onConcluido: () => setLancarCustos(null) }}
          initialTransaction={{
            tipo: Tipo_transacao.DESPESA,
            descricao: lancarCustos.descricao,
            valor: lancarCustos.valor,
            valorLiquido: lancarCustos.valor,
            pendente: true,
            parcelas: 1,
            data: new Date(),
          }}
        />
      ) : null}

      {/* Conta do proprietário: a transação nasce como recurso de terceiros, sem novo movimento no extrato. */}
      {lancarConta ? (
        <TransactionDialog
          key={`conta-${lancarConta.id}`}
          open
          setOpen={(open) => {
            if (!open) setLancarConta(null);
          }}
          handleGetTransactions={() => remote.reload()}
          lockValue
          initialTransaction={{
            tipo: Tipo_transacao.DESPESA,
            imovel_lancamento_id: Number(lancarConta.id),
            descricao: lancarConta.descricao,
            valor: Number(lancarConta.valor),
            valorLiquido: Number(lancarConta.valor),
            pendente: false,
            parcelas: 1,
            data: new Date(),
          }}
        />
      ) : null}

      {transacaoAberta != null ? (
        <TransactionDialog
          key={`transacao-${transacaoAberta}`}
          open
          setOpen={(open) => {
            if (!open) setTransacaoAberta(null);
          }}
          selectedTransactionId={transacaoAberta}
          setSelectedTransactionId={(id) => {
            if (id == null) setTransacaoAberta(null);
          }}
          handleGetTransactions={() => remote.reload()}
        />
      ) : null}
    </div>
  );
}
