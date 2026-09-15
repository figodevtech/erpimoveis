"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Lock } from "lucide-react";
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
import { ordenarPorLinha, rotuloDaLinha } from "@/lib/financeiro/plano-contas/opcoes-de-linha";

type Destino = {
  situacao: string;
  linha_codigo: string | null;
  linha_nome: string | null;
  motivo?: string | null;
};

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
  grupo?: { nome: string } | null;
  versao_registro: number;
  classificacao_especifica?: string | null;
  classificacao?: { codigo: string; naturezas?: string[] } | null;
  destino?: Destino;
};

type Grupo = {
  id: number;
  nome: string;
  classificacao: { naturezas?: string[] } | null;
  destino: Destino;
};

export type AlvoClassificacao = { tipo: "CONTA" | "GRUPO"; id: number; nome: string } | null;

/** Vários cadastros do mesmo tipo recebendo a mesma linha numa passada só. */
export type LoteClassificacao = {
  tipo: "CONTA" | "GRUPO";
  itens: { id: number; nome: string }[];
} | null;

/**
 * O que sai da linha que a pessoa está olhando. Só existe quando o diálogo nasce
 * do detalhamento de uma linha da DRE: é o número que ela vai ver mudar.
 */
export type ContextoDaLinha = {
  linha: { codigo: string; nome: string };
  periodo: string;
  lancamentos: number;
  valor: number;
  naturezas: string[];
};

const ROTA = {
  CONTA: "/api/tipos/planos-de-conta",
  GRUPO: "/api/tipos/grupos-planos-de-conta",
} as const;

/** Tirar a linha própria da conta: ela volta a seguir o grupo. */
const SEGUIR_GRUPO = "__seguir_grupo__";

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function textoDoDestino(destino: Destino | undefined) {
  if (destino?.situacao === "CLASSIFICADO" && destino.linha_codigo) {
    return `${destino.linha_codigo} · ${destino.linha_nome ?? ""}`.trim();
  }
  if (destino?.situacao === "EXCLUIDO") return "fora da DRE";
  return "sem linha";
}

function textoDaOpcao(item: Classificacao) {
  if (item.destino?.fora_da_dre) return "fora da DRE";
  if (item.destino?.linha_codigo) return `${item.destino.linha_codigo} · ${item.destino.linha_nome ?? item.nome}`;
  return "sem linha no relatório";
}

/**
 * Muda a linha da DRE de uma conta, de um grupo, ou de vários de uma vez.
 *
 * Grava sem vigência: corrige todo o histórico (decisão de 15/09/2026), e os
 * lançamentos são refeitos na mesma operação. Mudança só a partir de uma data é
 * feita na tela de planos de conta, onde a pessoa vê o cadastro inteiro.
 *
 * O corpo do PUT leva só a classificação e a versão: a rota preserva nome,
 * código, descrição e grupo omitidos. Mandar o cadastro inteiro daqui arriscaria
 * gravar por cima de uma edição feita em outra tela.
 *
 * No lote, cada cadastro vai num PUT próprio, com a versão dele. Um erro no meio
 * não desfaz os que já passaram — a mensagem final diz quantos foram e quantos
 * falharam, em vez de fingir que tudo ou nada aconteceu.
 */
