"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (v: number) => MOEDA.format(Number.isFinite(v) ? v : 0);

type Detalhe = {
  eventoId: number;
  descricao: string | null;
  quantidade: number;
  valorAtual: number;
  produto: {
    id: number;
    nome: string;
    ultimaCompra: number;
    precoMedio: number;
    custoSugerido: number | null;
    origemSugerida: "ULTIMA_COMPRA" | "PRECO_MEDIO" | null;
  } | null;
};

/**
 * Informa o custo de um item que foi vendido sem ele.
 *
 * O custo pedido é o UNITÁRIO, não o total do lançamento: é assim que a pessoa
 * conhece o número, e é assim que o cadastro guarda. A multiplicação pela
 * quantidade fica no servidor, com a mesma conta que a sincronização automática
 * faz — se fosse feita aqui, duas fórmulas para o mesmo valor acabariam
 * divergindo.
 *
 * O checkbox nasce desmarcado de propósito. Corrigir a margem do período é o que
 * o usuário veio fazer; mexer no cadastro muda a valorização do estoque inteiro,
 * e isso tem de ser escolha, não efeito colateral de ter passado por aqui.
 */
export function CorrigirCustoDialog({
  eventoId,
  podeEditarEstoque,
  onFechar,
  onCorrigido,
}: {
  eventoId: number | null;
  /** Sem `estoque:editar` o checkbox aparece desabilitado, com a razão dita. */
  podeEditarEstoque: boolean;
  onFechar: () => void;
  onCorrigido: () => void;
}) {
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [custo, setCusto] = useState("");
  const [aplicarNoCadastro, setAplicarNoCadastro] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!eventoId) return;
    const controller = new AbortController();

    setDetalhe(null);
    setErro(null);
    setCusto("");
    setAplicarNoCadastro(false);

    fetch(`/api/dre/pendencias/corrigir-custo?evento=${eventoId}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => ({ ok: r.ok, corpo: await r.json() }))
      .then(({ ok, corpo }) => {
        if (controller.signal.aborted) return;
        if (!ok) {
          setErro(corpo?.error ?? "Não foi possível carregar o item.");
          return;
        }
        setDetalhe(corpo as Detalhe);
      })
      .catch(() => {
        if (!controller.signal.aborted) setErro("Não foi possível carregar o item.");
      });

    return () => controller.abort();
  }, [eventoId]);

  const custoNumero = Number(custo.replace(",", "."));
  const custoValido = Number.isFinite(custoNumero) && custoNumero > 0;
  const quantidade = detalhe?.quantidade ?? 1;

  async function gravar(usarCustoDoCadastro: boolean) {
    if (!eventoId || salvando) return;
    setSalvando(true);
    try {
      const resposta = await fetch("/api/dre/pendencias/corrigir-custo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          usarCustoDoCadastro
            ? { eventoId, usarCustoDoCadastro: true }
            : { eventoId, custoUnitario: custoNumero },
        ),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        toast.error(corpo?.error ?? "Não foi possível corrigir o custo.");
        return;
      }

      // O livro está corrigido a partir daqui. O que vier depois é acréscimo:
      // se falhar, a DRE já está certa e a mensagem diz o que ficou pendente.
      if (aplicarNoCadastro && !usarCustoDoCadastro && corpo?.produtoId) {
        const noCadastro = await fetch(`/api/products/${corpo.produtoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ precocompra: custoNumero }),
        });
        if (!noCadastro.ok) {
          const falha = await noCadastro.json().catch(() => ({}));
          toast.warning(
            `Custo corrigido na DRE, mas o cadastro do produto não mudou: ${
              falha?.error ?? "sem permissão de estoque."
            }`,
          );
          onCorrigido();
          onFechar();
          return;
        }
        toast.success("Custo corrigido na DRE e no cadastro do produto.");
      } else {
        toast.success("Custo corrigido.");
      }

      onCorrigido();
      onFechar();
    } catch {
      toast.error("Não foi possível corrigir o custo.");
    } finally {
      setSalvando(false);
    }
  }

  const sugerido = detalhe?.produto?.custoSugerido ?? null;

  return (
    <Dialog open={!!eventoId} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Informar o custo</DialogTitle>
          <DialogDescription>
            {detalhe?.descricao ?? "Item vendido sem custo cadastrado."}
          </DialogDescription>
        </DialogHeader>

        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !detalhe ? (
          <div className="grid gap-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Quantidade vendida: <span className="font-medium tabular-nums">{quantidade}</span>
              {detalhe.produto && ` · ${detalhe.produto.nome}`}
            </p>

            {sugerido !== null && (
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-3">
                <div className="text-sm">
                  <p className="font-medium">{brl(sugerido)} por unidade</p>
                  <p className="text-xs text-muted-foreground">
                    {detalhe.produto?.origemSugerida === "ULTIMA_COMPRA"
                      ? "Última entrada registrada no estoque"
                      : "Preço médio de compra do cadastro"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={salvando}
                  onClick={() => gravar(true)}
                >
                  Usar este
                </Button>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="custo-unitario">Custo por unidade</Label>
              <Input
                id="custo-unitario"
                inputMode="decimal"
                placeholder="0,00"
                value={custo}
                disabled={salvando}
                onChange={(e) => setCusto(e.target.value)}
              />
              {custoValido && (
                <p className="text-xs text-muted-foreground">
                  Lançamento de custo: {brl(custoNumero * quantidade)} ({quantidade} ×{" "}
                  {brl(custoNumero)})
                </p>
              )}
            </div>

            {detalhe.produto && (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="aplicar-cadastro"
                  checked={aplicarNoCadastro}
                  disabled={!podeEditarEstoque || salvando}
                  onCheckedChange={(marcado) => setAplicarNoCadastro(marcado === true)}
                />
                <div className="grid gap-0.5">
                  <Label
                    htmlFor="aplicar-cadastro"
                    className={!podeEditarEstoque ? "text-muted-foreground" : undefined}
                  >
                    Aplicar também ao cadastro do produto
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {podeEditarEstoque
                      ? "Evita que a próxima venda deste produto caia no mesmo problema — e muda a valorização do estoque, que usa o custo do cadastro."
                      : "Só quem tem permissão de estoque pode alterar o cadastro do produto."}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!custoValido || salvando || !detalhe}
            onClick={() => gravar(false)}
          >
            {salvando ? "Gravando…" : "Corrigir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
