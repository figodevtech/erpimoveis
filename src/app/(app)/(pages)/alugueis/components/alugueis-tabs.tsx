"use client";

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, ChevronDown, KeyRound, Layers, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AbaAluguel } from "@/lib/alugueis/status";
import { contarAlugueis } from "../lib/api";
import type { AluguelLista } from "../types";
import { AlugueisTabela } from "./alugueis-tabela";
import type { AcaoAluguel } from "./row-actions";

const ABAS: { key: AbaAluguel; label: string; icon: JSX.Element; dot: string; active: string; accent: string }[] = [
  {
    key: "EM_ANDAMENTO",
    label: "Em andamento",
    icon: <KeyRound className="h-4 w-4" />,
    dot: "bg-emerald-500",
    active: "data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-800 data-[state=active]:ring-emerald-500/30",
    accent: "text-emerald-700 dark:text-emerald-300",
  },
  {
    key: "ATRASADOS",
    label: "Atrasados",
    icon: <AlertTriangle className="h-4 w-4" />,
    dot: "bg-red-500",
    active: "data-[state=active]:bg-red-500/15 data-[state=active]:text-red-800 data-[state=active]:ring-red-500/30",
    accent: "text-red-700 dark:text-red-300",
  },
  {
    key: "PAUSADOS",
    label: "Pausados",
    icon: <PauseCircle className="h-4 w-4" />,
    dot: "bg-slate-500",
    active: "data-[state=active]:bg-slate-500/15 data-[state=active]:text-slate-800 data-[state=active]:ring-slate-500/30",
    accent: "text-slate-700 dark:text-slate-300",
  },
  {
    key: "ENCERRADOS",
    label: "Encerrados",
    icon: <CheckCircle2 className="h-4 w-4" />,
    dot: "bg-indigo-500",
    active: "data-[state=active]:bg-indigo-500/15 data-[state=active]:text-indigo-800 data-[state=active]:ring-indigo-500/30",
    accent: "text-indigo-700 dark:text-indigo-300",
  },
  {
    key: "TODOS",
    label: "Todos",
    icon: <Layers className="h-4 w-4" />,
    dot: "bg-violet-500",
    active: "data-[state=active]:bg-violet-600/15 data-[state=active]:text-violet-700 data-[state=active]:ring-violet-500/30",
    accent: "text-violet-700 dark:text-violet-300",
  },
];

const ZERADO: Record<AbaAluguel, number> = { TODOS: 0, EM_ANDAMENTO: 0, ATRASADOS: 0, PAUSADOS: 0, ENCERRADOS: 0 };

function MiniCard({ title, value, icon, accent }: { title: string; value: number; icon: JSX.Element; accent: string }) {
  return (
    <Card className="bg-card py-4">
      <CardContent className="p-2 sm:p-3">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground sm:text-xs">
          <span className="truncate leading-tight">{title}</span>
          <span className={`shrink-0 ${accent} [&>svg]:h-3 [&>svg]:w-3 sm:[&>svg]:h-4 sm:[&>svg]:w-4`}>{icon}</span>
        </div>
        <div className="text-lg font-semibold leading-snug tabular-nums sm:text-xl">{value}</div>
      </CardContent>
    </Card>
  );
}

export function AlugueisTabs({
  onNovo,
  onAcao,
}: {
  onNovo: () => void;
  onAcao: (acao: AcaoAluguel, aluguel: AluguelLista) => void;
}) {
  const [aba, setAba] = useState<AbaAluguel>("EM_ANDAMENTO");
  const [contagem, setContagem] = useState(ZERADO);
  const [resumoMobile, setResumoMobile] = useState(false);
  const requisicao = useRef(0);

  const carregarContagem = useCallback(async () => {
    const id = ++requisicao.current;
    try {
      const dados = await contarAlugueis();
      if (id === requisicao.current) setContagem({ ...ZERADO, ...dados });
    } catch {
      // Contador é auxiliar; a lista mostra o erro.
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(carregarContagem);
    const aoMudar = () => void carregarContagem();
    window.addEventListener("alugueis:refresh", aoMudar);
    return () => window.removeEventListener("alugueis:refresh", aoMudar);
  }, [carregarContagem]);

  const resumo = (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {ABAS.map((item) => (
        <MiniCard key={item.key} title={item.label} value={contagem[item.key]} icon={item.icon} accent={item.accent} />
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="sm:hidden">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between"
          aria-expanded={resumoMobile}
          onClick={() => setResumoMobile((v) => !v)}
        >
          <span className="inline-flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Resumo
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${resumoMobile ? "rotate-180" : ""}`} />
        </Button>
        {resumoMobile ? <div className="mt-2">{resumo}</div> : null}
      </div>
      <div className="hidden sm:block">{resumo}</div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as AbaAluguel)} className="w-full">
        <TabsList className="w-full justify-start gap-2 overflow-x-auto rounded-lg bg-violet-50/80 px-1 py-1 ring-1 ring-violet-200/80 supports-[backdrop-filter]:backdrop-blur dark:bg-muted/40 dark:ring-border">
          {ABAS.map((item) => (
            <TabsTrigger
              key={item.key}
              value={item.key}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs ring-1 ring-transparent transition-colors hover:bg-violet-100/70 md:text-sm ${item.active}`}
            >
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${item.dot}`} />
                {item.icon}
                <span>{item.label}</span>
                <span className="text-[10px] tabular-nums opacity-70">{contagem[item.key]}</span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {ABAS.map((item) => (
          <TabsContent key={item.key} value={item.key} className="mt-3">
            <AlugueisTabela aba={item.key} onNovo={onNovo} onAcao={onAcao} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
