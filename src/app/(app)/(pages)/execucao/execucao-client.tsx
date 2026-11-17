"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, CheckCircle2, Clock, Loader2, LogOut, MapPin, RefreshCw, Sparkles, User, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { requestJson } from "@/components/imobiliario/shared";
import { ResponsavelLimpezaSelect } from "@/components/imobiliario/responsavel-limpeza-select";

type Pessoa = { id: string; nome?: string | null; email?: string | null } | null;
type Limpeza = {
  id: number;
  imovel_id: number;
  reserva_id: number | null;
  responsavel_id: string | null;
  status: "PENDENTE" | "CONCLUIDA" | "CANCELADA";
  solicitada_em: string;
  concluida_em: string | null;
  observacoes: string | null;
  imovel: { id: number; titulo?: string | null; codigo?: string | null; endereco?: Record<string, string> | null; endereco_publico?: Record<string, string> | null } | null;
  reserva: { id: number; inicio: string; fim: string; checkout_em: string | null; hospedes: number; cliente: { id: number; nomerazaosocial: string } | null } | null;
  responsavel: Pessoa;
  solicitante: Pessoa;
  concluinte: Pessoa;
};
type Resposta = { items: Limpeza[]; total: number; page: number; pageSize: number; escopo: Escopo; podeGerenciar: boolean };
type Situacao = "PENDENTE" | "CONCLUIDA";
type Escopo = "minhas" | "todas" | "sem_responsavel";

const PAGE_SIZE = 30;
const momento = (valor: string | null | undefined) =>
  valor ? new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" }) : "—";

/** "há 3 h", "há 2 dias": quanto tempo a limpeza está esperando. */
function espera(desde: string) {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60_000));
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 48) return `há ${horas} h`;
  return `há ${Math.round(horas / 24)} dias`;
}

function enderecoDe(imovel: Limpeza["imovel"]) {
  const e = imovel?.endereco ?? {};
  const pub = imovel?.endereco_publico ?? {};
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const local = [e.bairro ?? pub.bairro, [e.cidade ?? pub.cidade, e.estado ?? pub.estado].filter(Boolean).join("/")].filter(Boolean).join(" · ");
  return [rua && (e.complemento ? `${rua} — ${e.complemento}` : rua), local].filter(Boolean).join(" · ");
}

const nomeDe = (p: Pessoa) => p?.nome?.trim() || p?.email?.trim() || null;

