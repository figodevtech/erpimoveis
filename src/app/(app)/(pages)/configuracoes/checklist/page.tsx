"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

import type { ChecklistTemplate } from "./components/types";
import { categorias, novoTemplateVazio } from "./components/utils";
import {
  listarModelos,
  criarModelo,
  atualizarModelo,
  excluirModelo,
} from "./components/api";

import { TemplateForm } from "./components/template-form";
import { TemplatesList } from "./components/template-list";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function Page() {
  const [items, setItems] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [modeloEmEdicao, setModeloEmEdicao] =
    useState<ChecklistTemplate>(novoTemplateVazio());

  // função exposta pelo TemplateForm pra disparar o "submit"
  const submitRef = useRef<(() => Promise<void> | void) | null>(null);
  const resetDialogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const resetDialogState = () => {
    setEditandoId(null);
    setModeloEmEdicao(novoTemplateVazio());
    submitRef.current = null;
  };

  const scheduleDialogReset = () => {
    if (resetDialogTimerRef.current) {
      clearTimeout(resetDialogTimerRef.current);
    }
    resetDialogTimerRef.current = setTimeout(() => {
      resetDialogState();
      resetDialogTimerRef.current = null;
    }, 200);
  };

  async function reload() {
    try {
      setErro(null);
      setLoading(true);
      const data = await listarModelos();
      setItems(data);
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : "Não foi possível carregar os modelos.";
      setErro(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    return () => {
      if (resetDialogTimerRef.current) {
        clearTimeout(resetDialogTimerRef.current);
      }
    };
  }, []);

  const iniciarNovo = () => {
    if (resetDialogTimerRef.current) {
      clearTimeout(resetDialogTimerRef.current);
      resetDialogTimerRef.current = null;
    }
    setEditandoId(null);
    setModeloEmEdicao(novoTemplateVazio());
    setOpen(true);
  };

  const editar = (tpl: ChecklistTemplate) => {
    if (resetDialogTimerRef.current) {
      clearTimeout(resetDialogTimerRef.current);
      resetDialogTimerRef.current = null;
    }
    setEditandoId(tpl.id);
    const clone = JSON.parse(JSON.stringify(tpl)) as ChecklistTemplate;
    setModeloEmEdicao(clone);
    setOpen(true);
  };

  const excluir = async (id: string) => {
    try {
      setErro(null);
      await excluirModelo(id);
      setItems((lst) => lst.filter((c) => c.id !== id));
      toast.success("Checklist excluído com sucesso.");
      if (editandoId === id) {
        setOpen(false);
        scheduleDialogReset();
      }
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : "Erro ao excluir checklist.";
      setErro(msg);
      toast.error(msg);
    }
  };

  const handleCloseDialog = () => {
    if (salvando) return;
    setOpen(false);
    scheduleDialogReset();
  };

  const handleSaveTemplate = async (tpl: ChecklistTemplate) => {
    setErro(null);

    const payload = {
      nome: tpl.nome,
      descricao: tpl.descricao ?? "",
      categoria: tpl.categoria ?? "",
      itens: tpl.itens,
      ativo: tpl.ativo ?? true,
    };

    try {
      if (editandoId) {
        const atualizado = await atualizarModelo(editandoId, payload);
        setItems((lst) =>
          lst.map((c) => (c.id === editandoId ? atualizado : c)),
        );
        toast.success("Checklist atualizado com sucesso.");
      } else {
        const criado = await criarModelo(payload);
        setItems((lst) => [criado, ...lst]);
        toast.success("Checklist criado com sucesso.");
      }

      handleCloseDialog();
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message
          : "Erro ao salvar checklist.";
      setErro(msg);
      toast.error(msg);
      throw e; // deixa o botão de salvar tirar o loading corretamente
    }
  };

  const handleClickSalvar = async () => {
    if (!submitRef.current) return;
    setSalvando(true);
    try {
      await submitRef.current();
    } finally {
      setSalvando(false);
    }
  };

  const isInvalid =
    !modeloEmEdicao.nome?.trim() || (modeloEmEdicao.itens?.length ?? 0) === 0;

  return (
    <div className="mx-auto space-y-6">
      <TemplatesList
        items={items}
        loading={loading}
        error={erro}
        onReload={reload}
        onNew={iniciarNovo}
        onEdit={editar}
        onDelete={excluir}
      />

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (v) setOpen(true);
          else handleCloseDialog();
        }}
      >
        <DialogContent
          className="h-svh min-w-screen overflow-hidden p-0 sm:h-[85vh] sm:min-h-[620px] sm:max-h-[820px] sm:w-[90vw] sm:min-w-0 sm:max-w-[1000px]"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b px-6 py-4">
              <DialogTitle>
                {editandoId ? "Editar checklist" : "Novo checklist"}
              </DialogTitle>
            </DialogHeader>

            {/* conteúdo rolável */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 dark:bg-muted-foreground/5">
                                            <div className="rounded-lg border bg-card p-4 gap-3 flex flex-col">

              <TemplateForm
                value={modeloEmEdicao}
                categorias={categorias}
                editando={!!editandoId}
                onSave={handleSaveTemplate}
                onCancel={handleCloseDialog}
                variant="bare"
                onChange={setModeloEmEdicao}
                exposeSubmit={(fn) => {
                  submitRef.current = fn;
                }}
              />
            </div>
            </div>

            <DialogFooter className="shrink-0 border-t px-6 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseDialog}
                disabled={salvando}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleClickSalvar}
                disabled={salvando || isInvalid}
              >
                {salvando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Salvar"
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
