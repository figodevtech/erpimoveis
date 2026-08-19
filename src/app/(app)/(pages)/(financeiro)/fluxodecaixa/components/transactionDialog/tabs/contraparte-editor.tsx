"use client";

import { useState } from "react";

import CustomerSelect from "@/app/(app)/components/customerSelect";
import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { formatCpfCnpj } from "../../../utils";
import type { FormularioTransacao } from "../use-transacao-edicao";

/**
 * Quem pagou ou recebeu — o único lugar onde isso se edita.
 *
 * Os campos moram na aba Detalhes, junto do resto do formulário; a aba Cliente
 * só mostra o cadastro por extenso. Ter os dois editando os mesmos campos era o
 * caminho curto para as duas telas discordarem: a Detalhes travava o CPF/CNPJ
 * sempre, mesmo sem cadastro nenhum vinculado, e não oferecia como trocar.
 *
 * A regra é o vínculo, não a permissão: havendo `cliente_id` ou `fornecedor_id`,
 * nome e documento vêm do cadastro e não se digitam — mudá-los aqui faria a
 * transação divergir do cliente que ela aponta. Sem vínculo, são texto livre.
 *
 * Cliente e fornecedor são exclusivos, como no cadastro: escolher um limpa o
 * outro.
 */
export function ContraparteEditor({
  form,
  setForm,
  editavel,
}: {
  form: FormularioTransacao;
  setForm: React.Dispatch<React.SetStateAction<FormularioTransacao | undefined>>;
  editavel: boolean;
}) {
  const [clienteAberto, setClienteAberto] = useState(false);
  const [fornecedorAberto, setFornecedorAberto] = useState(false);

  const vinculado = form.cliente_id != null || form.fornecedor_id != null;

  const trocar = (patch: Partial<FormularioTransacao>) =>
    setForm((atual) => (atual ? { ...atual, ...patch } : atual));

  // Os seletores devolvem o cadastro inteiro; aqui só interessam estes três
  // campos, e o CPF/CNPJ pode vir vazio de um cadastro incompleto.
  type Escolhido = {
    id: number;
    nomerazaosocial?: string | null;
    cpfcnpj?: string | null;
  };

  const escolher = (qual: "cliente" | "fornecedor") => (escolhido: Escolhido) =>
    trocar({
      cliente_id: qual === "cliente" ? escolhido.id : null,
      fornecedor_id: qual === "fornecedor" ? escolhido.id : null,
      nomepagador: escolhido.nomerazaosocial ?? "",
      cpfcnpjpagador: escolhido.cpfcnpj ?? "",
    });

  /*
   * Desvincular mantém nome e documento: são NOT NULL no banco, e quem
   * desvincula quer passar a digitar — não apagar quem pagou.
   */
  const desvincular = () => trocar({ cliente_id: null, fornecedor_id: null });

  return (
    <>
      {editavel ? (
        <>
          {/* Dialogs controlados por estado: ficam sempre montados. */}
          <CustomerSelect
            open={clienteAberto}
            setOpen={setClienteAberto}
            OnSelect={escolher("cliente")}
          />
          <FornecedorSelect
            open={fornecedorAberto}
            setOpen={setFornecedorAberto}
            OnSelect={escolher("fornecedor")}
          />

          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 rounded-none sm:h-9"
              onClick={() => setClienteAberto(true)}
            >
              {form.cliente_id != null ? "Trocar cliente" : "Selecionar cliente"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 rounded-none sm:h-9"
              onClick={() => setFornecedorAberto(true)}
            >
              {form.fornecedor_id != null
                ? "Trocar fornecedor"
                : "Selecionar fornecedor"}
            </Button>
            {vinculado ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 rounded-none sm:h-9"
                onClick={desvincular}
              >
                Desvincular
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {vinculado ? (
        <div className="mb-4 border border-border bg-muted/30 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {form.cliente_id != null ? "Cliente vinculado" : "Fornecedor vinculado"}
          </p>
          <p className="mt-0.5 text-sm font-medium">
            {form.nomepagador ||
              `#${form.cliente_id ?? form.fornecedor_id}`}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="w-full space-y-2">
          <Label htmlFor="nomepagador">
            Nome do pagador/recebedor <span className="text-red-500">*</span>
          </Label>
          <Input
            id="nomepagador"
            disabled={!editavel || vinculado}
            value={form.nomepagador || ""}
            onChange={(evento) => trocar({ nomepagador: evento.target.value })}
            placeholder="Nome do pagador/recebedor"
          />
        </div>

        <div className="w-full space-y-2">
          <Label htmlFor="cpfcnpjpagador">
            CPF/CNPJ do pagador/recebedor <span className="text-red-500">*</span>
          </Label>
          <Input
            id="cpfcnpjpagador"
            disabled={!editavel || vinculado}
            inputMode="numeric"
            maxLength={18}
            value={formatCpfCnpj(form.cpfcnpjpagador || "") || ""}
            onChange={(evento) =>
              trocar({
                cpfcnpjpagador: evento.target.value.replace(/\D/g, "").slice(0, 14),
              })
            }
            placeholder="CPF/CNPJ"
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {vinculado
          ? "Nome e documento vêm do cadastro vinculado. Desvincule para digitá-los à mão."
          : "Sem cadastro vinculado: valem o nome e o documento digitados aqui."}
      </p>
      {editavel ? (
        <p className="mt-1 text-xs text-muted-foreground">
          A troca vale para este lançamento e fica registrada na aba Histórico. O
          documento de origem — a OS ou a venda — não é alterado.
        </p>
      ) : null}
    </>
  );
}
