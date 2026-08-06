"use client";

import { Info, Lock } from "lucide-react";

import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import ValueInput from "@/components/ui/value-input";
import { toast } from "@/lib/toast";
import { paraCentavos } from "@/lib/financeiro/rateio";
import formatarEmReal from "@/utils/formatarEmReal";

import { useBancos } from "../../../hooks/use-bancos";
import { useCategoriasTransacao } from "../../../hooks/use-categoria-transacao";
import { useCentrosCusto } from "../../../hooks/use-centros-custo";
import { usePlanosDeConta } from "../../../hooks/use-planos-de-conta";
import { Metodo_pagamento, Tipo_transacao } from "../../../types";
import {
  origemDaTransacao,
  rotuloDaOrigem,
  tipoTemValorLiquido,
  valorLiquidoEfetivo,
} from "@/lib/financeiro/transacao";

import { formatCpfCnpj } from "../../../utils";
import { PlanoContaCombobox } from "../../plano-conta-combobox";
import { SearchCombobox } from "../../search-combobox";
import { paraValorDeInputDate, parseLocalDateTime } from "../datas";
import type { FormularioTransacao } from "../use-transacao-edicao";

interface DetalhesTabProps {
  form: FormularioTransacao;
  setCampo: <Campo extends keyof FormularioTransacao>(
    campo: Campo,
    valor: FormularioTransacao[Campo],
  ) => void;
  setForm: React.Dispatch<React.SetStateAction<FormularioTransacao | undefined>>;
  editavel: boolean;
  /** Há documento de origem, então o bruto pode ser redistribuído na aba Parcelas. */
  permiteRateio: boolean;
  /**
   * Lançamento avulso e editável: aqui não há total de documento a preservar, e
   * o bruto pode ser digitado direto. O salvamento roteia pelo ajuste de valores.
   */
  permiteEditarValor: boolean;
  /**
   * Quantos descontos a transação tem. Com um só (a taxa), o campo de líquido
   * manda nele; com mais de um, a edição sai daqui para a aba de ajustes.
   */
  descontos: number;
}

/**
 * Bloco de valores.
 *
 * O bruto é somente leitura por design: é ele que abate o total da OS/venda, e
 * mexer numa linha isolada quebraria o documento. O líquido é editável porque
 * costuma ser descoberto depois — o financeiro registra a venda antes de o
 * extrato da maquineta mostrar quanto a taxa comeu.
 *
 * Despesa e depósito não passam por maquineta: não têm líquido nem taxa, então
 * o bloco vira um campo só. Mostrar "Líquido: R$ 0,00" numa conta a pagar era
 * ruído, e ainda travava o salvamento na validação de líquido.
 */