export function ExecucaoClient() {
  const [situacao, setSituacao] = useState<Situacao>("PENDENTE");
  const [escopo, setEscopo] = useState<Escopo>("minhas");
  const [page, setPage] = useState(1);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [concluindo, setConcluindo] = useState<Limpeza | null>(null);
  const [atribuindo, setAtribuindo] = useState<Limpeza | null>(null);
  const sequencia = useRef(0);

  const carregar = useCallback(async () => {
    const id = ++sequencia.current;
    setCarregando(true);
    setErro("");
    try {
      const params = new URLSearchParams({ status: situacao, escopo, page: String(page), pageSize: String(PAGE_SIZE) });
      const resposta = (await requestJson(`/api/execucao/limpezas?${params}`)) as Resposta;
      if (id === sequencia.current) setDados(resposta);
    } catch (error) {
      if (id === sequencia.current) setErro((error as Error).message);
    } finally {
      if (id === sequencia.current) setCarregando(false);
    }
  }, [situacao, escopo, page]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const podeGerenciar = dados?.podeGerenciar ?? false;
  const itens = dados?.items ?? [];
  const totalPaginas = dados ? Math.max(1, Math.ceil(dados.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Sparkles className="h-5 w-5 text-primary" />
            Limpezas
          </h1>
          <p className="text-sm text-muted-foreground">
            {podeGerenciar
              ? "Limpezas pedidas no check-out das reservas. Conclua, atribua ou acompanhe as da equipe."
              : "Imóveis em limpeza sob a sua responsabilidade. Conclua quando o imóvel estiver pronto."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando} className="gap-1.5 self-start hover:cursor-pointer sm:self-auto">
          <RefreshCw className={`h-3.5 w-3.5 ${carregando ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={situacao} onValueChange={(v) => { setSituacao(v as Situacao); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="PENDENTE" className="hover:cursor-pointer">Pendentes</TabsTrigger>
            <TabsTrigger value="CONCLUIDA" className="hover:cursor-pointer">Concluídas</TabsTrigger>
          </TabsList>
        </Tabs>
        {podeGerenciar ? (
          <Tabs value={escopo} onValueChange={(v) => { setEscopo(v as Escopo); setPage(1); }}>
            <TabsList>
              <TabsTrigger value="minhas" className="hover:cursor-pointer">Minhas</TabsTrigger>
              <TabsTrigger value="todas" className="hover:cursor-pointer">Todas</TabsTrigger>
              <TabsTrigger value="sem_responsavel" className="hover:cursor-pointer">Sem responsável</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
      </div>

      {erro ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <span>{erro}</span>
          <Button variant="outline" size="sm" onClick={() => void carregar()} className="hover:cursor-pointer">Tentar de novo</Button>
        </div>
      ) : carregando && !dados ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
        </div>
      ) : itens.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
          <p className="font-medium">
            {situacao === "PENDENTE" ? "Nenhuma limpeza pendente" : "Nenhuma limpeza concluída ainda"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {situacao === "PENDENTE"
              ? escopo === "minhas"
                ? "Quando um check-out pedir limpeza com você como responsável, o imóvel aparece aqui."
                : "Nenhum imóvel aguardando limpeza neste filtro."
              : "As limpezas concluídas aparecem aqui, das mais recentes para as mais antigas."}
          </p>
        </div>
      ) : (
        <div className={`grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${carregando ? "opacity-60" : ""}`}>
          {itens.map((limpeza) => (
            <LimpezaCard
              key={limpeza.id}
              limpeza={limpeza}
              podeGerenciar={podeGerenciar}
              onConcluir={() => setConcluindo(limpeza)}
              onAtribuir={() => setAtribuindo(limpeza)}
            />
          ))}
        </div>
      )}

      {dados && dados.total > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Página {page} de {totalPaginas} · {dados.total} limpezas
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1 || carregando} onClick={() => setPage((p) => p - 1)} className="hover:cursor-pointer">Anterior</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPaginas || carregando} onClick={() => setPage((p) => p + 1)} className="hover:cursor-pointer">Próxima</Button>
          </div>
        </div>
      ) : null}

      {concluindo ? (
        <ConcluirDialog
          limpeza={concluindo}
          onClose={() => setConcluindo(null)}
          onDone={() => {
            setConcluindo(null);
            void carregar();
          }}
        />
      ) : null}

      {atribuindo ? (
        <AtribuirDialog
          limpeza={atribuindo}
          onClose={() => setAtribuindo(null)}
          onDone={() => {
            setAtribuindo(null);
            void carregar();
          }}
        />
      ) : null}
    </div>
  );
}

function LimpezaCard({
  limpeza,
  podeGerenciar,
  onConcluir,
  onAtribuir,
}: {
  limpeza: Limpeza;
  podeGerenciar: boolean;
  onConcluir: () => void;
  onAtribuir: () => void;
}) {
  const titulo = limpeza.imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;
  const endereco = enderecoDe(limpeza.imovel);
  const responsavel = nomeDe(limpeza.responsavel);
  const pendente = limpeza.status === "PENDENTE";

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="space-y-2 border-b p-4">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <Building2 className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate">{titulo}</span>
          </CardTitle>
          {pendente ? (
            <Badge className="shrink-0 border border-amber-500/30 bg-amber-500/15 text-[11px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-400">
              Pendente
            </Badge>
          ) : (
            <Badge className="shrink-0 border border-emerald-500/30 bg-emerald-500/15 text-[11px] text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400">
              Concluída
            </Badge>
          )}
        </div>
        {limpeza.imovel?.codigo ? (
          <span className="w-fit rounded border border-border/40 bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            #{limpeza.imovel.codigo}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2.5 p-4 text-sm">
        {endereco ? (
          <p className="flex items-start gap-2 text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{endereco}</span>
          </p>
        ) : null}
        {pendente ? (
          <p className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Aguardando {espera(limpeza.solicitada_em)}{" "}
              <span className="text-muted-foreground">({momento(limpeza.solicitada_em)})</span>
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              Concluída em {momento(limpeza.concluida_em)}
              {nomeDe(limpeza.concluinte) ? <span className="text-muted-foreground"> por {nomeDe(limpeza.concluinte)}</span> : null}
            </span>
          </p>
        )}
        {limpeza.reserva ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              Saída {limpeza.reserva.cliente?.nomerazaosocial ? `de ${limpeza.reserva.cliente.nomerazaosocial}` : ""} · Reserva #{limpeza.reserva.id}
            </span>
          </p>
        ) : null}
        <p className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {responsavel ? <span>{responsavel}</span> : <span className="text-muted-foreground">Sem responsável</span>}
        </p>
        {limpeza.observacoes ? (
          <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">{limpeza.observacoes}</p>
        ) : null}

        {pendente ? (
          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" onClick={onConcluir} className="h-9 flex-1 gap-1.5 hover:cursor-pointer">
              <CheckCircle2 className="h-4 w-4" />
              Limpeza concluída
            </Button>
            {podeGerenciar ? (
              <Button size="sm" variant="outline" onClick={onAtribuir} className="h-9 gap-1.5 hover:cursor-pointer">
                <UserCog className="h-4 w-4" />
                Atribuir
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConcluirDialog({ limpeza, onClose, onDone }: { limpeza: Limpeza; onClose: () => void; onDone: () => void }) {
  const [observacoes, setObservacoes] = useState("");
  const [busy, setBusy] = useState(false);
  const titulo = limpeza.imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;

  const concluir = async () => {
    setBusy(true);
    try {
      await requestJson(`/api/execucao/limpezas/${limpeza.id}/concluir`, {
        method: "POST",
        body: JSON.stringify({ observacoes }),
      });
      toast.success("Limpeza concluída", { description: `${titulo} saiu da situação Limpeza.` });
      onDone();
    } catch (error) {
      toast.error("Não foi possível concluir a limpeza", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Concluir limpeza</DialogTitle>
          <DialogDescription>
            {titulo} deixa a situação Limpeza e volta a ficar pronto para o próximo hóspede.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Observações (opcional): itens repostos, algo a reparar..."
          rows={3}
          maxLength={2000}
          className="text-base sm:text-sm"
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="hover:cursor-pointer">Voltar</Button>
          <Button onClick={() => void concluir()} disabled={busy} className="gap-1.5 hover:cursor-pointer">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirmar conclusão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AtribuirDialog({ limpeza, onClose, onDone }: { limpeza: Limpeza; onClose: () => void; onDone: () => void }) {
  const [responsavel, setResponsavel] = useState<string | null>(limpeza.responsavel_id);
  const [busy, setBusy] = useState(false);
  const titulo = limpeza.imovel?.titulo || `Imóvel #${limpeza.imovel_id}`;

  const salvar = async () => {
    setBusy(true);
    try {
      await requestJson(`/api/execucao/limpezas/${limpeza.id}/atribuir`, {
        method: "POST",
        body: JSON.stringify({ responsavel_id: responsavel }),
      });
      toast.success(responsavel ? "Responsável atribuído" : "Limpeza ficou sem responsável");
      onDone();
    } catch (error) {
      toast.error("Não foi possível atribuir a limpeza", { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Responsável pela limpeza</DialogTitle>
          <DialogDescription>{titulo}</DialogDescription>
        </DialogHeader>
        <ResponsavelLimpezaSelect value={responsavel} onValueChange={setResponsavel} disabled={busy} />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="hover:cursor-pointer">Voltar</Button>
          <Button onClick={() => void salvar()} disabled={busy || responsavel === limpeza.responsavel_id} className="gap-1.5 hover:cursor-pointer">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
