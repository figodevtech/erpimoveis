"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Phone, Plus, Trash2 } from "lucide-react";
import { formatTelefone } from "./utils";
import type { TelefoneSecundario } from "./types";

interface SecondaryPhonesCardProps {
  telefones: TelefoneSecundario[];
  setTelefones: (telefones: TelefoneSecundario[]) => void;
  disabled?: boolean;
}

/**
 * Só adiciona contatos: o telefone principal continua no campo do cadastro e
 * nada aqui altera o que as telas e a nota fiscal já leem de `telefone`.
 */
export default function SecondaryPhonesCard({
  telefones,
  setTelefones,
  disabled = false,
}: SecondaryPhonesCardProps) {
  const adicionar = () =>
    setTelefones([...telefones, { telefone: "", contato: "", observacao: "" }]);

  const alterar = (index: number, campo: keyof TelefoneSecundario, valor: string) =>
    setTelefones(
      telefones.map((item, i) => (i === index ? { ...item, [campo]: valor } : item)),
    );

  const remover = (index: number) =>
    setTelefones(telefones.filter((_, i) => i !== index));

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Phone className="h-3 w-3 sm:h-4 sm:w-4" />
            <h3 className="text-base font-semibold sm:text-lg">Telefones secundários</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Outros números de contato e quem costuma atender em cada um.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={adicionar}
          className="text-xs hover:cursor-pointer"
        >
          <Plus className="h-4 w-4" /> Telefone
        </Button>
      </div>

      {telefones.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          Nenhum telefone secundário cadastrado.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {telefones.map((item, index) => (
            <div
              key={item.id ?? `novo-${index}`}
              className="grid grid-cols-1 items-end gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            >
              <div className="space-y-2">
                <Label htmlFor={`telefone-secundario-${index}`} className="text-sm">
                  Telefone
                </Label>
                <Input
                  id={`telefone-secundario-${index}`}
                  inputMode="tel"
                  disabled={disabled}
                  value={formatTelefone(item.telefone) || ""}
                  onChange={(e) =>
                    alterar(index, "telefone", e.target.value.replace(/\D/g, "").slice(0, 11))
                  }
                  placeholder="(11) 99999-9999"
                  maxLength={15}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`contato-secundario-${index}`} className="text-sm">
                  Quem atende
                </Label>
                <Input
                  id={`contato-secundario-${index}`}
                  disabled={disabled}
                  value={item.contato}
                  onChange={(e) => alterar(index, "contato", e.target.value)}
                  placeholder="Maria (financeiro)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`observacao-secundaria-${index}`} className="text-sm">
                  Observação
                </Label>
                <Input
                  id={`observacao-secundaria-${index}`}
                  disabled={disabled}
                  value={item.observacao}
                  onChange={(e) => alterar(index, "observacao", e.target.value)}
                  placeholder="Só pela manhã, WhatsApp..."
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                onClick={() => remover(index)}
                aria-label="Remover telefone secundário"
                className="text-muted-foreground hover:cursor-pointer hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
