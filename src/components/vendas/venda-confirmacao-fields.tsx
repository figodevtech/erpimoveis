"use client";

import {
  DadosParaFinanceiroFields,
  type DadosParaFinanceiro,
} from "@/components/financeiro/dados-para-financeiro";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
    <div className="space-y-5">
      <div className="pt-5">
        <DadosParaFinanceiroFields
          value={dadosFinanceiro}
          onChange={onDadosFinanceiroChange}
          totalCents={totalCents}
          disabled={disabled}
        />
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-descricao`}>Descrição</Label>
          <Textarea
            id={`${idPrefix}-descricao`}
            value={descricao}
            onChange={(event) => onDescricaoChange(event.target.value)}
            placeholder="Descrição comercial exibida ao cliente"
            rows={3}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-observacoes-internas`}>Observações internas</Label>
          <Textarea
            id={`${idPrefix}-observacoes-internas`}
            value={observacoesInternas}
            onChange={(event) => onObservacoesInternasChange(event.target.value)}
            placeholder="Informações exclusivas da equipe"
            rows={3}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-observacoes-fiscais`}>Observações fiscais</Label>
          <Textarea
            id={`${idPrefix}-observacoes-fiscais`}
            value={observacoesFiscais}
            onChange={(event) => onObservacoesFiscaisChange(event.target.value)}
            placeholder="Informações destinadas à emissão fiscal"
            rows={3}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
