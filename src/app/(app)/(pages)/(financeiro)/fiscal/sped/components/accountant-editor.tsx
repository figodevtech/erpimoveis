"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { Check, ChevronsUpDown, Pencil, Search, UserRoundCheck, UserRoundPlus } from "lucide-react";

import { useGetCidades } from "@/app/(app)/hooks/useGetCidades";
import { ESTADOS_BRASIL } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCnpj, formatCpf } from "@/lib/fiscal-identifiers";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { createSpedContabilista, updateSpedContabilista } from "../api";
import { formatCompetencia } from "../formatters";
import type { SpedCompetenciaDetail, SpedContabilista, SpedContabilistaForm } from "../types";

/** Os dois primeiros dígitos do código IBGE do município identificam a UF. */
const UF_POR_CODIGO_IBGE: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

const VAZIO: SpedContabilistaForm = {
  nome: "", cpf: "", crc: "", cnpjEscritorio: "", cep: "", endereco: "", numero: "",
  complemento: "", bairro: "", telefone: "", fax: "", email: "", codigoMunicipio: "",
};

type Modo = { tipo: "novo" } | { tipo: "corrigir"; contador: SpedContabilista };

function monthOf(civilDate: string | null) {
  return civilDate ? civilDate.slice(0, 7) : null;
}

/** O contador cuja vigência cobre a competência aberta na tela. */
function vigenteNaCompetencia(contadores: SpedContabilista[], competencia: string) {
  return contadores.find((contador) =>
    monthOf(contador.vigenciaInicio)! <= competencia
    && (!contador.vigenciaFim || monthOf(contador.vigenciaFim)! >= competencia)) ?? null;
}