function BlocoDeValores({
  form,
  setCampo,
  editavel,
  permiteRateio,
  permiteEditarValor,
  descontos,
}: Pick<
  DetalhesTabProps,
  | "form"
  | "setCampo"
  | "editavel"
  | "permiteRateio"
  | "permiteEditarValor"
  | "descontos"
>) {
  const bruto = Number(form.valor ?? 0);
  const temLiquido = tipoTemValorLiquido(form.tipo);

  if (!temLiquido) {
    return (
      <div className="space-y-2 sm:col-span-3 sm:max-w-xs">
        <Label htmlFor="valor-bruto" className="flex items-center gap-1.5">
          Valor
          <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
        </Label>
        <ValueInput id="valor-bruto" disabled value={bruto} />
        <p className="text-xs text-muted-foreground">
          {form.tipo === Tipo_transacao.DESPESA
            ? "Lançamentos de despesa não têm taxa de recebimento."
            : "Este tipo de lançamento não tem valor líquido."}
        </p>
      </div>
    );
  }

  const liquido = valorLiquidoEfetivo(form);
  // Havendo linha lançada, o número vem dela — é exato e diz o que era. A
  // subtração continua valendo para o que foi criado antes de existirem linhas.
  const descontosLancados = Number(form.valor_descontos ?? 0);
  const temDescontoLancado = Number.isFinite(descontosLancados) && descontosLancados > 0;
  const taxa = temDescontoLancado ? descontosLancados : Math.max(0, bruto - liquido);
  const excedeBruto = paraCentavos(liquido) > paraCentavos(bruto);
  const liquidoTravado = descontos > 1;

  return (
    <div className="grid gap-3 sm:col-span-3 sm:grid-cols-3">
      <div className="space-y-2">
        <Label htmlFor="valor-bruto" className="flex items-center gap-1.5">
          Valor bruto
          {permiteEditarValor ? null : (
            <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
          )}
        </Label>
        <ValueInput
          id="valor-bruto"
          disabled={!permiteEditarValor}
          value={bruto}
          onValueChange={
            permiteEditarValor ? (valor) => setCampo("valor", valor) : undefined
          }
        />
        <p className="text-xs text-muted-foreground">
          {permiteRateio
            ? "É o que o cliente pagou. Para redividir entre as parcelas, use a aba Parcelas."
            : permiteEditarValor
              ? "É o que o cliente pagou. Em parcelamento avulso, cada parcela é editada por conta própria."
              : "É o que o cliente pagou."}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="valor-liquido" className="flex items-center gap-1.5">
          Líquido recebido
          {liquidoTravado ? (
            <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
          ) : null}
        </Label>
        <ValueInput
          id="valor-liquido"
          disabled={!editavel || liquidoTravado}
          aria-invalid={excedeBruto}
          className={excedeBruto ? "border-destructive" : undefined}
          value={liquido}
          onValueChange={(valor) => setCampo("valorLiquido", valor)}
        />
        <p
          className={`text-xs ${excedeBruto ? "text-destructive" : "text-muted-foreground"}`}
        >
          {excedeBruto
            ? "Não pode ser maior que o bruto."
            : liquidoTravado
              ? "Há mais de um desconto. Edite pela aba Acréscimos e descontos."
              : "O que sobrou depois da taxa de recebimento."}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Descontos</Label>
        <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-sm font-medium tabular-nums">
          {taxa > 0 ? (
            <span className="text-destructive">- {formatarEmReal(taxa)}</span>
          ) : (
            <span className="text-muted-foreground">Sem desconto</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {temDescontoLancado
            ? "Somado das linhas da aba Acréscimos e descontos."
            : "Calculado: bruto menos líquido."}
        </p>
      </div>
    </div>
  );
}

export function DetalhesTab({
  form,
  setCampo,
  setForm,
  editavel,
  permiteRateio,
  permiteEditarValor,
  descontos,
}: DetalhesTabProps) {
  // Vem das colunas de vínculo da própria transação, não do contexto: o
  // contexto é uma consulta separada e pode ainda estar carregando.
  const origem = origemDaTransacao(form);
  const { bancos, loadingBancos, errorBancos } = useBancos();
  const { categorias, loadingCategorias, errorCategorias } = useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto, errorCentrosCusto } = useCentrosCusto();

  const rotuloLancamentoFuturo =
    form.tipo === Tipo_transacao.RECEITA
      ? "LANÇAMENTO A RECEBER"
      : form.tipo === Tipo_transacao.DESPESA
        ? "LANÇAMENTO A PAGAR"
        : null;

  const alterarData = (valor: string) => {
    const selecionada = valor ? parseLocalDateTime(`${valor}T00:00`) : undefined;

    if (!selecionada) {
      setCampo("data", undefined);
      return;
    }

    const agora = new Date();

    if (!form.pendente && selecionada.getTime() > agora.getTime()) {
      toast.warning("Uma transação já realizada não pode ter data futura.");
      return;
    }

    if (form.pendente && selecionada.getTime() < agora.getTime()) {
      toast.warning("Um lançamento a vencer não pode ter data passada.");
      return;
    }

    setCampo("data", selecionada);
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="w-full space-y-2">
          <Label htmlFor="tipo" className="flex items-center gap-1.5">
            Tipo <span className="text-red-500">*</span>
            {origem ? (
              <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
            ) : null}
          </Label>
          <Select
            disabled={!editavel || !!origem}
            value={form.tipo}
            onValueChange={(valor) => setCampo("tipo", valor as Tipo_transacao)}
          >
            <SelectTrigger id="tipo" className="w-full">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {Object.values(Tipo_transacao).map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {origem ? (
            <p className="text-xs text-muted-foreground">
              Gerada por {rotuloDaOrigem(origem)}: trocar o tipo faria o documento
              perder o lançamento.
            </p>
          ) : null}
        </div>

        <div className="w-full space-y-2">
          <Label htmlFor="metodopagamento">Método de pagamento</Label>
          <Select
            disabled={!editavel}
            value={form.metodopagamento || ""}
            onValueChange={(valor) =>
              setCampo("metodopagamento", valor as Metodo_pagamento)
            }
          >
            <SelectTrigger id="metodopagamento" className="w-full">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {Object.values(Metodo_pagamento).map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Somente leitura: quem muda isso é a baixa, não a edição. */}
        <div className="w-full space-y-2">
          <Label htmlFor="pendente" className="flex items-center gap-1.5">
            Lançamento futuro
            <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
          </Label>
          <div className="flex items-center gap-2">
            <Switch
              id="pendente"
              disabled
              aria-readonly
              checked={form.pendente || false}
            />
            {rotuloLancamentoFuturo ? (
              <span
                className={`flex items-center gap-1 text-xs text-muted-foreground ${
                  form.pendente ? "opacity-100" : "opacity-50"
                }`}
              >
                <Info className="h-3 w-3" aria-hidden />
                {rotuloLancamentoFuturo}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {form.pendente
              ? "Use a ação “Pago” para dar baixa — ela registra data, autor e histórico."
              : "Já baixada. Para desfazer, exclua o lançamento e registre de novo."}
          </p>
        </div>

        <BlocoDeValores
          form={form}
          setCampo={setCampo}
          editavel={editavel}
          permiteRateio={permiteRateio}
          permiteEditarValor={permiteEditarValor}
          descontos={descontos}
        />

        <div className="w-full space-y-2">
          <Label htmlFor="banco">Banco</Label>
          <SearchCombobox
            disabled={!editavel || !!errorBancos}
            loading={loadingBancos}
            value={form.banco_id?.toString() || ""}
            onValueChange={(valor) => {
              const bancoId = Number(valor);
              const banco = bancos.find((item) => item.id === bancoId);
              setForm((atual) =>
                atual ? { ...atual, banco_id: bancoId, banco: banco ?? atual.banco } : atual,
              );
            }}
            placeholder={errorBancos ?? "Selecione"}
            searchPlaceholder="Pesquisar banco ou conta..."
            emptyMessage="Nenhum banco encontrado."
            options={bancos.map((banco) => ({
              value: String(banco.id),
              label: banco.titulo,
              description: [
                banco.tipo,
                banco.agencia && `Ag. ${banco.agencia}`,
                banco.contanumero && `Conta ${banco.contanumero}`,
              ]
                .filter(Boolean)
                .join(" · "),
              searchText: `${banco.proprietario ?? ""} ${banco.tipo ?? ""}`,
            }))}
          />
        </div>

        <div className="w-full space-y-2">
          <Label htmlFor="categoria">Categoria</Label>
          <SearchCombobox
            disabled={!editavel || !!errorCategorias}
            loading={loadingCategorias}
            value={form.categoria}
            onValueChange={(valor) => {
              const categoria = categorias.find((item) => item.nome === valor);
              setForm((atual) =>
                atual
                  ? { ...atual, categoria: valor, categoria_id: categoria?.id ?? null }
                  : atual,
              );
            }}
            placeholder={errorCategorias ? "Erro ao carregar" : "Selecione"}
            searchPlaceholder="Pesquisar categoria..."
            emptyMessage="Nenhuma categoria encontrada."
            options={categorias.map((categoria) => ({
              value: categoria.nome,
              label: categoria.nome,
              description: categoria.descricao ?? undefined,
            }))}
          />
        </div>

        <div className="w-full space-y-2">
          <Label htmlFor="plano-de-conta">Plano de conta</Label>
          <PlanoContaCombobox
            disabled={!editavel}
            loading={loadingPlanos}
            groups={gruposPlanosDeConta}
            value={form.plano_de_conta_id?.toString() || ""}
            onValueChange={(_, selecionado) => {
              setForm((atual) =>
                atual
                  ? {
                      ...atual,
                      plano_de_conta_id: selecionado.id,
                      plano_de_conta: selecionado.nome,
                    }
                  : atual,
              );
            }}
            placeholder={form.plano_de_conta || "Selecione"}
          />
        </div>

        <div className="w-full space-y-2">
          <Label htmlFor="centro-custo">Centro de custo</Label>
          <SearchCombobox
            disabled={!editavel || !!errorCentrosCusto}
            loading={loadingCentrosCusto}
            value={form.centro_custo_id?.toString() || ""}
            onValueChange={(valor) => {
              const selecionado = centrosCusto.find((item) => String(item.id) === valor);
              setForm((atual) =>
                atual
                  ? {
                      ...atual,
                      centro_custo_id: selecionado?.id ?? null,
                      centro_custo: selecionado?.nome ?? null,
                    }
                  : atual,
              );
            }}
            placeholder={
              errorCentrosCusto ? "Erro ao carregar" : form.centro_custo || "Selecione"
            }
            searchPlaceholder="Pesquisar centro de custo..."
            emptyMessage="Nenhum centro de custo encontrado."
            options={centrosCusto.map((centro) => ({
              value: String(centro.id),
              label: centro.nome,
              description: centro.descricao ?? undefined,
            }))}
          />
        </div>

        <div className="w-full space-y-2 sm:col-span-3">
          <Label htmlFor="data">
            {form.pendente ? "Data de vencimento" : "Data do pagamento"}
          </Label>
          <DatePicker
            disabled={!editavel}
            value={paraValorDeInputDate(form.data)}
            className="w-full sm:max-w-xs"
            min={form.pendente ? paraValorDeInputDate(new Date()) : undefined}
            max={!form.pendente ? paraValorDeInputDate(new Date()) : undefined}
            onChange={alterarData}
          />
        </div>

        <div className="w-full space-y-2 sm:col-span-3">
          <Label htmlFor="descricao">
            Descrição <span className="text-red-500">*</span>
          </Label>
          <Input
            id="descricao"
            disabled={!editavel}
            value={form.descricao || ""}
            onChange={(evento) => setCampo("descricao", evento.target.value)}
            placeholder="Descrição"
          />
        </div>

        <div className="w-full space-y-2 sm:col-span-3">
          <Label htmlFor="descricao-pagamento">Descrição do pagamento</Label>
          <Input
            id="descricao-pagamento"
            disabled={!editavel}
            value={form.descricao_pagamento || ""}
            onChange={(evento) => setCampo("descricao_pagamento", evento.target.value)}
            placeholder="Ex.: entrada de 50%, sinal, restante na entrega"
          />
        </div>
      </div>

      <div>
        <span className="text-xs text-muted-foreground">Dados do pagador/recebedor</span>
        <Separator className="mt-1" />
      </div>

      {form.fornecedor ? (
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Fornecedor vinculado
          </p>
          <p className="mt-0.5 text-sm font-medium">
            {form.fornecedor.nomerazaosocial ||
              form.fornecedor.nomefantasia ||
              `Fornecedor #${form.fornecedor.id}`}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="w-full space-y-2">
          <Label htmlFor="nomepagador">
            Nome do pagador/recebedor <span className="text-red-500">*</span>
          </Label>
          <Input
            id="nomepagador"
            disabled={!editavel}
            value={form.nomepagador || ""}
            onChange={(evento) => setCampo("nomepagador", evento.target.value)}
            placeholder="Nome do pagador/recebedor"
          />
        </div>

        <div className="w-full space-y-2">
          <Label htmlFor="cpfcnpjpagador">CPF/CNPJ do pagador/recebedor</Label>
          <Input
            id="cpfcnpjpagador"
            disabled
            value={formatCpfCnpj(form.cpfcnpjpagador || "") || ""}
            placeholder="CPF/CNPJ"
          />
          <p className="text-xs text-muted-foreground">
            Vem do cadastro do cliente ou fornecedor.
          </p>
        </div>
      </div>
    </div>
  );
}
