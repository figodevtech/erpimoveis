"use client";

import { useEffect, useState } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { ROTULO_TIPO_ITEM_ALUGUEL, hojeAluguel } from "@/lib/alugueis/status";
import { avisarAlteracaoAlugueis, encerrarAluguel } from "../lib/api";
import type { AluguelLista } from "../types";
import { nomeDoCliente } from "../types";
import {
  ChecklistRascunhoCard,
  RASCUNHO_VAZIO,
  gravarChecklist,
  useModelosChecklist,
  type RascunhoChecklist,
} from "./checklist-aluguel";

const VOLTA_AO_ESTOQUE = new Set(["PRODUTO", "USOCONSUMO", "GERAL"]);

/** Encerrar: o checklist de retorno é opcional e grava depois do encerramento. */
export function EncerrarAluguelDialog({
  aluguel,
  onOpenChange,
}: {
  aluguel: AluguelLista | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(aluguel);
  const [dataRetorno, setDataRetorno] = useState(hojeAluguel());
  const [observacao, setObservacao] = useState("");
  const [checklist, setChecklist] = useState<RascunhoChecklist>(RASCUNHO_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const modelos = useModelosChecklist(open);

  useEffect(() => {
    if (!open) return;
    setDataRetorno(hojeAluguel());
    setObservacao("");
    setChecklist(RASCUNHO_VAZIO);
  }, [open]);

  const voltam = (aluguel?.itens ?? []).filter((item) => VOLTA_AO_ESTOQUE.has(item.tipo) && !item.devolvido_em);

  async function confirmar() {
    if (!aluguel) return;
    if (dataRetorno > hojeAluguel()) {
      toast.error("A data de retorno não pode estar no futuro.");
      return;
    }
    setSalvando(true);
    try {
      // Retorno hoje grava o instante exato; dia anterior fica ao meio-dia de Fortaleza.
      const encerradoEm = dataRetorno === hojeAluguel() ? undefined : `${dataRetorno}T12:00:00-03:00`;
      await encerrarAluguel(aluguel.id, { encerradoEm, observacao: observacao.trim() || undefined });
      if (checklist.templateId) {
        try {
          await gravarChecklist(aluguel.id, "RETORNO", checklist, modelos);
        } catch (error: any) {
          toast.error(`Aluguel encerrado, mas o checklist de retorno falhou: ${error?.message ?? "erro"}. Preencha pelos detalhes.`);
        }
      }
      toast.success(`Aluguel #${aluguel.id} encerrado.`);
      avisarAlteracaoAlugueis();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "Falha ao encerrar aluguel.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(valor) => !salvando && onOpenChange(valor)}>
      <DialogContent className="sm:max-w-xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" /> Encerrar aluguel #{aluguel?.id}
          </DialogTitle>
          <DialogDescription>{aluguel ? nomeDoCliente(aluguel) : null}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Data do retorno</Label>
              <Input type="date" value={dataRetorno} max={hojeAluguel()} onChange={(e) => setDataRetorno(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Observação (opcional)</Label>
            <Textarea rows={3} maxLength={1000} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Condição do bem, pendências..." />
          </div>

          <ChecklistRascunhoCard
            tipo="RETORNO"
            rascunho={checklist}
            modelos={modelos}
            onChange={setChecklist}
            disabled={salvando}
            ajuda="Opcional — dá para preencher depois pelos detalhes."
          />

          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            {voltam.length ? (
              <>
                <p className="font-medium">Volta ao estoque:</p>
                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                  {voltam.map((item) => (
                    <li key={item.id}>
                      {item.quantidade}× {item.descricao}{" "}
                      <span className="text-xs">({ROTULO_TIPO_ITEM_ALUGUEL[item.tipo]})</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">Nenhum item de estoque a devolver: veículo e item avulso não têm saldo.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={salvando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Encerrar aluguel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
