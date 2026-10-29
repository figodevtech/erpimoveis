"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  Maximize2,
  MoreHorizontal,
  RotateCcw,
  Save,
  ScanLine,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { CATALOGOS } from "@/lib/documentos/catalogo";
import { contextoDeExemplo } from "@/lib/documentos/exemplos";
import { renderizarModelo, variaveisDesconhecidas } from "@/lib/documentos/motor";
import { documentoPadrao } from "@/lib/documentos/padrao";
import {
  LIMITE_HTML_DOCUMENTO,
  MODULOS_DOCUMENTO,
  ROTULO_MODULO_DOCUMENTO,
  ehModuloDocumento,
  type ModuloDocumento,
} from "@/lib/documentos/tipos";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { atualizarDocumento, criarDocumento, excluirDocumento, type DocumentoPayload } from "./api";
import { EditorCodigo, type EditorCodigoHandle } from "./editor-codigo";
import { PainelVariaveis } from "./painel-variaveis";
import { PreviaDocumento, type ZoomPrevia } from "./previa-documento";

export type DocumentoEmEdicao = DocumentoPayload & {
  id: number | null;
  codigo_padrao: string | null;
};

/** Abaixo de lg, um painel por vez. */
type Painel = "codigo" | "previa";

const REGISTRO_DO_MODULO: Record<ModuloDocumento, string> = {
  venda: "Nº da venda",
};

export function listaDeDocumentos(modulo: ModuloDocumento) {
  return `/configuracoes/documentos?modulo=${modulo}`;
}

function iguais(a: DocumentoEmEdicao, b: DocumentoEmEdicao) {
  return (
    a.nome === b.nome &&
    a.modulo === b.modulo &&
    a.html === b.html &&
    a.ativo === b.ativo &&
    a.ordem === b.ordem &&
    a.impressao_rapida === b.impressao_rapida
  );
}

/** Cabeçalho de cada painel do espaço de trabalho. */
function CabecalhoPainel({ icone: Icone, titulo, children }: { icone: typeof Code2; titulo: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icone className="h-3.5 w-3.5" />
        {titulo}
      </span>
      {children}
    </div>
  );
}

