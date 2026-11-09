"use client";

import { useState, type ElementType } from "react";
import { ArrowRight, Building2, Info, Landmark, Loader2, Sparkles, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { money } from "./model";

/**
 * Formulário dos lançamentos da aba "Eventos financeiros" da reserva: custo da imobiliária
 * (DRE), despesa que o proprietário arca e repasse a ele (fora da DRE). Cada tipo mostra o
 * efeito do lançamento no que a tela acompanha, para o operador conferir antes de salvar.
 */

export type TipoNovo = "CUSTO" | "DESPESA_PROPRIETARIO" | "REPASSE";
type TipoLancamento = TipoNovo | "TAXA_ADMIN" | "ESTORNO_TAXA" | "VALOR_RESERVA";

export type Formulario = {
  modo: "novo" | "editar";
  tipo: TipoLancamento;
  id?: number;
  fonte?: "EVENTO" | "CONTA";
  atualizadoEm?: string;
  vinculado?: boolean;
  descricao: string;
  detalhe: string;
  valor: number;
  data: string;
  /** Na edição, o valor gravado: o efeito mostrado é a diferença. */
  valorOriginal?: number;
};

/** O que a tela já sabe da reserva, para sugerir e mostrar o efeito do lançamento. */
export type ContextoDaReserva = {
  reservaId: number;
  /** Nome do proprietário, para o título sugerido do repasse. */
  proprietario?: string | null;
  receitaReserva: number;
  taxa: number;
  percentual: string;
  custos: number;
  despesasProprietario: number;
  repasses: number;
  /** Parte do proprietário que ainda não saiu: o repasse sugerido. */
  faltaRepassar: number;
  /** Taxa menos custos: o lucro esperado da imobiliária na DRE. */
  lucroDre: number;
};

export const TIPOS: Record<
  TipoLancamento,
  {
    titulo: string;
    curto: string;
    descricao: string;
    icon: ElementType;
    dre: boolean;
    cor: { tile: string; ativo: string; botao: string };
    sugestoes: (contexto: ContextoDaReserva) => string[];
    placeholder: string;
    acao: string;
  }
> = {
  VALOR_RESERVA: {
    titulo: "Valor da reserva", curto: "Valor total da estadia",
    descricao: "Valor registrado automaticamente na criação da reserva para acompanhar a estadia.",
    icon: Building2, dre: false,
    cor: { tile: "bg-primary/10 text-primary", ativo: "", botao: "" },
    sugestoes: () => [], placeholder: "Valor da reserva", acao: "Salvar alterações",
  },
  TAXA_ADMIN: {
    titulo: "Taxa de administração", curto: "Receita da imobiliária",
    descricao: "Receita gerada pelo pagamento do hóspede. O ajuste atualiza a DRE e o extrato do proprietário.",
    icon: Sparkles, dre: true,
    cor: { tile: "bg-emerald-500/10 text-emerald-600", ativo: "", botao: "bg-emerald-600 text-white hover:bg-emerald-700" },
    sugestoes: () => [], placeholder: "Taxa de administração", acao: "Salvar alterações",
  },
  ESTORNO_TAXA: {
    titulo: "Estorno da taxa de administração", curto: "Dedução da receita",
    descricao: "Dedução gerada pelo reembolso ao hóspede. O ajuste atualiza a DRE e o extrato do proprietário.",
    icon: Sparkles, dre: true,
    cor: { tile: "bg-amber-500/10 text-amber-600", ativo: "", botao: "bg-amber-600 text-white hover:bg-amber-700" },
    sugestoes: () => [], placeholder: "Estorno da taxa de administração", acao: "Salvar alterações",
  },
  CUSTO: {
    titulo: "Custo da imobiliária",
    curto: "Pago pela imobiliária",
    descricao: "Pago com o dinheiro da imobiliária (faxina, lavanderia, comissão de canal). Entra na DRE e reduz o resultado.",
    icon: Building2,
    dre: true,
    cor: {
      tile: "bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400",
      ativo: "border-sky-500/60 bg-sky-500/5 ring-1 ring-sky-500/30",
      botao: "bg-sky-600 text-white hover:bg-sky-700",
    },
    sugestoes: () => ["Faxina de saída", "Lavanderia", "Comissão do canal", "Manutenção"],
    placeholder: "Ex.: Faxina de saída",
    acao: "Registrar custo",
  },
  DESPESA_PROPRIETARIO: {
    titulo: "Despesa do proprietário",
    curto: "Deduzida do repasse",
    descricao: "O proprietário arca com ela (ex.: a limpeza). É deduzida do repasse dele e fica fora da DRE.",
    icon: UserRound,
    dre: false,
    cor: {
      tile: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
      ativo: "border-amber-500/60 bg-amber-500/5 ring-1 ring-amber-500/30",
      botao: "bg-amber-600 text-white hover:bg-amber-700",
    },
    sugestoes: () => ["Limpeza por conta do proprietário", "Manutenção do imóvel", "Reposição de enxoval"],
    placeholder: "Ex.: Limpeza por conta do proprietário",
    acao: "Registrar despesa",
  },
  REPASSE: {
    titulo: "Repasse ao proprietário",
    curto: "Parte do proprietário",
    descricao: "Transfere ao proprietário a parte dele na reserva. Não é despesa: fica fora da DRE.",
    icon: Landmark,
    dre: false,
    cor: {
      tile: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
      ativo: "border-emerald-500/60 bg-emerald-500/5 ring-1 ring-emerald-500/30",
      botao: "bg-emerald-600 text-white hover:bg-emerald-700",
    },
    sugestoes: ({ reservaId, proprietario }) => [
      proprietario?.trim() ? `Repasse da Reserva #${reservaId} ao proprietário ${proprietario.trim()}` : `Repasse da Reserva #${reservaId} ao proprietário`,
    ],
    placeholder: "Ex.: Repasse da estadia",
    acao: "Registrar repasse",
  },
};

const centavos = (valor: number) => Math.round(Number(valor || 0) * 100);
const subtrair = (a: number, b: number) => (centavos(a) - centavos(b)) / 100;

/** O repasse sugerido é o que falta da parte do proprietário; nunca negativo. */
export const repasseSugerido = (contexto: ContextoDaReserva) => Math.max(contexto.faltaRepassar, 0);

/** Valores iniciais de um lançamento novo, já com título e (no repasse) valor sugeridos. */
export function formularioNovo(tipo: TipoNovo, contexto: ContextoDaReserva, datas: { inicio: string; hoje: string }): Formulario {
  return {
    modo: "novo",
    tipo,
    descricao: tipo === "REPASSE" ? TIPOS.REPASSE.sugestoes(contexto)[0] : "",
    detalhe: "",
    valor: tipo === "REPASSE" ? repasseSugerido(contexto) : 0,
    // Custo é competência da estadia; o que mexe na conta do proprietário é do dia.
    data: tipo === "CUSTO" ? datas.inicio || datas.hoje : datas.hoje,
  };
}

function LinhaConta({ rotulo, valor, sinal, destaque }: { rotulo: string; valor: number; sinal?: "-" | "="; destaque?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1 text-xs", destaque && "border-t pt-2 text-sm font-semibold text-foreground")}>
      <span className={destaque ? "" : "text-muted-foreground"}>
        {sinal === "-" ? "− " : sinal === "=" ? "= " : ""}
        {rotulo}
      </span>
      <span className="tabular-nums">{money(valor)}</span>
    </div>
  );
}

function AntesDepois({ rotulo, antes, depois, alerta }: { rotulo: string; antes: number; depois: number; alerta?: string | null }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold tabular-nums">
        <span className="text-muted-foreground line-through decoration-muted-foreground/40">{money(antes)}</span>
        <ArrowRight className="size-3.5 text-muted-foreground" />
        <span className={depois < 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}>{money(depois)}</span>
      </div>
      {alerta ? <p className="text-xs text-red-600 dark:text-red-400">{alerta}</p> : null}
    </div>
  );
}