export function ClassificarCadastroDialog({
  alvo,
  lote = null,
  contexto = null,
  podeEditar = true,
  onFechar,
  onClassificado,
}: {
  alvo: AlvoClassificacao;
  lote?: LoteClassificacao;
  contexto?: ContextoDaLinha | null;
  /** Sem a permissão, a tela avisa antes em vez de deixar tentar e voltar 403. */
  podeEditar?: boolean;
  onFechar: () => void;
  onClassificado: () => void;
}) {
  const tipo = alvo?.tipo ?? lote?.tipo ?? null;
  const aberto = !!alvo || !!lote;

  const [catalogo, setCatalogo] = useState<Classificacao[] | null>(null);
  const [cadastros, setCadastros] = useState<Cadastro[] | null>(null);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [escolhida, setEscolhida] = useState<string>("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto || !tipo) return;
    const controller = new AbortController();

    setCatalogo(null);
    setCadastros(null);
    setGrupos(null);
    setEscolhida("");
    setErro(null);

    const opcoes = { cache: "no-store" as const, signal: controller.signal };
    const json = (resposta: Response) => resposta.json();

    Promise.all([
      fetch("/api/tipos/classificacoes-resultado", opcoes).then(json),
      fetch(ROTA[tipo], opcoes).then(json),
      // A opção "seguir o grupo" precisa dizer para onde o grupo vai.
      tipo === "CONTA" ? fetch(ROTA.GRUPO, opcoes).then(json) : Promise.resolve(null),
    ])
      .then(([cat, lista, listaGrupos]) => {
        if (controller.signal.aborted) return;
        setCatalogo((cat?.items ?? []) as Classificacao[]);
        setCadastros((lista?.items ?? []) as Cadastro[]);
        if (listaGrupos) setGrupos((listaGrupos.items ?? []) as Grupo[]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setErro("Não foi possível carregar o catálogo.");
      });

    return () => controller.abort();
  }, [aberto, tipo]);

  const opcoes = useMemo(() => (catalogo ? ordenarPorLinha(catalogo) : null), [catalogo]);

  const ehConta = tipo === "CONTA";
  const cadastro = alvo ? (cadastros?.find((item) => Number(item.id) === alvo.id) ?? null) : null;
  const selecionados = lote
    ? lote.itens
        .map((item) => cadastros?.find((c) => Number(c.id) === item.id))
        .filter((c): c is Cadastro => !!c)
    : [];
  const grupo = cadastro?.grupo_id != null ? (grupos?.find((g) => Number(g.id) === Number(cadastro.grupo_id)) ?? null) : null;

  const carregado = !!opcoes && !!cadastros && (!alvo || !!cadastro);
  const naoEncontrado = !!alvo && !!cadastros && !cadastro;

  const codigoAtual = ehConta
    ? (cadastro?.classificacao_especifica ?? null)
    : (cadastro?.classificacao?.codigo ?? null);
  const seguindoGrupo = ehConta && !!cadastro && !cadastro.classificacao_especifica;

  const seguirGrupo = escolhida === SEGUIR_GRUPO;
  const selecionada = seguirGrupo ? null : (catalogo?.find((c) => String(c.id) === escolhida) ?? null);
  const semMudanca = !lote && (seguirGrupo ? seguindoGrupo : !!selecionada && selecionada.codigo === codigoAtual);

  const destinoEscolhido = seguirGrupo
    ? grupo
      ? textoDoDestino(grupo.destino)
      : "a linha do grupo"
    : selecionada
      ? textoDaOpcao(selecionada)
      : null;

  /*
   * A natureza continua protegida: despesa numa linha que só aceita receita não
   * soma em lugar nenhum. Quem move pela DRE sabe de que tipo são os lançamentos
   * que está olhando, e é esse o aviso que vale dar antes de gravar.
   */
  const naturezasAceitas = seguirGrupo ? (grupo?.classificacao?.naturezas ?? []) : (selecionada?.naturezas ?? []);
  const naturezasRecusadas =
    contexto && naturezasAceitas.length
      ? contexto.naturezas.filter((natureza) => !naturezasAceitas.includes(natureza))
      : [];

  const quantos = lote ? selecionados.length : 1;
  const podeGravar = podeEditar && !salvando && !!destinoEscolhido && !semMudanca && carregado && quantos > 0;

  async function gravarUm(registro: Cadastro) {
    const resposta = await fetch(`${ROTA[tipo!]}/${registro.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classificacao_id: seguirGrupo ? null : selecionada?.id,
        versao_registro: registro.versao_registro,
        vigencia_inicio: null,
      }),
    });
    if (resposta.ok) return null;
    const retorno = await resposta.json().catch(() => ({}));
    if (resposta.status === 403) return "sem permissão de configurações";
    if (resposta.status === 409) return "mudou enquanto você decidia";
    return (retorno?.error as string) ?? "erro ao gravar";
  }

  async function gravar() {
    if (!podeGravar) return;
    setSalvando(true);
    try {
      const alvos = lote ? selecionados : cadastro ? [cadastro] : [];
      const falhas: string[] = [];
      for (const registro of alvos) {
        const falha = await gravarUm(registro);
        if (falha) falhas.push(`${registro.nome}: ${falha}`);
      }

      const gravados = alvos.length - falhas.length;
      if (gravados > 0) {
        toast.success(
          alvos.length === 1
            ? `${alvos[0].nome} agora vai para ${destinoEscolhido}. A DRE foi refeita.`
            : `${gravados} cadastro(s) agora vão para ${destinoEscolhido}. A DRE foi refeita.`,
        );
      }
      if (falhas.length) {
        toast.error(
          falhas.length === 1 ? `Não gravou ${falhas[0]}.` : `${falhas.length} não gravaram: ${falhas[0]}…`,
        );
      }

      if (gravados > 0) onClassificado();
      if (!falhas.length) onFechar();
    } catch {
      toast.error("Não foi possível gravar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(estaAberto) => !estaAberto && !salvando && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {lote
              ? `Definir a linha de ${lote.itens.length} ${lote.tipo === "GRUPO" ? "grupo(s)" : "conta(s)"}`
              : contexto
                ? "Mover plano de conta"
                : `Linha da DRE ${ehConta ? "da conta" : "do grupo"}`}
          </DialogTitle>
          <DialogDescription>
            {lote
              ? lote.itens.map((item) => item.nome).slice(0, 3).join(", ") +
                (lote.itens.length > 3 ? ` e mais ${lote.itens.length - 3}` : "")
              : `${alvo?.nome ?? ""}${cadastro?.grupo?.nome ? ` · grupo ${cadastro.grupo.nome}` : ""}`}
          </DialogDescription>
        </DialogHeader>

        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : naoEncontrado ? (
          <p className="text-sm text-destructive">Cadastro não encontrado. Ele pode ter sido removido.</p>
        ) : !carregado ? (
          <div className="grid gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <div className="grid gap-4">
            {cadastro && (
              <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-sm">
                <p className="text-xs text-muted-foreground">Hoje vai para</p>
                <p className="font-medium">
                  {textoDoDestino(cadastro.destino)}
                  {ehConta && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {seguindoGrupo ? "segue o grupo" : "linha própria"}
                    </span>
                  )}
                </p>
                {contexto && (
                  <p className="text-xs text-muted-foreground">
                    Em {contexto.linha.codigo} · {contexto.linha.nome}, de {contexto.periodo}:{" "}
                    {contexto.lancamentos} lançamento(s), {MOEDA.format(contexto.valor)}.
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="nova-linha">Nova linha</Label>
              <Select value={escolhida} onValueChange={setEscolhida} disabled={salvando || !podeEditar}>
                <SelectTrigger id="nova-linha">
                  <SelectValue placeholder="Escolha para onde vai" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {ehConta && !lote && (
                    <SelectItem value={SEGUIR_GRUPO}>
                      Seguir o grupo{grupo ? ` (${textoDoDestino(grupo.destino)})` : ""}
                      {seguindoGrupo ? " · atual" : ""}
                    </SelectItem>
                  )}
                  {opcoes!.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {rotuloDaLinha(c)}
                      {!lote && c.codigo === codigoAtual ? " · atual" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {destinoEscolhido && !semMudanca && (
              <div className="flex items-start gap-2.5 rounded-md border p-3 text-sm">
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="grid gap-1">
                  <p>
                    {cadastro && (
                      <>
                        <span className="text-muted-foreground">{textoDoDestino(cadastro.destino)}</span>
                        {" → "}
                      </>
                    )}
                    <span className="font-medium">{destinoEscolhido}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ehConta
                      ? `Todos os lançamentos ${lote ? "das contas escolhidas" : "desta conta"} vão junto, em qualquer mês.`
                      : "Todas as contas do grupo sem linha própria vão junto, em qualquer mês."}{" "}
                    A DRE dos meses anteriores muda também.
                  </p>
                </div>
              </div>
            )}

            {semMudanca && <p className="text-xs text-muted-foreground">É onde este cadastro já está.</p>}

            {naturezasRecusadas.length > 0 && (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                <span>
                  Esta conta tem lançamento de{" "}
                  {naturezasRecusadas.map((n) => (n === "RECEITA" ? "receita" : "despesa")).join(" e ")} e a linha
                  escolhida não aceita esse tipo. Esses lançamentos sairiam do relatório e iriam para as pendências.
                </span>
              </p>
            )}

            {!podeEditar && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="size-3.5 shrink-0" aria-hidden />
                Mudar a linha exige a permissão de editar configurações.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="button" disabled={!podeGravar} onClick={gravar}>
            {salvando
              ? "Gravando…"
              : naturezasRecusadas.length
                ? "Mover mesmo assim"
                : lote
                  ? `Gravar em ${quantos}`
                  : contexto
                    ? "Mover lançamentos"
                    : "Gravar linha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