export function EditorDocumento({ inicial }: { inicial: DocumentoEmEdicao }) {
  const router = useRouter();
  const { data: session } = useSession();
  const permissoes = (session?.user as { permissoes?: unknown } | undefined)?.permissoes;
  const novo = inicial.id === null;
  const somenteLeitura = !permissionSetHas(permissoes, novo ? PERMS.CONFIG_CRIAR : PERMS.CONFIG_EDITAR);
  const podeCriar = permissionSetHas(permissoes, PERMS.CONFIG_CRIAR);
  const podeExcluir = permissionSetHas(permissoes, PERMS.CONFIG_EXCLUIR);

  const [rascunho, setRascunho] = useState(inicial);
  const [salvo, setSalvo] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [painel, setPainel] = useState<Painel>("codigo");
  const [variaveisAbertas, setVariaveisAbertas] = useState(false);
  const [zoom, setZoom] = useState<ZoomPrevia>("ajustar");
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [registroTeste, setRegistroTeste] = useState("");
  const editor = useRef<EditorCodigoHandle>(null);

  const modulo = rascunho.modulo;
  const mudou = !iguais(rascunho, salvo);
  const sujo = novo || mudou;
  const padrao = documentoPadrao(rascunho.codigo_padrao);
  const alterar = (parcial: Partial<DocumentoEmEdicao>) => setRascunho((atual) => ({ ...atual, ...parcial }));

  // A prévia acompanha a digitação sem travar o editor.
  const htmlDaPrevia = useDeferredValue(rascunho.html);
  const contexto = useMemo(() => contextoDeExemplo(modulo, rascunho.nome || "Documento"), [modulo, rascunho.nome]);
  const previa = useMemo(() => renderizarModelo(htmlDaPrevia, contexto, CATALOGOS[modulo]), [htmlDaPrevia, contexto, modulo]);
  const desconhecidas = useMemo(() => variaveisDesconhecidas(htmlDaPrevia, CATALOGOS[modulo]), [htmlDaPrevia, modulo]);

  const salvar = useCallback(async () => {
    if (somenteLeitura || salvando) return;
    if (!rascunho.nome.trim()) return void toast.error("Dê um nome ao documento.");
    if (!rascunho.html.trim()) return void toast.error("O documento está vazio.");
    if (rascunho.html.length > LIMITE_HTML_DOCUMENTO) return void toast.error("O documento passou do limite de caracteres.");

    const payload: DocumentoPayload = {
      nome: rascunho.nome.trim(),
      modulo: rascunho.modulo,
      html: rascunho.html,
      ativo: rascunho.ativo,
      ordem: rascunho.ordem,
      impressao_rapida: rascunho.impressao_rapida,
    };
    setSalvando(true);
    try {
      if (rascunho.id === null) {
        const criado = await criarDocumento(payload);
        toast.success("Documento criado.");
        router.replace(`/configuracoes/documentos/${criado.id}`);
        return;
      }
      const atualizado = await atualizarDocumento(rascunho.id, payload);
      const gravado = { ...rascunho, ...atualizado, codigo_padrao: atualizado.codigo_padrao };
      setRascunho(gravado);
      setSalvo(gravado);
      toast.success("Documento salvo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar documento.");
    } finally {
      setSalvando(false);
    }
  }, [rascunho, router, salvando, somenteLeitura]);

  // Ctrl+S salva de qualquer ponto da página.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void salvar();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [salvar]);

  // Fechar ou recarregar a aba com alteração pendente pede confirmação.
  useEffect(() => {
    if (!mudou || somenteLeitura) return;
    const aoSair = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [mudou, somenteLeitura]);

  function sair() {
    if (mudou && !somenteLeitura) setConfirmarSaida(true);
    else router.push(listaDeDocumentos(salvo.modulo));
  }

  function inserir(trecho: string) {
    // Abaixo de lg as variáveis cobrem o editor: fecha e volta para o HTML.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setVariaveisAbertas(false);
      setPainel("codigo");
    }
    requestAnimationFrame(() => editor.current?.inserir(trecho));
  }

  async function excluir() {
    if (rascunho.id === null) return;
    try {
      await excluirDocumento(rascunho.id);
      toast.success("Documento excluído.");
      router.push(listaDeDocumentos(salvo.modulo));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir documento.");
    }
  }

  const idTeste = Number(registroTeste);
  const podeTestar = rascunho.id !== null && !mudou && Number.isSafeInteger(idTeste) && idTeste > 0;

  return (
    // Sem card: o editor ocupa toda a área abaixo do cabeçalho do app,
    // anulando o respiro que o <main> dá às outras telas.
    <div className="-mx-4 -my-4 flex h-[calc(100svh-4rem)] min-h-[520px] flex-col overflow-hidden bg-background md:-mx-6 md:-my-6">
      {/* Uma barra só: sair, nome, ações. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="sm" onClick={sair} className="shrink-0">
          <ArrowLeft className="h-4 w-4" />
          Sair
        </Button>
        <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />

        <div className="flex min-w-[10rem] flex-1 items-center gap-2">
          <label htmlFor="documento-nome" className="sr-only">
            Nome do documento
          </label>
          <input
            id="documento-nome"
            value={rascunho.nome}
            maxLength={120}
            readOnly={somenteLeitura}
            onChange={(e) => alterar({ nome: e.target.value })}
            placeholder="Nome do documento"
            className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground hover:border-border focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
          />
          <Badge variant="secondary" className="hidden shrink-0 text-[10px] md:inline-flex">
            {ROTULO_MODULO_DOCUMENTO[modulo]}
          </Badge>
          {!rascunho.ativo ? (
            <Badge variant="outline" className="hidden shrink-0 text-[10px] md:inline-flex">
              Desativado
            </Badge>
          ) : null}
          {padrao ? (
            <Badge variant="outline" className="hidden shrink-0 text-[10px] lg:inline-flex">
              Padrão
            </Badge>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            aria-live="polite"
            className={cn(
              "mr-1 hidden items-center gap-1.5 text-xs md:flex",
              sujo ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
            )}
          >
            {sujo ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {novo ? "Ainda não salvo" : "Não salvo"}
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Salvo
              </>
            )}
          </span>

          {desconhecidas.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`${desconhecidas.length} variáveis desconhecidas`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {desconhecidas.length}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 text-sm">
                <p className="mb-2 font-medium">Variáveis fora do catálogo de {ROTULO_MODULO_DOCUMENTO[modulo].toLowerCase()}</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Vão sair escritas assim no documento. Confira a grafia em Variáveis.
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {desconhecidas.map((v) => (
                    <li key={v} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {v.startsWith("{{") ? v : `{{${v}}}`}
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          ) : null}

          <Button
            variant={variaveisAbertas ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={variaveisAbertas}
            aria-controls="painel-variaveis"
            onClick={() => setVariaveisAbertas((v) => !v)}
          >
            <Braces className="h-4 w-4" />
            <span className="hidden sm:inline">Variáveis</span>
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Opções do documento">
                <SlidersHorizontal className="h-4 w-4" />
                <span className="hidden sm:inline">Opções</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="documento-modulo">
                  Aparece em
                </label>
                <Select
                  value={modulo}
                  disabled={somenteLeitura}
                  onValueChange={(valor) => ehModuloDocumento(valor) && alterar({ modulo: valor })}
                >
                  <SelectTrigger id="documento-modulo" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODULOS_DOCUMENTO.map((m) => (
                      <SelectItem key={m} value={m}>
                        {ROTULO_MODULO_DOCUMENTO[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="documento-ordem">
                  Ordem no menu de impressão
                </label>
                <Input
                  id="documento-ordem"
                  type="number"
                  min={0}
                  max={9999}
                  value={rascunho.ordem}
                  readOnly={somenteLeitura}
                  onChange={(e) => alterar({ ordem: Math.max(0, Math.min(9999, Math.trunc(Number(e.target.value) || 0))) })}
                  className="tabular-nums"
                />
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Ativo para emissão
                  <span className="block text-xs text-muted-foreground">Desativado, some do botão de impressora.</span>
                </span>
                <Switch checked={rascunho.ativo} disabled={somenteLeitura} onCheckedChange={(ativo) => alterar({ ativo })} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Impressão rápida
                  <span className="block text-xs text-muted-foreground">
                    Botão de imprimir direto no menu, sem abrir a aba do documento.
                  </span>
                </span>
                <Switch
                  checked={rascunho.impressao_rapida}
                  disabled={somenteLeitura}
                  onCheckedChange={(impressao_rapida) => alterar({ impressao_rapida })}
                />
              </label>
              {padrao && !somenteLeitura ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    alterar({ html: padrao.html, modulo: padrao.modulo });
                    toast.success("Texto padrão restaurado. Salve para gravar.");
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restaurar texto padrão
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>

          {!novo && (podeCriar || podeExcluir) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Mais ações">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {podeCriar ? (
                  <DropdownMenuItem onSelect={() => router.push(`/configuracoes/documentos/novo?duplicar=${rascunho.id}`)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicar
                  </DropdownMenuItem>
                ) : null}
                {podeExcluir ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmarExclusao(true)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Excluir
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {!somenteLeitura ? (
            <Button size="sm" onClick={() => void salvar()} disabled={salvando || (!sujo && !novo)}>
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {novo ? "Criar" : "Salvar"}
            </Button>
          ) : (
            <Badge variant="outline">Somente leitura</Badge>
          )}
        </div>
      </div>

      {/* Abaixo de lg, um painel por vez. */}
      <div role="tablist" aria-label="Painéis do editor" className="flex shrink-0 gap-1 border-b px-3 py-1.5 lg:hidden">
        {(
          [
            ["codigo", "HTML", Code2],
            ["previa", "Prévia", Eye],
          ] as const
        ).map(([id, rotulo, Icone]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={painel === id}
            onClick={() => setPainel(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              painel === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icone className="h-3.5 w-3.5" />
            {rotulo}
          </button>
        ))}
      </div>

      {/* HTML e prévia meio a meio; as variáveis entram à esquerda só quando pedidas. */}
      <div
        className={cn(
          "relative grid min-h-0 flex-1 lg:grid-cols-2",
          variaveisAbertas && "lg:grid-cols-[18rem_minmax(0,1fr)_minmax(0,1fr)]",
        )}
      >
        {variaveisAbertas ? (
          <>
            <button
              type="button"
              aria-label="Fechar variáveis"
              onClick={() => setVariaveisAbertas(false)}
              className="absolute inset-0 z-20 bg-black/30 lg:hidden"
            />
            <section
              id="painel-variaveis"
              aria-label="Variáveis"
              className="absolute inset-y-0 left-0 z-30 flex w-[min(20rem,88vw)] min-h-0 flex-col border-r bg-card shadow-xl lg:static lg:w-auto lg:shadow-none"
            >
              <CabecalhoPainel icone={Braces} titulo={`Variáveis · ${ROTULO_MODULO_DOCUMENTO[modulo]}`}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Esconder variáveis"
                  onClick={() => setVariaveisAbertas(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </CabecalhoPainel>
              <PainelVariaveis modulo={modulo} onInserir={inserir} desabilitado={somenteLeitura} />
            </section>
          </>
        ) : null}

        <section aria-label="HTML" className={cn("min-h-0 min-w-0 flex-col lg:flex lg:border-r", painel === "codigo" ? "flex" : "hidden")}>
          <CabecalhoPainel icone={Code2} titulo="HTML" />
          <EditorCodigo
            ref={editor}
            value={rascunho.html}
            onChange={(html) => alterar({ html })}
            readOnly={somenteLeitura}
            limite={LIMITE_HTML_DOCUMENTO}
          />
        </section>

        <section aria-label="Prévia" className={cn("min-h-0 min-w-0 flex-col lg:flex", painel === "previa" ? "flex" : "hidden")}>
          <CabecalhoPainel icone={Eye} titulo="Prévia · dados de exemplo">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={zoom === "ajustar" ? "Ver em tamanho real" : "Ajustar à largura"}
                    onClick={() => setZoom((z) => (z === "ajustar" ? "real" : "ajustar"))}
                  >
                    {zoom === "ajustar" ? <Maximize2 className="h-3.5 w-3.5" /> : <ScanLine className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{zoom === "ajustar" ? "Tamanho real (A4)" : "Ajustar à largura"}</TooltipContent>
              </Tooltip>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={rascunho.id === null}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Testar com registro
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72">
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (podeTestar) window.open(`/print/documento/${rascunho.id}/${idTeste}`, "_blank");
                    }}
                  >
                    <label htmlFor="registro-teste" className="text-sm font-medium">
                      {REGISTRO_DO_MODULO[modulo]}
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="registro-teste"
                        inputMode="numeric"
                        value={registroTeste}
                        onChange={(e) => setRegistroTeste(e.target.value.replace(/\D/g, ""))}
                        placeholder="Ex.: 1234"
                        className="h-8"
                      />
                      <Button type="submit" size="sm" className="h-8" disabled={!podeTestar}>
                        Abrir
                      </Button>
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      {mudou
                        ? "Salve antes: o teste usa a versão gravada do documento."
                        : "Abre a emissão de verdade numa aba nova, com os dados desse registro."}
                    </p>
                  </form>
                </PopoverContent>
              </Popover>
            </div>
          </CabecalhoPainel>
          <PreviaDocumento html={previa} zoom={zoom} titulo={rascunho.nome || "Documento"} />
        </section>
      </div>

      <AlertDialog open={confirmarSaida} onOpenChange={setConfirmarSaida}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>As alterações feitas neste documento serão perdidas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => router.push(listaDeDocumentos(salvo.modulo))}
            >
              Descartar e sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmarExclusao} onOpenChange={setConfirmarExclusao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{salvo.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O documento deixa de aparecer para emissão. Documentos já impressos não são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void excluir()}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
