"use client";

import { useMemo, useState } from "react";
import type { Perfil, Setor } from "../lib/api";

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

type Payload = {
  nome: string;
  email: string;
  username: string;
  perfilid?: number | null;
  setorid?: number | null;
  ativo?: boolean;
  salario?: number | null;
  comissao_percent?: number | null;
  comissao_venda_percent?: number | null;
  comissao_criacao_servico_percent?: number | null;
  comissao_criacao_produto_percent?: number | null;
  comissao_criacao_somente_comissionaveis?: boolean;
  data_admissao?: string | null;
  data_demissao?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  perfis: Perfil[];
  setores: Setor[];
  onCreate: (payload: Payload) => void | Promise<void>;
};

function parseYYYYMMDDToDate(v?: string | null) {
  if (!v) return undefined;
  const s = String(v).includes("T") ? String(v).slice(0, 10) : String(v);
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

const clampPercent = (raw: string) => {
  if (!raw) return "";
  const n = Number(raw);
  if (Number.isNaN(n)) return "";
  return String(Math.min(100, Math.max(0, n)));
};

const tabTriggerClass =
  "h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

export function CriarUsuarioDialog({
  open,
  onOpenChange,
  perfis,
  setores,
  onCreate,
}: Props) {
  const [tab, setTab] = useState<"dados" | "financeiro" | "vinculo">("dados");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [perfilid, setPerfilid] = useState("");
  const [setorid, setSetorid] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [salario, setSalario] = useState("");
  const [comissao, setComissao] = useState("");
  const [comissaoVenda, setComissaoVenda] = useState("");
  const [comissaoCriacaoServico, setComissaoCriacaoServico] = useState("");
  const [comissaoCriacaoProduto, setComissaoCriacaoProduto] = useState("");
  const [comissaoCriacaoSomente, setComissaoCriacaoSomente] = useState(false);
  const [dataAdmissao, setDataAdmissao] = useState("");
  const [dataDemissao, setDataDemissao] = useState("");
  const [saving, setSaving] = useState(false);

  const salarioNumber = useMemo(() => {
    if (!salario.trim()) return null;
    return parseBRLStringToNumber(salario);
  }, [salario]);

  const canSave = useMemo(() => {
    if (!nome.trim() || !email.trim() || !/^[a-z0-9._-]{3,30}$/.test(username.trim().toLowerCase())) {
      return false;
    }

    const c = comissao.trim() ? Number(comissao) : 0;
    if (Number.isNaN(c) || c < 0 || c > 100) return false;

    const cv = comissaoVenda.trim() ? Number(comissaoVenda) : 0;
    if (Number.isNaN(cv) || cv < 0 || cv > 100) return false;

    const ccs = comissaoCriacaoServico.trim() ? Number(comissaoCriacaoServico) : 0;
    if (Number.isNaN(ccs) || ccs < 0 || ccs > 100) return false;

    const ccp = comissaoCriacaoProduto.trim() ? Number(comissaoCriacaoProduto) : 0;
    if (Number.isNaN(ccp) || ccp < 0 || ccp > 100) return false;

    if (
      salarioNumber != null &&
      (Number.isNaN(salarioNumber) || salarioNumber < 0)
    )
      return false;

    return true;
  }, [
    nome,
    email,
    username,
    comissao,
    comissaoVenda,
    comissaoCriacaoServico,
    comissaoCriacaoProduto,
    salarioNumber,
  ]);

  const handleSave = async () => {
    if (!canSave || saving) return;

    setSaving(true);
    try {
      await onCreate({
        nome: nome.trim(),
        email: email.trim(),
        username: username.trim().toLowerCase(),
        perfilid: perfilid ? Number(perfilid) : null,
        setorid: setorid ? Number(setorid) : null,
        ativo,
        salario: salarioNumber,
        comissao_percent: comissao.trim() ? Number(comissao) : null,
        comissao_venda_percent: comissaoVenda.trim()
          ? Number(comissaoVenda)
          : null,
        comissao_criacao_servico_percent: comissaoCriacaoServico.trim()
          ? Number(comissaoCriacaoServico)
          : null,
        comissao_criacao_produto_percent: comissaoCriacaoProduto.trim()
          ? Number(comissaoCriacaoProduto)
          : null,
        comissao_criacao_somente_comissionaveis: comissaoCriacaoSomente,
        data_admissao: dataAdmissao || null,
        data_demissao: dataDemissao || null,
      });

      setTab("dados");
      setNome("");
      setEmail("");
      setUsername("");
      setPerfilid("");
      setSetorid("");
      setAtivo(true);
      setSalario("");
      setComissao("");
      setComissaoVenda("");
      setComissaoCriacaoServico("");
      setComissaoCriacaoProduto("");
      setComissaoCriacaoSomente(false);
      setDataAdmissao("");
      setDataDemissao("");
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
            <DialogTitle>Novo usuário</DialogTitle>
          </DialogHeader>

          <div className="h-full min-h-0 overflow-auto px-6 py-6">
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

              <TabsContent value="dados" className="mt-4 space-y-4 p-4 border bg-card rounded-2xl">
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

                <div className="grid gap-2">
                  <Label htmlFor="create-username">Nome de usuário</Label>
                  <Input
                    id="create-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    placeholder="Ex.: atendente.01"
                    autoComplete="off"
                    maxLength={30}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use de 3 a 30 letras minúsculas, números, ponto, hífen ou sublinhado.
                  </p>
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
                    min={0}
                    max={100}
                    value={comissao}
                    onChange={(e) => setComissao(clampPercent(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    0 a 100. Aplicada sobre o valor dos serviços executados.
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label>Comissão de venda (%)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    min={0}
                    max={100}
                    value={comissaoVenda}
                    onChange={(e) =>
                      setComissaoVenda(clampPercent(e.target.value))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    0 a 100. Aplicada sobre o valor das vendas realizadas no
                    PDV.
                  </p>
                </div>

                {/*
                  Comissão por criação é outra coisa: paga a quem ABRE a ordem,
                  sobre tudo que ela contém, mesmo que outra pessoa execute.
                  Soma com a de realização quando a mesma pessoa faz as duas.
                */}
                <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                  <div>
                    <p className="text-sm font-medium">Comissão por criação de OS</p>
                    <p className="text-xs text-muted-foreground">
                      Paga por abrir a ordem, sobre os itens dela — independente de quem
                      executa. Deixe em branco para não pagar por criação.
                    </p>
                  </div>

                  <div className="grid gap-2">
                    <Label>Sobre serviços (%)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="0"
                      min={0}
                      max={100}
                      value={comissaoCriacaoServico}
                      onChange={(e) =>
                        setComissaoCriacaoServico(clampPercent(e.target.value))
                      }
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Sobre produtos (%)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="0"
                      min={0}
                      max={100}
                      value={comissaoCriacaoProduto}
                      onChange={(e) =>
                        setComissaoCriacaoProduto(clampPercent(e.target.value))
                      }
                    />
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Label>Só serviços que geram comissão</Label>
                      <p className="text-xs text-muted-foreground">
                        Ligado, respeita a marca &quot;Gera comissão&quot; do cadastro do
                        serviço. Desligado, conta todos os serviços da OS.
                      </p>
                    </div>
                    <Switch
                      checked={comissaoCriacaoSomente}
                      onCheckedChange={setComissaoCriacaoSomente}
                    />
                  </div>
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
          </div>

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>

            <Button onClick={handleSave} disabled={!canSave || saving}>
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
