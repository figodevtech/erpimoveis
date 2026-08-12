"use client";

import { useState } from "react";
import type { UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import type { FormValues, ModeloPadraoFiscal, OperacaoPadraoFiscal } from "../types";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info, ShieldAlert } from "lucide-react";
import type { CRT } from "@/lib/nfe/types";

import { PadraoFiscalFields } from "./padrao-fiscal-fields";

const CLASSES_SELECT =
  "border-input bg-background ring-offset-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none";

/** Um padrão só conta como cadastrado quando tem algum valor de verdade. */
function temValor(padrao: unknown) {
  if (!padrao || typeof padrao !== "object") return false;
  return Object.values(padrao as Record<string, unknown>).some(
    (valor) => valor !== "" && valor !== null && valor !== undefined && valor !== false,
  );
}

/**
 * Pílula de troca de variante.
 *
 * É navegação, não dado: fica visualmente distinta dos campos abaixo para
 * ninguém confundir "estou editando este padrão" com "este é um valor que será
 * salvo". O ponto ao lado diz se aquela variante já tem algo cadastrado, o que
 * evita ter de clicar em cada uma para descobrir.
 */
function AbaVariante({
  ativa,
  rotulo,
  preenchida,
  onClick,
}: {
  ativa: boolean;
  rotulo: string;
  preenchida: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={`focus-visible:ring-ring inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none ${
        ativa
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-background/80"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          preenchida
            ? ativa
              ? "bg-primary-foreground"
              : "bg-emerald-500"
            : ativa
              ? "bg-primary-foreground/40"
              : "bg-muted-foreground/40"
        }`}
      />
      {rotulo}
      <span className="sr-only">{preenchida ? " — configurado" : " — sem padrão"}</span>
    </button>
  );
}

