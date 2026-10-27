"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Copy, FilePlus2, FileText, MoreHorizontal, Pencil, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { MODULOS_DOCUMENTO, ROTULO_MODULO_DOCUMENTO, type DocumentoModelo, type ModuloDocumento } from "@/lib/documentos/tipos";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { atualizarDocumento, excluirDocumento, listarDocumentos } from "./api";

const ONDE_APARECE: Record<ModuloDocumento, string> = {
  venda: "no botão de impressora do diálogo da venda",
  os: "no botão de impressora dos detalhes da ordem de serviço",
  aluguel: "no botão de impressora dos detalhes do aluguel",
};

const DO_MODULO: Record<ModuloDocumento, string> = {
  venda: "de venda",
  os: "de ordem de serviço",
  aluguel: "de aluguel",
};

function atualizadoEm(valor: string) {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Fortaleza" });
}

export function DocumentosLista({ moduloInicial }: { moduloInicial: ModuloDocumento }) {
  const router = useRouter();
  const { data: session } = useSession();
  const permissoes = (session?.user as { permissoes?: unknown } | undefined)?.permissoes;
  const podeCriar = permissionSetHas(permissoes, PERMS.CONFIG_CRIAR);
  const podeEditar = permissionSetHas(permissoes, PERMS.CONFIG_EDITAR);
  const podeExcluir = permissionSetHas(permissoes, PERMS.CONFIG_EXCLUIR);

  const [itens, setItens] = useState<DocumentoModelo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<ModuloDocumento>(moduloInicial);
  const [excluindo, setExcluindo] = useState<DocumentoModelo | null>(null);
  const [alternando, setAlternando] = useState<number | null>(null);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setItens(await listarDocumentos());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao listar documentos.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  function trocarAba(modulo: ModuloDocumento) {
    setAba(modulo);
    // A aba vai na URL: o "Sair" do editor volta para ela.
    router.replace(`/configuracoes/documentos?modulo=${modulo}`, { scroll: false });
  }

  const doModulo = useMemo(() => itens.filter((d) => d.modulo === aba), [itens, aba]);
  const contagem = useMemo(() => {
    const total: Record<ModuloDocumento, { todos: number; ativos: number }> = {
      venda: { todos: 0, ativos: 0 },
      os: { todos: 0, ativos: 0 },
      aluguel: { todos: 0, ativos: 0 },
    };
    for (const d of itens) {
      total[d.modulo].todos += 1;
      if (d.ativo) total[d.modulo].ativos += 1;
    }
    return total;
  }, [itens]);

  async function alternarAtivo(doc: DocumentoModelo, ativo: boolean) {
    setAlternando(doc.id);
    try {
      const salvo = await atualizarDocumento(doc.id, {
        nome: doc.nome,
        modulo: doc.modulo,
        html: doc.html,
        ordem: doc.ordem,
        ativo,
        impressao_rapida: doc.impressao_rapida,
      });
      setItens((atual) => atual.map((d) => (d.id === salvo.id ? salvo : d)));
      toast.success(ativo ? `“${doc.nome}” ativado.` : `“${doc.nome}” desativado.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar documento.");
    } finally {
      setAlternando(null);
    }
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    const alvo = excluindo;
    setExcluindo(null);
    try {
      await excluirDocumento(alvo.id);
      setItens((atual) => atual.filter((d) => d.id !== alvo.id));
      toast.success("Documento excluído.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir documento.");
    }
  }

  const linkNovo = `/configuracoes/documentos/novo?modulo=${aba}`;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Documentos personalizados</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Contratos, recibos e termos em HTML, preenchidos com os dados do registro na hora de emitir.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => void recarregar()} disabled={carregando} aria-label="Atualizar lista">
            <RefreshCw className={cn("h-4 w-4", carregando && "animate-spin")} />
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
          {podeCriar ? (
            <Button size="sm" asChild>
              <Link href={linkNovo}>
                <Plus className="h-4 w-4" />
                Novo documento
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Módulos: cada documento aparece em um só. */}
        <div role="tablist" aria-label="Módulo" className="grid grid-cols-3 border-b">
          {MODULOS_DOCUMENTO.map((m) => {
            const ativo = aba === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => trocarAba(m)}
                className={cn(
                  "relative flex flex-col items-start gap-0.5 px-3 py-3 text-left transition-colors sm:px-5",
                  ativo ? "bg-background" : "bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}
              >
                <span className="text-sm font-semibold">{ROTULO_MODULO_DOCUMENTO[m]}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {carregando ? "…" : `${contagem[m].ativos} ativo${contagem[m].ativos === 1 ? "" : "s"} de ${contagem[m].todos}`}
                </span>
                <span
                  aria-hidden="true"
                  className={cn("absolute inset-x-0 bottom-0 h-0.5 transition-colors", ativo ? "bg-primary" : "bg-transparent")}
                />
              </button>
            );
          })}
        </div>

        <p className="flex items-center gap-2 border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground sm:px-5">
          <Printer className="h-3.5 w-3.5 shrink-0" />
          Os documentos ativos aparecem {ONDE_APARECE[aba]}, na ordem definida em cada um.
        </p>

        {carregando ? (
          <ul className="divide-y" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-9 w-9 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-48 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-28 animate-pulse rounded bg-muted" />
                </div>
              </li>
            ))}
          </ul>
        ) : erro ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <p className="text-sm text-destructive">{erro}</p>
            <Button variant="outline" size="sm" onClick={() => void recarregar()}>
              Tentar de novo
            </Button>
          </div>
        ) : doModulo.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <FilePlus2 className="h-6 w-6 text-muted-foreground" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium">Nenhum documento {DO_MODULO[aba]}</p>
              <p className="text-xs text-muted-foreground">Crie um contrato, recibo ou termo para emitir a partir daqui.</p>
            </div>
            {podeCriar ? (
              <Button size="sm" asChild>
                <Link href={linkNovo}>
                  <Plus className="h-4 w-4" />
                  Criar documento
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y">
            {doModulo.map((doc) => (
              <li
                key={doc.id}
                className={cn("group relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:gap-4 sm:px-5", !doc.ativo && "opacity-70")}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      href={`/configuracoes/documentos/${doc.id}`}
                      className="truncate font-medium outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
                    >
                      {doc.nome}
                    </Link>
                    {doc.codigo_padrao ? (
                      <Badge variant="outline" className="text-[10px]">
                        Padrão
                      </Badge>
                    ) : null}
                    {!doc.ativo ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Desativado
                      </Badge>
                    ) : null}
                    {doc.impressao_rapida ? (
                      <Badge variant="outline" className="text-[10px]">
                        Impressão rápida
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ordem {doc.ordem}
                    <span className="mx-1.5">·</span>
                    Atualizado em {atualizadoEm(doc.updated_at)}
                  </p>
                </div>

                {/* Acima do link que cobre a linha. */}
                <div className="relative z-10 flex shrink-0 items-center gap-1 sm:gap-3">
                  <Switch
                    checked={doc.ativo}
                    disabled={!podeEditar || alternando === doc.id}
                    onCheckedChange={(ativo) => void alternarAtivo(doc, ativo)}
                    aria-label={doc.ativo ? `Desativar ${doc.nome}` : `Ativar ${doc.nome}`}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Ações de ${doc.nome}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/configuracoes/documentos/${doc.id}`}>
                          <Pencil className="mr-2 h-4 w-4" />
                          {podeEditar ? "Editar" : "Visualizar"}
                        </Link>
                      </DropdownMenuItem>
                      {podeCriar ? (
                        <DropdownMenuItem asChild>
                          <Link href={`/configuracoes/documentos/novo?duplicar=${doc.id}`}>
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicar
                          </Link>
                        </DropdownMenuItem>
                      ) : null}
                      {podeExcluir ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setExcluindo(doc)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Excluir
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={Boolean(excluindo)} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{excluindo?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O documento deixa de aparecer para emissão. Documentos já impressos não são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void confirmarExclusao()}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
