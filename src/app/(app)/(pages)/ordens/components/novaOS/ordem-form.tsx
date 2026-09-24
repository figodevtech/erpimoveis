"use client";

import { useEffect, useMemo, useState } from "react";
import { safeUUID } from "../../lib/safe-uuid";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Search,
  User2,
  ClipboardList,
  Building2,
  Wrench,
  Plus,
  X,
  Pencil,
  TriangleAlert,
  FileText,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { useSession } from "next-auth/react";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import VehicleSelect from "@/app/(app)/components/vehicleSelect";
import { Customer } from "../../../clientes/types";
import { listarSetores } from "../../lib/api";
import { ClienteInfoCard } from "./cliente-info-card";
import { CustomerDialog } from "../../../clientes/components/customerDialogRegister/customerDialog";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { OrdemFormSection } from "../form-section";

export type FormularioNovaOSProps = {
  exposeSubmit?: (
    fn: (mode?: "CHECKLIST" | "ORCAMENTO") => Promise<void>,
  ) => void;
  onDone?: (osId?: number) => void;
  onSavingChange?: (saving: boolean) => void;
};

type AlvoTipo = "VEICULO" | "PECA" | "EQUIPAMENTO";
const MAX_PECA_NOME = 60;
const MAX_PECA_DESC = 120;

type PecaItem = {
  id: string;
  nome: string;
  descricao: string | null;
  lacre: string | null;
};

