"use client";

import { useEffect, useMemo, useState } from "react";
import type { Usuario } from "../lib/api";
import { buscarComissaoUsuario, type ComissaoUsuarioResumo } from "../lib/api";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Loader2 } from "lucide-react";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  usuario: Usuario | null;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatDateToYYYYMMDD(d?: Date) {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYYYYMMDDToDate(v?: string | null) {
  if (!v) return undefined;
  const s = String(v).includes("T") ? String(v).slice(0, 10) : String(v);
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function DatePickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const selected = parseYYYYMMDDToDate(value);

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={`w-full justify-start text-left text-xs font-normal ${
              !selected ? "text-muted-foreground" : ""
            }`}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {selected
              ? format(selected, "dd/MM/yyyy", { locale: ptBR })
              : "Selecione"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={ptBR}
            selected={selected}
            onSelect={(d) => onChange(d ? formatDateToYYYYMMDD(d) : "")}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function monthLabel(yyyymm: string) {
  const [y, m] = yyyymm.split("-").map((x) => Number(x));
  if (!y || !m) return yyyymm;
  const d = new Date(y, m - 1, 1);
  return format(d, "MMM/yyyy", { locale: ptBR });
}

const tabTriggerClass =
  "h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

export function DetalhesUsuarioDialog({ open, onOpenChange, usuario }: Props) {
  const [tab, setTab] = useState<"perfil" | "comissao">("perfil");
  const [dateFrom, setDateFrom] = useState(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    return formatDateToYYYYMMDD(start);
  });
  const [dateTo, setDateTo] = useState(() => formatDateToYYYYMMDD(new Date()));
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ComissaoUsuarioResumo | null>(null);

  useEffect(() => {
    if (!open || !usuario?.id) return;

    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErro(null);
        setResumo(null);

        const data = await buscarComissaoUsuario(usuario.id, {
          dateFrom,
          dateTo,
        });
        if (!alive) return;
        setResumo(data);
      } catch (e: any) {
        if (!alive) return;
        setErro(e?.message ?? "Falha ao carregar comissão.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, usuario?.id, dateFrom, dateTo]);

  const comissaoPercent = usuario?.comissao_percent ?? 0;
  const comissaoVendaPercent = usuario?.comissao_venda_percent ?? 0;

  const info = useMemo(() => {
    if (!usuario) return null;
    return {
      nome: usuario.nome,
      email: usuario.email,
      username: usuario.username ?? "—",
      perfil: usuario.perfil?.nome ?? "—",
      setor: usuario.setor?.nome ?? "—",
      status: usuario.ativo ? "Ativo" : "Inativo",
      salario: usuario.salario != null ? brl.format(usuario.salario) : "—",
      comissao: `${Number(comissaoPercent || 0)}%`,
      comissaoVenda: `${Number(comissaoVendaPercent || 0)}%`,
      admissao: usuario.data_admissao ? usuario.data_admissao : "—",
      demissao: usuario.data_demissao ? usuario.data_demissao : "—",
    };
  }, [usuario, comissaoPercent, comissaoVendaPercent]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-svh min-w-screen overflow-hidden p-0 sm:h-auto sm:min-h-[580px] sm:max-h-[760px] sm:w-[85vw] sm:min-w-0 sm:max-w-[860px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>Detalhes do usuário</DialogTitle>
          </DialogHeader>

          <div className="h-full min-h-0 overflow-auto px-6 py-6 bg-card rounded-2xl border">
            {!usuario || !info ? (
              <div className="text-sm text-muted-foreground">
                Nenhum usuário selecionado.
              </div>
            ) : (
              <Tabs
                value={tab}
                onValueChange={(v) => setTab(v as "perfil" | "comissao")}
                className="w-full"
              >
                <div className="max-w-full overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
                  <TabsList className="h-auto min-w-full justify-start gap-1.5 rounded-xl border bg-muted/40 p-1">
                    <TabsTrigger value="perfil" className={tabTriggerClass}>
                      Perfil
                    </TabsTrigger>
                    <TabsTrigger value="comissao" className={tabTriggerClass}>
                      Comissão
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="perfil" className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">Nome</p>
                      <p className="text-sm font-medium">{info.nome}</p>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">E-mail</p>
                      <p className="text-sm font-medium">{info.email}</p>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">Nome de usuário</p>
                      <p className="text-sm font-medium">{info.username}</p>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">Setor</p>
                      <p className="text-sm font-medium">{info.setor}</p>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">Perfil</p>
                      <p className="text-sm font-medium">{info.perfil}</p>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">Status</p>
                      <Badge
                        variant={usuario.ativo ? "default" : "destructive"}
                      >
                        {info.status}
                      </Badge>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">Salário</p>
                      <p className="text-sm font-medium">{info.salario}</p>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">
                        Comissão de serviços
                      </p>
                      <p className="text-sm font-medium">{info.comissao}</p>
                    </div>

                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">
                        Comissão de venda
                      </p>
                      <p className="text-sm font-medium">
                        {info.comissaoVenda}
                      </p>
                    </div>

                    <div className="rounded-md border p-3 sm:col-span-2">
                      <p className="text-xs text-muted-foreground">Vínculo</p>
                      <p className="text-sm">
                        Admissão:{" "}
                        <span className="font-medium">{info.admissao}</span>
                        <br />
                        Demissão:{" "}
                        <span className="font-medium">{info.demissao}</span>
                      </p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="comissao" className="mt-4 space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <DatePickerField
                      label="Data inicial"
                      value={dateFrom}
                      onChange={setDateFrom}
                    />
                    <DatePickerField
                      label="Data final"
                      value={dateTo}
                      onChange={setDateTo}
                    />

                    <div className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">
                        Percentual
                      </p>
                      <p className="text-sm font-medium">
                        {Number(resumo?.comissao_percent ?? 0)}%
                      </p>
                    </div>
                  </div>

                  {erro ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                      {erro}
                    </div>
                  ) : null}

                  {loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando
                      comissão...
                    </div>
                  ) : null}

                  {!loading && resumo ? (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">
                            Serviços (itens)
                          </p>
                          <p className="text-lg font-semibold">
                            {resumo.totalServicos}
                          </p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">
                            Faturamento (subtotal)
                          </p>
                          <p className="text-lg font-semibold">
                            {brl.format(resumo.totalFaturamento)}
                          </p>
                        </div>
                        <div className="rounded-md border p-3">
                          <p className="text-xs text-muted-foreground">
                            Comissão estimada
                          </p>
                          <p className="text-lg font-semibold">
                            {brl.format(resumo.totalComissao)}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-md border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Mês</TableHead>
                              <TableHead className="text-right">
                                Serviços
                              </TableHead>
                              <TableHead className="text-right">
                                Faturamento
                              </TableHead>
                              <TableHead className="text-right">
                                Comissão
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {resumo.meses.length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={4}
                                  className="text-center text-sm text-muted-foreground py-8"
                                >
                                  Nenhum serviço encontrado no período.
                                </TableCell>
                              </TableRow>
                            ) : (
                              resumo.meses.map((m) => (
                                <TableRow key={m.month}>
                                  <TableCell className="font-medium">
                                    {monthLabel(m.month)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {m.servicos}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {brl.format(Number(m.faturamento || 0))}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {brl.format(Number(m.comissao || 0))}
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  ) : null}
                </TabsContent>
              </Tabs>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
