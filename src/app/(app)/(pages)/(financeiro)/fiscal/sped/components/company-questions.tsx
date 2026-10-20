"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, CheckCircle2, CircleHelp, Pencil, Sparkles, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  corpoDoPatch,
  formatarCnae,
  patchDaResposta,
  perguntaVisivel,
  respostaAtual,
  SPED_PERGUNTAS,
  type SpedPergunta,
  type SpedRespostaAtual,
} from "@/lib/sped/configuracao-empresa";
import { toast } from "@/lib/toast";

import { deduceSpedConfiguration, updateSpedConfiguration } from "../api";
import { formatTimestamp } from "../formatters";
import type { SpedCompetenciaDetail } from "../types";

const REGIMES: Record<string, string> = {
  "1": "Simples Nacional",
  "2": "Simples Nacional (excesso de sublimite)",
  "3": "Regime normal",
  "4": "MEI",
};

/** Fusos do Amazonas, o único estado com dois fusos em municípios comuns. */
const FUSOS_AM = [
  { valor: "America/Manaus", rotulo: "Manaus e a maior parte do estado" },
  { valor: "America/Eirunepe", rotulo: "Sudoeste do estado (Eirunepé, Envira, Guajará, Ipixuna)" },
];

const ROTULO_ESPECIAL: Record<string, string> = {
  MANUAL: "Definido pelo contador nos ajustes técnicos",
  PERSONALIZADO: "Correspondência definida pelo contador",
};

type Linha = { pergunta: SpedPergunta; resposta: SpedRespostaAtual | null };

/**
 * Configuração do SPED em perguntas de quem opera o ERP. O que o cadastro e a
 * lei respondem já chega respondido, com a explicação; o resto é uma pergunta
 * de cada vez, respondida com um clique.
 */