export function NFeTab({
  register,
  setValue,
  watch,
}: {
  register: UseFormRegister<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  watch?: UseFormWatch<FormValues>;
}) {
  const nfceConfigurada = watch?.("nfe.nfceConfigurada") ?? false;
  /** Só a versão 2 do QR Code depende de CSC. */
  const usaCsc = String(watch?.("nfe.qrCodeVersao") ?? "3") === "2";

  const [modeloPadrao, setModeloPadrao] = useState<ModeloPadraoFiscal>("NFE");
  const [operacaoPadrao, setOperacaoPadrao] = useState<OperacaoPadraoFiscal>("SAIDA");
  const regime = Number(watch?.("empresa.regimetributario") ?? 0);
  const crt = ([1, 2, 3, 4] as number[]).includes(regime) ? (regime as CRT) : null;
  // A NFC-e não é documento de entrada; o seletor de operação some no modelo 65
  // para ninguém cadastrar um padrão que nunca vai ser lido.
  const operacaoAtiva: OperacaoPadraoFiscal =
    modeloPadrao === "NFCE" ? "SAIDA" : operacaoPadrao;

  const padroes = watch?.("nfe.padroesFiscais");
  const temNfeSaida = temValor(padroes?.NFE?.SAIDA);
  const temNfeSaidaNaoVenda = temValor(padroes?.NFE?.SAIDA_NAO_VENDA);
  const temNfeEntrada = temValor(padroes?.NFE?.ENTRADA);
  // Sem padrão próprio, a NFC-e aproveita o de saída da NF-e. Vale avisar: o
  // campo em branco aqui não significa item sem tributação na emissão.
  const temNfceSaida = temValor(padroes?.NFCE?.SAIDA);

  return (
    <Card className="border-primary/10 bg-card/80 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <CardContent className="p-5 sm:p-6 space-y-8">
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">NF-e · modelo 55</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label className="mb-2 block">Série</Label>
              <Input {...register("nfe.serieNFe")} placeholder="Ex.: 1" inputMode="numeric" />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-2 block">Natureza da operação</Label>
              <Input
                {...register("nfe.naturezaOperacao")}
                placeholder="Ex.: Venda de mercadoria"
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 border-t pt-6">
          <h3 className="text-sm font-semibold">NFC-e · modelo 65</h3>

          {!nfceConfigurada ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-600" />
              Esta empresa ainda não tem configuração de NFC-e. Rode a migration fiscal antes de
              preencher os campos abaixo.
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label className="mb-2 block">Série</Label>
              <Input {...register("nfe.serieNFCe")} placeholder="Ex.: 1" inputMode="numeric" />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-2 block">Natureza da operação</Label>
              <Input
                {...register("nfe.naturezaOperacaoNFCe")}
                placeholder="Ex.: Venda ao consumidor"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="mb-2 block">Leiaute do QR Code</Label>
            <select className={CLASSES_SELECT} {...register("nfe.qrCodeVersao")}>
              <option value="3">Versão 3 — atual, dispensa CSC (NT 2025.001)</option>
              <option value="2">Versão 2 — legada, exige CSC</option>
            </select>
            <p className="text-muted-foreground text-xs">
              A versão 3 está em produção na SVRS — autorizadora da NFC-e na Paraíba — desde
              01/09/2025 e não usa CSC nem ID do CSC, nem na emissão normal nem na contingência.
              A versão 2 segue aceita e fica disponível apenas para compatibilidade.
            </p>
          </div>

          <div
            className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${usaCsc ? "" : "opacity-60"}`}
          >
            <p className="text-muted-foreground text-xs sm:col-span-2">
              {usaCsc
                ? "Obrigatórios na versão 2 do QR Code."
                : "Não são usados na versão 3 — deixe em branco, a menos que precise voltar para a versão 2."}
            </p>
            <div>
              <Label className="mb-2 block">CSC · Homologação</Label>
              <Input
                {...register("nfe.cscHomologacao")}
                placeholder="Código de Segurança do Contribuinte"
                autoComplete="off"
              />
            </div>
            <div>
              <Label className="mb-2 block">ID do CSC · Homologação</Label>
              <Input
                {...register("nfe.idCscHomologacao")}
                placeholder="Ex.: 000001"
                inputMode="numeric"
              />
            </div>
            <div>
              <Label className="mb-2 block">CSC · Produção</Label>
              <Input
                {...register("nfe.cscProducao")}
                placeholder="Código de Segurança do Contribuinte"
                autoComplete="off"
              />
            </div>
            <div>
              <Label className="mb-2 block">ID do CSC · Produção</Label>
              <Input
                {...register("nfe.idCscProducao")}
                placeholder="Ex.: 000001"
                inputMode="numeric"
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 border-t pt-6">
          <div>
            <h3 className="text-sm font-semibold">Padrão fiscal dos itens</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              Preenche na emissão o que o cadastro do produto deixou em branco, para o mesmo perfil
              tributário não ser redigitado item a item. Produto com o campo preenchido continua
              vencendo — é assim que a exceção (peça monofásica, por exemplo) sobrevive. NCM e CEST
              ficam de fora: são do item, não do perfil.
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              <strong className="text-foreground">Saída (venda)</strong> vale para venda, PDV,
              peça aplicada em OS e NF-e avulsa.{" "}
              <strong className="text-foreground">Saída (não venda)</strong> vale para a saída de
              estoque — devolução de compra, remessa para conserto, retorno e garantia —, que não
              é fato gerador de venda e por isso tem perfil próprio.{" "}
              <strong className="text-foreground">Entrada</strong> vale para a NF-e de compra.
            </p>
          </div>

          <div className="bg-muted/40 flex flex-wrap items-center gap-1 rounded-xl border p-1">
            <AbaVariante
              ativa={modeloPadrao === "NFE" && operacaoAtiva === "SAIDA"}
              rotulo="NF-e · saída (venda)"
              preenchida={temNfeSaida}
              onClick={() => {
                setModeloPadrao("NFE");
                setOperacaoPadrao("SAIDA");
              }}
            />
            <AbaVariante
              ativa={modeloPadrao === "NFE" && operacaoAtiva === "SAIDA_NAO_VENDA"}
              rotulo="NF-e · saída (não venda)"
              preenchida={temNfeSaidaNaoVenda}
              onClick={() => {
                setModeloPadrao("NFE");
                setOperacaoPadrao("SAIDA_NAO_VENDA");
              }}
            />
            <AbaVariante
              ativa={modeloPadrao === "NFE" && operacaoAtiva === "ENTRADA"}
              rotulo="NF-e · entrada"
              preenchida={temNfeEntrada}
              onClick={() => {
                setModeloPadrao("NFE");
                setOperacaoPadrao("ENTRADA");
              }}
            />
            <AbaVariante
              ativa={modeloPadrao === "NFCE"}
              rotulo="NFC-e · saída"
              preenchida={temNfceSaida}
              onClick={() => setModeloPadrao("NFCE")}
            />
          </div>

          {modeloPadrao === "NFCE" && !temNfceSaida ? (
            <div className="flex items-start gap-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
              <span>
                Enquanto estes campos ficarem em branco, a NFC-e usa o padrão de{" "}
                <strong>saída (venda) da NF-e</strong> — o perfil tributário da mercadoria é o
                mesmo nos dois modelos. Preencha aqui só o que precisar ser diferente; na emissão,
                o que veio da NF-e aparece marcado como <em>padrão NF-e</em>.
              </span>
            </div>
          ) : null}

          {modeloPadrao === "NFE" && operacaoAtiva === "SAIDA_NAO_VENDA" && !temNfeSaidaNaoVenda ? (
            <div className="flex items-start gap-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
              <span>
                Enquanto estes campos ficarem em branco, a saída de estoque usa o padrão de{" "}
                <strong>saída (venda)</strong> — é o que já acontecia antes desta separação
                existir, e é melhor que emitir sem tributação nenhuma. Mas devolução e remessa não
                são venda: preencha aqui o perfil correto. Na emissão, o que veio da venda aparece
                marcado como <em>padrão de venda</em>. O CFOP não entra na conta — quem manda nele
                é a natureza fiscal escolhida na própria saída.
              </span>
            </div>
          ) : null}

          {watch ? (
            <PadraoFiscalFields
              register={register}
              setValue={setValue}
              watch={watch}
              modelo={modeloPadrao}
              operacao={operacaoAtiva}
              crt={crt}
            />
          ) : null}
        </section>

        <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
          <Info className="text-primary mt-0.5 h-4 w-4" />
          <span>
            O ambiente fiscal (produção ou homologação) é único e fica na aba{" "}
            <strong>Empresa</strong>. Trocar lá muda NF-e e NFC-e ao mesmo tempo.
          </span>
        </div>

        <div className="flex items-start gap-2 rounded-lg border p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 text-primary" />
          <span>
            NF-e e NFC-e têm séries e contadores independentes. Na versão 3 do QR Code o CSC não é
            usado em nenhum momento. Se você voltar para a versão 2, o CSC é exibido mascarado por
            segurança — deixe como está para manter o que já está gravado, ou cole o código novo
            por cima; produção e homologação usam CSCs diferentes, e trocar um pelo outro invalida
            o QR Code das notas emitidas.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