export function FormularioNovaOS({
  exposeSubmit,
  onDone,
  onSavingChange,
}: FormularioNovaOSProps) {
  const { data: session } = useSession();
  const canEditCustomer = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.CLIENTES_EDITAR,
  );

  const [saving, setSaving] = useState(false);
  useEffect(() => onSavingChange?.(saving), [saving, onSavingChange]);

  const [setores, setSetores] = useState<Array<{ id: number; nome: string }>>(
    [],
  );
  const [loadingSetores, setLoadingSetores] = useState(false);
  const [setoresError, setSetoresError] = useState<string | null>(null);
  const [setor, setSetor] = useState<string>("");

  const [cliente, setCliente] = useState<Customer | null>(null);
  const [veiculosDoCliente, setVeiculosDoCliente] = useState<any[]>([]);
  const [veiculoSelecionadoId, setVeiculoSelecionadoId] = useState<
    number | null
  >(null);
  const [veiculoSelecionado, setVeiculoSelecionado] = useState<any | null>(
    null,
  );
  const [openCustomer, setOpenCustomer] = useState(false);
  const [openVehicleAll, setOpenVehicleAll] = useState(false);
  const [openVehicleCustomer, setOpenVehicleCustomer] = useState(false);
  const [customerRegisterOpen, setCustomerRegisterOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<
    number | undefined
  >(undefined);

  const [prioridade, setPrioridade] = useState<"BAIXA" | "NORMAL" | "ALTA">(
    "NORMAL",
  );
  const [descricao, setDescricao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [observacoesFiscais, setObservacoesFiscais] = useState("");
  const [confirmSemVeiculoOpen, setConfirmSemVeiculoOpen] = useState(false);
  const [pendingSubmitMode, setPendingSubmitMode] = useState<
    "CHECKLIST" | "ORCAMENTO"
  >("CHECKLIST");

  const [alvoTipo, setAlvoTipo] = useState<AlvoTipo>("VEICULO");
  const [vPlaca, setVPlaca] = useState("");
  const [vModelo, setVModelo] = useState("");
  const [vMarca, setVMarca] = useState("");
  const [vAno, setVAno] = useState("");
  const [vCor, setVCor] = useState("");
  const [vKm, setVKm] = useState("");
  const [pNome, setPNome] = useState("");
  const [pDesc, setPDesc] = useState("");
  const [pLacre, setPLacre] = useState("");
  const [pecas, setPecas] = useState<PecaItem[]>([]);
  const [eNome, setENome] = useState("");
  const [eAno, setEAno] = useState("");
  const [ePatrimonio, setEPatrimonio] = useState("");
  const [eHorimetro, setEHorimetro] = useState("");

  const veiculoVinculado = veiculoSelecionadoId !== null;

  const applySelectedCustomer = (c?: Customer | null) => {
    setCliente(c ?? null);
    setVeiculosDoCliente(c?.veiculos ?? []);
  };

  const mergeUpdatedCustomer = (updatedCustomer: Customer) => {
    if (cliente?.id !== updatedCustomer.id) return;

    const veiculos = updatedCustomer.veiculos ?? cliente.veiculos ?? [];
    setCliente({
      ...cliente,
      ...updatedCustomer,
      veiculos,
      ordens: updatedCustomer.ordens ?? cliente.ordens ?? [],
    });
    setVeiculosDoCliente(veiculos);
  };

  const limparRascunhoPeca = () => {
    setPNome("");
    setPDesc("");
    setPLacre("");
  };

  const montarPecaRascunho = (): PecaItem | null => {
    const nome = pNome.trim();
    if (!nome) return null;
    return {
      id: safeUUID(),
      nome,
      descricao: pDesc.trim() || null,
      lacre: pLacre.trim() || null,
    };
  };

  const pecasParaSalvar = (): PecaItem[] => {
    const itens = [...pecas];
    const rascunho = montarPecaRascunho();
    if (rascunho) itens.push(rascunho);
    return itens;
  };

  const adicionarPeca = () => {
    const rascunho = montarPecaRascunho();
    if (!rascunho) {
      toast.error("Informe o nome da peça.");
      return;
    }
    setPecas((prev) => [...prev, rascunho]);
    limparRascunhoPeca();
  };

  const removerPeca = (id: string) => {
    setPecas((prev) => prev.filter((item) => item.id !== id));
  };

  useEffect(() => {
    (async () => {
      try {
        setLoadingSetores(true);
        setSetoresError(null);
        const items = await listarSetores();
        setSetores(items);

        try {
          const configResponse = await fetch("/api/config", { cache: "no-store" });
          const configData = await configResponse.json().catch(() => ({}));
          const setorPadraoId = Number(configData?.config?.setor_padrao_os_id);
          if (
            configResponse.ok
            && Number.isInteger(setorPadraoId)
            && items.some((item) => item.id === setorPadraoId)
          ) {
            setSetor((atual) => atual || String(setorPadraoId));
          }
        } catch (configError) {
          console.warn("N\u00e3o foi poss\u00edvel carregar o setor padr\u00e3o da OS.", configError);
        }
      } catch (e: any) {
        setSetoresError(e?.message ?? "Não foi possível carregar os setores.");
        setSetores([]);
      } finally {
        setLoadingSetores(false);
      }
    })();
  }, []);

  const veiculoOptions = useMemo(
    () =>
      veiculosDoCliente.map((v) => ({
        value: String(v.id),
        label: `${v.modelo} • ${v.placa}${v.ano ? ` (${v.ano})` : ""}`,
      })),
    [veiculosDoCliente],
  );

  const veiculoSelecionadoResumo = useMemo(() => {
    if (veiculoSelecionado) return veiculoSelecionado;
    return (
      veiculosDoCliente.find((v) => Number(v.id) === veiculoSelecionadoId) ??
      null
    );
  }, [veiculoSelecionado, veiculoSelecionadoId, veiculosDoCliente]);

  const selecionarVeiculo = (veiculo: any) => {
    setVeiculoSelecionadoId(Number(veiculo.id));
    setVeiculoSelecionado(veiculo);
    setVPlaca("");
    setVModelo("");
    setVMarca("");
    setVAno("");
    setVCor("");
    setVKm("");
  };

  const limparVeiculo = () => {
    setVeiculoSelecionadoId(null);
    setVeiculoSelecionado(null);
  };

  useEffect(() => {
    exposeSubmit?.(salvar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    setor,
    descricao,
    observacoes,
    observacoesFiscais,
    cliente,
    veiculosDoCliente,
    veiculoSelecionadoId,
    prioridade,
    alvoTipo,
    vPlaca,
    vModelo,
    vMarca,
    vAno,
    vCor,
    vKm,
    pNome,
    pDesc,
    pLacre,
    pecas,
    eNome,
    eAno,
    ePatrimonio,
    eHorimetro,
  ]);

  const validateAll = (): string | null => {
    if (!setor) return "Selecione o setor responsável.";
    if (alvoTipo === "VEICULO") {
      const placaNorm = vPlaca.trim().toUpperCase();
      if (!veiculoVinculado && placaNorm && veiculosDoCliente.length > 0) {
        const normalize = (s: string) =>
          s.replace(/[^A-Z0-9]/gi, "").toUpperCase();
        const jaExiste = veiculosDoCliente.some((v: any) => {
          const placaCliente = (v.placa || "").toString();
          return normalize(placaCliente) === normalize(placaNorm);
        });
        if (jaExiste) {
          return "Já existe um veículo com essa placa para este cliente. Selecione-o na lista em vez de cadastrar outro.";
        }
      }
    } else if (alvoTipo === "PECA") {
      if (pecasParaSalvar().length === 0) return "Informe ao menos uma peça.";
    } else if (!eNome.trim()) {
      return "Informe o nome da máquina/equipamento.";
    }

    return null;
  };

  const salvarOS = async (mode: "CHECKLIST" | "ORCAMENTO"): Promise<void> => {
    setSaving(true);
    try {
      const pecasPayload = alvoTipo === "PECA" ? pecasParaSalvar() : [];

      const payload: any = {
        setorid: setor ? Number(setor) : null,
        descricao: descricao || null,
        observacoes: (observacoes || "").trim() || null,
        observacoes_fiscais: (observacoesFiscais || "").trim() || null,
        prioridade,
        status: mode === "ORCAMENTO" ? "ORCAMENTO" : "AGUARDANDO_CHECKLIST",
        cliente: cliente ? { id: cliente.id } : null,
        veiculoid: veiculoSelecionadoId,
        alvo:
          alvoTipo === "VEICULO"
            ? veiculoVinculado
              ? { tipo: "VEICULO" }
              : {
                  tipo: "VEICULO",
                  veiculo: {
                    placa: vPlaca || null,
                    modelo: vModelo || null,
                    marca: vMarca || null,
                    ano: vAno ? Number(vAno) : null,
                    cor: vCor || null,
                    kmatual: vKm ? Number(vKm) : null,
                  },
                }
            : alvoTipo === "PECA"
              ? {
                  tipo: "PECA",
                  pecas: pecasPayload.map((item) => ({
                    nome: item.nome,
                    descricao: item.descricao,
                    lacre: item.lacre,
                  })),
                }
              : {
                  tipo: "EQUIPAMENTO",
                  equipamento: {
                    nome: eNome.trim(),
                    patrimonio: ePatrimonio.trim() || null,
                    ano: eAno ? Number(eAno) : null,
                    horimetro: eHorimetro ? Number(eHorimetro) : null,
                  },
                },
      };

      const r = await fetch("/api/ordens/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Falha ao criar OS");

      const osId: number = j?.id;
      const totalCriadas = Number(j?.totalCriadas || 0);

      toast.success(
        totalCriadas > 1
          ? `${totalCriadas} OS criadas com sucesso.`
          : `OS criada com sucesso!${osId ? ` ID: ${osId}` : ""}`,
      );

      window.dispatchEvent(new CustomEvent("os:refresh"));
      onDone?.(osId);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar OS");
    } finally {
      setSaving(false);
    }
  };

  const salvar = async (
    mode: "CHECKLIST" | "ORCAMENTO" = "CHECKLIST",
  ): Promise<void> => {
    if (saving) return;

    const err = validateAll();
    if (err) {
      toast.error(err);
      return;
    }

    if (alvoTipo === "VEICULO" && !veiculoVinculado && !vPlaca.trim()) {
      setPendingSubmitMode(mode);
      setConfirmSemVeiculoOpen(true);
      return;
    }

    await salvarOS(mode);
  };

  return (
    <>
      <AlertDialog
        open={confirmSemVeiculoOpen}
        onOpenChange={setConfirmSemVeiculoOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Criar OS sem veículo</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja criar a ordem de serviço sem selecionar um veículo
              vinculado?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                setConfirmSemVeiculoOpen(false);
                void salvarOS(pendingSubmitMode);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-3">
        <OrdemFormSection
          icon={User2}
          title="Cliente"
          description="Selecione um cliente cadastrado ou mantenha a OS sem cliente."
          contentClassName="space-y-3"
        >
            <div className="flex w-full flex-wrap items-center gap-2">
                <CustomerSelect
                  open={openCustomer}
                  setOpen={setOpenCustomer}
                  OnSelect={(c) => {
                    applySelectedCustomer(c);
                  }}
                >
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 text-xs transition-transform motion-safe:hover:-translate-y-0.5"
                  >
                    <Search className="h-3 w-3" />
                    Selecionar Cliente
                  </Button>
                </CustomerSelect>
                {cliente ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover cliente selecionado"
                    onClick={() => applySelectedCustomer(null)}
                    className="size-9 text-destructive hover:text-destructive"
                  >
                    <X className="size-4" />
                  </Button>
                ) : null}
              <CustomerDialog
                customerId={selectedCustomerId}
                setSelectedCustomerId={setSelectedCustomerId}
                isOpen={customerRegisterOpen}
                setIsOpen={setCustomerRegisterOpen}
                onRegister={(c) => {
                  applySelectedCustomer(c);
                }}
                onUpdate={mergeUpdatedCustomer}
              />
              {cliente && canEditCustomer ? (
                <Button
                  type="button"
                  onClick={() => {
                    setSelectedCustomerId(cliente.id);
                    setCustomerRegisterOpen(true);
                  }}
                  variant="outline"
                  className="h-9 text-xs transition-transform motion-safe:hover:-translate-y-0.5"
                >
                  <Pencil className="h-3 w-3" />
                  Editar Cliente
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={() => {
                  setSelectedCustomerId(undefined);
                  setCustomerRegisterOpen(true);
                }}
                variant="outline"
                className="h-9 text-xs transition-transform motion-safe:hover:-translate-y-0.5"
              >
                <Plus className="h-3 w-3" />
                Novo Cliente
              </Button>
            </div>
            {cliente && <ClienteInfoCard customer={cliente} />}
        </OrdemFormSection>

        <OrdemFormSection
          icon={Building2}
          title="Definição da OS"
          description="Defina a responsabilidade, a prioridade e o alvo do reparo."
          contentClassName="space-y-4"
        >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(14rem,0.8fr)]">
              <div className="space-y-1.5">
                <Label>Setor responsável</Label>
                <Select
                  value={setor}
                  onValueChange={setSetor}
                  disabled={
                    loadingSetores || (!!setoresError && setores.length === 0)
                  }
                >
                  <SelectTrigger className="h-10 w-full truncate">
                    <SelectValue
                      placeholder={
                        loadingSetores
                          ? "Carregando setores..."
                          : setores.length
                            ? "Selecione o setor"
                            : "Nenhum setor disponível"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {setores.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {setoresError && (
                  <p className="text-xs text-red-500">{setoresError}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Prioridade</Label>
                <Select
                  value={prioridade}
                  onValueChange={(v) => setPrioridade(v as any)}
                >
                  <SelectTrigger className="h-10 w-full truncate">
                    <SelectValue placeholder="Selecione a prioridade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BAIXA">Baixa</SelectItem>
                    <SelectItem value="NORMAL">Normal</SelectItem>
                    <SelectItem value="ALTA">Alta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-primary" />
                <Label className="font-medium">Alvo do reparo</Label>
              </div>

              <RadioGroup
                value={alvoTipo}
                onValueChange={(v: AlvoTipo) => setAlvoTipo(v)}
                className="grid grid-cols-1 gap-2 sm:grid-cols-3"
              >
                <label className="flex min-h-11 cursor-pointer items-center gap-2 border border-border bg-background px-3 text-sm transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem id="alvo-veic" value="VEICULO" />
                  <span>Veículo</span>
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 border border-border bg-background px-3 text-sm transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem id="alvo-peca" value="PECA" />
                  <span>Peça</span>
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 border border-border bg-background px-3 text-sm transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem id="alvo-equipamento" value="EQUIPAMENTO" />
                  <span>Máquina/Equipamento</span>
                </label>
              </RadioGroup>

              {alvoTipo === "VEICULO" ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Vincular a um veículo já cadastrado (opcional)</Label>
                    <Badge variant="outline" className="font-normal">
                      {cliente ? `${veiculoOptions.length} veículo(s) do cliente` : "Sem cliente"}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {cliente ? (
                      <VehicleSelect
                        open={openVehicleCustomer}
                        setOpen={setOpenVehicleCustomer}
                        clienteId={cliente.id}
                        title="Selecione um veículo do cliente"
                        OnSelect={selecionarVeiculo}
                      >
                        <Button type="button" variant="outline" className="text-xs">
                          <Search className="h-3 w-3" />
                          Veículos do cliente
                        </Button>
                      </VehicleSelect>
                    ) : null}

                    <VehicleSelect
                      open={openVehicleAll}
                      setOpen={setOpenVehicleAll}
                      title="Selecione um veículo"
                      OnSelect={selecionarVeiculo}
                    >
                      <Button type="button" variant="outline" className="text-xs">
                        <Search className="h-3 w-3" />
                        Todos os veículos
                      </Button>
                    </VehicleSelect>

                    {veiculoSelecionadoId ? (
                      <Button type="button" variant="outline" className="text-xs" onClick={limparVeiculo}>
                        <X className="h-3 w-3 text-red-500" />
                        Remover veículo
                      </Button>
                    ) : null}
                  </div>

                  {veiculoSelecionadoResumo ? (
                    <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                      <p className="font-medium text-foreground">
                        Veículo vinculado: {veiculoSelecionadoResumo.modelo || "-"}
                      </p>
                      <p className="text-muted-foreground">
                        Placa: {veiculoSelecionadoResumo.placa || "-"}
                        {veiculoSelecionadoResumo.marca ? ` • Marca: ${veiculoSelecionadoResumo.marca}` : ""}
                        {veiculoSelecionadoResumo.ano ? ` • Ano: ${veiculoSelecionadoResumo.ano}` : ""}
                      </p>
                      <p className="text-muted-foreground">
                        Proprietário: {veiculoSelecionadoResumo.cliente?.nomerazaosocial || "Sem proprietário"}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                      Nenhum veículo selecionado.
                    </div>
                  )}
                </div>
              ) : alvoTipo === "PECA" ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
                    <div className="space-y-1.5">
                      <Label>Nome da peça</Label>
                      <Input
                        value={pNome}
                        maxLength={MAX_PECA_NOME}
                        onChange={(e) =>
                          setPNome(e.target.value.slice(0, MAX_PECA_NOME))
                        }
                        placeholder="Ex.: Bomba d'água"
                      />
                      <div className="text-right text-xs text-muted-foreground">
                        {pNome.length}/{MAX_PECA_NOME}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Lacre da peça</Label>
                      <Input
                        value={pLacre}
                        maxLength={30}
                        onChange={(e) => setPLacre(e.target.value.slice(0, 30))}
                        placeholder="Lacre para identificação"
                      />
                      <div className="text-right text-xs text-muted-foreground">
                        {pLacre.length}/30
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Descrição (opcional)</Label>
                      <Input
                        value={pDesc}
                        maxLength={MAX_PECA_DESC}
                        onChange={(e) =>
                          setPDesc(e.target.value.slice(0, MAX_PECA_DESC))
                        }
                        placeholder="Detalhes da peça"
                      />
                      <div className="text-right text-xs text-muted-foreground">
                        {pDesc.length}/{MAX_PECA_DESC}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="hidden lg:block opacity-0">
                        Adicionar
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={adicionarPeca}
                        className="w-full lg:w-auto"
                      >
                        <Plus className="h-4 w-4" />
                        Adicionar peça
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Peças desta criação</Label>
                      <Badge variant="outline" className="font-normal">
                        {pecas.length} adicionada(s)
                      </Badge>
                    </div>

                    {pecas.length > 0 ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {pecas.map((item, index) => (
                          <div
                            key={item.id}
                            className="group rounded-xl border bg-background p-3 shadow-sm transition-colors hover:border-primary/30"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="secondary"
                                    className="font-medium"
                                  >
                                    Peça {index + 1}
                                  </Badge>
                                  <p className="text-sm font-semibold leading-none">
                                    {item.nome}
                                  </p>
                                </div>

                                <div className="space-y-1 text-xs text-muted-foreground">
                                  {item.lacre ? (
                                    <p>
                                      <span className="font-medium text-foreground/80">
                                        Lacre:
                                      </span>{" "}
                                      {item.lacre}
                                    </p>
                                  ) : null}
                                  {item.descricao ? (
                                    <p>{item.descricao}</p>
                                  ) : null}
                                  {!item.lacre && !item.descricao ? (
                                    <p className="italic">
                                      Sem detalhes adicionais.
                                    </p>
                                  ) : null}
                                </div>
                              </div>

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shrink-0 opacity-80 transition-opacity group-hover:opacity-100"
                                onClick={() => removerPeca(item.id)}
                              >
                                <X className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed bg-muted/20 px-4 py-5">
                        <p className="text-sm text-muted-foreground">
                          Nenhuma peça adicionada ainda. Você pode adicionar
                          várias; será criada uma OS para cada peça.
                        </p>
                      </div>
                    )}

                    {pNome.trim() && (
                      <p className="text-xs text-muted-foreground">
                        A peça atualmente preenchida também será incluída no
                        salvamento, mesmo sem clicar em adicionar.
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label>Nome da máquina/equipamento *</Label>
                    <Input value={eNome} onChange={(event) => setENome(event.target.value)} placeholder="Ex.: Retroescavadeira" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Patrimônio</Label>
                    <Input value={ePatrimonio} onChange={(event) => setEPatrimonio(event.target.value)} placeholder="Ex.: MAQ-001" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Ano</Label>
                    <Input type="number" value={eAno} onChange={(event) => setEAno(event.target.value)} placeholder="2022" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Horímetro</Label>
                    <Input type="number" min="0" step="0.1" value={eHorimetro} onChange={(event) => setEHorimetro(event.target.value)} placeholder="Horas de uso" />
                  </div>
                </div>
              )}
            </div>
        </OrdemFormSection>

        <OrdemFormSection
          icon={ClipboardList}
          title="Relato do problema"
          description="Registre os sintomas e o contexto informado pelo cliente."
        >
            <Textarea
              placeholder="Descreva o problema..."
              className="min-h-24 resize-y"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
        </OrdemFormSection>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <OrdemFormSection
            icon={TriangleAlert}
            title="Notas internas"
            description="Anotações exclusivas da equipe e histórico relevante."
          >
            <Textarea
              placeholder="Informações adicionais..."
              className="min-h-24 resize-y"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </OrdemFormSection>

          <OrdemFormSection
            icon={FileText}
            title="Notas fiscais"
            description="Informações úteis para emissão de notas e processos fiscais."
          >
            <Textarea
              placeholder="Informações fiscais adicionais..."
              className="min-h-24 resize-y"
              value={observacoesFiscais}
              onChange={(e) => setObservacoesFiscais(e.target.value)}
            />
          </OrdemFormSection>
        </div>
      </div>
    </>
  );
}