export function CompanyQuestions({
  competencia,
  canManage,
  disabled,
  onSaved,
}: {
  competencia: SpedCompetenciaDetail;
  canManage: boolean;
  disabled: boolean;
  onSaved: () => void;
}) {
  const { configuracao } = competencia;
  const campos = useMemo(() => configuracao.campos ?? {}, [configuracao.campos]);
  const fatos = useMemo(() => configuracao.empresa ?? { uf: null, regimeTributario: null, cnae: null }, [configuracao.empresa]);
  const locked = !canManage || disabled || competencia.status === "FECHADA";
  const [salvando, setSalvando] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  // Respostas salvas que a competência atualizada ainda não trouxe.
  const [salvas, setSalvas] = useState<Record<string, string>>({});
  const deduzido = useRef(false);

  useEffect(() => setSalvas({}), [campos]);

  const linhas: Linha[] = useMemo(
    () => SPED_PERGUNTAS
      .filter((pergunta) => perguntaVisivel(pergunta.id, fatos))
      .map((pergunta) => {
        const salva = salvas[pergunta.id];
        const resposta = salva
          ? { valor: salva, descricao: "Resposta salva agora.", origem: "RESPOSTA" as const, confirmadoEm: null }
          : respostaAtual(pergunta.id, campos);
        return { pergunta, resposta };
      }),
    [campos, fatos, salvas],
  );
  const pendentes = linhas.filter((linha) => !linha.resposta);
  const respondidas = linhas.filter((linha) => linha.resposta);
  const fusoPendente = configuracao.timezoneStatus === "PENDENTE";

  // Ao abrir, o ERP responde sozinho o que já sabe; só preenche o que está pendente.
  useEffect(() => {
    if (locked || deduzido.current || (pendentes.length === 0 && !fusoPendente)) return;
    deduzido.current = true;
    deduceSpedConfiguration(configuracao.empresaId)
      .then((response) => { if (response.data.applied.length > 0) onSaved(); })
      .catch(() => { /* As perguntas continuam disponíveis para resposta manual. */ });
  }, [configuracao.empresaId, fusoPendente, locked, onSaved, pendentes.length]);

  async function salvar(chave: string, corpo: Record<string, unknown>, valor?: string) {
    setSalvando(chave);
    try {
      await updateSpedConfiguration(configuracao.empresaId, corpo);
      toast.success("Resposta salva.");
      if (valor) setSalvas((atual) => ({ ...atual, [chave]: valor }));
      setEditando(null);
      onSaved();
    } catch (error: unknown) {
      toast.error("Não foi possível salvar a resposta", {
        description: error instanceof Error ? error.message : "Falha inesperada.",
      });
    } finally {
      setSalvando(null);
    }
  }

  function responder(pergunta: SpedPergunta, valor: string) {
    const rotulo = pergunta.opcoes.find((opcao) => opcao.valor === valor)?.rotulo ?? valor;
    const descricao = `Resposta à pergunta "${pergunta.pergunta}": ${rotulo}.`;
    void salvar(pergunta.id, corpoDoPatch(patchDaResposta(pergunta.id, valor, descricao, "RESPOSTA")), valor);
  }

  function responderFuso(valor: string, rotulo: string) {
    void salvar("timezone", {
      timezone_iana: valor,
      timezone_status: "CONFIRMADO",
      evidencias: { timezone: { descricao: `Fuso informado pela localização da empresa: ${rotulo}.`, origem: "RESPOSTA" } },
    });
  }

  const ordenadas = [...pendentes].sort((a, b) => Number(a.pergunta.quemResponde === "CONTADOR") - Number(b.pergunta.quemResponde === "CONTADOR"));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="size-4" aria-hidden="true" /> Sobre a empresa
        </CardTitle>
        <CardDescription>
          O SPED precisa saber como a empresa funciona. O que o cadastro já diz, o ERP responde sozinho e explica de onde tirou;
          o resto são perguntas do dia a dia, respondidas uma vez.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <EmpresaResumo fatos={fatos} />

        {fusoPendente ? (
          <section className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <p className="text-sm font-medium">Em que região fica a empresa?</p>
            {fatos.uf === "AM" ? (
              <div className="flex flex-wrap gap-2">
                {FUSOS_AM.map((fuso) => (
                  <Button key={fuso.valor} type="button" size="sm" variant="outline" disabled={locked || salvando != null} onClick={() => responderFuso(fuso.valor, fuso.rotulo)}>
                    {fuso.rotulo}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                O ERP descobre o fuso pela UF e pelo município. Complete o endereço no{" "}
                <Link href="/configuracoes/empresa" className="underline underline-offset-2">cadastro da empresa</Link>.
              </p>
            )}
          </section>
        ) : null}

        {ordenadas.length > 0 ? (
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <CircleHelp className="size-4 text-amber-600" aria-hidden="true" />
              Precisamos da sua resposta ({ordenadas.length})
            </h3>
            {ordenadas.map(({ pergunta }) => (
              <Pergunta
                key={pergunta.id}
                pergunta={pergunta}
                valorAtual={null}
                disabled={locked || salvando != null}
                salvando={salvando === pergunta.id}
                onResponder={(valor) => responder(pergunta, valor)}
              />
            ))}
          </section>
        ) : (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
            Todas as perguntas sobre a empresa estão respondidas.
          </p>
        )}

        {respondidas.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Já respondido ({respondidas.length})</h3>
            <div className="divide-y rounded-lg border">
              {respondidas.map(({ pergunta, resposta }) => editando === pergunta.id ? (
                <div key={pergunta.id} className="p-3">
                  <Pergunta
                    pergunta={pergunta}
                    valorAtual={resposta!.valor}
                    disabled={locked || salvando != null}
                    salvando={salvando === pergunta.id}
                    onResponder={(valor) => responder(pergunta, valor)}
                    onCancelar={() => setEditando(null)}
                  />
                </div>
              ) : (
                <Respondida
                  key={pergunta.id}
                  pergunta={pergunta}
                  resposta={resposta!}
                  disabled={locked || salvando != null || pergunta.opcoes.length < 2}
                  onAlterar={() => setEditando(pergunta.id)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmpresaResumo({ fatos }: { fatos: SpedCompetenciaDetail["configuracao"]["empresa"] }) {
  const faltando = [!fatos.uf && "UF", !fatos.regimeTributario && "regime tributário", !fatos.cnae && "CNAE"].filter(Boolean);
  return (
    <div className="rounded-lg bg-muted/40 p-3 text-sm">
      <p className="text-xs text-muted-foreground">O ERP usa estes dados do cadastro da empresa:</p>
      <p className="mt-1">
        {fatos.uf ?? "UF não informada"} · {fatos.regimeTributario ? REGIMES[fatos.regimeTributario] ?? `Regime ${fatos.regimeTributario}` : "regime não informado"} ·{" "}
        {fatos.cnae ? `CNAE ${formatarCnae(fatos.cnae)}` : "CNAE não informado"}
      </p>
      {faltando.length ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          Falta {faltando.join(", ")} no cadastro; sem isso, algumas respostas viram perguntas.{" "}
          <Link href="/configuracoes/empresa" className="underline underline-offset-2">Abrir cadastro da empresa</Link>
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          Se algum dado estiver errado, corrija no <Link href="/configuracoes/empresa" className="underline underline-offset-2">cadastro da empresa</Link>.
        </p>
      )}
    </div>
  );
}

function Pergunta({
  pergunta,
  valorAtual,
  disabled,
  salvando,
  onResponder,
  onCancelar,
}: {
  pergunta: SpedPergunta;
  valorAtual: string | null;
  disabled: boolean;
  salvando: boolean;
  onResponder: (valor: string) => void;
  onCancelar?: () => void;
}) {
  return (
    <div className={valorAtual == null ? "space-y-2 rounded-lg border p-4" : "space-y-2"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium">{pergunta.pergunta}</p>
        {pergunta.quemResponde === "CONTADOR" ? (
          <Badge variant="outline" className="gap-1"><UserRound className="size-3" aria-hidden="true" /> Pergunte ao contador</Badge>
        ) : null}
      </div>
      {pergunta.ajuda ? <p className="text-xs leading-relaxed text-muted-foreground">{pergunta.ajuda}</p> : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {pergunta.opcoes.map((opcao) => (
          <Button
            key={opcao.valor}
            type="button"
            size="sm"
            variant={opcao.valor === valorAtual ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onResponder(opcao.valor)}
          >
            {opcao.rotulo}
          </Button>
        ))}
        {onCancelar ? <Button type="button" size="sm" variant="ghost" onClick={onCancelar}>Cancelar</Button> : null}
        {salvando ? <span className="self-center text-xs text-muted-foreground">Salvando...</span> : null}
      </div>
    </div>
  );
}

function Respondida({
  pergunta,
  resposta,
  disabled,
  onAlterar,
}: {
  pergunta: SpedPergunta;
  resposta: SpedRespostaAtual;
  disabled: boolean;
  onAlterar: () => void;
}) {
  const rotulo = pergunta.opcoes.find((opcao) => opcao.valor === resposta.valor)?.rotulo ?? ROTULO_ESPECIAL[resposta.valor] ?? resposta.valor;
  const quando = resposta.confirmadoEm ? ` em ${formatTimestamp(resposta.confirmadoEm)}` : "";
  const fonte = resposta.origem === "AUTOMATICA"
    ? "Respondido pelo ERP"
    : resposta.origem === "RESPOSTA"
      ? `Respondido nesta tela${quando}`
      : `Definido pelo contador${quando}`;
  return (
    <div className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <p className="text-sm">{pergunta.pergunta}</p>
        <p className="mt-0.5 text-sm font-medium">{rotulo}</p>
        <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
          {resposta.origem === "AUTOMATICA" ? <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> : null}
          <span>{fonte}{resposta.descricao ? `: ${resposta.descricao}` : "."}</span>
        </p>
      </div>
      {pergunta.opcoes.length > 1 ? (
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onAlterar}>
          <Pencil aria-hidden="true" /> Alterar
        </Button>
      ) : null}
    </div>
  );
}
