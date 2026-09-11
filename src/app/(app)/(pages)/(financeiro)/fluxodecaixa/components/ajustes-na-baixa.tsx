"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { ChevronDown, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { totalDaBaixaComAjustes, type AjusteEmEspera } from "@/lib/financeiro/transacao";
import { normalizarAjustes } from "@/app/api/transaction/_lib/ajustes";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";
import { FormularioDeAjuste, type TipoAjuste } from "./formulario-de-ajuste";

export type AjusteNaBaixa = AjusteEmEspera & { id: string; tipoId: number; nome: string };

export function AjustesNaBaixa({ base, linhas, onChange, disabled, bloqueio, onRascunhoChange }: {
  base: number;
  linhas: AjusteNaBaixa[];
  onChange: (linhas: AjusteNaBaixa[]) => void;
  disabled: boolean;
  bloqueio: string | null;
  onRascunhoChange: (pendente: boolean) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [tipos, setTipos] = useState<TipoAjuste[] | null>(null);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [tipoId, setTipoId] = useState("");
  const [modo, setModo] = useState<"FIXO" | "PORCENTAGEM">("FIXO");
  const [valor, setValor] = useState("");

  useEffect(() => {
    if (!aberto || bloqueio || tipos) return;
    let ativo = true;
    axios.get("/api/tipos/ajustes-transacao")
      .then((res) => { if (ativo) setTipos(res.data.data ?? []); })
      .catch(() => { if (ativo) setErro(true); });
    return () => { ativo = false; };
  }, [aberto, bloqueio, tipos, tentativa]);

  function adicionar() {
    const tipo = tipos?.find((item) => String(item.id) === tipoId);
    const validacao = normalizarAjustes([{ tipoId, modo, valorInformado: valor.replace(",", ".") }]);
    if (!validacao.ok) { toast.error(validacao.erro); return; }
    if (!tipo) { toast.error("Escolha o tipo do ajuste."); return; }
    const linha: AjusteNaBaixa = {
      id: crypto.randomUUID(), tipoId: tipo.id, nome: tipo.nome,
      natureza: tipo.natureza, modo, valorInformado: validacao.ajustes[0].valorInformado,
    };
    const calculo = totalDaBaixaComAjustes({ saldo: 0, valorBase: base, ajustes: [linha] });
    if (calculo.acrescimos + calculo.descontos <= 0) {
      toast.error("O ajuste calculado ficou em zero."); return;
    }
    onChange([...linhas, linha]);
    setValor("");
    onRascunhoChange(false);
  }

  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Acréscimos e descontos na baixa">
      <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium" onClick={() => setAberto(!aberto)} aria-expanded={aberto} aria-controls="ajustes-baixa-conteudo">
        Acréscimos e descontos{linhas.length > 0 ? ` (${linhas.length})` : ""}
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div id="ajustes-baixa-conteudo" hidden={!aberto}>
        <p className="mt-2 text-xs text-muted-foreground">Os ajustes serão gravados junto com a baixa. Cancelar descarta os ajustes desta tela.</p>
        {bloqueio ? <p className="mt-3 text-xs text-muted-foreground">{bloqueio}</p> : erro ? (
          <div className="mt-3 text-sm"><p>Não foi possível carregar os tipos de ajuste.</p><Button type="button" variant="outline" onClick={() => { setErro(false); setTentativa(tentativa + 1); }}>Tentar novamente</Button></div>
        ) : !tipos ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando tipos...</p>
        ) : (
          <div className="mt-3">
            <FormularioDeAjuste tipos={tipos} tipoId={tipoId} onTipoChange={setTipoId}
              modo={modo} onModoChange={setModo} valor={valor}
              onValorChange={(novo) => { setValor(novo); onRascunhoChange(novo !== "" && novo !== "0"); }}
              base={base} onAdicionar={adicionar} disabled={disabled || linhas.length >= 8} rotulo="Adicionar" />
            {linhas.length >= 8 ? <p className="mt-2 text-xs text-muted-foreground">Limite de 8 ajustes por baixa.</p> : null}
          </div>
        )}
        {valor !== "" && valor !== "0" ? <Button type="button" variant="ghost" disabled={disabled} onClick={() => { setValor(""); onRascunhoChange(false); }}>Limpar valor do ajuste</Button> : null}
        {linhas.length > 0 ? <ul className="mt-3 divide-y">
          {linhas.map((linha) => {
            const calculo = totalDaBaixaComAjustes({ saldo: 0, valorBase: base, ajustes: [linha] });
            return <li key={linha.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{linha.nome}{linha.modo === "PORCENTAGEM" ? ` (${linha.valorInformado}%)` : ""}</span>
              <span className="shrink-0 tabular-nums">{linha.natureza === "ACRESCIMO" ? "+" : "−"} {formatarEmReal(calculo.acrescimos + calculo.descontos)}</span>
              <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`Remover ${linha.nome}`} onClick={() => onChange(linhas.filter((item) => item.id !== linha.id))}><Trash2 className="h-4 w-4" /></Button>
            </li>;
          })}
        </ul> : null}
      </div>
    </section>
  );
}
