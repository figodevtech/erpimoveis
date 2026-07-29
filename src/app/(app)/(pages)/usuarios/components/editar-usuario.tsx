"use client";

import { useEffect, useMemo, useState } from "react";
import type { Perfil, Setor, Usuario, UsuarioPayload } from "../lib/api";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, CalendarIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  usuario: Usuario | null;
  perfis: Perfil[];
  setores: Setor[];
  onSave: (
    id: string | number,
    payload: UsuarioPayload,
  ) => void | Promise<void>;
};

function toDateInput(v?: string | null) {
  if (!v) return "";
  const s = String(v);
  return s.includes("T") ? s.slice(0, 10) : s;
}

function parseYYYYMMDDToDate(v?: string | null) {
  if (!v) return undefined;
  const s = toDateInput(v);
  if (!s) return undefined;
  const [y, m, d] = s.split("-").map((x) => Number(x));
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function formatDateToYYYYMMDD(d?: Date) {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function DatePickerField({
  label,
  value,
  onChange,
  placeholder = "Selecionar data",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const selected = parseYYYYMMDDToDate(value);

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={`w-full justify-start text-left font-normal ${!selected ? "text-muted-foreground" : ""}`}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {selected
              ? format(selected, "dd/MM/yyyy", { locale: ptBR })
              : placeholder}
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

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatBRLFromNumber(v: number | null) {
  if (v == null || Number.isNaN(v)) return "";
  return brlFormatter.format(v);
}

function parseBRLStringToNumber(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const cents = parseInt(digits || "0", 10);
  return cents / 100;
}

function clampPercent(raw: string) {
  if (!raw) return "";
  const n = Number(raw);
  if (Number.isNaN(n)) return "";
  return String(Math.min(100, Math.max(0, n)));
}

const tabTriggerClass =
  "h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

export function EditarUsuarioDialog({
  open,
  onOpenChange,
  usuario,
  perfis,
  setores,
  onSave,
}: Props) {
  const [tab, setTab] = useState<"dados" | "financeiro" | "vinculo">("dados");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [perfilid, setPerfilid] = useState("");
  const [setorid, setSetorid] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [salario, setSalario] = useState("");
  const [comissao, setComissao] = useState("");
  const [comissaoVenda, setComissaoVenda] = useState("");
  const [dataAdmissao, setDataAdmissao] = useState("");
  const [dataDemissao, setDataDemissao] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!usuario) return;

    setTab("dados");
    setNome(usuario.nome ?? "");
    setEmail(usuario.email ?? "");

    const perfilIdFromUser =
      (usuario as any).perfilid ??
      (usuario as any).perfilId ??
      usuario.perfil?.id ??
      null;
    const setorIdFromUser =
      (usuario as any).setorid ??
      (usuario as any).setorId ??
      usuario.setor?.id ??
      null;

    setPerfilid(perfilIdFromUser != null ? String(perfilIdFromUser) : "");
    setSetorid(setorIdFromUser != null ? String(setorIdFromUser) : "");
    setAtivo(usuario.ativo ?? true);
    setSalario(formatBRLFromNumber(usuario.salario ?? null));
    setComissao(
      usuario.comissao_percent != null ? String(usuario.comissao_percent) : "",
    );
    setComissaoVenda(
      usuario.comissao_venda_percent != null
        ? String(usuario.comissao_venda_percent)
        : "",
    );
    setDataAdmissao(toDateInput(usuario.data_admissao));
    setDataDemissao(toDateInput(usuario.data_demissao));
  }, [usuario]);

  const salarioNumber = useMemo(() => {
    if (!salario.trim()) return null;
    return parseBRLStringToNumber(salario);
  }, [salario]);

  const canSave = useMemo(() => {
    if (!usuario) return false;
    if (!nome.trim() || !email.trim()) return false;

    const c = comissao.trim() ? Number(comissao) : 0;
    if (Number.isNaN(c) || c < 0 || c > 100) return false;

    const cv = comissaoVenda.trim() ? Number(comissaoVenda) : 0;
    if (Number.isNaN(cv) || cv < 0 || cv > 100) return false;

    if (
      salarioNumber != null &&
      (Number.isNaN(salarioNumber) || salarioNumber < 0)
    )
      return false;

    return true;
  }, [usuario, nome, email, comissao, comissaoVenda, salarioNumber]);

  const handleSave = async () => {
    if (!usuario || !canSave || saving) return;

    setSaving(true);
    try {
      await onSave(usuario.id, {
        nome: nome.trim(),
        email: email.trim(),
        perfilid: perfilid ? Number(perfilid) : null,
        setorid: setorid ? Number(setorid) : null,
        ativo,
        salario: salarioNumber,
        comissao_percent: comissao.trim() ? Number(comissao) : null,
        comissao_venda_percent: comissaoVenda.trim()
          ? Number(comissaoVenda)
          : null,
        data_admissao: dataAdmissao || null,
        data_demissao: dataDemissao || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent
        className="h-svh min-w-screen overflow-hidden p-0 sm:h-auto sm:min-h-[520px] sm:max-h-[760px] sm:w-[85vw] sm:min-w-0 sm:max-w-[760px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 border-b px-6 py-4">
            <DialogTitle>Editar usuário</DialogTitle>
          </DialogHeader>

          <div className="h-full min-h-0 overflow-auto px-6 py-6 dark:bg-muted-foreground/5">
            {!usuario ? null : (
              <Tabs
                value={tab}
                onValueChange={(v) =>
                  setTab(v as "dados" | "financeiro" | "vinculo")
                }
                className="w-full"
              >
                <div className="max-w-full overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
                  <TabsList className="h-auto min-w-full justify-start gap-1.5 rounded-xl border bg-muted/40 p-1">
                    <TabsTrigger value="dados" className={tabTriggerClass}>
                      Dados
                    </TabsTrigger>
                    <TabsTrigger value="financeiro" className={tabTriggerClass}>
                      Financeiro
                    </TabsTrigger>
                    <TabsTrigger value="vinculo" className={tabTriggerClass}>
                      Vínculo
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="dados" className="mt-4 space-y-4 border bg-card p-4 rounded-2xl">
                  <div className="grid gap-2">
                    <Label>Nome</Label>
                    <Input
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      placeholder="Nome completo"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>E-mail</Label>
                    <Input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@dominio.com"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Perfil</Label>
                      <Select value={perfilid} onValueChange={setPerfilid}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {perfis.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label>Setor</Label>
                      <Select value={setorid} onValueChange={setSetorid}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {setores.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <div className="text-sm font-medium">Ativo</div>
                      <div className="text-xs text-muted-foreground">
                        Usuário pode acessar o sistema.
                      </div>
                    </div>
                    <Switch checked={ativo} onCheckedChange={setAtivo} />
                  </div>
                </TabsContent>

                <TabsContent value="financeiro" className="mt-4 space-y-4 p-4 border bg-card rounded-2xl">
                  <div className="grid gap-2">
                    <Label>Salário</Label>
                    <ValueInput
                      value={parseBRLStringToNumber(salario)}
                      onValueChange={(value) => setSalario(formatBRLFromNumber(value))}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Comissão de serviços (%)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="0"
                      value={comissao}
                      onChange={(e) =>
                        setComissao(clampPercent(e.target.value))
                      }
                    />
                    <p className="text-xs text-muted-foreground">De 0 a 100.</p>
                  </div>

                  <div className="grid gap-2">
                    <Label>Comissão de venda (%)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="0"
                      value={comissaoVenda}
                      onChange={(e) =>
                        setComissaoVenda(clampPercent(e.target.value))
                      }
                    />
                    <p className="text-xs text-muted-foreground">De 0 a 100.</p>
                  </div>
                </TabsContent>

                <TabsContent value="vinculo" className="mt-4 space-y-4 p-4 border bg-card rounded-2xl">
                  <DatePickerField
                    label="Data de admissão"
                    value={dataAdmissao}
                    onChange={setDataAdmissao}
                  />
                  <DatePickerField
                    label="Data de demissão"
                    value={dataDemissao}
                    onChange={setDataDemissao}
                  />
                </TabsContent>
              </Tabs>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>

            <Button
              onClick={handleSave}
              disabled={!canSave || saving || !usuario}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
