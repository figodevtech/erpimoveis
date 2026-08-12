"use client";

import type { UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { identificarModeloEmissao } from "@/lib/services/fiscais/nfse-service";
import type { ModeloEmissao } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types";

import type { FormValues } from "../types";

function rotuloModeloFiscal(modelo: ModeloEmissao) {
  if (modelo === "NACIONAL") return "NFS-e Nacional (MEI)";
  if (modelo === "MUNICIPAL_CABEDELO") return "NFS-e Cabedelo";
  return "NFS-e João Pessoa";
}

function Campo({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <Label className="text-xs font-normal">{label}</Label>
      {children}
      {hint ? (
        <p className="text-muted-foreground text-[11px] leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Padrão fiscal da NFS-e: os códigos que já vêm preenchidos na emissão.
 *
 * O modelo não é escolhido aqui — quem determina é o município e o regime da
 * empresa, via `identificarModeloEmissao`. Deixar o operador escolher abriria a
 * porta para cadastrar o padrão de um modelo que a empresa não emite.
 */
export function PadraoNFSeFields({
  register,
  setValue,
  watch,
}: {
  register: UseFormRegister<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  watch: UseFormWatch<FormValues>;
}) {
  const modelo = identificarModeloEmissao({
    codigomunicipio: watch("empresa.codigomunicipio"),
    regimetributario: watch("empresa.regimetributario"),
  });

  if (!modelo) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <p className="text-muted-foreground text-sm">
          Preencha o código IBGE do município e o regime tributário em{" "}
          <strong className="text-foreground">Configurações › Empresa</strong> para cadastrar o
          padrão: são eles que determinam qual NFS-e a empresa emite.
        </p>
      </div>
    );
  }

  const base = `nfse.padroesEmissao.${modelo}` as const;
  /**
   * Selects não funcionam com `register`; leem e escrevem pelo formulário.
   * O caminho é montado em runtime a partir do modelo, então o tipo do campo
   * não sobrevive à indexação — daí o cast.
   */
  const seletor = (campo: string) => {
    const caminho = `${base}.${campo}` as never;
    return {
      value: (watch(caminho) as unknown as string | undefined) ?? "",
      onValueChange: (valor: string) => setValue(caminho, valor as never),
    };
  };

  return (
    <div className="space-y-4">
      <div className="bg-muted/40 inline-flex flex-wrap items-center gap-2 rounded-xl border px-3 py-1.5">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
        <span className="text-xs font-medium">{rotuloModeloFiscal(modelo)}</span>
        <span className="text-muted-foreground text-[11px]">
          determinado pelo município e pelo regime da empresa
        </span>
      </div>

      {modelo === "NACIONAL" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Código de Tributação Nacional do ISS">
            <Input
              {...register(`${base}.codigoTributacaoNacionalIss`)}
              placeholder="Ex.: 140101"
              inputMode="numeric"
              maxLength={12}
            />
          </Campo>
          <Campo label="Alíquota do ISS (%)">
            <Input
              {...register(`${base}.aliquotaIss`)}
              placeholder="Quando exigida"
              inputMode="decimal"
            />
          </Campo>
          <Campo label="Tributação do ISS">
            <Select {...seletor("tributacaoIss")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Operação tributável</SelectItem>
                <SelectItem value="2">Imunidade</SelectItem>
                <SelectItem value="3">Exportação de serviço</SelectItem>
                <SelectItem value="4">Não incidência</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Retenção do ISS">
            <Select {...seletor("tipoRetencaoIss")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Não retido</SelectItem>
                <SelectItem value="2">Retido pelo tomador</SelectItem>
                <SelectItem value="3">Retido pelo intermediário</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="CST do IBS/CBS">
            <Input
              {...register(`${base}.ibsCbsSituacaoTributaria`)}
              placeholder="3 dígitos"
              inputMode="numeric"
              maxLength={3}
            />
          </Campo>
          <Campo label="Classificação Tributária do IBS/CBS">
            <Input
              {...register(`${base}.ibsCbsClassificacaoTributaria`)}
              placeholder="6 dígitos"
              inputMode="numeric"
              maxLength={6}
            />
          </Campo>
          <Campo label="Código NBS" className="sm:col-span-2">
            <Input
              {...register(`${base}.codigoNbs`)}
              placeholder="9 dígitos, quando aplicável"
              inputMode="numeric"
              maxLength={14}
            />
          </Campo>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Item da Lista de Serviço">
            <Input {...register(`${base}.itemListaServico`)} placeholder="Ex.: 14.01" maxLength={8} />
          </Campo>
          <Campo label="CNAE">
            <Input
              {...register(`${base}.codigoCnae`)}
              placeholder={modelo === "MUNICIPAL_JOAO_PESSOA" ? "9 dígitos" : "7 a 9 dígitos"}
              inputMode="numeric"
              maxLength={12}
            />
          </Campo>
          <Campo label="Natureza da operação">
            <Select {...seletor("naturezaOperacao")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Tributação no município</SelectItem>
                <SelectItem value="2">Tributação fora do município</SelectItem>
                <SelectItem value="3">Isenção</SelectItem>
                <SelectItem value="4">Imunidade</SelectItem>
                <SelectItem value="5">Exigibilidade suspensa — decisão judicial</SelectItem>
                <SelectItem value="6">Exigibilidade suspensa — processo administrativo</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="ISS retido">
            <Select {...seletor("issRetido")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="false">Não</SelectItem>
                <SelectItem value="true">Sim</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Alíquota do ISS (%)">
            <Input
              {...register(`${base}.aliquotaIss`)}
              placeholder="Ex.: 3,00"
              inputMode="decimal"
            />
          </Campo>
          <Campo label="Código NBS">
            <Input
              {...register(`${base}.codigoNbs`)}
              placeholder="9 dígitos, quando aplicável"
              inputMode="numeric"
              maxLength={14}
            />
          </Campo>
        </div>
      )}
    </div>
  );
}