export function AccountantEditor({
  competencia,
  canManage,
  disabled,
  onSaved,
}: {
  competencia: SpedCompetenciaDetail;
  canManage: boolean;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [modo, setModo] = useState<Modo | null>(null);
  const contadores = competencia.contabilistas ?? [];
  const vigente = vigenteNaCompetencia(contadores, competencia.competencia);

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRoundCheck className="size-4" aria-hidden="true" /> Contabilista
          </CardTitle>
          <CardDescription>
            Contador responsável pela escrituração. Os dados vão no registro 0100 de todo arquivo; não é acesso ao sistema.
          </CardDescription>
        </div>
        <Button type="button" size="sm" variant={vigente ? "outline" : "default"} disabled={!canManage || disabled} onClick={() => setModo({ tipo: "novo" })}>
          <UserRoundPlus aria-hidden="true" /> {contadores.length ? "Trocar contador" : "Cadastrar contador"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {!vigente ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-destructive">
            Nenhum contador responde por {formatCompetencia(competencia.competencia)}. A competência não fecha sem ele.
          </p>
        ) : null}
        {contadores.map((contador) => (
          <div key={contador.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {contador.nome}
                {contador.id === vigente?.id ? <Badge variant="secondary">Responde por {formatCompetencia(competencia.competencia)}</Badge> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                CRC {contador.crc} · CPF {formatCpf(contador.cpf)}
                {contador.cnpjEscritorio ? ` · Escritório ${formatCnpj(contador.cnpjEscritorio)}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                A partir de {formatCompetencia(monthOf(contador.vigenciaInicio)!)}
                {contador.vigenciaFim ? ` até ${formatCompetencia(monthOf(contador.vigenciaFim)!)}` : " · atual"}
              </p>
            </div>
            <Button type="button" size="sm" variant="ghost" disabled={!canManage || disabled} onClick={() => setModo({ tipo: "corrigir", contador })}>
              <Pencil aria-hidden="true" /> Corrigir dados
            </Button>
          </div>
        ))}
      </CardContent>

      {modo ? (
        <AccountantDialog
          key={modo.tipo === "corrigir" ? modo.contador.id : "novo"}
          modo={modo}
          empresaId={competencia.configuracao.empresaId}
          competencia={competencia.competencia}
          onClose={() => setModo(null)}
          onSaved={() => {
            setModo(null);
            onSaved();
          }}
        />
      ) : null}
    </Card>
  );
}

function AccountantDialog({ modo, empresaId, competencia, onClose, onSaved }: {
  modo: Modo;
  empresaId: number;
  competencia: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const inicial = modo.tipo === "corrigir" ? modo.contador : null;
  const [form, setForm] = useState<SpedContabilistaForm>(() => inicial
    ? {
      nome: inicial.nome, cpf: formatCpf(inicial.cpf), crc: inicial.crc,
      cnpjEscritorio: inicial.cnpjEscritorio ? formatCnpj(inicial.cnpjEscritorio) : "",
      cep: inicial.cep, endereco: inicial.endereco, numero: inicial.numero, complemento: inicial.complemento ?? "",
      bairro: inicial.bairro, telefone: inicial.telefone ?? "", fax: inicial.fax ?? "", email: inicial.email,
      codigoMunicipio: inicial.codigoMunicipio,
    }
    : VAZIO);
  const [aPartirDe, setAPartirDe] = useState(competencia);
  const [uf, setUf] = useState(() => UF_POR_CODIGO_IBGE[(inicial?.codigoMunicipio ?? "").slice(0, 2)] ?? "");
  const [cidadeAberta, setCidadeAberta] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const { cidades, loading: carregandoCidades, error: erroCidades, recarregar } = useGetCidades(uf || undefined);

  const cidadeSelecionada = useMemo(
    () => cidades.find((cidade) => String(cidade.id) === form.codigoMunicipio) ?? null,
    [cidades, form.codigoMunicipio],
  );

  const set =(campo: keyof SpedContabilistaForm, valor: string) => setForm((atual) => ({ ...atual, [campo]: valor }));

  async function buscarCep() {
    const cep = form.cep.replace(/\D/g, "");
    if (cep.length !== 8) {
      toast.error("Informe um CEP com 8 dígitos.");
      return;
    }
    setBuscandoCep(true);
    try {
      const response = await fetch(`https://opencep.com/v1/${cep}`);
      if (!response.ok) throw new Error(response.status === 404 ? "CEP não encontrado." : "Busca de CEP indisponível.");
      const endereco = await response.json() as { logradouro?: string; bairro?: string; uf?: string; ibge?: string | number };
      if (endereco.uf) setUf(endereco.uf);
      setForm((atual) => ({
        ...atual,
        endereco: endereco.logradouro || atual.endereco,
        bairro: endereco.bairro || atual.bairro,
        codigoMunicipio: endereco.ibge ? String(endereco.ibge) : atual.codigoMunicipio,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Busca de CEP indisponível.", {
        description: "Preencha o endereço manualmente.",
      });
    } finally {
      setBuscandoCep(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    try {
      if (modo.tipo === "corrigir") {
        await updateSpedContabilista(empresaId, modo.contador.id, form);
        toast.success("Dados do contador corrigidos.");
      } else {
        await createSpedContabilista(empresaId, aPartirDe, form);
        toast.success(`Contador cadastrado a partir de ${formatCompetencia(aPartirDe)}.`);
      }
      onSaved();
    } catch (error) {
      toast.error("Não foi possível salvar o contador", {
        description: error instanceof Error ? error.message : "Falha inesperada.",
      });
    } finally {
      setSalvando(false);
    }
  }

  const campo = (id: keyof SpedContabilistaForm, rotulo: string, props: ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`contador-${id}`}>{rotulo}</Label>
      <Input id={`contador-${id}`} value={form[id] ?? ""} disabled={salvando} onChange={(event) => set(id, event.target.value)} {...props} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && !salvando && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{modo.tipo === "corrigir" ? "Corrigir dados do contador" : "Contador responsável"}</DialogTitle>
          <DialogDescription>
            {modo.tipo === "corrigir"
              ? "A vigência não muda. Meses já fechados mantêm os dados do fechamento."
              : "Se já houver um contador, ele passa a responder só até o mês anterior."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void salvar();
          }}
        >
          {modo.tipo === "novo" ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="contador-a-partir-de">Responde a partir da competência *</Label>
              <Input id="contador-a-partir-de" type="month" value={aPartirDe} disabled={salvando} onChange={(event) => setAPartirDe(event.target.value)} className="sm:max-w-48" />
            </div>
          ) : null}
          <div className="sm:col-span-2">{campo("nome", "Nome *", { maxLength: 100 })}</div>
          {campo("cpf", "CPF *", { inputMode: "numeric", placeholder: "000.000.000-00" })}
          {campo("crc", "CRC *", { maxLength: 15, placeholder: "PB-000000/O-0" })}
          {campo("cnpjEscritorio", "CNPJ do escritório")}
          {campo("email", "E-mail *", { type: "email" })}
          {campo("telefone", "Telefone", { inputMode: "tel", placeholder: "(83) 90000-0000" })}

          <div className="space-y-1.5">
            <Label htmlFor="contador-cep">CEP *</Label>
            <div className="flex gap-2">
              <Input id="contador-cep" value={form.cep} disabled={salvando} inputMode="numeric" placeholder="00000-000" onChange={(event) => set("cep", event.target.value)} />
              <Button type="button" variant="outline" size="icon" aria-label="Buscar CEP" disabled={salvando || buscandoCep} onClick={() => void buscarCep()}>
                <Search aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="sm:col-span-2">{campo("endereco", "Endereço *", { maxLength: 60 })}</div>
          {campo("numero", "Número *", { maxLength: 10 })}
          {campo("complemento", "Complemento", { maxLength: 60 })}
          {campo("bairro", "Bairro *", { maxLength: 60 })}

          <div className="grid grid-cols-[5.5rem_1fr] gap-2 sm:col-span-2">
            <div className="space-y-1.5">
              <Label htmlFor="contador-uf">UF *</Label>
              <select
                id="contador-uf"
                className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={uf}
                disabled={salvando}
                onChange={(event) => {
                  const sigla = event.target.value;
                  setUf(sigla);
                  // O município escolhido pertence a outra UF.
                  if (UF_POR_CODIGO_IBGE[form.codigoMunicipio.slice(0, 2)] !== sigla) set("codigoMunicipio", "");
                }}
              >
                <option value="">—</option>
                {ESTADOS_BRASIL.map((sigla) => <option key={sigla} value={sigla}>{sigla}</option>)}
              </select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label>Município *</Label>
              <Popover open={cidadeAberta} onOpenChange={setCidadeAberta}>
                <PopoverTrigger asChild disabled={!uf || salvando}>
                  <Button type="button" variant="outline" role="combobox" aria-expanded={cidadeAberta} className="w-full justify-between font-normal">
                    <span className="truncate">
                      {cidadeSelecionada?.nome
                        ?? (carregandoCidades ? "Carregando..." : erroCidades ? "Cidades indisponíveis" : uf ? "Selecione..." : "Selecione a UF")}
                    </span>
                    <ChevronsUpDown className="opacity-50" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" onWheel={(event) => event.stopPropagation()}>
                  <Command>
                    <CommandInput placeholder="Buscar município..." />
                    <CommandList className="max-h-56 overflow-y-auto">
                      {erroCidades ? (
                        <div className="space-y-2 p-3 text-center text-xs text-muted-foreground">
                          <p>{erroCidades}</p>
                          <Button type="button" size="sm" variant="outline" onClick={() => recarregar()}>Tentar novamente</Button>
                        </div>
                      ) : <CommandEmpty>Nenhum município encontrado.</CommandEmpty>}
                      <CommandGroup>
                        {cidades.map((cidade) => (
                          <CommandItem
                            key={cidade.id}
                            value={cidade.nome}
                            onSelect={() => {
                              set("codigoMunicipio", String(cidade.id));
                              setCidadeAberta(false);
                            }}
                          >
                            {cidade.nome}
                            <Check className={cn("ml-auto", String(cidade.id) === form.codigoMunicipio ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={salvando} onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={salvando} onClick={() => void salvar()}>
            {salvando ? "Salvando..." : modo.tipo === "corrigir" ? "Salvar correção" : "Cadastrar contador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
