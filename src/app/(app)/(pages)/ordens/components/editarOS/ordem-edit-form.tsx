// src/app/(app)/(pages)/ordens/components/editarOS/ordem-edit-form.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Loader2,
  User2,
  Wrench,
  ClipboardList,
  Building2,
  Search,
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
import { ClienteInfoCard } from "../novaOS/cliente-info-card";
import { CustomerDialog } from "../../../clientes/components/customerDialogRegister/customerDialog";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { OrdemFormSection } from "../form-section";

type Veiculo = {
  id: number;
  placa: string;
  modelo: string;
  marca: string;
  ano?: number | null;
  cor?: string | null;
  kmatual?: number | null;
};

export type OrdemEditFormProps = {
  defaultValues: { id: number } | null;
  exposeSubmit?: (fn: () => void) => void;
  onSavingChange?: (saving: boolean) => void;
  onInitialLoadingChange?: (loading: boolean) => void;
  onClose?: () => void;
};

type AlvoTipo = "VEICULO" | "PECA" | "EQUIPAMENTO";

function resolvePecaNome(src: any): string {
  return src?.titulo ?? src?.nome ?? src?.peca?.titulo ?? src?.peca?.nome ?? "";
}

function resolvePecaDescricao(src: any): string {
  return src?.descricao ?? src?.peca?.descricao ?? "";
}
function resolvePecaLacre(src: any): string {
  return src?.lacre ?? src?.peca?.lacre ?? "";
}

