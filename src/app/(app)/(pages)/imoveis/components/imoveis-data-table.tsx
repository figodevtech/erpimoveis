"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronsLeft,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsRight,
  Loader,
  Loader2,
  Plus,
  LayoutList,
  LayoutGrid,
  Bed,
  Bath,
  Car,
  MapPin,
  User,
  Building2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Imovel, Pagination } from "../types";
import { StatusBadge } from "@/components/imobiliario/shared";
import { money, rowStatus } from "@/components/imobiliario/model";
import { RowActions } from "@/components/imobiliario/row-actions";
import { cn } from "@/lib/utils";

interface ImoveisDataTableProps {
  imoveis: Imovel[];
  isLoading: boolean;
  pagination: Pagination;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRefresh: () => void;
  onSelectImovel: (id: number) => void;
  onNewImovel?: () => void;
  onDeleteImovel?: (id: number) => Promise<unknown>;
  canCreate: boolean;
  canEdit: boolean;
}

export default function ImoveisDataTable({
  imoveis,
  isLoading,
  pagination,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onSelectImovel,
  onNewImovel,
  onDeleteImovel,
  canCreate,
  canEdit,
}: ImoveisDataTableProps) {
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => {
    if (typeof window !== "undefined") {
      try {
        const savedMode = localStorage.getItem("erp_imoveis_view_mode");
        if (savedMode === "table" || savedMode === "cards") {
          return savedMode;
        }
      } catch {
        // Falha silenciosa
      }
    }
    return "table";
  });

  const [cardsHeight, setCardsHeight] = useState<number | undefined>(undefined);
  const cardsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardsContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = Math.round(entry.contentRect.height);
        if (height > 50) {
          setCardsHeight(height);
        }
      }
    });
    observer.observe(cardsContainerRef.current);
    return () => observer.disconnect();
  }, [viewMode, imoveis.length]);

  // Calcula a altura mínima necessária para que o card no modo Lista seja igual ou superior ao modo Cards
  const targetMinHeight = (() => {
    if (imoveis.length === 0) return undefined;
    if (cardsHeight) return cardsHeight;
    const cols =
      typeof window !== "undefined"
        ? window.innerWidth < 640
          ? 1
          : window.innerWidth < 1024
          ? 2
          : window.innerWidth < 1280
          ? 3
          : 4
        : 4;
    const rows = Math.ceil(imoveis.length / cols);
    return rows * 395;
  })();

  const handleViewModeChange = (mode: "table" | "cards") => {
    setViewMode(mode);
    try {
      localStorage.setItem("erp_imoveis_view_mode", mode);
    } catch {
      // Falha silenciosa
    }
  };

  return (
    <Card>
      <CardHeader className="border-b-2 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle>Lista de Imóveis</CardTitle>
            <CardDescription className="flex flex-col">
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 hover:cursor-pointer mt-0.5"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
            </CardDescription>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Controle de Alternância Lista / Cards */}
            <div
              role="group"
              aria-label="Alternar modo de visualização"
              className="inline-flex items-center rounded-lg border bg-muted/40 p-1 text-muted-foreground shadow-xs"
            >
              <button
                type="button"
                onClick={() => handleViewModeChange("table")}
                aria-pressed={viewMode === "table"}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all hover:cursor-pointer",
                  viewMode === "table"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Visualização em Lista"
              >
                <LayoutList className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Lista</span>
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange("cards")}
                aria-pressed={viewMode === "cards"}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all hover:cursor-pointer",
                  viewMode === "cards"
                    ? "bg-background text-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Visualização em Cards"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cards</span>
              </button>
            </div>

            {canCreate && onNewImovel ? (
              <Button onClick={onNewImovel} className="hover:cursor-pointer">
                <Plus className="h-4 w-4" /> Imóvel
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent
        style={{
          minHeight: targetMinHeight ? `${targetMinHeight + 90}px` : undefined,
        }}
        className="min-h-[300px] -mt-[24px] px-4 pb-4 pt-0 relative flex flex-col justify-between transition-[min-height] duration-200"
      >
        <div
          className={`${
            isLoading ? "opacity-100" : "opacity-0"
          } transition-all h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0 z-10`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              isLoading ? "animate-slideIn" : ""
            }`}
          />
        </div>

        <div key={viewMode} className="flex-1 animate-in fade-in duration-200">
          {viewMode === "table" ? (
            <Table className="mt-6 text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">ID</TableHead>
                  <TableHead>Imóvel</TableHead>
                  <TableHead>Proprietário / Localização</TableHead>
                  <TableHead>Modalidade</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Valores</TableHead>
                  <TableHead className="w-[50px]">Ações</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {imoveis.length === 0 && !isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Nenhum imóvel encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  imoveis.map((imovel) => {
                    const owner = imovel.proprietario?.nomerazaosocial ?? imovel.proprietario_nome ?? "—";
                    const localizacao = [
                      imovel.endereco?.bairro ?? imovel.endereco_publico?.bairro,
                      imovel.endereco?.cidade ?? imovel.endereco_publico?.cidade,
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    const valorPrincipal =
                      imovel.diaria && Number(imovel.diaria) > 0
                        ? `${money(imovel.diaria)} / diária`
                        : imovel.valor_locacao && Number(imovel.valor_locacao) > 0
                        ? `${money(imovel.valor_locacao)} / mês`
                        : imovel.valor_venda && Number(imovel.valor_venda) > 0
                        ? money(imovel.valor_venda)
                        : "—";

                    return (
                      <TableRow
                        key={imovel.id}
                        className="hover:cursor-pointer"
                        onDoubleClick={() => onSelectImovel(imovel.id)}
                      >
                        <TableCell className="font-mono text-muted-foreground">#{imovel.id}</TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground">{imovel.titulo}</div>
                          <span className="text-[11px] text-muted-foreground">
                            {imovel.tipo ?? "Imóvel"}
                            {imovel.quartos ? ` · ${imovel.quartos} qto(s)` : ""}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div>{owner}</div>
                          <span className="text-[11px] text-muted-foreground">
                            {localizacao || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {imovel.modalidades && imovel.modalidades.length > 0 ? (
                              imovel.modalidades.map((m) => (
                                <span
                                  key={m}
                                  className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium"
                                >
                                  {m}
                                </span>
                              ))
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={rowStatus(imovel)} />
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {imovel.publicado ? "Publicado no site" : "Não publicado"}
                          </p>
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          {valorPrincipal}
                        </TableCell>
                        <TableCell>
                          <RowActions
                            canEdit={canEdit}
                            onOpen={() => onSelectImovel(imovel.id)}
                            onDelete={onDeleteImovel ? () => onDeleteImovel(imovel.id) : undefined}
                            deleteDescription="Sem reservas, locações, vendas ou lançamentos financeiros, o imóvel é excluído definitivamente, com fotos, anexos, tarifas e agenda. Com qualquer um desses vínculos, ele é apenas inativado e retirado do site."
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          ) : (
            <div>
              {imoveis.length === 0 && !isLoading ? (
                <div className="mt-6 flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed border-border/80 bg-muted/20">
                  <Building2 className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <h3 className="text-sm font-medium text-foreground">Nenhum imóvel encontrado</h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Não há registros para os filtros selecionados. Tente ajustar a busca ou situação.
                  </p>
                </div>
              ) : (
                <div
                  ref={cardsContainerRef}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-6"
                >
                  {imoveis.map((imovel) => {
                    const owner = imovel.proprietario?.nomerazaosocial ?? imovel.proprietario_nome ?? "—";
                    const localizacao = [
                      imovel.endereco?.bairro ?? imovel.endereco_publico?.bairro,
                      imovel.endereco?.cidade ?? imovel.endereco_publico?.cidade,
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    const valorPrincipal =
                      imovel.diaria && Number(imovel.diaria) > 0
                        ? `${money(imovel.diaria)} / diária`
                        : imovel.valor_locacao && Number(imovel.valor_locacao) > 0
                        ? `${money(imovel.valor_locacao)} / mês`
                        : imovel.valor_venda && Number(imovel.valor_venda) > 0
                        ? money(imovel.valor_venda)
                        : "—";

                    return (
                      <div
                        key={imovel.id}
                        className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card transition-all duration-200 hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
                        onDoubleClick={() => onSelectImovel(imovel.id)}
                      >
                        <div>
                          {/* Imagem de Capa ou Fallback */}
                          <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted/40 border-b border-border/60">
                            {imovel.foto_capa ? (
                              <img
                                src={imovel.foto_capa}
                                alt={imovel.titulo}
                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                decoding="async"
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-muted/60 via-muted/30 to-muted/10 text-muted-foreground">
                                <Building2 className="h-8 w-8 opacity-30 transition-transform duration-300 group-hover:scale-110" />
                                <span className="text-[10px] text-muted-foreground/60 mt-1">Sem foto</span>
                              </div>
                            )}

                            {/* Menu de Ações Flutuante no Canto Superior Direito da Foto */}
                            <div
                              className="absolute top-2 right-2 pointer-events-auto"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="rounded-md bg-background/85 backdrop-blur-md shadow-xs border border-border/40 hover:bg-background transition-colors p-0.5">
                                <RowActions
                                  canEdit={canEdit}
                                  onOpen={() => onSelectImovel(imovel.id)}
                                  onDelete={onDeleteImovel ? () => onDeleteImovel(imovel.id) : undefined}
                                  deleteDescription="Sem reservas, locações, vendas ou lançamentos financeiros, o imóvel é excluído definitivamente, com fotos, anexos, tarifas e agenda. Com qualquer um desses vínculos, ele é apenas inativado e retirado do site."
                                />
                              </div>
                            </div>
                          </div>

                          {/* Conteúdo do Card */}
                          <div className="p-3.5 pb-2">
                            {/* Identificação e Badge de Situação (fundo sólido, alta legibilidade) */}
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-mono text-[11px] font-semibold text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                                  #{imovel.id}
                                </span>
                                <span className="text-[11px] font-medium text-foreground/80 truncate">
                                  {imovel.tipo ?? "Imóvel"}
                                </span>
                              </div>
                              <div className="shrink-0">
                                <StatusBadge status={rowStatus(imovel)} />
                              </div>
                            </div>

                            {/* Título do Imóvel */}
                            <h3
                              onClick={() => onSelectImovel(imovel.id)}
                              className="font-medium text-foreground text-sm leading-snug line-clamp-2 hover:text-primary transition-colors cursor-pointer"
                              title={imovel.titulo}
                            >
                              {imovel.titulo}
                            </h3>

                            {/* Localização e Proprietário */}
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                              <div
                                className="flex items-center gap-1.5 truncate"
                                title={localizacao || "Localização não informada"}
                              >
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                                <span className="truncate">{localizacao || "Endereço não informado"}</span>
                              </div>
                              <div
                                className="flex items-center gap-1.5 truncate"
                                title={owner}
                              >
                                <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                                <span className="truncate">{owner}</span>
                              </div>
                            </div>

                            {/* Especificações estruturais (quartos, banheiros, vagas) */}
                            <div className="mt-2.5 flex items-center gap-3 text-xs text-muted-foreground border-y border-border/50 py-1.5">
                              <div className="inline-flex items-center gap-1" title="Quartos">
                                <Bed className="h-3.5 w-3.5 text-foreground/70" />
                                <span>{imovel.quartos ?? 0} qto(s)</span>
                              </div>
                              <div className="inline-flex items-center gap-1" title="Banheiros">
                                <Bath className="h-3.5 w-3.5 text-foreground/70" />
                                <span>{imovel.banheiros ?? 0} banh.</span>
                              </div>
                              <div className="inline-flex items-center gap-1" title="Vagas">
                                <Car className="h-3.5 w-3.5 text-foreground/70" />
                                <span>{imovel.vagas ?? 0} vg(s)</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Rodapé do Card: Modalidades, Status de Publicação e Valor Principal */}
                        <div className="p-3.5 pt-0 mt-1 flex items-end justify-between gap-2">
                          <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex flex-wrap gap-1">
                              {imovel.modalidades && imovel.modalidades.length > 0 ? (
                                imovel.modalidades.map((m) => (
                                  <span
                                    key={m}
                                    className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                                  >
                                    {m}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px] text-muted-foreground">—</span>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1 truncate">
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-full",
                                  imovel.publicado ? "bg-emerald-500" : "bg-muted-foreground/40"
                                )}
                              />
                              <span className="truncate">{imovel.publicado ? "No site" : "Não publicado"}</span>
                            </span>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="font-semibold text-foreground text-sm whitespace-nowrap">
                              {valorPrincipal}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Paginação */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Total de {pagination.total} registros</span>
            <Loader
              className={`w-3.5 h-3.5 animate-spin transition-all opacity-0 ${
                isLoading ? "opacity-100" : ""
              }`}
            />
          </div>

          <div className="flex items-center justify-center space-x-1 sm:space-x-2">
            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => onPageChange(1)}
              disabled={pagination.page <= 1 || isLoading}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1 || isLoading}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>

            <span className="text-[10px] sm:text-xs font-medium px-2">
              Pg. {pagination.page} de {pagination.totalPages || 1}
            </span>

            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => onPageChange(pagination.totalPages)}
              disabled={pagination.page >= pagination.totalPages || pagination.totalPages === 0 || isLoading}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Por página:</span>
            <Select
              value={String(pagination.limit)}
              onValueChange={(val) => onPageSizeChange(Number(val))}
            >
              <SelectTrigger size="sm" className="w-[70px] hover:cursor-pointer">
                <SelectValue placeholder={pagination.limit} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="hover:cursor-pointer" value="10">10</SelectItem>
                <SelectItem className="hover:cursor-pointer" value="20">20</SelectItem>
                <SelectItem className="hover:cursor-pointer" value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
