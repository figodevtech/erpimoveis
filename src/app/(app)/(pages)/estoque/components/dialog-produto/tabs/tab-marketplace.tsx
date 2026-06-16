"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Store, AlignLeft } from "lucide-react";
import { Produto } from "../../../types";

type Props = {
  produto: Produto;
  onChange: (field: keyof Produto, value: any) => void;
};

export function TabMarketplace({ produto, onChange }: Props) {
  const LIMITE_TITULO = 100;
  const LIMITE_DESCRICAO = 300;

  const tituloQtd = (produto.tituloMarketplace || "").length;
  const descricaoQtd = (produto.descricaoMarketplace || "").length;

  return (
    <TabsContent value="MarketPlace" className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 px-2 py-3 md:px-6 md:py-6 space-y-6">
      
      {/* Visibilidade */}
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Store className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Visibilidade
          </h3>
        </div>

        <div className="flex flex-row items-center justify-between rounded-lg border bg-card p-4">
          <div className="space-y-0.5">
            <Label className="text-base">Exibir no Marketplace</Label>
            <p className="text-sm text-muted-foreground">
              Deixe ativo para que este produto seja listado em sua loja online/PDV
            </p>
          </div>
          <Switch 
            checked={!!(produto as any).exibirPdv} 
            onCheckedChange={(v) => onChange("exibirPdv" as any, v)} 
          />
        </div>
      </div>

      {/* Informações de Exibição */}
      <div className="rounded-xl border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <AlignLeft className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Informações de Exibição
          </h3>
        </div>

        <div className="grid gap-6 p-4 rounded-lg border bg-card">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="tituloMarketplace">Título no Marketplace *</Label>
              <span
                className={`text-xs font-medium ${tituloQtd >= LIMITE_TITULO ? "text-destructive" : "text-muted-foreground"}`}
              >
                {tituloQtd}/{LIMITE_TITULO}
              </span>
            </div>
            <Input
              id="tituloMarketplace"
              value={(produto as any).tituloMarketplace || ""}
              onChange={(e) => onChange("tituloMarketplace" as any, e.target.value)}
              placeholder="Ex: Pneu Aro 14"
              maxLength={LIMITE_TITULO}
            />
            <p className="text-xs text-muted-foreground">
              Nome comercial chamativo que aparecerá para os clientes.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="descricaoMarketplace">Descrição no Marketplace</Label>
              <span
                className={`text-xs font-medium ${descricaoQtd >= LIMITE_DESCRICAO ? "text-destructive" : "text-muted-foreground"}`}
              >
                {descricaoQtd}/{LIMITE_DESCRICAO}
              </span>
            </div>
            <Textarea
              id="descricaoMarketplace"
              value={(produto as any).descricaoMarketplace || ""}
              onChange={(e) => onChange("descricaoMarketplace" as any, e.target.value)}
              placeholder="Descreva os detalhes do produto, compatibilidade, marca, etc..."
              className="min-h-[120px] resize-y"
              maxLength={LIMITE_DESCRICAO}
            />
            <p className="text-xs text-muted-foreground">
              Forneça detalhes relevantes para convencer o cliente a comprar.
            </p>
          </div>
        </div>
      </div>
      
    </TabsContent>
  );
}