/** O que muda na reserva se o lançamento for salvo. */
function Efeito({ formulario, contexto, onUsarSugerido }: { formulario: Formulario; contexto: ContextoDaReserva; onUsarSugerido: () => void }) {
  // Na edição, o valor antigo já está nos totais: o efeito é só a diferença.
  const delta = subtrair(formulario.valor, formulario.valorOriginal ?? 0);

  if (formulario.tipo === "VALOR_RESERVA") {
    return <p className="rounded-xl border bg-muted/30 p-3.5 text-xs text-muted-foreground">
      Este registro é informativo. Para alterar o preço cobrado do hóspede, edite os valores no cadastro da reserva.
    </p>;
  }

  if (formulario.tipo === "REPASSE") {
    const sugerido = Math.max(contexto.faltaRepassar + (formulario.valorOriginal ?? 0), 0);
    const restante = subtrair(contexto.faltaRepassar, delta);
    return (
      <div className="space-y-3 rounded-xl border bg-muted/30 p-3.5">
        <div>
          <LinhaConta rotulo="Total da reserva" valor={contexto.receitaReserva} />
          <LinhaConta rotulo={`Taxa de administração (${contexto.percentual}%)`} valor={contexto.taxa} sinal="-" />
          {contexto.despesasProprietario > 0 ? (
            <LinhaConta rotulo="Despesas do proprietário" valor={contexto.despesasProprietario} sinal="-" />
          ) : null}
          {contexto.repasses > 0 ? <LinhaConta rotulo="Já repassado" valor={contexto.repasses} sinal="-" /> : null}
          <LinhaConta rotulo="Repasse sugerido" valor={sugerido} sinal="=" destaque />
        </div>
        {centavos(formulario.valor) !== centavos(sugerido) && sugerido > 0 ? (
          <Button type="button" variant="outline" size="sm" className="h-8 w-full gap-1.5 text-xs" onClick={onUsarSugerido}>
            <Sparkles className="size-3.5" /> Usar o valor sugerido ({money(sugerido)})
          </Button>
        ) : null}
        {sugerido <= 0 ? (
          <p className="text-xs text-muted-foreground">A parte do proprietário nesta reserva já foi toda repassada ou deduzida.</p>
        ) : restante < 0 ? (
          <p className="text-xs text-red-600 dark:text-red-400">
            Este repasse passa {money(-restante)} da parte do proprietário nesta reserva.
          </p>
        ) : restante > 0 ? (
          <p className="text-xs text-muted-foreground">Depois deste repasse ainda faltará repassar {money(restante)}.</p>
        ) : (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">Com este repasse, a parte do proprietário fica quitada.</p>
        )}
      </div>
    );
  }

  if (formulario.tipo === "TAXA_ADMIN" || formulario.tipo === "ESTORNO_TAXA") {
    const ajuste = formulario.tipo === "TAXA_ADMIN" ? delta : -delta;
    return <div className="space-y-3 rounded-xl border bg-muted/30 p-3.5">
      <AntesDepois rotulo="Lucro esperado da imobiliária" antes={contexto.lucroDre} depois={contexto.lucroDre + ajuste} />
      <AntesDepois rotulo="Falta repassar ao proprietário" antes={contexto.faltaRepassar} depois={contexto.faltaRepassar - ajuste} />
    </div>;
  }

  if (formulario.tipo === "DESPESA_PROPRIETARIO") {
    const depois = subtrair(contexto.faltaRepassar, delta);
    return (
      <div className="rounded-xl border bg-muted/30 p-3.5">
        <AntesDepois
          rotulo="Falta repassar ao proprietário"
          antes={contexto.faltaRepassar}
          depois={depois}
          alerta={depois < 0 ? "A despesa passa da parte do proprietário nesta reserva; o saldo dele fica negativo." : null}
        />
      </div>
    );
  }

  const depois = subtrair(contexto.lucroDre, delta);
  return (
    <div className="rounded-xl border bg-muted/30 p-3.5">
      <AntesDepois
        rotulo="Lucro esperado da imobiliária nesta reserva (taxa menos custos)"
        antes={contexto.lucroDre}
        depois={depois}
        alerta={depois < 0 && contexto.lucroDre >= 0 ? "Com este custo, a reserva passa a dar prejuízo para a imobiliária." : null}
      />
    </div>
  );
}

