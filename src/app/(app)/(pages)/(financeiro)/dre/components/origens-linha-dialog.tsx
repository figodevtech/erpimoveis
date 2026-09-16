"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ArrowRightLeft,
  CalendarDays,
  Cog,
  FolderTree,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { LinhaDre, PeriodoDre } from "../types";
import {
  ClassificarCadastroDialog,
  type AlvoClassificacao,
  type ContextoDaLinha,
} from "./classificar-cadastro-dialog";

type ContaDaLinha = {
  id: number;
  codigo: string | null;
  nome: string;
  grupo: string;
  ativo: boolean;
  doSistema: boolean;
  linhaPropria: boolean;
  classificacao: string | null;
  linhaCodigo: string | null;
  linhaNome: string | null;
  quantidade: number;
  valor: number;
  transacoes: number;
};

type OrigemAutomatica = {
  chave: string;
  rotulo: string;
  detalhe: string;
  declarada: boolean;
  quantidade: number;
  valor: number;
};

type Resposta = {
  contas: ContaDaLinha[];
  automaticas: OrigemAutomatica[];
};

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (v: number) => MOEDA.format(Number.isFinite(v) ? v : 0);

const normalizar = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");

const dataDoPeriodo = (iso: string) => iso.split("-").reverse().join("/");

const nomeDaConta = (conta: ContaDaLinha) => [conta.codigo, conta.nome].filter(Boolean).join(" · ");

/**
 * O que alimenta uma linha da DRE — as fontes, não os lançamentos.
 *
 * Clicar no valor responde "de onde veio este número"; clicar no nome da linha
 * responde "o que cai aqui", que é uma pergunta de cadastro: vale mesmo quando o
 * mês está zerado. Por isso conta sem movimento no período aparece igual.
 *
 * Plano de conta se move daqui para outra linha. Origem automática não: ela vem
 * do documento (OS, venda, entrada fiscal), e o significado é do documento, não
 * de uma conta que alguém escolheu.
 */
