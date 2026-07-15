// src/app/(app)/(pages)/configuracoes/tipos/components/servicos-section.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import {
  ChevronsLeft,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronsRight,
  Loader2,
  Plus,
  MoreHorizontal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ServicoDialog from "./servicoDialog/servico-dialog";
import { formatCurrencyBRL } from "../../../dashboard/components/dashboard-ordemservico/lib/format";

type Servico = {
  id: number;
  codigo: string;
  descricao: string;
  precohora: number;
  codigoservicomunicipal: string;
  aliquotaiss?: number | null;
  cnae?: string | null;
  itemlistaservico: string;
  tiposervicoid?: number | null;
  ativo?: boolean | null;
  permite_agendamento?: boolean | null;
};

type ServicoForm = {
  codigo: string;
  descricao: string;
  precohora: string;
  ativo: boolean;
  permite_agendamento: boolean;
};

const emptyForm: ServicoForm = {
  codigo: "",
  descricao: "",
  precohora: "",
  ativo: true,
  permite_agendamento: false,
};

const DEFAULT_LIMIT = 10;

export default function ServicosSection() {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [editing, setEditing] = useState<Servico | null>(null);
  const [form, setForm] = useState<ServicoForm>(emptyForm);

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [open, setOpen] = useState<boolean>(false);

  const total = servicos.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const start = (page - 1) * limit;
  const end = Math.min(total, start + limit);
  const pageItems = useMemo(() => servicos.slice(start, end), [servicos, start, end]);

  const linhasSkeleton = useMemo(
    () =>
      Array.from({ length: Math.min(5, limit) }).map((_, i) => (
        <TableRow key={`skeleton-${i}`} className="animate-pulse">
          <TableCell className="h-10">
            <div className="h-3 w-24 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-40 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-20 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-16 bg-muted rounded" />
          </TableCell>
          <TableCell>
            <div className="h-3 w-24 bg-muted rounded" />
          </TableCell>
          <TableCell className="text-center">
            <div className="h-5 w-16 bg-muted rounded-full mx-auto" />
          </TableCell>
          <TableCell className="text-right">
            <div className="h-6 w-10 bg-muted rounded-full ml-auto" />
          </TableCell>
        </TableRow>
      )),
    [limit]
  );

  async function loadServicos() {
    try {
      setIsLoading(true);
      setErro(null);

      const res = await fetch("/api/tipos/servicos", { cache: "no-store" });
      const j = await res.json();

      if (!res.ok) throw new Error(j?.error || "Falha ao carregar serviços");

      const items: Servico[] = (j.items ?? j.data ?? []).map((s: Servico) => ({
        ...s,
        ativo: s.ativo ?? true,
        permite_agendamento: s.permite_agendamento ?? false,
      }));

      setServicos(items);
    } catch (e: any) {
      const msg = e?.message || "Erro ao carregar serviços";
      setErro(msg);
      toast.error(msg);
      setServicos([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadServicos();
  }, []);

  function openNovo() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEditar(s: Servico) {
    setEditing(s);
    setForm({
      codigo: s.codigo ?? "",
      descricao: s.descricao ?? "",
      precohora: s.precohora != null ? String(s.precohora) : "",
      ativo: s.ativo ?? true,
      permite_agendamento: s.permite_agendamento ?? false,
    });
    setOpen(true);
  }

  return (
    <Card className="min-h-[460px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Serviços</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                onClick={loadServicos}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 text-xs"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
              <span className="text-foreground/60">
                {total} serviço{total === 1 ? "" : "s"}
              </span>
              {erro && (
                <Badge variant="destructive" className="ml-1">
                  {erro}
                </Badge>
              )}
            </CardDescription>
          </div>

          <Button size="sm" className="hover:cursor-pointer" onClick={openNovo}>
            <Plus className="mr-1 h-4 w-4" />
            Serviço
          </Button>
          <ServicoDialog
            form={form}
            setForm={setForm}
            openNovo={openNovo}
            loadServicos={loadServicos}
            open={open}
            setOpen={setOpen}
            editing={editing}
            setEditing={setEditing}
          />
        </div>
      </CardHeader>

      <CardContent className="min-h-[190px] -mt-[24px] px-4 pb-4 pt-0 sm:px-6 relative">
        <div
          className={`${
            isLoading ? "opacity-100" : ""
          } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
        >
          <div
            className={`w-1/2 bg-primary h-full absolute left-0 rounded-lg -translate-x-[100%] ${
              isLoading ? "animate-slideIn" : ""
            }`}
          />
        </div>

        <Table className="mt-6">
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Preço</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              linhasSkeleton
            ) : total === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  Nenhum serviço cadastrado. Clique em <b>+ Serviço</b> para cadastrar.
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((s) => (
                <TableRow key={s.id} className="hover:cursor-default">
                  <TableCell className="font-mono text-xs">{s.codigo}</TableCell>
                  <TableCell>{s.descricao}</TableCell>
                  <TableCell>{s.precohora != null ? formatCurrencyBRL(s.precohora) : "—"}</TableCell>
                  <TableCell>
                    <Badge
                      variant={s.ativo ? "default" : "outline"}
                      className={s.ativo ? "" : "border-destructive bg-destructive"}
                    >
                      {s.ativo ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0 hover:cursor-pointer">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-32">
                        <DropdownMenuItem onClick={() => openEditar(s)}>Editar</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center mt-4 justify-between">
          <div className="text-xs text-muted-foreground mr-2 flex flex-nowrap">
            {total > 0 ? (
              <>
                <span>{start + 1}</span>
                {" - "}
                <span>{end}</span>
                <span className="ml-1 hidden sm:block">de {total}</span>
              </>
            ) : (
              <span>0 de 0</span>
            )}
          </div>

          <div className="flex items-center justify-center space-x-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage(1)}
              disabled={page === 1 || total === 0}
              className="hover:cursor-pointer"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || total === 0}
              className="hover:cursor-pointer"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <span className="text-xs font-medium text-nowrap">
              Pg. {Math.min(page, totalPages)} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || total === 0}
              className="hover:cursor-pointer"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages || total === 0}
              className="hover:cursor-pointer"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>

          <div>
            <Select
              value={String(limit)}
              onValueChange={(v) => {
                const n = parseInt(v, 10) || DEFAULT_LIMIT;
                setLimit(n);
                setPage(1);
              }}
            >
              <SelectTrigger className="hover:cursor-pointer ml-2">
                <SelectValue placeholder={DEFAULT_LIMIT} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10" className="hover:cursor-pointer">
                  10
                </SelectItem>
                <SelectItem value="20" className="hover:cursor-pointer">
                  20
                </SelectItem>
                <SelectItem value="50" className="hover:cursor-pointer">
                  50
                </SelectItem>
                <SelectItem value="100" className="hover:cursor-pointer">
                  100
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