export function LancamentoReservaDialog({
  formulario: formularioAberto,
  onChange,
  onClose,
  onSalvar,
  salvando,
  contexto,
  datas,
}: {
  formulario: Formulario | null;
  onChange: (formulario: Formulario) => void;
  onClose: () => void;
  onSalvar: () => void;
  salvando: boolean;
  contexto: ContextoDaReserva;
  datas: { inicio: string; hoje: string };
}) {
  // Ao fechar, o pai zera o formulário antes de a animação de saída terminar. Mantém o último na
  // tela até lá, senão o conteúdo some e o diálogo encolhe no meio da animação.
  const [ultimo, setUltimo] = useState(formularioAberto);
  if (formularioAberto && formularioAberto !== ultimo) setUltimo(formularioAberto);
  const formulario = formularioAberto ?? ultimo;
  const tipo = formulario ? TIPOS[formulario.tipo] : null;
  const Icon = tipo?.icon ?? Building2;
  const editando = formulario?.modo === "editar";

  const trocarTipo = (novo: TipoNovo) => {
    if (!formulario || novo === formulario.tipo) return;
    const base = formularioNovo(novo, contexto, datas);
    // O que o operador digitou fica; o que era sugestão do tipo anterior é trocado.
    const tituloSugerido = TIPOS[formulario.tipo].sugestoes(contexto).includes(formulario.descricao);
    onChange({
      ...formulario,
      tipo: novo,
      descricao: !formulario.descricao.trim() || tituloSugerido ? base.descricao : formulario.descricao,
      valor: novo === "REPASSE" && (formulario.valor <= 0 || formulario.tipo !== "REPASSE") ? base.valor : formulario.valor,
      data: base.data,
    });
  };

  return (
    <Dialog open={Boolean(formularioAberto)} onOpenChange={(open) => !open && !salvando && onClose()}>
      <DialogContent className={cn("flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-xl", !editando && "h-[min(840px,92dvh)]")}>
        {formulario && tipo ? (
          <>
            <DialogHeader className="shrink-0">
              <div className="flex items-start gap-3 text-left">
                <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tipo.cor.tile)}>
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle>{editando ? `Editar ${tipo.titulo.toLocaleLowerCase("pt-BR")}` : tipo.titulo}</DialogTitle>
                    <Badge variant="outline" className={cn("text-[10px]", tipo.dre ? "border-sky-500/30 text-sky-700 dark:text-sky-300" : "text-muted-foreground")}>
                      {tipo.dre ? "Entra na DRE" : "Fora da DRE"}
                    </Badge>
                  </div>
                  <DialogDescription>{tipo.descricao}</DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
              {!editando ? (
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de lançamento">
                  {(["CUSTO", "DESPESA_PROPRIETARIO", "REPASSE"] as TipoNovo[]).map((chave) => {
                    const opcao = TIPOS[chave];
                    const OpcaoIcon = opcao.icon;
                    const ativo = formulario.tipo === chave;
                    return (
                      <button
                        key={chave}
                        type="button"
                        role="radio"
                        aria-checked={ativo}
                        onClick={() => trocarTipo(chave)}
                        className={cn(
                          "flex flex-col gap-2 rounded-xl border p-3 text-left transition-all hover:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          ativo ? opcao.cor.ativo : "border-border/60 hover:bg-muted/50"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn("flex size-7 items-center justify-center rounded-lg", opcao.cor.tile)}>
                            <OpcaoIcon className="size-3.5" />
                          </span>
                          <span className={cn("text-[10px] font-medium", opcao.dre ? "text-sky-700 dark:text-sky-300" : "text-muted-foreground")}>
                            {opcao.dre ? "DRE" : "Fora da DRE"}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground">{opcao.titulo}</p>
                          <p className="text-[11px] text-muted-foreground">{opcao.curto}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="evento-titulo">Título</Label>
                <Input
                  id="evento-titulo"
                  maxLength={200}
                  value={formulario.descricao}
                  placeholder={tipo.placeholder}
                  onChange={(event) => onChange({ ...formulario, descricao: event.target.value })}
                />
                <div className="flex flex-wrap gap-1.5">
                  {tipo.sugestoes(contexto).map((sugestao) => (
                    <button
                      key={sugestao}
                      type="button"
                      onClick={() => onChange({ ...formulario, descricao: sugestao })}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:cursor-pointer",
                        formulario.descricao === sugestao ? "border-primary/50 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {sugestao}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="evento-valor">Valor</Label>
                  <ValueInput
                    id="evento-valor"
                    value={formulario.valor}
                    onValueChange={(valor) => onChange({ ...formulario, valor })}
                    placeholder="R$ 0,00"
                    className="text-base font-semibold"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="evento-data">{tipo.dre ? "Competência (mês da DRE)" : "Data"}</Label>
                  <Input
                    id="evento-data"
                    type="date"
                    value={formulario.data}
                    onChange={(event) => onChange({ ...formulario, data: event.target.value })}
                  />
                </div>
              </div>

              {tipo.dre ? (
                <div className="space-y-2">
                  <Label htmlFor="evento-detalhe">Detalhe (opcional)</Label>
                  <Textarea
                    id="evento-detalhe"
                    maxLength={2000}
                    rows={2}
                    value={formulario.detalhe}
                    placeholder="Fornecedor, nota fiscal, observações"
                    onChange={(event) => onChange({ ...formulario, detalhe: event.target.value })}
                  />
                </div>
              ) : null}

              <Efeito
                formulario={formulario}
                contexto={contexto}
                onUsarSugerido={() => onChange({ ...formulario, valor: Math.max(contexto.faltaRepassar + (formulario.valorOriginal ?? 0), 0) })}
              />

              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                <p>
                  {formulario.vinculado
                    ? "Parcelas em aberto são atualizadas. Se já houve pagamento, a diferença vira um ajuste a pagar ou receber, preservando as baixas anteriores."
                    : formulario.tipo === "VALOR_RESERVA"
                      ? "Gerado na criação da reserva. Os pagamentos são acompanhados na aba Pagamentos."
                    : formulario.tipo === "TAXA_ADMIN" || formulario.tipo === "ESTORNO_TAXA"
                      ? "O ajuste vale para este evento. A porcentagem padrão da reserva é mantida para os próximos pagamentos."
                    : formulario.tipo === "CUSTO"
                    ? "Para pagar, use “Lançar no financeiro” na lista: aceita à vista, a prazo ou boleto parcelado."
                    : "Entra no extrato do proprietário na hora. A saída do dinheiro vai ao caixa por “Lançar no financeiro” na lista."}
                </p>
              </div>
            </div>

            <DialogFooter className="shrink-0">
              <Button variant="outline" disabled={salvando} onClick={onClose}>
                Cancelar
              </Button>
              <Button className={cn("gap-1.5", !editando && tipo.cor.botao)} disabled={salvando} onClick={onSalvar}>
                {salvando ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
                {editando ? "Salvar alterações" : tipo.acao}
                {!editando && formulario.valor > 0 ? <span className="tabular-nums opacity-90">· {money(formulario.valor)}</span> : null}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
