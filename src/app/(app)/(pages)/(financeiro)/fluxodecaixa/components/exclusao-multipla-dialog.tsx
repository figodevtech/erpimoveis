"use client";

import { useCallback, useEffect, useState } from "react";

import axios, { isAxiosError } from "axios";
import { Ban, Loader2, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";

import type { Transaction } from "../types";

/**
 * A prévia da exclusão em massa.
 *
 * Ao contrário do diálogo de baixa, este PRECISA mostrar item a item: a baixa
 * faz a mesma coisa com todas as linhas, e a exclusão faz coisas diferentes com
 * cada uma. Numa seleção de cinquenta pode haver cinco desfechos ao mesmo tempo,
 * e alguns arrastam linhas que a pessoa nem marcou.
 *
 * Quem classifica é o servidor (`/api/transaction/delete-impact-lote`). Aqui só
 * se agrupa e se dá nome ao que ele respondeu — e o servidor refaz a conta na
 * hora de executar, porque entre ver e confirmar o estado pode ter mudado.
 */

type Classificacao = "EXCLUI" | "EXCLUI_EM_GRUPO" | "ESTORNA_E_EXCLUI" | "BLOQUEADO";

type ItemClassificado = {
  id: number;
  classificacao: Classificacao;
  motivo: string;
  descricao: string | null;
  valor: number;
  grupo?: { tipo: string; id: number; lider: number; resumo: string };
  reabre: Array<{ tipo: "OS" | "VENDA"; id: number }>;
  competenciaAnterior: boolean;
};

type Previa = {
  itens: ItemClassificado[];
  resumo: {
    selecionados: number;
    saem: number;
    arrastados: number;
    porClasse: Record<Classificacao, number>;
    reabrem: Array<{ tipo: "OS" | "VENDA"; id: number }>;
    competenciaAnterior: number;
  };
};

/** O que a pessoa digita para liberar o caminho destrutivo. */
const PALAVRA_DE_CONFIRMACAO = "EXCLUIR";

const TETO_DA_LISTA = 10;

function Bloco({
  titulo,
  tom,
  itens,
  children,
}: {
  titulo: string;
  tom: "neutro" | "aviso" | "impedimento";
  itens: ItemClassificado[];
  children?: React.ReactNode;
}) {
  if (itens.length === 0) return null;

  const cor =
    tom === "impedimento"
      ? "border-destructive/40 bg-destructive/5"
      : tom === "aviso"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-border bg-muted/20";

  const visiveis = itens.slice(0, TETO_DA_LISTA);
  const restantes = itens.length - visiveis.length;

  return (
    <div className={`rounded-lg border p-3 ${cor}`}>
      <p className="flex items-center gap-2 text-sm font-medium">
        {tom === "impedimento" ? (
          <Ban className="h-4 w-4 shrink-0" aria-hidden />
        ) : tom === "aviso" ? (
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
        ) : null}
        {titulo} ({itens.length})
      </p>

      {children}

      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {visiveis.map((item) => (
          <li key={item.id}>
            <span className="font-medium text-foreground">#{item.id}</span>{" "}
            {item.descricao ?? "sem descrição"}
            {item.valor ? ` — ${formatarEmReal(item.valor)}` : ""}
            {tom === "impedimento" ? <span className="block pl-4">{item.motivo}</span> : null}
          </li>
        ))}
        {restantes > 0 ? <li>e mais {restantes}.</li> : null}
      </ul>
    </div>
  );
}

export function ExclusaoMultiplaDialog({
  aberto,
  setAberto,
  transacoes,
  processando,
  setProcessando,
  onConcluido,
}: {
  aberto: boolean;
  setAberto: (valor: boolean) => void;
  transacoes: Transaction[];
  processando: boolean;
  setProcessando: (valor: boolean) => void;
  onConcluido: (idsExcluidos: number[]) => void;
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [falhouAVerificacao, setFalhouAVerificacao] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [falhas, setFalhas] = useState<Array<{ id: number; erro: string }>>([]);

  const ids = transacoes.map((t) => t.id);

  const carregarPrevia = useCallback(async () => {
    setCarregando(true);
    setFalhouAVerificacao(null);
    try {
      const resposta = await axios.post("/api/transaction/delete-impact-lote", { ids });
      setPrevia(resposta.data?.data ?? null);
    } catch (erro) {
      setPrevia(null);
      /*
       * Sem a conferência não dá para saber o que a exclusão arrasta.
       *
       * Antes de este estado existir no alerta individual, a falha caía no texto
       * de "sem impacto" e a pessoa confirmava achando que estava verificado.
       */
      setFalhouAVerificacao(
        isAxiosError(erro)
          ? (erro.response?.data?.error ?? erro.message)
          : "Não foi possível verificar o que a exclusão afeta.",
      );
    } finally {
      setCarregando(false);
    }
    // `ids` muda de identidade a cada render; a seleção em si é o que importa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  useEffect(() => {
    if (!aberto) return;
    setConfirmacao("");
    setFalhas([]);
    void carregarPrevia();
  }, [aberto, carregarPrevia]);

  const resumo = previa?.resumo;
  const itens = previa?.itens ?? [];

  const porClasse = (classe: Classificacao) =>
    itens.filter((item) => item.classificacao === classe);

  const semDocumento = porClasse("EXCLUI").filter((i) => i.reabre.length === 0);
  const comDocumento = porClasse("EXCLUI").filter((i) => i.reabre.length > 0);
  const emGrupo = porClasse("EXCLUI_EM_GRUPO");
  const estornaEExclui = porClasse("ESTORNA_E_EXCLUI");
  const bloqueados = porClasse("BLOQUEADO");

  const saem = resumo?.saem ?? 0;
  const precisaDigitar = estornaEExclui.length > 0;
  const confirmou = !precisaDigitar || confirmacao.trim().toUpperCase() === PALAVRA_DE_CONFIRMACAO;
  const podeExecutar = saem > 0 && confirmou && !carregando && !falhouAVerificacao;

  // Um grupo por linha, sem repetir o mesmo resumo para cada irmã marcada.
  const gruposUnicos = [
    ...new Map(emGrupo.filter((i) => i.grupo).map((i) => [`${i.grupo!.tipo}:${i.grupo!.id}`, i.grupo!])).values(),
  ];

  async function confirmar() {
    if (!podeExecutar) return;

    setProcessando(true);
    try {
      const resposta = await axios.post("/api/transaction/excluir-lote", { ids });
      const excluidos: number[] = resposta.data?.data?.excluidos ?? [];
      const erros: Array<{ id: number; erro: string }> = resposta.data?.data?.falhas ?? [];

      if (erros.length > 0) {
        // Falha parcial não fecha: o que passou já foi gravado, e repetir tudo
        // não desfaz nada — mas a pessoa precisa ver o que sobrou.
        setFalhas(erros);
        onConcluido(excluidos);
        // A classificação de quem sobrou pode ter mudado (a antecipação saiu, os
        // títulos reabriram), então a prévia é refeita antes de uma segunda
        // tentativa.
        void carregarPrevia();
        return;
      }

      toast.success(
        excluidos.length === 1 ? "1 transação excluída." : `${excluidos.length} transações excluídas.`,
      );
      onConcluido(excluidos);
      setAberto(false);
    } catch (erro) {
      toast.error("Não foi possível excluir", {
        description: isAxiosError(erro)
          ? (erro.response?.data?.error ?? erro.message)
          : "Tente novamente.",
      });
    } finally {
      setProcessando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Revisar exclusão de {transacoes.length}{" "}
            {transacoes.length === 1 ? "transação" : "transações"}
          </DialogTitle>
          <DialogDescription>
            {carregando
              ? "Verificando o que cada uma afeta..."
              : resumo
                ? `${saem} ${saem === 1 ? "sai" : "saem"}${
                    bloqueados.length ? ` · ${bloqueados.length} ${bloqueados.length === 1 ? "pulada" : "puladas"}` : ""
                  }`
                : "Confira o que vai acontecer antes de prosseguir."}
          </DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Analisando cada transação...
          </div>
        ) : null}

        {falhouAVerificacao ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <Ban className="h-4 w-4 shrink-0" aria-hidden />
              Não foi possível verificar o impacto
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{falhouAVerificacao}</p>
          </div>
        ) : null}

        {!carregando && !falhouAVerificacao && resumo ? (
          <div className="space-y-3">
            {/* O número que a pessoa não espera: marcou N, saem mais. */}
            {resumo.arrastados > 0 ? (
              <p className="text-sm">
                Você marcou <strong>{resumo.selecionados}</strong>{" "}
                {resumo.selecionados === 1 ? "linha" : "linhas"}; saem{" "}
                <strong>{saem}</strong>.
              </p>
            ) : null}

            <Bloco titulo="Saem sem mexer em outros documentos" tom="neutro" itens={semDocumento} />

            <Bloco titulo="Saem e reabrem documento" tom="aviso" itens={comDocumento}>
              {resumo.reabrem.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {resumo.reabrem.map((a) => `${a.tipo} #${a.id}`).join(", ")}{" "}
                  {resumo.reabrem.length === 1 ? "volta" : "voltam"} a ficar em aberto.
                </p>
              ) : null}
            </Bloco>

            <Bloco titulo="Saem e levam outras linhas junto" tom="aviso" itens={emGrupo}>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {gruposUnicos.map((grupo) => (
                  <li key={`${grupo.tipo}:${grupo.id}`}>{grupo.resumo}</li>
                ))}
              </ul>
            </Bloco>

            <Bloco titulo="Serão estornadas e excluídas" tom="impedimento" itens={estornaEExclui}>
              <p className="mt-1 text-xs text-muted-foreground">
                A baixa é desfeita e o título é apagado em seguida.{" "}
                <strong className="text-destructive">A dívida deixa de existir.</strong>
              </p>
            </Bloco>

            <Bloco titulo="Não podem ser excluídas" tom="impedimento" itens={bloqueados} />

            {resumo.competenciaAnterior > 0 ? (
              <p className="text-xs text-muted-foreground">
                {resumo.competenciaAnterior}{" "}
                {resumo.competenciaAnterior === 1 ? "lançamento é de mês anterior" : "lançamentos são de meses anteriores"}
                . Excluir muda o resultado daqueles meses no DRE.
              </p>
            ) : null}

            {saem > 0 ? (
              <p className="text-sm font-medium">Esta ação não pode ser desfeita.</p>
            ) : null}

            {/*
              Confirmação digitada só no caminho destrutivo.
              A prévia por item já é a fricção nos demais; aqui não basta, porque
              a operação encadeia duas regras que o sistema separa de propósito.
            */}
            {precisaDigitar ? (
              <div className="space-y-1">
                <Label htmlFor="confirmacao-exclusao" className="text-xs">
                  Para prosseguir, digite {PALAVRA_DE_CONFIRMACAO}
                </Label>
                <Input
                  id="confirmacao-exclusao"
                  value={confirmacao}
                  onChange={(evento) => setConfirmacao(evento.target.value)}
                  placeholder={PALAVRA_DE_CONFIRMACAO}
                  autoComplete="off"
                  disabled={processando}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {falhas.length ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              {falhas.length === 1
                ? "1 transação não pôde ser excluída"
                : `${falhas.length} transações não puderam ser excluídas`}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {falhas.map((falha) => (
                <li key={falha.id}>
                  <span className="font-medium text-foreground">#{falha.id}</span> {falha.erro}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setAberto(false)}
            disabled={processando}
          >
            {/*
              Nada a fazer: o botão de ação some em vez de ficar apagado — um
              botão desabilitado convida a insistir.
            */}
            {saem === 0 || falhas.length ? "Fechar" : "Cancelar"}
          </Button>
          {saem > 0 ? (
            <Button
              variant="destructive"
              className="w-full sm:w-auto"
              onClick={() => void confirmar()}
              disabled={processando || !podeExecutar}
            >
              {processando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Excluindo...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {falhas.length ? "Tentar de novo" : `Excluir ${saem}`}
                </>
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
