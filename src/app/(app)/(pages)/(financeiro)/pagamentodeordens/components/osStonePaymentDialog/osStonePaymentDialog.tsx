// src/app/(app)/(pages)/(financeiro)/pagamentodeordens/components/osStonePaymentDialog/osStonePaymentDialog.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  osId: number;
  handleGetOrdens: () => void;
};

type MetodoMaquineta = "CREDITO" | "DEBITO" | "PIX";

type ItemOrcamentoProduto = {
  descricao: string;
  quantidade: number;
  precounitario: number;
  subtotal: number;
};

type ItemOrcamentoServico = {
  descricao: string;
  quantidade: number;
  precounitario: number;
  subtotal: number;
};

type DetalhesPagamento = {
  id: number;
  ordemservicoid: number;
  status: string;
  nsu: string | null;
  autorizacao: string | null;
  bandeira: string | null;
  valor: number;
};

const STATUS_FINAIS = ["PAGO", "ESTORNADO", "RECUSADO", "CANCELADO"];

export default function OsStonePaymentDialog({
  open,
  onOpenChange,
  osId,
  handleGetOrdens,
}: Props) {
  const [metodo, setMetodo] = useState<MetodoMaquineta>("CREDITO");
  const [valor, setValor] = useState<string>("");
  const [parcelas, setParcelas] = useState<number>(1);
  const [carregandoOS, setCarregandoOS] = useState(false);
  const [totalOS, setTotalOS] = useState<number | null>(null);
  const [statusOS, setStatusOS] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [emitirNfeProdutos, setEmitirNfeProdutos] = useState<boolean>(false);

  const [itensProdutos, setItensProdutos] = useState<ItemOrcamentoProduto[]>(
    []
  );
  const [itensServicos, setItensServicos] = useState<ItemOrcamentoServico[]>(
    []
  );

  // Pagamento / PDV
  const [pagamentoId, setPagamentoId] = useState<number | null>(null);
  const [statusPagamento, setStatusPagamento] = useState<string | null>(null);
  const [detalhesPagamento, setDetalhesPagamento] =
    useState<DetalhesPagamento | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Controle do polling com ref para evitar múltiplos intervals
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  function limparIntervalo() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }

  // Carrega dados da OS (orcamento + itens) quando abrir
  useEffect(() => {
    if (!open || !osId) return;

    const carregarOS = async () => {
      try {
        setCarregandoOS(true);
        setItensProdutos([]);
        setItensServicos([]);

        const resp = await fetch(`/api/ordens/${osId}`, { cache: "no-store" });
        const dados = await resp.json().catch(() => ({} as any));

        if (!resp.ok) {
          console.error("Erro ao carregar OS:", dados);
          toast.error("Não foi possível carregar a OS para cobrança.");
          return;
        }

        // Status da OS (para saber se já está concluída)
        setStatusOS(dados?.os?.status ?? null);

        // ===== Total do orçamento =====
        let bruto: unknown = dados?.os?.orcamentototal;

        if (
          (bruto === null || bruto === undefined || Number(bruto) <= 0) &&
          dados?.orcamento
        ) {
          const produtos = Array.isArray(dados.orcamento.produtos)
            ? dados.orcamento.produtos
            : [];
          const servicos = Array.isArray(dados.orcamento.servicos)
            ? dados.orcamento.servicos
            : [];

          const somaProd = produtos.reduce(
            (acc: number, p: any) => acc + Number(p.subtotal || 0),
            0
          );
          const somaServ = servicos.reduce(
            (acc: number, s: any) => acc + Number(s.subtotal || 0),
            0
          );

          bruto = somaProd + somaServ;
        }

        const numero = Number(bruto);
        if (!Number.isNaN(numero) && numero > 0) {
          setTotalOS(numero);
          setValor(numero.toFixed(2).replace(".", ",")); // formato BR
        } else {
          setTotalOS(null);
        }

        // ===== Itens do orçamento =====
        const produtosOrc = Array.isArray(dados?.orcamento?.produtos)
          ? (dados.orcamento.produtos as any[])
          : [];
        const servicosOrc = Array.isArray(dados?.orcamento?.servicos)
          ? (dados.orcamento.servicos as any[])
          : [];

        setItensProdutos(
          produtosOrc.map((p) => ({
            descricao: String(p.descricao ?? "Produto"),
            quantidade: Number(p.quantidade ?? 0),
            precounitario: Number(p.precounitario ?? 0),
            subtotal: Number(p.subtotal ?? 0),
          }))
        );

        setItensServicos(
          servicosOrc.map((s) => ({
            descricao: String(s.descricao ?? "Serviço"),
            quantidade: Number(s.quantidade ?? 0),
            precounitario: Number(s.precounitario ?? 0),
            subtotal: Number(s.subtotal ?? 0),
          }))
        );
      } catch (err) {
        console.error("Erro ao buscar OS:", err);
        toast.error("Erro ao buscar informações da OS.");
      } finally {
        setCarregandoOS(false);
      }
    };

    carregarOS();
  }, [open, osId]);

  function limparEstado() {
    limparIntervalo();
    setMetodo("CREDITO");
    setValor("");
    setParcelas(1);
    setTotalOS(null);
    setStatusOS(null);
    setEmitirNfeProdutos(false);
    setItensProdutos([]);
    setItensServicos([]);
    setPagamentoId(null);
    setStatusPagamento(null);
    setDetalhesPagamento(null);
    setLogs([]);
  }

  function handleChangeOpen(novoOpen: boolean) {
    if (!novoOpen) {
      limparEstado();
    }
    onOpenChange(novoOpen);
  }

  function parseValorParaNumero(valorStr: string): number {
    // "1.234,56" -> 1234.56
    const normalizado = valorStr
      .replace(/\./g, "")
      .replace(",", ".")
      .trim();
    const n = Number(normalizado);
    return Number.isFinite(n) ? n : 0;
  }

  async function handleConfirmarPagamento() {
    const numeroValor = parseValorParaNumero(valor);

    if (!numeroValor || numeroValor <= 0) {
      toast.error("Informe um valor válido para o pagamento.");
      return;
    }

    if (numeroValor < 1) {
      toast.error("Valor mínimo para envio à maquineta é maior que zero.");
      return;
    }

    setEnviando(true);
    try {
      const tipoPagamentoApi =
        metodo === "CREDITO" ? "credit" : metodo === "DEBITO" ? "debit" : "pix";

      const resp = await fetch("/api/pagamentos/stone/pedido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ordemServicoId: osId,
          valor: numeroValor,
          descricao: `OS #${osId}`,
          tipoPagamento: tipoPagamentoApi,
          parcelas: metodo === "CREDITO" ? parcelas ?? 1 : 1,
          direto: true,
          emitirNfeProdutos,
        }),
      });

      const dados = await resp.json().catch(() => ({} as any));

      if (!resp.ok || dados?.erro) {
        console.error("Erro ao criar pedido Stone:", dados);
        toast.error(
          dados?.erro ||
            "Não foi possível enviar o pedido para a maquineta. Tente novamente."
        );
        return;
      }

      // Backend deve retornar pagamentoId e objeto pagamento
      const idPagamento: number | undefined =
        dados.pagamentoId ?? dados.pagamento?.id;

      if (!idPagamento) {
        console.warn(
          "Resposta da API não contém pagamentoId. Verifique o backend."
        );
      } else {
        setPagamentoId(idPagamento);
        const statusInicial =
          (dados.pagamento?.status as string | undefined) ?? "CRIADO";
        setStatusPagamento(statusInicial.toUpperCase());
        setLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] Pedido criado no Pagar.me (pagamento #${
            idPagamento ?? "?"
          }).`,
        ]);
      }

      toast.success("Pedido enviado para a maquineta.");
    } catch (err) {
      console.error("Erro ao processar pagamento:", err);
      toast.error("Erro inesperado ao processar pagamento na maquineta.");
    } finally {
      setEnviando(false);
    }
  }

  // Carregar pagamento (novo formato: { pagamento, eventos })
  async function carregarPagamento(id: number) {
    try {
      const resp = await fetch(`/api/pagamentos/${id}`, { cache: "no-store" });
      const dados = await resp.json().catch(() => ({} as any));

      if (!resp.ok || dados?.erro) {
        console.error("Erro ao consultar pagamento:", dados);
        return;
      }

      const pagamento = dados.pagamento ?? dados; // fallback se o backend ainda estiver no formato antigo
      const eventos = Array.isArray(dados.eventos) ? dados.eventos : [];

      const statusBruto = pagamento?.status as string | undefined;
      const novoStatus = statusBruto ? statusBruto.toUpperCase() : "CRIADO";

      setDetalhesPagamento({
        id: Number(pagamento.id),
        ordemservicoid: Number(pagamento.ordemservicoid),
        status: novoStatus,
        nsu: pagamento.nsu ?? null,
        autorizacao: pagamento.autorizacao ?? null,
        bandeira: pagamento.bandeira ?? null,
        valor: Number(pagamento.valor ?? 0),
      });

      setStatusPagamento((statusAntigo) => {
        const anterior = statusAntigo?.toUpperCase();
        if (anterior !== novoStatus) {
          setLogs((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] Status atualizado: ${novoStatus}.`,
          ]);
        }
        return novoStatus;
      });

      // Logs dos eventos (simples)
      if (eventos.length) {
        setLogs((prev) => {
          const novosLogs = [...prev];
          for (const ev of eventos as any[]) {
            const tipo = ev.tipo ?? "EVENTO";
            const criado = ev.criado_em
              ? new Date(ev.criado_em).toLocaleTimeString()
              : new Date().toLocaleTimeString();
            const linha = `[${criado}] Evento: ${tipo}`;
            if (!novosLogs.includes(linha)) {
              novosLogs.push(linha);
            }
          }
          return novosLogs;
        });
      }

      // Se status final, encerra polling e, se PAGO, atualiza lista de OS
      const ehFinal = STATUS_FINAIS.includes(novoStatus);
      if (ehFinal) {
        limparIntervalo();

        if (novoStatus === "PAGO") {
          toast.success("Pagamento aprovado na maquineta.");
          handleGetOrdens();
        } else if (novoStatus === "RECUSADO") {
          toast.error("Pagamento recusado na maquineta.");
        } else if (novoStatus === "ESTORNADO") {
          toast("Pagamento estornado.", {
            description: "Verifique o extrato de transações.",
          });
        }
      }
    } catch (err) {
      console.error("Erro ao consultar pagamento (polling):", err);
    }
  }

  // Polling do pagamento enquanto não está em status final
  useEffect(() => {
    // Se dialog fechado ou não há pagamento, não pollar
    if (!open || !pagamentoId) {
      limparIntervalo();
      return;
    }

    const statusEhFinalLocal = STATUS_FINAIS.includes(
      (statusPagamento ?? "").toUpperCase()
    );

    // Se já está em status final, não pollar
    if (statusEhFinalLocal) {
      limparIntervalo();
      return;
    }

    // Evitar múltiplos intervals
    if (pollingRef.current) return;

    // Consulta imediata
    carregarPagamento(pagamentoId);

    // Continua consultando a cada 3s
    pollingRef.current = setInterval(() => {
      carregarPagamento(pagamentoId);
    }, 3000);

    return () => {
      limparIntervalo();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pagamentoId, statusPagamento]);

  const carregandoTudo = carregandoOS && !totalOS && !itensProdutos.length;

  const statusEhFinal = STATUS_FINAIS.includes(
    (statusPagamento ?? "").toUpperCase()
  );

  const osConcluida =
    (statusOS ?? "").toUpperCase() === "CONCLUIDO";

  const pago =
    (statusPagamento ?? "").toUpperCase() === "PAGO";

  // Botão NF – por enquanto simulando, depois você pluga na rota real
  async function handleEmitirImprimirNota() {
    try {
      // Aqui você pode, no futuro, chamar sua rota real, por exemplo:
      // await fetch(`/api/nfe/os/${osId}/emitir`, { method: "POST" });
      // window.open(`/nfe/os/${osId}/danfe`, "_blank");

      toast.info(
        "Simulação: emissão/impressão da nota fiscal. Integre aqui com sua API de NF-e/NFC-e."
      );
    } catch (err) {
      console.error("Erro ao emitir/imprimir NF:", err);
      toast.error("Erro ao tentar emitir/imprimir a nota fiscal.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleChangeOpen}>
      <DialogContent className="flex max-h-[80vh] w-[95vw] max-w-[95vw] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Pagamento na maquineta - OS #{osId}</DialogTitle>
          <DialogDescription>
            Confira os itens do orçamento, escolha o método de pagamento e
            acompanhe o status da cobrança em tempo real.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid flex-1 gap-4 overflow-hidden md:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)]">
          {/* COLUNA ESQUERDA: resumo + itens */}
          <div className="relative flex flex-col rounded-md border bg-muted/40 p-3">
            {carregandoTudo && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-md bg-background/80">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm text-muted-foreground">
                  Carregando orçamento da OS...
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Total do orçamento:</span>
              <span className="font-semibold text-foreground">
                {totalOS != null ? `R$ ${totalOS.toFixed(2)}` : "—"}
              </span>
            </div>

            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Produtos: {itensProdutos.length} • Serviços:{" "}
                {itensServicos.length}
              </span>
              <span>
                Itens totais: {itensProdutos.length + itensServicos.length}
              </span>
            </div>

            <div className="mt-2 flex-1 overflow-auto rounded-md bg-background p-2 text-xs">
              {itensProdutos.length === 0 && itensServicos.length === 0 && (
                <p className="text-muted-foreground">
                  Nenhum item encontrado para esta OS.
                </p>
              )}

              {itensProdutos.length > 0 && (
                <div>
                  <p className="mb-1 font-semibold">Produtos</p>
                  <div className="space-y-1">
                    {itensProdutos.map((p, idx) => (
                      <div
                        key={`prod-${idx}`}
                        className="flex items-center justify-between gap-2 rounded border bg-muted/40 px-2 py-1"
                      >
                        <div className="flex-1">
                          <p className="text-[13px] font-medium">
                            {p.descricao}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Qtd: {p.quantidade} | Unit: R${" "}
                            {p.precounitario.toFixed(2)} | Subtotal: R${" "}
                            {p.subtotal.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {itensServicos.length > 0 && (
                <div>
                  <p className="mb-1 mt-2 font-semibold">Serviços</p>
                  <div className="space-y-1">
                    {itensServicos.map((s, idx) => (
                      <div
                        key={`serv-${idx}`}
                        className="flex items-center justify-between gap-2 rounded border bg-muted/40 px-2 py-1"
                      >
                        <div className="flex-1">
                          <p className="text-[13px] font-medium">
                            {s.descricao}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Qtd: {s.quantidade} | Unit: R${" "}
                            {s.precounitario.toFixed(2)} | Subtotal: R${" "}
                            {s.subtotal.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* COLUNA DIREITA: pagamento + status */}
          <div className="flex h-full flex-col gap-3 overflow-auto">
            <div className="space-y-2">
              <Label>Método na maquineta</Label>
              <Select
                value={metodo}
                onValueChange={(v) => setMetodo(v as MetodoMaquineta)}
                disabled={!!pagamentoId && !statusEhFinal}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o método" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CREDITO">
                    Cartão de crédito (maquineta Stone)
                  </SelectItem>
                  <SelectItem value="DEBITO">
                    Cartão de débito (maquineta Stone)
                  </SelectItem>
                  <SelectItem value="PIX">PIX na maquineta Stone</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Valor a receber (R$)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="Ex: 250,00"
                disabled={!!pagamentoId && !statusEhFinal}
              />
              <p className="text-xs text-muted-foreground">
                Por padrão usamos o valor total do orçamento, mas você pode
                ajustar para receber parcialmente.
              </p>
            </div>

            {metodo === "CREDITO" && (
              <div className="space-y-2">
                <Label>Parcelas</Label>
                <Select
                  value={String(parcelas)}
                  onValueChange={(v) => setParcelas(Number(v))}
                  disabled={!!pagamentoId && !statusEhFinal}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o número de parcelas" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }).map((_, i) => {
                      const n = i + 1;
                      return (
                        <SelectItem key={n} value={String(n)}>
                          {n}x
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Ajuste conforme a regra de parcelas da sua loja / Stone.
                </p>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-md border p-3">
              <Checkbox
                id="emitir-nfe-produtos"
                checked={emitirNfeProdutos}
                onCheckedChange={(v) => setEmitirNfeProdutos(Boolean(v))}
                disabled={!!pagamentoId && !statusEhFinal}
              />
              <div className="space-y-1 leading-tight">
                <Label htmlFor="emitir-nfe-produtos">
                  Emitir nota fiscal para os produtos do orçamento
                </Label>
                <p className="text-xs text-muted-foreground">
                  Se marcado, o backend cria um registro de nota fiscal (stub)
                  quando o pagamento for confirmado (via webhook/simulação).
                </p>
              </div>
            </div>

            {/* Status do pagamento */}
            <div className="rounded-md border p-3 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold">Status do pagamento</span>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] ${
                    (statusPagamento ?? "").toUpperCase() === "PAGO"
                      ? "bg-emerald-100 text-emerald-700"
                      : (statusPagamento ?? "").toUpperCase() ===
                          "ESTORNADO" ||
                        (statusPagamento ?? "").toUpperCase() === "RECUSADO"
                      ? "bg-red-100 text-red-700"
                      : statusPagamento
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {statusPagamento || "Aguardando envio"}
                </span>
              </div>

              {pagamentoId && (
                <p className="mb-1 text-[11px] text-muted-foreground">
                  Pagamento ID:{" "}
                  <span className="font-mono">{pagamentoId}</span>
                </p>
              )}

              {detalhesPagamento && (
                <div className="space-y-1 text-[11px] text-muted-foreground">
                  <p>NSU: {detalhesPagamento.nsu || "—"}</p>
                  <p>Autorização: {detalhesPagamento.autorizacao || "—"}</p>
                  <p>Bandeira: {detalhesPagamento.bandeira || "—"}</p>
                  <p>
                    Valor: R$
                    {detalhesPagamento.valor.toFixed(2)}
                  </p>
                </div>
              )}

              {/* Logs */}
              {logs.length > 0 && (
                <div className="mt-2 max-h-24 overflow-auto rounded bg-muted/60 p-2">
                  {logs.map((l, i) => (
                    <p key={i} className="text-[11px]">
                      {l}
                    </p>
                  ))}
                </div>
              )}

              {/* Botão de emissão/impressão de NF quando estiver pago */}
              {pago && (
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleEmitirImprimirNota}
                  >
                    Emitir / imprimir nota fiscal
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-auto text-xs text-muted-foreground">
              Ao confirmar, um pedido será criado no Pagar.me/Stone (Connect) e
              enviado para a maquineta configurada. O status será atualizado
              automaticamente conforme os webhooks ou simulações.
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleChangeOpen(false)}
            disabled={enviando}
          >
            Fechar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmarPagamento}
            disabled={
              enviando ||
              !!pagamentoId || // já existe pedido em andamento ou finalizado
              osConcluida || // OS já concluída
              pago // já pago
            }
          >
            {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pagamentoId && !statusEhFinal
              ? "Aguardando pagamento..."
              : "Enviar para maquineta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
