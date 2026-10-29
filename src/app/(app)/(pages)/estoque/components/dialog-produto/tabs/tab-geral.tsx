"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { UppercaseInput } from "@/components/ui/uppercase-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "../entrada-valor";
import { Conservacao_produto, Produto, Unidade_medida } from "../../../types";
import { formatDate } from "@/utils/formatDate";
import { CodigoBarrasInput } from "../codigo-barras-input";
import { ESTOQUE_STATUS_BADGES } from "../lib/options-fiscais";
import type { UnidadeFromApi } from "../hooks/use-unidades-medida";
import { GrupoFromApi } from "../hooks/use-grupo-produtos";
import { TagInput } from "../tag-input";
import { Info, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import GrupoProdutoDialog from "@/app/(app)/(pages)/configuracoes/tipos/components/grupoProdutoDialog/grupo-produto-dialog";
import { useTipoAccess } from "@/app/(app)/(pages)/configuracoes/tipos/components/use-tipo-access";
import { DescricaoIA } from "./descricao-ia";
import { SearchCombobox } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/search-combobox";

type Props = {
  mode: "create" | "edit";
  produto: Produto;
  onChange: (field: keyof Produto, value: any) => void;
  unidades: UnidadeFromApi[];
  loadingUnidades: boolean;
  errorUnidades: string | null;
  showDates?: boolean;
  grupos: GrupoFromApi[];
  loadingGrupos?: boolean;
  onGrupoCriado?: (grupo: GrupoFromApi) => void;
  precoMedioCompraObrigatorio?: boolean;
};

export function TabGeral({
  mode,
  produto,
  onChange,
  unidades,
  grupos,
  loadingGrupos = false,
  onGrupoCriado,
  loadingUnidades,
  errorUnidades,
  showDates,
  precoMedioCompraObrigatorio = false,
}: Props) {
  const LIMITE_TITULO = 100;
  const LIMITE_DESCRICAO = 300;
  const LIMITE_FABRICANTE = 50;

  const qtdTitulo = (produto.titulo ?? "").length;
  const qtdDescricao = (produto.descricao ?? "").length;
  const qtdFabricante = (produto.fabricante ?? "").length;

  const { canCreate: podeCriarGrupo } = useTipoAccess("grupos");
  const [novoGrupoOpen, setNovoGrupoOpen] = useState(false);

  const opcoesGrupo = grupos.map((g) => ({ value: g.id.toString(), label: g.nome }));
  // A lista traz so grupos ativos: um produto ainda ligado a um grupo inativo
  // continua mostrando o seu, em vez de parecer sem grupo.
  if (
    produto.grupo_produto_id &&
    produto.grupo?.nome &&
    !opcoesGrupo.some((o) => o.value === produto.grupo_produto_id?.toString())
  ) {
    opcoesGrupo.push({ value: produto.grupo_produto_id.toString(), label: produto.grupo.nome });
  }

  return (
    <TabsContent value="Geral" className="h-full min-h-0 w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto bg-muted-foreground/5 px-4 py-4 md:px-6 md:py-6">
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            <div className="col-span-2 space-y-2 lg:col-span-2 flex items-center">
              <Label htmlFor="status_estoque">
                Status do Estoque:{" "}
                {ESTOQUE_STATUS_BADGES.filter((s) => s.value === produto.status_estoque).map((s) => (
                  <Badge key={s.value} variant={s.badge}>
                    {s.value}
                  </Badge>
                ))}
              </Label>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <Label>Grupo{mode === "create" && <span className="text-destructive"> *</span>}</Label>
              <div className="flex min-w-0 gap-2">
                <div className="min-w-0 flex-1">
                  <SearchCombobox
                    value={produto.grupo_produto_id?.toString() ?? ""}
                    options={opcoesGrupo}
                    onValueChange={(v) => onChange("grupo_produto_id", v ? Number(v) : undefined)}
                    loading={loadingGrupos}
                    placeholder="Selecione"
                    searchPlaceholder="Buscar grupo..."
                    emptyMessage="Nenhum grupo encontrado."
                  />
                </div>
                {podeCriarGrupo && onGrupoCriado ? (
                  <GrupoProdutoDialog
                    open={novoGrupoOpen}
                    onOpenChange={setNovoGrupoOpen}
                    onSaved={(grupo) => {
                      onGrupoCriado({ ...grupo, ativo: grupo.ativo ?? true });
                      // Grupo inativo nao entra na lista, entao nao da para seleciona-lo.
                      if (grupo.ativo !== false) onChange("grupo_produto_id", grupo.id);
                    }}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-9 shrink-0"
                      aria-label="Cadastrar novo grupo"
                      title="Cadastrar novo grupo"
                    >
                      <Plus className="size-4" aria-hidden="true" />
                    </Button>
                  </GrupoProdutoDialog>
                ) : null}
              </div>
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label>Conservação</Label>
              <Select
                value={produto.conservacao || ""}
                onValueChange={(v) => {
                  if (v === "Selecione") {
                    onChange("conservacao", null);
                  } else {
                    onChange("conservacao", v);
                  }
                }}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(Conservacao_produto).map((c) => (
                    <SelectItem className="hover:cursor-pointer" key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                  <SelectItem
                    className="hover:cursor-pointer bg-muted/50 data-[state=open]:bg-muted"
                    key="Selecione"
                    value="Selecione"
                  >
                    NÃO INFORMAR
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="titulo">Título *</Label>
              <span className={`text-xs ${qtdTitulo >= LIMITE_TITULO ? "text-destructive" : "text-muted-foreground"}`}>
                {qtdTitulo}/{LIMITE_TITULO}
              </span>
            </div>

            <UppercaseInput
              id="titulo"
              value={produto.titulo}
              onValueChange={(valor) => onChange("titulo", valor)}
              placeholder={mode === "edit" ? "Nome comercial / vitrine" : "Título interno"}
              maxLength={LIMITE_TITULO}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="descricao">Descrição</Label>
              <span
                className={`text-xs ${qtdDescricao >= LIMITE_DESCRICAO ? "text-destructive" : "text-muted-foreground"}`}
              >
                {qtdDescricao}/{LIMITE_DESCRICAO}
              </span>
            </div>

            <Textarea
              id="descricao"
              value={produto.descricao || ""}
              onChange={(e) => onChange("descricao", e.target.value)}
              placeholder="Descrição do produto"
              maxLength={LIMITE_DESCRICAO}
            />
            <DescricaoIA produto={produto} onChange={onChange} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-2 lg:col-span-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="fabricante">Fabricante</Label>
                <span
                  className={`text-xs ${qtdFabricante >= LIMITE_FABRICANTE ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {qtdFabricante}/{LIMITE_FABRICANTE}
                </span>
              </div>
              <Input
                id="fabricante"
                value={(produto as any).fabricante || ""}
                onChange={(e) => onChange("fabricante", e.target.value)}
                placeholder="Fabricante"
              />
            </div>
            <div className="lg:col-span-2">
              <CodigoBarrasInput
                produtoId={mode === "edit" ? produto.id : undefined}
                value={produto.codigobarras}
                onChange={(v) => onChange("codigobarras", v)}
              />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="unidade">Unidade</Label>
              <Select
                value={produto.unidade || undefined}
                onValueChange={(v) => onChange("unidade", v as Unidade_medida)}
                disabled={loadingUnidades || !!errorUnidades}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue
                    placeholder={loadingUnidades ? "Carregando..." : errorUnidades ? "Erro ao carregar" : "Selecione"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {unidades.map((u) => (
                    <SelectItem key={u.id} value={u.sigla as Unidade_medida} className="hover:cursor-pointer">
                      {u.sigla}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {errorUnidades && <p className="mt-1 text-xs text-destructive">{errorUnidades}</p>}
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="precovenda">Valor de Venda (Unitário)</Label>
              <ValueInput price={produto.precovenda} setPrice={(v) => onChange("precovenda", v)} />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="precocompra">
                Valor Médio de Compra
                {precoMedioCompraObrigatorio && <span className="text-destructive"> *</span>}
              </Label>
              <ValueInput price={produto.precocompra} setPrice={(v) => onChange("precocompra", v)} />
            </div>
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="ultimovalordecompra">Último Valor de Compra</Label>
              <ValueInput
                price={produto.ultimovalordecompra ?? 0}
                setPrice={(v) => onChange("ultimovalordecompra", v)}
              />
              <p className="text-xs text-muted-foreground">
                Usado como referência de custo nas novas ordens de serviço.
              </p>
            </div>
          </div>
          <div className="space-y-2 sm:col-span-4 ">
            <div className="w-full flex flex-row items-center gap-2">
              <div className="flex flex-col md:flex-row md:gap-2">
                <Label htmlFor="referencia">Referência</Label>
                <span className=" italic text-xs text-muted-foreground flex flex-row items-center gap-1">
                  <Info className="size-3" />
                  Insira ou cole tags de busca separadas por espaço.
                </span>
              </div>
            </div>
            <TagInput
              value={produto.referencia?.length && produto.referencia.length > 0 ? produto.referencia.split(" ") : []}
              onChange={(tags) => onChange("referencia", tags.join(" "))}
              placeholder="Ex: P-001 P-002"
            />
          </div>
        </div>

        {showDates ? (
          <>
            <Separator />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-nowrap">
              <div className="space-x-1 flex items-center text-muted-foreground text-xs">
                <Label>Criado em:</Label>
                <span className="text-muted-foreground">{formatDate((produto as any).createdat)}</span>
              </div>
              <div className="space-x-1 flex items-center text-muted-foreground text-xs">
                <Label>Última modificação:</Label>
                <span className="text-muted-foreground">{formatDate((produto as any).updatedat)}</span>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </TabsContent>
  );
}