export function OrigensLinhaDialog({
  linha,
  periodo,
  versao,
  onFechar,
  onAlterado,
}: {
  linha: LinhaDre | null;
  periodo: PeriodoDre;
  /** Sobe quando a DRE é refeita: a lista acompanha sem fechar. */
  versao: number;
  onFechar: () => void;
  onAlterado: () => void;
}) {
  return (
    <Dialog open={!!linha} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {linha && (
          <Conteudo
            key={`${linha.id}|${periodo.de}|${periodo.ate}`}
            linha={linha}
            periodo={periodo}
            versao={versao}
            onAlterado={onAlterado}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Conteudo({
  linha,
  periodo,
  versao,
  onAlterado,
}: {
  linha: LinhaDre;
  periodo: PeriodoDre;
  versao: number;
  onAlterado: () => void;
}) {
  const { data: session } = useSession();
  const podeMover = permissionSetHas((session?.user as any)?.permissoes, PERMS.CONFIG_EDITAR);

  const chave = `${linha.id}|${periodo.de}|${periodo.ate}|${versao}`;
  const [resultado, setResultado] = useState<{
    chave: string;
    dados: Resposta | null;
    erro: string | null;
  }>({ chave: "", dados: null, erro: null });
  const [busca, setBusca] = useState("");
  const [mover, setMover] = useState<{ alvo: NonNullable<AlvoClassificacao>; contexto: ContextoDaLinha } | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/dre/origens?linha=${linha.id}&de=${periodo.de}&ate=${periodo.ate}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (resposta) => {
        const corpo = await resposta.json().catch(() => ({}));
        if (!resposta.ok) throw new Error(corpo?.error || "Não foi possível carregar as origens.");
        return corpo as Resposta;
      })
      .then((corpo) => {
        if (controller.signal.aborted) return;
        setResultado({ chave, dados: corpo, erro: null });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResultado((atual) => ({
          ...atual,
          chave,
          erro: e instanceof Error ? e.message : "Não foi possível carregar as origens.",
        }));
      });

    return () => controller.abort();
  }, [chave, linha.id, periodo.ate, periodo.de]);

  const primeiraCarga = resultado.chave === "";
  const carregando = resultado.chave !== chave;
  const contas = useMemo(() => resultado.dados?.contas ?? [], [resultado.dados]);
  const automaticas = useMemo(() => resultado.dados?.automaticas ?? [], [resultado.dados]);

  const termo = normalizar(busca.trim());
  const contasVisiveis = useMemo(
    () =>
      !termo
        ? contas
        : contas.filter((conta) =>
            [conta.nome, conta.codigo, conta.grupo, conta.linhaCodigo].some(
              (campo) => !!campo && normalizar(campo).includes(termo),
            ),
          ),
    [contas, termo],
  );

  const totalFontes = contas.length + automaticas.length;
  const periodoTexto = `${dataDoPeriodo(periodo.de)} a ${dataDoPeriodo(periodo.ate)}`;

  function abrirMover(conta: ContaDaLinha) {
    setMover({
      alvo: { tipo: "CONTA", id: conta.id, nome: nomeDaConta(conta) },
      contexto: {
        linha: { codigo: conta.linhaCodigo ?? linha.codigo, nome: conta.linhaNome ?? linha.nome },
        periodo: periodoTexto,
        lancamentos: conta.quantidade,
        valor: conta.valor,
        naturezas: [],
      },
    });
  }

  return (
    <>
      <DialogHeader className="space-y-0 border-b px-5 py-4 text-left sm:px-6">
        <div className="flex flex-col gap-3 pr-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground tabular-nums">
                {linha.codigo}
              </span>
              O que entra nesta linha
            </p>
            <DialogTitle className="mt-1.5 text-lg leading-tight">{linha.nome}</DialogTitle>
            <DialogDescription className="mt-1 flex items-center gap-1.5">
              <CalendarDays className="size-3.5 shrink-0" aria-hidden />
              Movimento de {periodoTexto}
            </DialogDescription>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="text-xs text-muted-foreground">Fontes</p>
            <p className="text-2xl font-semibold tabular-nums">{primeiraCarga ? "—" : totalFontes}</p>
            <p className="text-xs text-muted-foreground">
              {primeiraCarga ? "carregando…" : `${contas.length} conta(s) · ${automaticas.length} automática(s)`}
            </p>
          </div>
        </div>
      </DialogHeader>

      {contas.length > 8 && (
        <div className="border-b px-5 py-2.5 sm:px-6">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Buscar conta, grupo ou linha…"
              aria-label="Buscar planos de conta"
              className="h-8 pl-8"
            />
          </div>
        </div>
      )}

      <div className={cn("min-h-0 flex-1 overflow-y-auto", carregando && !primeiraCarga && "opacity-60")}>
        {resultado.erro ? (
          <p className="px-6 py-12 text-center text-sm text-destructive">{resultado.erro}</p>
        ) : primeiraCarga ? (
          <ul className="divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="ml-auto h-4 w-24" />
              </li>
            ))}
          </ul>
        ) : totalFontes === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium">Nada aponta para esta linha</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Nenhum plano de conta e nenhuma origem automática têm esta linha como destino. Ela só recebe valor
              se alguma conta for apontada para cá.
            </p>
          </div>
        ) : (
          <>
            {automaticas.length > 0 && (
              <Secao
                icone={Sparkles}
                titulo="Do sistema"
                descricao="Vêm do documento e não passam por plano de conta — não mudam de linha por aqui."
              >
                {automaticas.map((origem) => (
                  <li key={origem.chave} className="flex items-center gap-3 px-5 py-2.5 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{origem.rotulo}</p>
                      <p className="truncate text-xs text-muted-foreground">{origem.detalhe}</p>
                    </div>
                    {!origem.declarada && (
                      <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[11px] font-normal">
                        sem mapeamento
                      </Badge>
                    )}
                    <Valor quantidade={origem.quantidade} valor={origem.valor} />
                  </li>
                ))}
              </Secao>
            )}

            {contas.length > 0 && (
              <Secao
                icone={FolderTree}
                titulo="Planos de conta"
                descricao="O que for lançado nestas contas cai nesta linha. Mover leva junto todos os lançamentos da conta."
              >
                {contasVisiveis.length === 0 ? (
                  <li className="px-5 py-8 text-center text-sm text-muted-foreground sm:px-6">
                    Nenhuma conta com esse termo.
                  </li>
                ) : (
                  contasVisiveis.map((conta) => (
                    <li key={conta.id} className="flex items-center gap-3 px-5 py-2.5 sm:px-6">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{nomeDaConta(conta)}</p>
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 truncate text-xs text-muted-foreground">
                          <span className="truncate">{conta.grupo}</span>
                          <span>· {conta.linhaPropria ? "linha própria" : "segue o grupo"}</span>
                          {conta.linhaCodigo && conta.linhaCodigo !== linha.codigo && (
                            <span>· cai em {conta.linhaCodigo}</span>
                          )}
                          {!conta.ativo && <span>· inativa</span>}
                        </p>
                      </div>

                      {conta.doSistema && (
                        <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[11px] font-normal">
                          Sistema
                        </Badge>
                      )}
                      <Valor quantidade={conta.quantidade} valor={conta.valor} />

                      {conta.doSistema ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
                              <Cog className="size-4" aria-hidden />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            Conta do sistema: a finalidade dela não muda. Crie uma conta própria para outra linha.
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0"
                          disabled={!podeMover}
                          title={podeMover ? "Mover esta conta para outra linha" : "Exige permissão de configurações"}
                          onClick={() => abrirMover(conta)}
                        >
                          <ArrowRightLeft className="mr-1.5 size-3.5" aria-hidden />
                          Mover
                        </Button>
                      )}
                    </li>
                  ))
                )}
              </Secao>
            )}
          </>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground sm:px-6">
        <span>
          {primeiraCarga
            ? "carregando…"
            : `${contas.length} plano(s) de conta · ${automaticas.length} origem(ns) do sistema`}
        </span>
        <span>Conta sem movimento no período também aparece.</span>
      </footer>

      <ClassificarCadastroDialog
        alvo={mover?.alvo ?? null}
        contexto={mover?.contexto ?? null}
        podeEditar={podeMover}
        onFechar={() => setMover(null)}
        onClassificado={onAlterado}
      />
    </>
  );
}

function Secao({
  icone: Icone,
  titulo,
  descricao,
  children,
}: {
  icone: LucideIcon;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-start gap-2 bg-muted/30 px-5 py-2 sm:px-6">
        <Icone className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-xs font-medium">{titulo}</h3>
          <p className="text-[11px] text-muted-foreground">{descricao}</p>
        </div>
      </div>
      <ul className="divide-y">{children}</ul>
    </section>
  );
}

function Valor({ quantidade, valor }: { quantidade: number; valor: number }) {
  if (quantidade === 0) {
    return <span className="shrink-0 text-xs text-muted-foreground">sem movimento</span>;
  }
  return (
    <span className="shrink-0 text-right">
      <span className="block text-sm tabular-nums">{brl(valor)}</span>
      <span className="block text-[11px] text-muted-foreground tabular-nums">{quantidade} lanç.</span>
    </span>
  );
}
