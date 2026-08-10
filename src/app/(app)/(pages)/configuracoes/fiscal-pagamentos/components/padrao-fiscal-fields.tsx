"use client";

import type { UseFormRegister, UseFormWatch } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getNFeFiscalFieldRules, PIS_COFINS_CST_OPTIONS } from "@/lib/nfe/taxRules";
import {
  CSOSN_DESCRICOES,
  CST_ICMS_DESCRICOES,
  ORIGENS_MERCADORIA,
} from "@/lib/nfe/rotulosFiscais";
import type { CRT } from "@/lib/nfe/types";

import type { FormValues, ModeloPadraoFiscal, OperacaoPadraoFiscal } from "../types";

const CLASSES_SELECT =
  "border-input bg-background ring-offset-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

const MODOS = [
  ["", "—"],
  ["PERCENTUAL", "Percentual sobre a base"],
  ["QUANTIDADE", "Valor por unidade"],
  ["NAO_TRIBUTADO", "Não tributado"],
] as const;

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
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-[11px] leading-snug">{hint}</p> : null}
    </div>
  );
}

/**
 * Formulário de um conjunto de padrões (um modelo × uma operação).
 *
 * Todo campo é opcional: o que ficar em branco continua vindo do cadastro do
 * produto ou sendo digitado na emissão. O que o padrão não faz é sobrescrever —
 * produto preenchido sempre vence.
 */
export function PadraoFiscalFields({
  register,
  watch,
  modelo,
  operacao,
  crt,
}: {
  register: UseFormRegister<FormValues>;
  watch: UseFormWatch<FormValues>;
  modelo: ModeloPadraoFiscal;
  operacao: OperacaoPadraoFiscal;
  crt: CRT | null;
}) {
  const base = `nfe.padroesFiscais.${modelo}.${operacao}` as const;
  const regras = crt ? getNFeFiscalFieldRules(crt) : null;
  const usaCsosn = regras?.icms.csosn === "REQUIRED";
  const rtcLigado = Boolean(watch(`${base}.rtc_habilitado`));

  const cstsSaida = PIS_COFINS_CST_OPTIONS.filter((opcao) =>
    operacao === "ENTRADA" ? opcao.operation !== "SAIDA" : opcao.operation !== "ENTRADA",
  );

  if (!regras) {
    return (
      <p className="text-muted-foreground text-sm">
        Defina o regime tributário na aba <strong>Empresa</strong> antes de cadastrar o padrão: é
        ele que decide entre CSOSN e CST de ICMS.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Campo label="Origem da mercadoria" hint="Obrigatória no XML; quase nenhum produto tem.">
          <select className={CLASSES_SELECT} {...register(`${base}.origem_mercadoria`)}>
            <option value="">—</option>
            {ORIGENS_MERCADORIA.map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {valor} · {rotulo}
              </option>
            ))}
          </select>
        </Campo>

        <Campo
          label="CFOP"
          hint="O primeiro dígito é ajustado sozinho conforme a UF do destinatário."
        >
          <Input
            {...register(`${base}.cfop`)}
            placeholder={operacao === "ENTRADA" ? "Ex.: 1102" : "Ex.: 5102"}
            inputMode="numeric"
          />
        </Campo>

        {usaCsosn ? (
          <Campo label="CSOSN">
            <select className={CLASSES_SELECT} {...register(`${base}.csosn`)}>
              <option value="">—</option>
              {regras.icms.csosnPermitidos.map((codigo) => (
                <option key={codigo} value={codigo}>
                  {codigo} · {CSOSN_DESCRICOES[codigo] ?? ""}
                </option>
              ))}
            </select>
          </Campo>
        ) : (
          <Campo label="CST de ICMS">
            <select className={CLASSES_SELECT} {...register(`${base}.cst`)}>
              <option value="">—</option>
              {regras.icms.cstPermitidos.map((codigo) => (
                <option key={codigo} value={codigo}>
                  {codigo} · {CST_ICMS_DESCRICOES[codigo] ?? ""}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <Campo label="Alíquota de ICMS (%)">
          <Input {...register(`${base}.aliquotaicms`)} placeholder="Ex.: 18" inputMode="decimal" />
        </Campo>
      </div>

      {(["pis", "cofins"] as const).map((tributo) => (
        <div key={tributo} className="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-4">
          <Campo label={`CST de ${tributo.toUpperCase()}`}>
            <select className={CLASSES_SELECT} {...register(`${base}.cst_${tributo}`)}>
              <option value="">—</option>
              {cstsSaida.map((opcao) => (
                <option key={opcao.value} value={opcao.value}>
                  {opcao.value} · {opcao.description}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Modo de cálculo" hint="Alguns CSTs já definem o modo sozinhos.">
            <select className={CLASSES_SELECT} {...register(`${base}.modo_${tributo}`)}>
              {MODOS.map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </Campo>

          <Campo label="Alíquota (%)">
            <Input
              {...register(`${base}.aliquota_${tributo}`)}
              placeholder={tributo === "pis" ? "Ex.: 1,65" : "Ex.: 7,60"}
              inputMode="decimal"
            />
          </Campo>

          <Campo label="Valor por unidade">
            <Input
              {...register(`${base}.aliquota_por_unidade_${tributo}`)}
              placeholder="Só no modo por quantidade"
              inputMode="decimal"
            />
          </Campo>
        </div>
      ))}

      <div className="space-y-4 border-t pt-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" {...register(`${base}.rtc_habilitado`)} />
          Destacar IBS/CBS nos itens
        </label>

        {rtcLigado ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-5">
            <Campo label="CST IBS/CBS">
              <Input {...register(`${base}.cst_ibscbs`)} placeholder="Ex.: 000" inputMode="numeric" />
            </Campo>
            <Campo label="cClassTrib" hint="Conferido na tabela oficial vigente ao salvar.">
              <Input
                {...register(`${base}.cclass_trib`)}
                placeholder="Ex.: 000001"
                inputMode="numeric"
              />
            </Campo>
            <Campo label="IBS UF (%)">
              <Input {...register(`${base}.aliquota_ibs_uf`)} inputMode="decimal" />
            </Campo>
            <Campo label="IBS Município (%)">
              <Input {...register(`${base}.aliquota_ibs_municipio`)} inputMode="decimal" />
            </Campo>
            <Campo label="CBS (%)">
              <Input {...register(`${base}.aliquota_cbs`)} inputMode="decimal" />
            </Campo>
          </div>
        ) : null}
      </div>
    </div>
  );
}
