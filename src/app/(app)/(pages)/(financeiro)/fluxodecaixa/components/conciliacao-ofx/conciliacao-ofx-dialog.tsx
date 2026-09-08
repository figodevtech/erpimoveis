"use client";

import { useRef, useState } from "react";
import { AlertTriangle, History, Landmark, Upload, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import formatarEmReal from "@/utils/formatarEmReal";
import { useBancos } from "../../hooks/use-bancos";
import { HistoricoImportacoes } from "./historico-importacoes";
import { MovimentoDialog } from "./movimento-dialog";
import TransactionDialog from "../transactionDialog/transactionDialog";
import { decisaoDeNovaTransacao, transacaoInicialOfx } from "./nova-transacao";
import { MovimentoDetalhes } from "./movimento-detalhes";
import { OfxUpload } from "./ofx-upload";
import { ConciliacaoTabela } from "./conciliacao-tabela";
import { GrupoDialog } from "./grupo-dialog";
import {
  ConciliacaoConfirmacao,
  ConciliacaoResultado,
} from "./conciliacao-confirmacao";
import { useConciliacao } from "./use-conciliacao";
import { formatarDia } from "./apresentacao";
import type { MovimentoAnalisado } from "./types";

type Props = {
  aberto: boolean;
  setAberto: (valor: boolean) => void;
  onConcluido: () => void;
};

export function ConciliacaoOfxDialog(props: Props) {
  return props.aberto ? <CentralConciliacao {...props} /> : null;
}

function CentralConciliacao({ aberto, setAberto, onConcluido }: Props) {
  const { bancos, loadingBancos, errorBancos } = useBancos();
  const c = useConciliacao(onConcluido);
  const [aba, setAba] = useState<"CONCILIACAO" | "HISTORICO">("CONCILIACAO");
  const [edicao, setEdicao] = useState<{
    movimento: MovimentoAnalisado;
    modo?: "CRIAR" | "BUSCAR";
  } | null>(null);
  const [detalhes, setDetalhes] = useState<MovimentoAnalisado | null>(null);
  const [confirmacao, setConfirmacao] = useState(false);
  const [trocarArquivo, setTrocarArquivo] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  /** As linhas escolhidas para uma conciliação N:1, enquanto o dialog decide. */
  const [agrupamento, setAgrupamento] = useState<MovimentoAnalisado[]>([]);
  const retornoFoco = useRef<HTMLElement | null>(null);
  const criando =
    edicao &&
    (edicao.modo === "CRIAR" ||
      (!edicao.modo &&
        c.decisoes[edicao.movimento.fingerprint]?.acao === "CRIAR"));
  function fecharEdicao(v: boolean) {
    if (!v) {
      setEdicao(null);
      requestAnimationFrame(() => retornoFoco.current?.focus());
    }
  }
  const preview = c.sessao?.preview;
  const importacao = c.sessao?.importacao;
  const conta =
    preview?.conta.titulo ?? importacao?.banco?.titulo ?? "Conta removida";
  const nomeArquivo = preview?.arquivo.nome ?? importacao?.arquivo_nome ?? "";
  const inicio = preview?.cabecalho.periodoInicio ?? importacao?.periodo_inicio;
  const fim = preview?.cabecalho.periodoFim ?? importacao?.periodo_fim;
  const saldo = preview?.cabecalho.saldoFinal ?? importacao?.saldo_final;
  const saldoInicial =
    preview?.cabecalho.saldoInicial ?? importacao?.saldo_inicial;
  const bloqueado = Boolean(c.ocupado);
  const abrir = async (id: number) => {
    if (await c.abrir(id)) setAba("CONCILIACAO");
  };
  function novoArquivo() {
    if (c.sessao) setTrocarArquivo(true);
    else {
      c.limpar();
      setAba("CONCILIACAO");
    }
  }
  function editar(movimento: MovimentoAnalisado, modo?: "CRIAR" | "BUSCAR") {
    retornoFoco.current = document.activeElement as HTMLElement;
    setEdicao({ movimento, modo });
  }
  const semSelecao = c.selecao.linhas.length === 0;

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        /*
         * Nada fecha esta tela por acidente.
         *
         * Analisar um extrato e decidir movimento a movimento leva minutos, e
         * nada disso é gravado antes de "confirmar o lote": um clique fora ou um
         * Esc distraído jogava fora o trabalho inteiro, sem aviso e sem volta. O
         * único caminho de saída é o X do cabeçalho, que pergunta antes.
         */
        if (!v) {
          if (!bloqueado) setConfirmarSaida(true);
          return;
        }
        setAberto(true);
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1280px,calc(100vw-2rem))]"
        // O X embutido é um `DialogPrimitive.Close`: fecharia sem passar pela
        // confirmação. Quem fecha é o botão do cabeçalho, logo abaixo.
        showCloseButton={false}
        onInteractOutside={(evento) => evento.preventDefault()}
        onEscapeKeyDown={(evento) => evento.preventDefault()}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Fechar conciliação"
          title="Fechar conciliação"
          disabled={bloqueado}
          onClick={() => setConfirmarSaida(true)}
          className="absolute top-3 right-3 z-20 size-8 hover:cursor-pointer"
        >
          <X className="size-4" />
        </Button>
        <div className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6 sm:pr-12">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <DialogHeader className="text-left">
              <DialogTitle className="flex items-center gap-2">
                <Landmark className="size-5 text-primary" />
                Conciliação bancária
              </DialogTitle>
              <DialogDescription>
                Compare o extrato bancário com os lançamentos financeiros do
                ERP.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={aba === "HISTORICO" ? "secondary" : "outline"}
                size="sm"
                disabled={bloqueado}
                onClick={() =>
                  setAba(aba === "HISTORICO" ? "CONCILIACAO" : "HISTORICO")
                }
              >
                <History className="size-4" />
                {aba === "HISTORICO" ? "Voltar à conciliação" : "Histórico"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={bloqueado}
                onClick={novoArquivo}
              >
                <Upload className="size-4" />
                Importar OFX
              </Button>
            </div>
          </div>
          {aba === "CONCILIACAO" && (
            <ol
              aria-label="Etapas da conciliação"
              className="mt-4 flex gap-3 text-xs text-muted-foreground"
            >
              {["Arquivo", "Conferência", "Conciliação"].map((label, i) => (
                <li
                  key={label}
                  aria-current={
                    (importacao ? 2 : preview ? 1 : 0) === i
                      ? "step"
                      : undefined
                  }
                  className={
                    (importacao ? 2 : preview ? 1 : 0) === i
                      ? "font-semibold text-primary"
                      : ""
                  }
                >
                  {i > 0 && (
                    <span className="mr-3" aria-hidden="true">
                      →
                    </span>
                  )}
                  {i + 1}. {label}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div
          className="min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
          aria-busy={bloqueado}
        >
          {c.erro && (
            <div
              role="alert"
              className="mb-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="size-4 shrink-0" />
              {c.erro}
            </div>
          )}
          {errorBancos && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {errorBancos}
            </p>
          )}
          {c.ocupado === "CARREGAR" ? (
            <CarregandoConciliacao />
          ) : aba === "HISTORICO" ? (
            <HistoricoImportacoes
              onAbrirPendencias={(id) => void abrir(id)}
              onImportar={novoArquivo}
              bancos={bancos}
            />
          ) : !c.sessao ? (
            <OfxUpload
              arquivo={c.arquivo}
              onArquivo={c.setArquivo}
              bancoId={c.bancoId}
              onBanco={c.setBancoId}
              bancos={bancos}
              carregandoBancos={loadingBancos}
              analisando={c.ocupado === "ANALISE"}
              onAnalisar={() => void c.analisar()}
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{conta}</p>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {nomeArquivo}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatarDia(inicio)} → {formatarDia(fim)}
                  </p>
                  {preview && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Banco no arquivo:{" "}
                      {preview.cabecalho.bankId ?? "não informado"} · Agência{" "}
                      {preview.cabecalho.branchId ?? "não informada"} · Conta{" "}
                      {preview.cabecalho.acctId ?? "não informada"}
                    </p>
                  )}
                  {importacao && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Importado em{" "}
                      {new Date(importacao.created_at).toLocaleString("pt-BR")}{" "}
                      · Agência {importacao.agencia_ofx ?? "não informada"} ·
                      Conta {importacao.conta_ofx ?? "não informada"}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-sm sm:text-right">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Saldo inicial:{" "}
                    {saldoInicial == null
                      ? "não informado"
                      : formatarEmReal(Number(saldoInicial))}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Saldo final do extrato
                  </p>
                  <p className="mt-1 font-semibold tabular-nums">
                    {saldo == null
                      ? "Não informado"
                      : formatarEmReal(Number(saldo))}
                  </p>
                  {preview && (
                    <Select
                      value={String(preview.conta.id)}
                      disabled={bloqueado}
                      onValueChange={(id) => void c.analisar(id)}
                    >
                      <SelectTrigger
                        aria-label="Alterar conta e reanalisar"
                        className="mt-2 w-full sm:w-56"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {bancos.map((b) => (
                          <SelectItem key={b.id} value={String(b.id)}>
                            {b.titulo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
              {preview?.contaSugerida &&
                preview.contaSugerida.id === preview.conta.id && (
                  <p className="text-xs text-muted-foreground">
                    Conta identificada pelo arquivo: {preview.conta.titulo}.
                    Você pode alterá-la para refazer a análise.
                  </p>
                )}
              {preview?.divergenciaDeConta && (
                <p
                  role="alert"
                  className="rounded-lg border border-amber-600/30 bg-amber-600/10 p-3 text-sm text-amber-800 dark:text-amber-300"
                >
                  {preview.divergenciaDeConta} Confira a conta escolhida antes
                  de confirmar.
                </p>
              )}
              {preview?.arquivo.jaImportado && (
                <div className="flex flex-col gap-3 rounded-lg border border-sky-600/30 bg-sky-600/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      Este arquivo já foi importado.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {conta} · {preview.movimentos.length} movimentos ·
                      Importado em{" "}
                      {new Date(
                        preview.arquivo.jaImportado.created_at,
                      ).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={bloqueado}
                    onClick={() => void abrir(preview.arquivo.jaImportado!.id)}
                  >
                    Abrir conciliação
                  </Button>
                </div>
              )}
              {preview &&
                !preview.arquivo.jaImportado &&
                preview.resumo.jaImportados > 0 && (
                  <p className="rounded-lg border bg-muted/30 p-3 text-xs">
                    Este extrato possui {preview.resumo.jaImportados} movimentos
                    já conhecidos e{" "}
                    {preview.movimentos.length - preview.resumo.jaImportados}{" "}
                    novos. Você pode continuar; movimentos já resolvidos ficam
                    protegidos contra duplicidade.
                  </p>
                )}
              {c.ocupado === "ANALISE" ? (
                <CarregandoConciliacao mensagem="Reanalisando o extrato na conta escolhida…" />
              ) : (
                <ConciliacaoTabela
                  key={importacao?.id ?? preview?.arquivo.hash}
                  movimentos={c.sessao.movimentos}
                  decisoes={c.decisoes}
                  marcadas={c.marcadas}
                  bloqueado={bloqueado || Boolean(preview?.arquivo.jaImportado)}
                  falhas={c.falhas}
                  onMarcar={(chave) =>
                    c.marcarVarios([chave], !c.marcadas.has(chave))
                  }
                  onMarcarVarios={c.marcarVarios}
                  onEditar={editar}
                  onDetalhes={setDetalhes}
                  onIgnorar={(m) =>
                    c.decidir(m, {
                      fingerprint: m.fingerprint,
                      movimentoId: m.movimentoId ?? undefined,
                      acao: "IGNORAR",
                    })
                  }
                  onAgrupar={setAgrupamento}
                />
              )}
            </div>
          )}
        </div>
        {aba === "CONCILIACAO" && c.sessao && !preview?.arquivo.jaImportado && (
          <DialogFooter className="shrink-0 gap-3 border-t bg-background px-4 py-3 sm:items-center sm:justify-between sm:px-6">
            <div className="text-xs">
              <p className="font-medium">
                {c.selecao.linhas.length}{" "}
                {c.selecao.linhas.length === 1
                  ? "movimento selecionado"
                  : "movimentos selecionados"}
              </p>
              {c.selecao.incompletas > 0 && (
                <p className="mt-1 text-amber-700 dark:text-amber-300">
                  {c.selecao.incompletas} ainda precisam de revisão. Escolha uma
                  ação para cada movimento.
                </p>
              )}
              {c.selecao.conflitos.size > 0 && (
                <p className="mt-1 text-destructive">
                  A mesma transação foi escolhida em mais de um movimento.
                  Revise os vínculos.
                </p>
              )}
              {!semSelecao && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-6 px-0 text-xs"
                  disabled={bloqueado}
                  onClick={() => c.marcarVarios([...c.marcadas], false)}
                >
                  Limpar seleção
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!semSelecao && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={bloqueado}
                  onClick={c.ignorarSelecionados}
                >
                  Marcar para ignorar
                </Button>
              )}
              <Button
                disabled={
                  bloqueado ||
                  c.selecao.incompletas > 0 ||
                  c.selecao.conflitos.size > 0 ||
                  Boolean(importacao && semSelecao)
                }
                onClick={() => setConfirmacao(true)}
              >
                {semSelecao && !importacao
                  ? "Importar para conciliar depois"
                  : `Conciliar ${c.selecao.linhas.length} movimento${c.selecao.linhas.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </DialogFooter>
        )}
        {edicao && criando ? (
          <TransactionDialog
            key={edicao.movimento.fingerprint}
            open
            setOpen={fecharEdicao}
            initialTransaction={transacaoInicialOfx(
              edicao.movimento,
              Number(c.bancoId),
              c.decisoes[edicao.movimento.fingerprint],
            )}
            conciliacaoOfx={{
              data: edicao.movimento.dataPostagem,
              valorCentavos: edicao.movimento.valorCentavos,
              bancoId: Number(c.bancoId),
              onPreparar: (transacao) =>
                c.decidir(
                  edicao.movimento,
                  decisaoDeNovaTransacao(edicao.movimento, transacao),
                ),
            }}
          />
        ) : (
          <MovimentoDialog
            movimento={edicao?.movimento ?? null}
            decisaoAtual={
              edicao ? (c.decisoes[edicao.movimento.fingerprint] ?? null) : null
            }
            aberto={Boolean(edicao)}
            modoInicial={edicao?.modo === "BUSCAR" ? "BUSCAR" : undefined}
            bancoId={Number(c.bancoId)}
            conta={conta}
            setAberto={fecharEdicao}
            onCriar={() => {
              if (edicao) setEdicao({ ...edicao, modo: "CRIAR" });
            }}
            onDecidir={(decisao, sugestao) => {
              if (edicao) c.decidir(edicao.movimento, decisao, sugestao);
            }}
          />
        )}
        <MovimentoDetalhes
          movimento={detalhes}
          decisao={detalhes ? c.decisoes[detalhes.fingerprint] : undefined}
          conta={conta}
          arquivo={nomeArquivo}
          importacaoId={importacao?.id ?? null}
          onFechar={() => setDetalhes(null)}
        />
        <ConciliacaoConfirmacao
          aberto={confirmacao}
          onAberto={setConfirmacao}
          decisoes={c.selecao.enviar}
          linhas={c.selecao.linhas}
          conta={conta}
          arquivo={nomeArquivo}
          novaImportacao={!importacao}
          ocupado={bloqueado}
          erro={c.erro}
          onConfirmar={() => {
            void c.confirmar().then((ok) => {
              if (ok) setConfirmacao(false);
            });
          }}
        />
        <ConciliacaoResultado
          resultado={confirmacao ? null : c.resultado}
          movimentos={c.sessao?.movimentos ?? []}
          onContinuar={() => {
            c.setResultado(null);
            if (!c.sessao) setAba("HISTORICO");
          }}
          onFluxo={() => setAberto(false)}
        />
        <Dialog open={trocarArquivo} onOpenChange={setTrocarArquivo}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Importar outro extrato?</DialogTitle>
              <DialogDescription>
                As escolhas ainda não confirmadas serão descartadas. As
                conciliações já registradas permanecem no histórico.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTrocarArquivo(false)}>
                Continuar neste extrato
              </Button>
              <Button
                onClick={() => {
                  c.limpar();
                  setAba("CONCILIACAO");
                  setTrocarArquivo(false);
                }}
              >
                Importar outro OFX
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <GrupoDialog
          linhas={agrupamento}
          aberto={agrupamento.length > 1}
          setAberto={(valor) => {
            if (!valor) setAgrupamento([]);
          }}
          bancoId={Number(c.bancoId)}
          conta={conta}
          onConfirmar={(base) => {
            c.agrupar(agrupamento, base);
            setAgrupamento([]);
          }}
        />
        <AlertDialog open={confirmarSaida} onOpenChange={setConfirmarSaida}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sair da conciliação?</AlertDialogTitle>
              <AlertDialogDescription>
                As escolhas ainda não confirmadas serão descartadas. As
                conciliações já registradas permanecem no histórico.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuar conciliando</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmarSaida(false);
                  setAberto(false);
                }}
              >
                Sair e descartar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function CarregandoConciliacao({
  mensagem = "Carregando movimentos e atualizando correspondências…",
}: {
  mensagem?: string;
}) {
  return (
    <div role="status" className="space-y-3 py-4">
      <p className="text-sm text-muted-foreground">{mensagem}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
