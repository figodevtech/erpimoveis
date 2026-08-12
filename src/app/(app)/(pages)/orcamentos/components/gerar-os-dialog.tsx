"use client";

import { useEffect, useMemo, useState } from "react";
import { Car, Cog, Loader2, Package, TriangleAlert } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";

import VehicleSelect from "@/app/(app)/components/vehicleSelect";
import { gerarOSDoOrcamento, listarSetores } from "../lib/api";
import type { AlvoGerarOS, OrcamentoLinha } from "../types";

type AlvoTipo = "VEICULO" | "PECA" | "EQUIPAMENTO";

export type GerarOSDialogProps = {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  orcamento: OrcamentoLinha | null;
  onGerada?: (ordemservicoid: number) => void;
};

export function GerarOSDialog({ open, onOpenChange, orcamento, onGerada }: GerarOSDialogProps) {
  const [setores, setSetores] = useState<Array<{ id: number; nome: string }>>([]);
  const [setor, setSetor] = useState<string>("");
  const [prioridade, setPrioridade] = useState<"BAIXA" | "NORMAL" | "ALTA">("NORMAL");
  const [alvoTipo, setAlvoTipo] = useState<AlvoTipo>("VEICULO");

  const [veiculoId, setVeiculoId] = useState<number | null>(null);
  const [veiculoRotulo, setVeiculoRotulo] = useState("");
  const [veiculoAberto, setVeiculoAberto] = useState(false);
  const [placa, setPlaca] = useState("");
  const [modelo, setModelo] = useState("");
  const [marca, setMarca] = useState("");

  const [pecaNome, setPecaNome] = useState("");
  const [equipamentoNome, setEquipamentoNome] = useState("");

  const [gerando, setGerando] = useState(false);
  const [erroEstoque, setErroEstoque] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setErroEstoque(null);
    listarSetores()
      .then(setSetores)
      .catch((erro) => toast.error(erro?.message ?? "Falha ao carregar setores"));
  }, [open]);

  useEffect(() => {
    if (open) return;
    // Limpa ao fechar para a próxima conversão não herdar o alvo da anterior.
    setSetor("");
    setPrioridade("NORMAL");
    setAlvoTipo("VEICULO");
    setVeiculoId(null);
    setVeiculoRotulo("");
    setPlaca("");
    setModelo("");
    setMarca("");
    setPecaNome("");
    setEquipamentoNome("");
  }, [open]);

  const clienteNome = useMemo(
    () => orcamento?.cliente?.nomerazaosocial?.trim() || null,
    [orcamento],
  );

  function montarAlvo(): AlvoGerarOS | null {
    if (alvoTipo === "VEICULO") {
      if (veiculoId) return { tipo: "VEICULO", veiculoid: veiculoId };
      if (placa.trim()) {
        return {
          tipo: "VEICULO",
          veiculo: { placa: placa.trim(), modelo: modelo.trim(), marca: marca.trim() },
        };
      }
      // A OS aceita nascer sem veículo; o banco permite e a tela de OS também.
      return { tipo: "VEICULO" };
    }

    if (alvoTipo === "PECA") {
      if (!pecaNome.trim()) return null;
      return { tipo: "PECA", peca: { nome: pecaNome.trim() } };
    }

    if (!equipamentoNome.trim()) return null;
    return { tipo: "EQUIPAMENTO", equipamento: { nome: equipamentoNome.trim() } };
  }

  async function gerar() {
    if (!orcamento || gerando) return;

    const setorid = Number(setor);
    if (!Number.isInteger(setorid) || setorid <= 0) {
      toast.error("Selecione o setor da OS.");
      return;
    }

    const alvo = montarAlvo();
    if (!alvo) {
      toast.error(
        alvoTipo === "PECA"
          ? "Informe o nome da peça."
          : "Informe o nome da máquina ou equipamento.",
      );
      return;
    }

    setGerando(true);
    setErroEstoque(null);
    try {
      const { ordemservicoid } = await gerarOSDoOrcamento(orcamento.id, {
        setorid,
        clienteid: orcamento.cliente?.id ?? null,
        prioridade,
        status: "ORCAMENTO",
        alvo,
      });

      toast.success(`OS #${ordemservicoid} criada a partir do orçamento.`);
      onGerada?.(ordemservicoid);
      onOpenChange(false);
    } catch (erro: any) {
      // Estoque insuficiente não é erro de digitação: merece ficar fixo na tela,
      // porque a correção é repor peça ou mudar o orçamento, não tentar de novo.
      if (erro?.codigo === "ESTOQUE_INSUFICIENTE") {
        setErroEstoque(erro.message);
      } else {
        toast.error(erro?.message ?? "Falha ao gerar OS");
      }
    } finally {
      setGerando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(valor) => (gerando ? null : onOpenChange(valor))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Gerar OS do orçamento #{orcamento?.id}</DialogTitle>
          <DialogDescription>
            Os itens e valores vão para a OS exatamente como foram cotados. Falta informar o que a
            OS exige e o orçamento não exigia.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {clienteNome ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              Cliente: <span className="font-medium">{clienteNome}</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Este orçamento não tem cliente. A OS será criada sem cliente e você precisará
                informá-lo antes de enviá-la para aprovação.
              </span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Setor *</Label>
              <Select value={setor} onValueChange={setSetor}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o setor" />
                </SelectTrigger>
                <SelectContent>
                  {setores.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Prioridade</Label>
              <Select value={prioridade} onValueChange={(v) => setPrioridade(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BAIXA">Baixa</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="ALTA">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">O que será atendido</Label>
            <RadioGroup
              value={alvoTipo}
              onValueChange={(v) => setAlvoTipo(v as AlvoTipo)}
              className="grid gap-2 sm:grid-cols-3"
            >
              {[
                { valor: "VEICULO" as const, rotulo: "Veículo", icone: Car },
                { valor: "PECA" as const, rotulo: "Peça", icone: Package },
                { valor: "EQUIPAMENTO" as const, rotulo: "Equipamento", icone: Cog },
              ].map(({ valor, rotulo, icone: Icone }) => (
                <Label
                  key={valor}
                  className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <RadioGroupItem value={valor} />
                  <Icone className="h-4 w-4" />
                  {rotulo}
                </Label>
              ))}
            </RadioGroup>
          </div>

          {alvoTipo === "VEICULO" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <VehicleSelect
                  open={veiculoAberto}
                  setOpen={setVeiculoAberto}
                  OnSelect={(veiculo: any) => {
                    setVeiculoId(Number(veiculo.id));
                    setVeiculoRotulo(
                      [veiculo.modelo, veiculo.placa].filter(Boolean).join(" • ") ||
                        `Veículo #${veiculo.id}`,
                    );
                  }}
                >
                  <Button type="button" variant="outline">
                    <Car className="mr-2 h-4 w-4" />
                    {veiculoId ? "Trocar veículo" : "Selecionar veículo"}
                  </Button>
                </VehicleSelect>

                {veiculoId ? (
                  <span className="rounded-md border bg-muted/30 px-3 py-1.5 text-sm font-medium">
                    {veiculoRotulo}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Ou informe a placa abaixo para cadastrar um novo
                  </span>
                )}
              </div>

              {!veiculoId ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Placa</Label>
                    <Input value={placa} onChange={(e) => setPlaca(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Modelo</Label>
                    <Input value={modelo} onChange={(e) => setModelo(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Marca</Label>
                    <Input value={marca} onChange={(e) => setMarca(e.target.value)} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : alvoTipo === "PECA" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Nome da peça *</Label>
              <Input value={pecaNome} onChange={(e) => setPecaNome(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">Nome da máquina ou equipamento *</Label>
              <Input
                value={equipamentoNome}
                onChange={(e) => setEquipamentoNome(e.target.value)}
              />
            </div>
          )}

          {erroEstoque ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erroEstoque}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={gerando}>
            Cancelar
          </Button>
          <Button onClick={gerar} disabled={gerando}>
            {gerando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Gerando...
              </>
            ) : (
              "Gerar OS"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GerarOSDialog;
