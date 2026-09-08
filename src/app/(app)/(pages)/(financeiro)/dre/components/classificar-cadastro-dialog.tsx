"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

type Classificacao = {
  id: number;
  codigo: string;
  nome: string;
  familia: string;
  naturezas: string[];
  destino: { fora_da_dre: boolean; linha_codigo: string | null; linha_nome: string | null } | null;
};

type Cadastro = {
  id: number;
  nome: string;
  grupo_id?: number;
  versao_registro: number;
  classificacao_especifica?: string | null;
};

export type AlvoClassificacao = { tipo: "CONTA" | "GRUPO"; id: number; nome: string } | null;

const ROTA = {
  CONTA: "/api/tipos/planos-de-conta",
  GRUPO: "/api/tipos/grupos-planos-de-conta",
} as const;

/**
 * Dá destino de DRE a uma conta ou a um grupo do plano de contas.
 *
 * O destino de cada opção vem do catálogo, que já traz a linha do mapeamento
 * ativo. A rota `dre_previa_da_conta` responde outra pergunta — "para onde esta
 * conta vai HOJE" —, e mostrá-la ao lado da escolha nova confundiria as duas.
 *
 * A gravação usa as rotas de cadastro que já existem, com a permissão que elas
 * já exigem (`configuracoes:editar`). Criar aqui um atalho com permissão de
 * financeiro daria, pela porta da DRE, um acesso que a tela de configurações
 * nega — então um 403 é respondido com a explicação, não contornado.
 */
export function ClassificarCadastroDialog({
  alvo,
  emLegado,
  onFechar,
  onClassificado,
}: {
  alvo: AlvoClassificacao;
  /** Em LEGADO a soma ignora a classificação da conta: o aviso é obrigatório. */
  emLegado: boolean;
  onFechar: () => void;
  onClassificado: () => void;
}) {
  const [catalogo, setCatalogo] = useState<Classificacao[] | null>(null);
  const [cadastro, setCadastro] = useState<Cadastro | null>(null);
  const [escolhida, setEscolhida] = useState<string>("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!alvo) return;
    const controller = new AbortController();

    setCatalogo(null);
    setCadastro(null);
    setEscolhida("");
    setErro(null);

    const opcoes = { cache: "no-store" as const, signal: controller.signal };

    Promise.all([
      fetch("/api/tipos/classificacoes-resultado", opcoes).then((r) => r.json()),
      fetch(ROTA[alvo.tipo], opcoes).then((r) => r.json()),
    ])
      .then(([cat, lista]) => {
        if (controller.signal.aborted) return;
        setCatalogo((cat?.items ?? []) as Classificacao[]);
        const registro = (lista?.items ?? []).find(
          (item: Cadastro) => Number(item.id) === alvo.id,
        );
        if (!registro) {
          setErro("Cadastro não encontrado. Ele pode ter sido removido.");
          return;
        }
        setCadastro(registro as Cadastro);
      })
      .catch(() => {
        if (!controller.signal.aborted) setErro("Não foi possível carregar o catálogo.");
      });

    return () => controller.abort();
  }, [alvo]);

  const selecionada = catalogo?.find((c) => String(c.id) === escolhida) ?? null;

  async function gravar() {
    if (!alvo || !cadastro || !selecionada || salvando) return;
    setSalvando(true);
    try {
      const corpo: Record<string, unknown> = {
        nome: cadastro.nome,
        classificacao_id: selecionada.id,
        versao_registro: cadastro.versao_registro,
      };
      if (alvo.tipo === "CONTA") corpo.grupo_id = cadastro.grupo_id;

      const resposta = await fetch(`${ROTA[alvo.tipo]}/${alvo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const retorno = await resposta.json().catch(() => ({}));

      if (!resposta.ok) {
        toast.error(
          resposta.status === 403
            ? "Classificar o plano de contas exige permissão de configurações."
            : (retorno?.error ?? "Não foi possível classificar."),
        );
        return;
      }

      toast.success(
        emLegado
          ? "Classificação gravada. O total da DRE não muda enquanto a apuração estiver em modo legado."
          : "Classificação gravada.",
      );
      onClassificado();
      onFechar();
    } catch {
      toast.error("Não foi possível classificar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={!!alvo} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Classificar {alvo?.tipo === "GRUPO" ? "o grupo" : "a conta"}
          </DialogTitle>
          <DialogDescription>{alvo?.nome}</DialogDescription>
        </DialogHeader>

        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !catalogo || !cadastro ? (
          <div className="grid gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="classificacao">Classificação</Label>
              <Select value={escolhida} onValueChange={setEscolhida} disabled={salvando}>
                <SelectTrigger id="classificacao">
                  <SelectValue placeholder="Escolha para onde vai" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {catalogo.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nome}
                      {c.destino?.linha_codigo ? ` · ${c.destino.linha_codigo}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selecionada && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {selecionada.destino?.fora_da_dre
                    ? "Não compõe o resultado"
                    : selecionada.destino
                      ? `Vai para ${selecionada.destino.linha_codigo} ${selecionada.destino.linha_nome}`
                      : "Sem destino no template ativo"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Aceita lançamento de {selecionada.naturezas.join(" e ").toLowerCase()}.
                </p>
              </div>
            )}

            {emLegado && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                A apuração está em modo legado: a DRE ainda soma pelo grupo do plano de contas e
                ignora a classificação da conta. Gravar aqui prepara a virada, mas{" "}
                <span className="font-medium">não altera o total do relatório hoje.</span>
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="button" disabled={!selecionada || salvando} onClick={gravar}>
            {salvando ? "Gravando…" : "Classificar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
