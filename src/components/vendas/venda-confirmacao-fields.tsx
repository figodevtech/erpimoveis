"use client";

import {
  DadosParaFinanceiroFields,
  type DadosParaFinanceiro,
} from "@/components/financeiro/dados-para-financeiro";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CreditCard, FileText } from "lucide-react";

type VendaConfirmacaoFieldsProps = {
  descricao: string;
  onDescricaoChange: (value: string) => void;
  observacoesInternas: string;
  onObservacoesInternasChange: (value: string) => void;
  observacoesFiscais: string;
  onObservacoesFiscaisChange: (value: string) => void;
  dadosFinanceiro: DadosParaFinanceiro;
  onDadosFinanceiroChange: (value: DadosParaFinanceiro) => void;
  totalCents: number;
  disabled?: boolean;
  idPrefix: string;
};

export function VendaConfirmacaoFields({
  descricao,
  onDescricaoChange,
  observacoesInternas,
  onObservacoesInternasChange,
  observacoesFiscais,
  onObservacoesFiscaisChange,
  dadosFinanceiro,
  onDadosFinanceiroChange,
  totalCents,
  disabled = false,
  idPrefix,
}: VendaConfirmacaoFieldsProps) {
  return (
    <div className="space-y-4">
      <section className="overflow-hidden border border-border bg-card shadow-sm">
        <header className="flex items-start gap-3 border-b border-border bg-muted/25 px-3 py-3 sm:px-4">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center border border-border bg-background text-primary">
            <CreditCard className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-foreground">
              Dados financeiros
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Informe formas, valores previstos, parcelas, orientação financeira e garantia.
            </p>
          </div>
        </header>
        <div className="p-3 sm:p-4">
          <DadosParaFinanceiroFields
            value={dadosFinanceiro}
            onChange={onDadosFinanceiroChange}
            totalCents={totalCents}
            disabled={disabled}
          />
        </div>
      </section>
      <section className="overflow-hidden border border-border bg-card shadow-sm">
        <header className="flex items-start gap-3 border-b border-border bg-muted/25 px-3 py-3 sm:px-4">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center border border-border bg-background text-primary">
            <FileText className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-foreground">
              Informações da venda
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Registre a descrição comercial e as observações de uso interno e fiscal.
            </p>
          </div>
        </header>
        <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-2">
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor={`${idPrefix}-descricao`}>Descrição</Label>
            <Textarea
              id={`${idPrefix}-descricao`}
              value={descricao}
              onChange={(event) => onDescricaoChange(event.target.value)}
              placeholder="Descrição comercial exibida ao cliente"
              rows={3}
              disabled={disabled}
              className="resize-y rounded-none bg-background"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-observacoes-internas`}>
              Observações internas
            </Label>
            <Textarea
              id={`${idPrefix}-observacoes-internas`}
              value={observacoesInternas}
              onChange={(event) => onObservacoesInternasChange(event.target.value)}
              placeholder="Informações exclusivas da equipe"
              rows={3}
              disabled={disabled}
              className="resize-y rounded-none bg-background"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-observacoes-fiscais`}>
              Observações fiscais
            </Label>
            <Textarea
              id={`${idPrefix}-observacoes-fiscais`}
              value={observacoesFiscais}
              onChange={(event) => onObservacoesFiscaisChange(event.target.value)}
              placeholder="Informações destinadas à emissão fiscal"
              rows={3}
              disabled={disabled}
              className="resize-y rounded-none bg-background"
            />
          </div>
        </div>
      </section>

      
    </div>
  );
}
