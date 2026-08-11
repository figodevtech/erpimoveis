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
import { Switch } from "@/components/ui/switch";
import { getNFeFiscalFieldRules, PIS_COFINS_CST_OPTIONS } from "@/lib/nfe/taxRules";
import {
  CSOSN_DESCRICOES,
  CST_ICMS_DESCRICOES,
  ORIGENS_MERCADORIA,
} from "@/lib/nfe/rotulosFiscais";
import type { CRT } from "@/lib/nfe/types";

import type { FormValues, ModeloPadraoFiscal, OperacaoPadraoFiscal } from "../types";

const MODOS = [
  { value: "PERCENTUAL", label: "Percentual sobre a base" },
  { value: "QUANTIDADE", label: "Valor por unidade" },
  { value: "NAO_TRIBUTADO", label: "Não tributado" },
] as const;

/** Título de um grupo de campos, com a régua que separa do grupo anterior. */
function Grupo({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h4 className="text-foreground text-xs font-semibold tracking-wide uppercase">{titulo}</h4>
        {descricao ? (
          <p className="text-muted-foreground text-[11px] leading-snug">{descricao}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
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

/** Grade padrão dos campos: uma coluna no celular, quatro no desktop. */
function Grade({ children, colunas = 4 }: { children: React.ReactNode; colunas?: 2 | 3 | 4 }) {
  const classe =
    colunas === 2
      ? "sm:grid-cols-2"
      : colunas === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";
  return <div className={`grid grid-cols-1 gap-4 ${classe}`}>{children}</div>;
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
  setValue,
  watch,
  modelo,
  operacao,
  crt,
}: {
  register: UseFormRegister<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  watch: UseFormWatch<FormValues>;
  modelo: ModeloPadraoFiscal;
  operacao: OperacaoPadraoFiscal;
  crt: CRT | null;
}) {
  const base = `nfe.padroesFiscais.${modelo}.${operacao}` as const;
  const regras = crt ? getNFeFiscalFieldRules(crt) : null;

  /**
   * `Select` e `Switch` não aceitam `register`. O caminho é montado em runtime
   * a partir do modelo e da operação, então o tipo do campo não sobrevive à
   * indexação — daí o cast.
   */
  const seletor = (campo: string) => {
    const caminho = `${base}.${campo}` as never;
    return {
      value: (watch(caminho) as unknown as string | undefined) ?? "",
      onValueChange: (valor: string) => setValue(caminho, valor as never),
    };
  };

  const rtcLigado = Boolean(watch(`${base}.rtc_habilitado`));

  if (!regras) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <p className="text-muted-foreground text-sm">
          Defina o regime tributário na aba <strong className="text-foreground">Empresa</strong>{" "}
          para cadastrar o padrão: é ele que decide entre CSOSN e CST de ICMS.
        </p>
      </div>
    );
  }

  const usaCsosn = regras.icms.csosn === "REQUIRED";
  const cstsDaOperacao = PIS_COFINS_CST_OPTIONS.filter((opcao) =>
    operacao === "ENTRADA" ? opcao.operation !== "SAIDA" : opcao.operation !== "ENTRADA",
  );

  return (
    <div className="space-y-6">
      <Grupo titulo="Identificação" descricao="NCM e CEST continuam vindo do produto.">
        <Grade colunas={3}>
          <Campo label="Origem da mercadoria" hint="Obrigatória no XML.">
            <Select {...seletor("origem_mercadoria")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent className="max-w-[min(32rem,calc(100vw-2rem))]">
                {ORIGENS_MERCADORIA.map(([valor, rotulo]) => (
                  <SelectItem
                    key={valor}
                    value={valor}
                    className="py-2 break-words whitespace-normal"
                  >
                    {valor} — {rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>

          <Campo label="CFOP" hint="O primeiro dígito se ajusta pela UF do destinatário.">
            <Input
              {...register(`${base}.cfop`)}
              placeholder={operacao === "ENTRADA" ? "1102" : "5102"}
              inputMode="numeric"
              maxLength={4}
            />
          </Campo>
        </Grade>
      </Grupo>

      <Grupo
        titulo="ICMS"
        descricao={usaCsosn ? "Simples Nacional usa CSOSN." : "Regime normal usa CST."}
      >
        <Grade colunas={3}>
          {usaCsosn ? (
            <Campo label="CSOSN">
              <Select {...seletor("csosn")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent className="max-w-[min(34rem,calc(100vw-2rem))]">
                  {regras.icms.csosnPermitidos.map((codigo) => (
                    <SelectItem
                      key={codigo}
                      value={codigo}
                      className="py-2 break-words whitespace-normal"
                    >
                      {codigo} — {CSOSN_DESCRICOES[codigo] ?? codigo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          ) : (
            <Campo label="CST de ICMS">
              <Select {...seletor("cst")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent className="max-w-[min(34rem,calc(100vw-2rem))]">
                  {regras.icms.cstPermitidos.map((codigo) => (
                    <SelectItem
                      key={codigo}
                      value={codigo}
                      className="py-2 break-words whitespace-normal"
                    >
                      {codigo} — {CST_ICMS_DESCRICOES[codigo] ?? codigo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>
          )}

          <Campo label="Alíquota (%)">
            <Input {...register(`${base}.aliquotaicms`)} placeholder="18" inputMode="decimal" />
          </Campo>
        </Grade>
      </Grupo>

      {(["pis", "cofins"] as const).map((tributo) => (
        <Grupo
          key={tributo}
          titulo={tributo.toUpperCase()}
          descricao="Alguns CSTs já definem o modo de cálculo sozinhos."
        >
          <Grade>
            <Campo label="CST" className="sm:col-span-2">
              <Select {...seletor(`cst_${tributo}`)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent className="max-w-[min(38rem,calc(100vw-2rem))]">
                  {cstsDaOperacao.map((opcao) => (
                    <SelectItem
                      key={opcao.value}
                      value={opcao.value}
                      className="py-2 break-words whitespace-normal"
                    >
                      {opcao.value} — {opcao.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>

            <Campo label="Modo de cálculo">
              <Select {...seletor(`modo_${tributo}`)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {MODOS.map((modo) => (
                    <SelectItem key={modo.value} value={modo.value}>
                      {modo.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Campo>

            <Campo label="Alíquota (%)">
              <Input
                {...register(`${base}.aliquota_${tributo}`)}
                placeholder={tributo === "pis" ? "1,65" : "7,60"}
                inputMode="decimal"
              />
            </Campo>

            <Campo label="Valor por unidade" hint="Só no modo por quantidade.">
              <Input
                {...register(`${base}.aliquota_por_unidade_${tributo}`)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </Campo>
          </Grade>
        </Grupo>
      ))}

      <Grupo titulo="IBS / CBS" descricao="Reforma tributária.">
        <div className="bg-muted/30 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <Label htmlFor="rtc-habilitado" className="text-sm font-medium">
              Destacar IBS/CBS nos itens
            </Label>
            <p className="text-muted-foreground mt-0.5 text-xs">
              A classificação é conferida na tabela oficial vigente ao salvar.
            </p>
          </div>
          <Switch
            id="rtc-habilitado"
            checked={rtcLigado}
            onCheckedChange={(valor) =>
              setValue(`${base}.rtc_habilitado` as never, valor as never)
            }
          />
        </div>

        {rtcLigado ? (
          <Grade>
            <Campo label="CST IBS/CBS">
              <Input
                {...register(`${base}.cst_ibscbs`)}
                placeholder="000"
                inputMode="numeric"
                maxLength={3}
              />
            </Campo>
            <Campo label="cClassTrib">
              <Input
                {...register(`${base}.cclass_trib`)}
                placeholder="000001"
                inputMode="numeric"
                maxLength={6}
              />
            </Campo>
            <Campo label="IBS UF (%)">
              <Input {...register(`${base}.aliquota_ibs_uf`)} placeholder="0,00" inputMode="decimal" />
            </Campo>
            <Campo label="IBS Município (%)">
              <Input
                {...register(`${base}.aliquota_ibs_municipio`)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </Campo>
            <Campo label="CBS (%)">
              <Input {...register(`${base}.aliquota_cbs`)} placeholder="0,00" inputMode="decimal" />
            </Campo>
          </Grade>
        ) : null}
      </Grupo>
    </div>
  );
}
