"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { TabsContent } from "@/components/ui/tabs";
import { Produto } from "../../../types";
import { onlyDigits } from "../lib/utils";

type Props = {
  mode: "create" | "edit";
  produto: Produto;
  onChange: (field: keyof Produto, value: any) => void;
};

export function TabEstoque({ mode, produto, onChange }: Props) {
  return (
    <TabsContent value="Estoque" className="h-full min-h-0 w-full min-w-0 max-w-full overflow-x-hidden overflow-y-auto bg-muted-foreground/5 px-3 py-3 md:px-6 md:py-6">
      <div className="space-y-3 md:space-y-4">
        <div className="rounded-md border bg-card p-3 md:rounded-lg md:p-4">
          <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="estoque" className="text-xs md:text-sm">{mode === "edit" ? "Estoque (Qtd) *" : "Estoque Inicial (Qtd) *"}</Label>
            <Input
              disabled={mode === "edit"}
              id="estoque"
              value={(produto as any).estoque || ""}
              onChange={(e) => onChange("estoque" as any, onlyDigits(e.target.value))}
              placeholder="0"
              inputMode="numeric"
              maxLength={9}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="estoqueminimo" className="text-xs md:text-sm">Estoque Mínimo *</Label>
            <Input
              id="estoqueminimo"
              value={(produto as any).estoqueminimo || ""}
              onChange={(e) => onChange("estoqueminimo" as any, onlyDigits(e.target.value))}
              placeholder="0"
              inputMode="numeric"
              maxLength={9}
            />
          </div>
          </div>
        </div>

        <Separator className="my-1 md:my-2" />

        <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground md:rounded-lg md:p-4">
          <span className="font-medium text-foreground">Regra de estoque</span>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            <li>
              <strong>OK:</strong> Estoque acima do estoque mínimo.
            </li>
            <li>
              <strong>BAIXO:</strong> Estoque igual ou abaixo do estoque mínimo.
            </li>
            <li>
              <strong>CRÍTICO:</strong> Estoque atingiu a metade do estoque mínimo.
            </li>
            <li>
              <strong>SEM ESTOQUE:</strong> Estoque indisponível.
            </li>
          </ul>
        </div>
      </div>
    </TabsContent>
  );
}
