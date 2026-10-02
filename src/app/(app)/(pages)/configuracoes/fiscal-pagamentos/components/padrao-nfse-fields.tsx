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
import {
  dataDoDiaNFSe,
  modelosPossiveisNFSe,
  resolverPoliticaNFSe,
  rotuloModeloNFSe,
} from "@/lib/services/fiscais/nfse-politica";
import type { ModeloEmissao } from "@/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types";

import type { FormValues } from "../types";

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

type Opcoes = Array<[string, string]>;

/**
 * Padrão fiscal da NFS-e: os códigos que já vêm preenchidos na emissão.
 *
 * O modelo não é escolhido aqui — quem determina é a política de emissão
 * (município, regime, data e item de serviço). Durante a transição de João
 * Pessoa a empresa pode precisar de dois padrões: o Nacional, para a operação
 * comum, e o municipal, que segue valendo para os itens de exceção.
 *
 * Nenhum código do padrão municipal é copiado para o Nacional: CNAE, item da
 * LC 116 e código de serviço municipal não são os códigos da DPS.
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
  const empresa = {
    codigomunicipio: watch("empresa.codigomunicipio"),
    regimetributario: watch("empresa.regimetributario"),
  };
  const hoje = dataDoDiaNFSe(new Date());
  const modelos = modelosPossiveisNFSe(empresa, hoje);

  if (modelos.length === 0) {
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

  const politicaComum = resolverPoliticaNFSe({
    codigoMunicipio: empresa.codigomunicipio,
    regimeTributario: empresa.regimetributario,
    dataCompetencia: hoje,
  });

  return (
    <div className="space-y-6">
      {modelos.map((modelo) => (
        <PadraoDoModelo
          key={modelo}
          modelo={modelo}
          principal={modelo === politicaComum?.modelo}
          exigeRtc={modelo === "NACIONAL" && Boolean(politicaComum?.exigeRtc)}
          regimeTributario={String(empresa.regimetributario ?? "")}
          register={register}
          setValue={setValue}
          watch={watch}
        />
      ))}
    </div>
  );
}

function PadraoDoModelo({
  modelo,
  principal,
  exigeRtc,
  regimeTributario,
  register,
  setValue,
  watch,
}: {
  modelo: ModeloEmissao;
  principal: boolean;
  exigeRtc: boolean;
  regimeTributario: string;
  register: UseFormRegister<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  watch: UseFormWatch<FormValues>;
}) {
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
  const select = (campo: string, opcoes: Opcoes) => (
    <Select {...seletor(campo)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Selecione..." />
      </SelectTrigger>
      <SelectContent>
        {opcoes.map(([valor, rotulo]) => (
          <SelectItem key={valor} value={valor}>{rotulo}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const obrigatorioRtc = exigeRtc ? " (obrigatório)" : "";
  const simplesMeEpp = regimeTributario === "1" || regimeTributario === "2";

  return (
    <section className="space-y-4">
      <div className="bg-muted/40 inline-flex flex-wrap items-center gap-2 rounded-xl border px-3 py-1.5">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${principal ? "bg-emerald-500" : "bg-amber-500"}`}
        />
        <span className="text-xs font-medium">{rotuloModeloNFSe(modelo)}</span>
        <span className="text-muted-foreground text-[11px]">
          {principal
            ? "usado na emissão comum — determinado pelo município, pelo regime e pela data"
            : "só para os itens 01.03, 01.05, 01.09 e 16.01, ainda aceitos pelo emissor municipal"}
        </span>
      </div>

      {modelo === "NACIONAL" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Código de Tributação Nacional do ISS" hint="6 dígitos da lista nacional (cTribNac).">
            <Input
              {...register(`${base}.codigoTributacaoNacionalIss`)}
              placeholder="6 dígitos"
              inputMode="numeric"
              maxLength={12}
            />
          </Campo>
          <Campo
            label="Código de Tributação Municipal"
            hint="cTribMun, 3 dígitos, só quando o município exige. Não é o código do emissor municipal antigo."
          >
            <Input
              {...register(`${base}.codigoTributacaoMunicipalIss`)}
              placeholder="3 dígitos, quando aplicável"
              inputMode="numeric"
              maxLength={3}
            />
          </Campo>
          <Campo label="Código NBS" hint="9 dígitos (cNBS).">
            <Input
              {...register(`${base}.codigoNbs`)}
              placeholder="9 dígitos"
              inputMode="numeric"
              maxLength={14}
            />
          </Campo>
          <Campo
            label="Alíquota do ISS (%)"
            hint="Município conveniado ao Sistema Nacional já tem a alíquota parametrizada: deixe em branco, salvo orientação contrária."
          >
            <Input
              {...register(`${base}.aliquotaIss`)}
              placeholder="Em branco = parametrizada"
              inputMode="decimal"
            />
          </Campo>
          <Campo label="Tributação do ISS">
            {select("tributacaoIss", [
              ["1", "Operação tributável"],
              ["2", "Imunidade"],
              ["3", "Exportação de serviço"],
              ["4", "Não incidência"],
            ])}
          </Campo>
          <Campo label="Retenção do ISS">
            {select("tipoRetencaoIss", [
              ["1", "Não retido"],
              ["2", "Retido pelo tomador"],
              ["3", "Retido pelo intermediário"],
            ])}
          </Campo>
          <Campo label="Regime especial de tributação municipal" hint="Em branco, a DPS vai com 0 — Nenhum.">
            {select("regimeEspecialTributacao", [
              ["0", "Nenhum"],
              ["1", "Ato cooperado (cooperativa)"],
              ["2", "Estimativa"],
              ["3", "Microempresa municipal"],
              ["4", "Notário ou registrador"],
              ["5", "Profissional autônomo"],
              ["6", "Sociedade de profissionais"],
              ["9", "Outros"],
            ])}
          </Campo>
          {simplesMeEpp ? (
            <Campo
              label="Regime de apuração do Simples Nacional"
              hint={regimeTributario === "2"
                ? "Obrigatório para CRT 2 (excesso de sublimite)."
                : "Em branco, vale 1: tributos federais e ISS dentro do Simples."}
            >
              {select("regimeApuracaoSimplesNacional", [
                ["1", "Federais e ISS pelo Simples Nacional"],
                ["2", "Federais pelo Simples, ISS por fora"],
                ["3", "Federais e ISS por fora do Simples"],
              ])}
            </Campo>
          ) : null}

          <p className="text-muted-foreground text-[11px] leading-snug sm:col-span-2">
            Grupo IBS/CBS — Reforma Tributária{obrigatorioRtc}. Os códigos vêm das tabelas
            oficiais da Reforma; confirme com a contabilidade antes de cadastrar.
          </p>
          <Campo label={`Finalidade da emissão${obrigatorioRtc}`}>
            {select("finalidadeEmissao", [["0", "NFS-e regular"]])}
          </Campo>
          <Campo label={`Operação de uso ou consumo pessoal${obrigatorioRtc}`}>
            {select("consumidorFinal", [["0", "Não"], ["1", "Sim"]])}
          </Campo>
          <Campo label={`Destinatário do serviço${obrigatorioRtc}`}>
            {select("indicadorDestinatario", [["0", "O próprio tomador"]])}
          </Campo>
          <Campo label={`Código indicador da operação (cIndOp)${obrigatorioRtc}`}>
            <Input
              {...register(`${base}.codigoIndicadorOperacao`)}
              placeholder="6 dígitos"
              inputMode="numeric"
              maxLength={6}
            />
          </Campo>
          <Campo label={`CST do IBS/CBS${obrigatorioRtc}`}>
            <Input
              {...register(`${base}.ibsCbsSituacaoTributaria`)}
              placeholder="3 dígitos"
              inputMode="numeric"
              maxLength={3}
            />
          </Campo>
          <Campo label={`Classificação Tributária do IBS/CBS (cClassTrib)${obrigatorioRtc}`}>
            <Input
              {...register(`${base}.ibsCbsClassificacaoTributaria`)}
              placeholder="6 dígitos"
              inputMode="numeric"
              maxLength={6}
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
            {select("naturezaOperacao", [
              ["1", "Tributação no município"],
              ["2", "Tributação fora do município"],
              ["3", "Isenção"],
              ["4", "Imunidade"],
              ["5", "Exigibilidade suspensa — decisão judicial"],
              ["6", "Exigibilidade suspensa — processo administrativo"],
            ])}
          </Campo>
          <Campo label="ISS retido">
            {select("issRetido", [["false", "Não"], ["true", "Sim"]])}
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
    </section>
  );
}