export function OrdemEditForm({
  defaultValues,
  exposeSubmit,
  onSavingChange,
  onInitialLoadingChange,
  onClose,
}: OrdemEditFormProps) {
  const { data: session } = useSession();
  const canEditCustomer = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.CLIENTES_EDITAR,
  );
  const osId = defaultValues?.id ?? null;

  const [setores, setSetores] = useState<Array<{ id: number; nome: string }>>(
    [],
  );
  const [loadingSetores, setLoadingSetores] = useState(false);
  const [setoresError, setSetoresError] = useState<string | null>(null);
  const [setor, setSetor] = useState<string>("");

  const [modoAtendimento, setModoAtendimento] = useState<
    "cadastrado" | "avulso"
  >("cadastrado");
  const [prioridade, setPrioridade] = useState<"BAIXA" | "NORMAL" | "ALTA">(
    "NORMAL",
  );

  const [cliente, setCliente] = useState<Customer | null>(null);
  const [veiculosDoCliente, setVeiculosDoCliente] = useState<any[]>([]);
  const [veiculoSelecionadoId, setVeiculoSelecionadoId] = useState<
    number | null
  >(null);
  const [veiculoSelecionadoItem, setVeiculoSelecionadoItem] = useState<
    any | null
  >(null);
  const [openCustomer, setOpenCustomer] = useState(false);
  const [openVehicleAll, setOpenVehicleAll] = useState(false);
  const [openVehicleCustomer, setOpenVehicleCustomer] = useState(false);
  const [customerRegisterOpen, setCustomerRegisterOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<
    number | undefined
  >(undefined);

  const [avulsoNome, setAvulsoNome] = useState("");
  const [avulsoDoc, setAvulsoDoc] = useState("");
  const [avulsoTelefone, setAvulsoTelefone] = useState("");
  const [avulsoEmail, setAvulsoEmail] = useState("");

  const [descricao, setDescricao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [observacoesFiscais, setObservacoesFiscais] = useState("");

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
  const [eNome, setENome] = useState("");
  const [eAno, setEAno] = useState("");
  const [ePatrimonio, setEPatrimonio] = useState("");
  const [eHorimetro, setEHorimetro] = useState("");

  const [initialLoading, setInitialLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmSemVeiculoOpen, setConfirmSemVeiculoOpen] = useState(false);

  const applySelectedCustomer = (c?: Customer | null) => {
    setCliente(c ?? null);
    setModoAtendimento("cadastrado");
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

  // ===== Carrega lista de setores =====
  useEffect(() => {
    (async () => {
      try {
        setLoadingSetores(true);
        setSetoresError(null);

        const items = await listarSetores(); // só ativos
        setSetores(items);
      } catch (e: any) {
        setSetoresError(e?.message ?? "Não foi possível carregar os setores.");
        setSetores([]);
      } finally {
        setLoadingSetores(false);
      }
    })();
  }, []);

  // ===== Carrega dados da OS para edição =====
  useEffect(() => {
    if (!osId) return;

    (async () => {
      try {
        setInitialLoading(true);
        const r = await fetch(`/api/ordens/${osId}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok)
          throw new Error(j?.error || "Não foi possível carregar a OS.");

        const os = j?.os ?? {};
        const cli = j?.cliente ?? j?.os?.cliente ?? null;
        const vei = j?.veiculo ?? j?.os?.veiculo ?? null;

        const setorIdResolvido =
          os?.setorid != null
            ? os.setorid
            : os?.setor?.id != null
              ? os.setor.id
              : null;
        setSetor(setorIdResolvido != null ? String(setorIdResolvido) : "");

        setPrioridade((os?.prioridade as any) || "NORMAL");
        setDescricao(os?.descricao || "");
        setObservacoes(os?.observacoes || "");
        setObservacoesFiscais(os?.observacoes_fiscais || "");

        if (cli?.id) {
          // Cliente cadastrado (inclui o "avulso" que foi salvo na tabela cliente)
          setModoAtendimento("cadastrado");
          setCliente({
            id: cli.id,
            tipopessoa: cli.tipopessoa ?? "FISICA",
            cpfcnpj: cli.cpfcnpj ?? "",
            nomerazaosocial: cli.nomerazaosocial ?? cli.nome ?? "Cliente",
            email: cli.email ?? "",
            telefone: cli.telefone ?? "",
            endereco: cli.endereco ?? "",
            endereconumero: cli.endereconumero ?? "",
            enderecocomplemento: cli.enderecocomplemento ?? "",
            cidade: cli.cidade ?? "",
            estado: cli.estado ?? "",
            bairro: cli.bairro ?? "",
            cep: cli.cep ?? "",
            inscricaoestadual: cli.inscricaoestadual ?? "",
            inscricaomunicipal: cli.inscricaomunicipal ?? "",
            codigomunicipio: cli.codigomunicipio ?? "",
            createdat: cli.createdat ?? new Date().toISOString(),
            updatedat: cli.updatedat ?? null,
            status: cli.status ?? "ATIVO",
            veiculos: Array.isArray(cli.veiculos) ? cli.veiculos : [],
            ordens: Array.isArray(cli.ordens) ? cli.ordens : [],
            rank: cli.rank ?? "NORMAL",
          } as Customer);

          try {
            const rv = await fetch(`/api/veiculos/cliente/${cli.id}`, {
              cache: "no-store",
            });
            if (rv.ok) {
              const vj = await rv.json();
              const arr: Veiculo[] = (
                Array.isArray(vj) ? vj : (vj?.veiculos ?? vj?.items ?? [])
              ).map((v: any) => ({
                id: v.id,
                placa: v.placa,
                modelo: v.modelo,
                marca: v.marca,
                ano: v.ano ?? null,
                cor: v.cor ?? null,
                kmatual: v.kmatual ?? null,
              }));
              setVeiculosDoCliente(arr);
            }
          } catch {
            // se der erro aqui, só ignora a lista de veículos
          }
        } else {
          // fallback: caso um dia você trate cliente avulso separado
          setModoAtendimento("avulso");
          setCliente(null);
          setAvulsoNome(cli?.nomerazaosocial ?? cli?.nome ?? "");
          setAvulsoDoc(cli?.cpfcnpj ?? "");
          setAvulsoTelefone(cli?.telefone ?? "");
          setAvulsoEmail(cli?.email ?? "");
        }

        const alvo = (os?.alvo_tipo as AlvoTipo) || "VEICULO";
        setAlvoTipo(alvo);

        if (alvo === "VEICULO") {
          setVeiculoSelecionadoId(os?.veiculoid ?? vei?.id ?? null);
          setVeiculoSelecionadoItem(vei ?? os?.veiculo ?? null);
          setVPlaca(vei?.placa ?? os?.veiculo?.placa ?? "");
          setVModelo(vei?.modelo ?? os?.veiculo?.modelo ?? "");
          setVMarca(vei?.marca ?? os?.veiculo?.marca ?? "");
          setVAno(
            vei?.ano
              ? String(vei.ano)
              : os?.veiculo?.ano
                ? String(os.veiculo.ano)
                : "",
          );
          setVCor(vei?.cor ?? os?.veiculo?.cor ?? "");
          setVKm(
            vei?.kmatual
              ? String(vei.kmatual)
              : os?.veiculo?.kmatual
                ? String(os.veiculo.kmatual)
                : "",
          );
        } else if (alvo === "PECA") {
          setPNome(resolvePecaNome(j?.peca ?? os?.peca));
          setPDesc(resolvePecaDescricao(j?.peca ?? os?.peca));
          setPLacre(resolvePecaLacre(j?.peca ?? os?.peca));
          setVeiculoSelecionadoId(null);
          setVeiculoSelecionadoItem(null);
        } else {
          const equipamento = j?.equipamento ?? os?.equipamento ?? null;
          setENome(equipamento?.nome ?? "");
          setEAno(equipamento?.ano != null ? String(equipamento.ano) : "");
          setEPatrimonio(equipamento?.patrimonio ?? "");
          setEHorimetro(equipamento?.horimetro != null ? String(equipamento.horimetro) : "");
          setVeiculoSelecionadoId(null);
          setVeiculoSelecionadoItem(null);
        }
      } catch (e: any) {
        toast.error(e?.message ?? "Falha ao carregar a OS para edição.");
      } finally {
        setInitialLoading(false);
      }
    })();
  }, [osId]);

  useEffect(() => {
    onSavingChange?.(saving);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving]);

  useEffect(() => {
    onInitialLoadingChange?.(initialLoading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoading]);

  const veiculoOptions = useMemo(
    () =>
      veiculosDoCliente.map((v) => ({
        value: String(v.id),
        label: `${v.modelo} • ${v.placa}${v.ano ? ` (${v.ano})` : ""}`,
      })),
    [veiculosDoCliente],
  );
  const veiculoSelecionado =
    veiculoSelecionadoItem ??
    veiculosDoCliente.find((v) => Number(v.id) === veiculoSelecionadoId) ??
    null;

  const selecionarVeiculo = (veiculo: any) => {
    setVeiculoSelecionadoId(Number(veiculo.id));
    setVeiculoSelecionadoItem(veiculo);
    setVPlaca("");
    setVModelo("");
    setVMarca("");
    setVAno("");
    setVCor("");
    setVKm("");
  };

  const limparVeiculo = () => {
    setVeiculoSelecionadoId(null);
    setVeiculoSelecionadoItem(null);
  };

  function validar(): string | null {
    if (!osId) return "OS inválida.";
    if (!setor) return "Selecione o setor responsável.";
    if (modoAtendimento === "avulso") {
      if (!avulsoNome || !avulsoDoc)
        return "Preencha Nome/Razão Social e CPF/CNPJ no atendimento avulso.";
      if (!avulsoTelefone?.trim() || !avulsoEmail?.trim())
        return "Para atendimento avulso, telefone e e-mail são obrigatórios.";
    }

    if (false && alvoTipo === "VEICULO") {
      if (!veiculoSelecionadoId && !vModelo.trim() && !vPlaca.trim())
        return "Informe Modelo ou Placa do veículo, ou vincule um veículo existente.";
    } else if (alvoTipo === "PECA" && !pNome.trim()) {
      return "Informe o nome da peça.";
    } else if (alvoTipo === "EQUIPAMENTO" && !eNome.trim()) {
      return "Informe o nome da máquina/equipamento.";
    }
    return null;
  }

  const buildPayload = () => {
    const veiculoPayload =
      alvoTipo === "VEICULO"
        ? {
            placa: vPlaca?.trim() || null,
            modelo: vModelo?.trim() || null,
            marca: vMarca?.trim() || null,
            ano: vAno?.trim() ? Number(vAno) : null,
            cor: vCor?.trim() || null,
            kmatual: vKm?.trim() ? Number(vKm) : null,
          }
        : null;

    const base: any = {
      setorid: setor ? Number(setor) : null,
      prioridade,
      descricao: (descricao || "").trim() || null,
      observacoes: (observacoes || "").trim() || null,
      observacoes_fiscais: (observacoesFiscais || "").trim() || null,
    };

    base.cliente =
      modoAtendimento === "cadastrado"
        ? cliente
          ? { id: cliente.id }
          : null
        : {
            nome: avulsoNome?.trim(),
            documento: avulsoDoc?.trim(),
            telefone: avulsoTelefone?.trim() || null,
            email: avulsoEmail?.trim() || null,
          };

    if (alvoTipo === "VEICULO") {
      base.veiculoid = veiculoSelecionadoId ?? null;
      base.alvo = {
        tipo: "VEICULO",
        veiculoid: veiculoSelecionadoId ?? null,
        veiculo: veiculoPayload,
      };
    } else if (alvoTipo === "PECA") {
      base.veiculoid = null;
      base.alvo = {
        tipo: "PECA",
        peca: {
          nome: pNome.trim(),
          descricao: pDesc?.trim() || null,
          lacre: pLacre?.trim() || null,
        },
      };
    } else {
      base.veiculoid = null;
      base.alvo = {
        tipo: "EQUIPAMENTO",
        equipamento: {
          nome: eNome.trim(),
          ano: eAno ? Number(eAno) : null,
          patrimonio: ePatrimonio.trim() || null,
          horimetro: eHorimetro ? Number(eHorimetro) : null,
        },
      };
    }

    return base;
  };

  const salvarOS = async () => {
    const payload = buildPayload();

    setSaving(true);
    try {
      const r = await fetch(`/api/ordens/${osId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Falha ao atualizar OS");

      toast.success("OS atualizada com sucesso");
      window.dispatchEvent(new CustomEvent("os:refresh"));
      onClose?.();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar alterações");
    } finally {
      setSaving(false);
    }
  };

  const salvar = async () => {
    if (initialLoading || saving) return;
    const err = validar();
    if (err) return toast.error(err);

    if (alvoTipo === "VEICULO" && !veiculoSelecionadoId && !vModelo.trim() && !vPlaca.trim()) {
      setConfirmSemVeiculoOpen(true);
      return;
    }

    await salvarOS();
  };

  useEffect(() => {
    if (!exposeSubmit) return;
    exposeSubmit(salvar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    osId,
    setor,
    prioridade,
    modoAtendimento,
    cliente,
    veiculoSelecionadoId,
    avulsoNome,
    avulsoDoc,
    avulsoTelefone,
    avulsoEmail,
    descricao,
    observacoes,
    observacoesFiscais,
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
    eNome,
    eAno,
    ePatrimonio,
    eHorimetro,
  ]);

  if (!osId)
    return <div className="text-sm text-red-600">OS inválida para edição.</div>;

  return (
    <>
      <AlertDialog
        open={confirmSemVeiculoOpen}
        onOpenChange={setConfirmSemVeiculoOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar OS sem veículo</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja salvar a ordem de serviço sem veículo vinculado?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                setConfirmSemVeiculoOpen(false);
                void salvarOS();
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    <div className={initialLoading ? "min-h-[55vh]" : "space-y-3"}>
      {initialLoading ? (
        <div className="flex h-full min-h-[55vh] flex-col items-center justify-center gap-3">
          <div className="size-8 animate-spin rounded-full border-t-2 border-primary" />
          <span className="text-sm font-medium text-primary">Carregando</span>
        </div>
      ) : (
        <>
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
                      disabled={saving}
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
                      onClick={() => {
                        if (saving) return;
                        setCliente(null);
                        setVeiculosDoCliente([]);
                      }}
                      className="size-9 text-destructive hover:text-destructive"
                      disabled={saving}
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
                    disabled={saving}
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
                  disabled={saving}
                >
                  <Plus className="h-3 w-3" />
                  Novo Cliente
                </Button>
              </div>

              {modoAtendimento === "cadastrado" && (
                cliente ? (
                  <ClienteInfoCard customer={cliente} />
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                    Nenhum cliente selecionado.
                  </div>
                )
              )}
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
                      loadingSetores ||
                      (!!setoresError && setores.length === 0) ||
                      saving
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
                    disabled={saving}
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
                          <Button type="button" variant="outline" className="text-xs" disabled={saving}>
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
                        <Button type="button" variant="outline" className="text-xs" disabled={saving}>
                          <Search className="h-3 w-3" />
                          Todos os veículos
                        </Button>
                      </VehicleSelect>

                      {veiculoSelecionadoId ? (
                        <Button type="button" variant="outline" className="text-xs" onClick={limparVeiculo} disabled={saving}>
                          <X className="h-3 w-3 text-red-500" />
                          Remover veículo
                        </Button>
                      ) : null}
                    </div>

                    {veiculoSelecionado ? (
                      <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                        <p className="font-medium text-foreground">
                          Veículo vinculado: {veiculoSelecionado.modelo || "-"}
                        </p>
                        <p className="text-muted-foreground">
                          Placa: {veiculoSelecionado.placa || "-"}
                          {veiculoSelecionado.marca ? ` • Marca: ${veiculoSelecionado.marca}` : ""}
                          {veiculoSelecionado.ano ? ` • Ano: ${veiculoSelecionado.ano}` : ""}
                        </p>
                        <p className="text-muted-foreground">
                          Proprietário: {veiculoSelecionado.cliente?.nomerazaosocial || "Sem proprietário"}
                        </p>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                        Nenhum veículo selecionado.
                      </div>
                    )}
                  </div>
                ) : alvoTipo === "PECA" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label>Nome da peça</Label>
                      <Input
                        value={pNome}
                        maxLength={60}
                        onChange={(e) => setPNome(e.target.value)}
                        placeholder="Ex.: Radiador, Bomba d'água..."
                        disabled={saving}
                      />
                      <div className="text-right text-xs text-muted-foreground">
                        {pNome.length}/60
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Lacre</Label>
                      <Input
                        value={pLacre}
                        maxLength={30}
                        onChange={(e) => setPLacre(e.target.value.slice(0, 30))}
                        placeholder="Identificador do lacre"
                        disabled={saving}
                      />
                      <div className="text-right text-xs text-muted-foreground">
                        {pLacre.length}/30
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Descrição (opcional)</Label>
                      <Input
                        value={pDesc}
                        maxLength={120}
                        onChange={(e) => setPDesc(e.target.value)}
                        placeholder="Detalhes da peça"
                        disabled={saving}
                      />
                      <div className="text-right text-xs text-muted-foreground">
                        {pDesc.length}/120
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label>Nome da máquina/equipamento *</Label>
                      <Input value={eNome} onChange={(event) => setENome(event.target.value)} disabled={saving} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Patrimônio</Label>
                      <Input value={ePatrimonio} onChange={(event) => setEPatrimonio(event.target.value)} disabled={saving} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Ano</Label>
                      <Input type="number" value={eAno} onChange={(event) => setEAno(event.target.value)} disabled={saving} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Horímetro</Label>
                      <Input type="number" min="0" step="0.1" value={eHorimetro} onChange={(event) => setEHorimetro(event.target.value)} disabled={saving} />
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
                disabled={saving}
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
                disabled={saving}
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
                disabled={saving}
              />
            </OrdemFormSection>
          </div>

          {saving && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Salvando alterações...
            </div>
          )}
        </>
      )}
    </div>
    </>
  );
}
