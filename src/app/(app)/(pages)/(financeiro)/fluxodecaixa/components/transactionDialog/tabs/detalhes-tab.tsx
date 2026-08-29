"use client";

import {
  CalendarClock,
  CircleDollarSign,
  CreditCard,
  FileCheck2,
  Info,
  Lock,
  Tags,
  UserRound,
} from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import ValueInput from "@/components/ui/value-input";
import { toast } from "@/lib/toast";
import { paraCentavos } from "@/lib/financeiro/rateio";
import formatarEmReal from "@/utils/formatarEmReal";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";

import { useBancos } from "../../../hooks/use-bancos";
import { useCategoriasTransacao } from "../../../hooks/use-categoria-transacao";
import { useCentrosCusto } from "../../../hooks/use-centros-custo";
import { usePlanosDeConta } from "../../../hooks/use-planos-de-conta";
import { useTiposDocumento } from "../../../hooks/use-tipos-documento";
import { Metodo_pagamento, Tipo_transacao } from "../../../types";
import {
  origemDaTransacao,
  rotuloDaOrigem,
  tipoTemValorLiquido,
  valorLiquidoEmEdicao,
} from "@/lib/financeiro/transacao";

import { ContraparteEditor } from "./contraparte-editor";
import { PlanoContaCombobox } from "../../plano-conta-combobox";
import { SearchCombobox } from "../../search-combobox";
import { paraDataDaApi, paraValorDeInputDate, parseLocalDateTime } from "../datas";
import { TransactionSection } from "../transaction-dialog-ui";
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
   * O líquido deixou de ser campo: há desconto lançado que não é a taxa de
   * recebimento, e o gatilho o deriva das linhas. A edição sai daqui para a aba
   * de ajustes — é a mesma regra que o servidor aplica ao salvar.
   */
  liquidoTravado: boolean;
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
  liquidoTravado,
}: Pick<
  DetalhesTabProps,
  | "form"
  | "setCampo"
  | "editavel"
  | "permiteRateio"
  | "permiteEditarValor"
  | "liquidoTravado"
>) {
  const bruto = Number(form.valor ?? 0);
  const temLiquido = tipoTemValorLiquido(form.tipo);

  /*
   * Com acréscimo lançado, "valor bruto" fica ambíguo — e a ambiguidade estraga
   * o lançamento em silêncio.
   *
   * O campo mostra o total já com os juros dentro (face + acréscimos). Quem
   * digita aqui costuma ter em mente a face, o valor de antes dos juros; e o
   * sistema, ao receber um `valor` menor, entende "o total é este" e reparte
   * para trás, redefinindo a face sem avisar. Na transação 366 do Demir, juros
   * de R$ 55,53 sobre R$ 666,67 viravam face de R$ 611,14.
   *
   * Como não há como adivinhar qual dos dois números a pessoa quis dizer, o
   * campo sai de cena e o ajuste passa a ser feito onde ele é explícito — a
   * mesma decisão já tomada para o líquido quando há mais de um desconto.
   */
  const acrescimosLancados = Number(form.valor_acrescimos ?? 0);
  const brutoTravadoPorAcrescimo =
    Number.isFinite(acrescimosLancados) && acrescimosLancados > 0;
  /*
   * `permiteRateio` não basta para saber se há documento por trás.
   *
   * Ele nasce de `contexto.relacionadas.origem`, que só conhece OS, VENDA e
   * PARCELAMENTO — entrada de estoque e uso e consumo saem de lá como "NENHUM".
   * Como as duas geram DESPESA, e despesa nunca chegava ao campo editável, a
   * diferença não aparecia. Perguntar à `origemDaTransacao`, que é a mesma
   * pergunta que o salvamento faz para decidir se manda o bruto, fecha isso:
   * mudar o valor de uma compra que virou estoque descolaria a transação da nota
   * e do custo, e o campo aberto nem salvaria — `use-transacao-edicao` descarta o
   * bruto de transação com origem.
   */
  const brutoTemDocumento = permiteRateio || origemDaTransacao(form) != null;
  /*
   * Vale para os quatro tipos, e é por isso que fica antes do desvio abaixo.
   *
   * Despesa e depósito caíam no `return` de campo único com `disabled` literal,
   * sem consultar `permiteEditarValor`: uma conta a pagar avulsa — sem OS, venda
   * ou entrada a preservar — não tinha nenhum caminho de correção pela tela, e o
   * texto de ajuda falava de taxa de recebimento, como se o cadeado fosse outro
   * assunto. O servidor sempre aceitou esse ajuste (`/ajustar-valores` só exige
   * a soma constante quando há documento); a trava era só daqui.
   */
  const brutoEditavel =
    permiteEditarValor && !brutoTravadoPorAcrescimo && !brutoTemDocumento;

  if (!temLiquido) {
    return (
      <div className="space-y-2 sm:col-span-3 sm:max-w-xs">
        <Label htmlFor="valor-bruto" className="flex items-center gap-1.5">
          Valor
          {brutoEditavel ? null : (
            <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
          )}
        </Label>
        <ValueInput
          id="valor-bruto"
          disabled={!brutoEditavel}
          value={bruto}
          onValueChange={
            brutoEditavel ? (valor) => setCampo("valor", valor) : undefined
          }
        />
        <p className="text-xs text-muted-foreground">
          {brutoTravadoPorAcrescimo
            ? `Inclui ${formatarEmReal(acrescimosLancados)} de acréscimo. Para mudar o valor, ajuste a linha na aba Acréscimos e descontos.`
            : permiteRateio
              ? "É o que abate o documento de origem. Para redividir entre as parcelas, use a aba Parcelas."
              : origemDaTransacao(form) != null
                ? `Vem da ${rotuloDaOrigem(origemDaTransacao(form)!)} e acompanha ela. Corrija o valor no documento.`
                : form.tipo === Tipo_transacao.DESPESA
                  ? "Lançamentos de despesa não têm taxa de recebimento."
                  : "Este tipo de lançamento não tem valor líquido."}
        </p>
      </div>
    );
  }

  // Com o líquido travado o número vem dos descontos, não do que está guardado:
  // digitar um bruto novo muda o líquido junto, e o guardado ainda é o do bruto
  // anterior. É o mesmo número que o gatilho vai gravar.
  const liquido = valorLiquidoEmEdicao(form, liquidoTravado);
  // Havendo linha lançada, o número vem dela — é exato e diz o que era. A
  // subtração continua valendo para o que foi criado antes de existirem linhas.
  const descontosLancados = Number(form.valor_descontos ?? 0);
  const temDescontoLancado = Number.isFinite(descontosLancados) && descontosLancados > 0;
  const taxa = temDescontoLancado ? descontosLancados : Math.max(0, bruto - liquido);
  const excedeBruto = paraCentavos(liquido) > paraCentavos(bruto);

  return (
    <div className="grid gap-3 sm:col-span-3 sm:grid-cols-3">
      <div className="space-y-2">
        <Label htmlFor="valor-bruto" className="flex items-center gap-1.5">
          Valor bruto
          {brutoEditavel ? null : (
            <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
          )}
        </Label>
        <ValueInput
          id="valor-bruto"
          disabled={!brutoEditavel}
          value={bruto}
          onValueChange={
            brutoEditavel ? (valor) => setCampo("valor", valor) : undefined
          }
        />
        <p className="text-xs text-muted-foreground">
          {brutoTravadoPorAcrescimo
            ? `Inclui ${formatarEmReal(acrescimosLancados)} de acréscimo. Para mudar o valor, ajuste a linha na aba Acréscimos e descontos.`
            : permiteRateio
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
              ? "Definido pelos descontos lançados. Edite pela aba Acréscimos e descontos."
              : "O que sobrou depois da taxa de recebimento."}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Descontos</Label>
        <div className="flex h-10 items-center border bg-muted/30 px-3 text-sm font-medium tabular-nums">
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
  liquidoTravado,
}: DetalhesTabProps) {
  // Vem das colunas de vínculo da própria transação, não do contexto: o
  // contexto é uma consulta separada e pode ainda estar carregando.
  const origem = origemDaTransacao(form);
  const { bancos, loadingBancos, errorBancos } = useBancos();
  const { categorias, loadingCategorias, errorCategorias } = useCategoriasTransacao();
  const { gruposPlanosDeConta, loadingPlanos } = usePlanosDeConta();
  const { centrosCusto, loadingCentrosCusto, errorCentrosCusto } = useCentrosCusto();
  const { tiposDocumento, loadingTiposDocumento, errorTiposDocumento } =
    useTiposDocumento();
  const { options: metodosPagamento } = usePaymentMethodOptions();

  /**
   * A antecipação que liquidou este título, quando há uma.
   *
   * O banco dela é o único que existe nessa operação: a parcela é baixada sem
   * conta para não entrar no fluxo de caixa junto com o lançamento que a pagou.
   * O campo fica travado porque escolher um banco aqui dobrava o saldo em
   * silêncio — o servidor recusa, e a tela precisa dizer por quê antes.
   */
  const antecipadoPor = form.adiantamento_id ?? null;

  const rotuloLancamentoFuturo =
    form.tipo === Tipo_transacao.RECEITA
      ? "LANÇAMENTO A RECEBER"
      : form.tipo === Tipo_transacao.DESPESA
        ? "LANÇAMENTO A PAGAR"
        : null;

  /**
   * Competência é regime econômico: a que mês o fato pertence, ao contrário da
   * data, que é de caixa. Só faz sentido editar em lançamento avulso — quando
   * há documento, ela pertence ao documento, e o servidor recusa a alteração.
   */
  const competenciaEditavel = editavel && origem == null;

  /**
   * Qual documento manda na competência, com o número. Sem o número, o aviso
   * dizia que a data "vem do documento" e deixava o usuário procurando qual.
   */
  const documentoDaCompetencia = (() => {
    if (origem === "OS" && form.ordemservicoid != null) {
      return `ordem de serviço #${form.ordemservicoid}`;
    }
    if (origem === "VENDA" && form.vendaid != null) return `venda #${form.vendaid}`;
    if (origem === "ENTRADA" && form.entrada_id != null) {
      return `entrada de estoque #${form.entrada_id}`;
    }
    if (origem === "USOCONSUMO" && form.usoconsumo_entrada_id != null) {
      return `entrada de uso e consumo #${form.usoconsumo_entrada_id}`;
    }
    return origem ? rotuloDaOrigem(origem) : null;
  })();

  const alterarCompetencia = (valor: string) => {
    const selecionada = valor ? parseLocalDateTime(`${valor}T00:00`) : undefined;
    setCampo("competencia_em", selecionada ? selecionada.toISOString() : null);
  };

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

    /*
     * Vencimento no passado é permitido.
     *
     * A trava aqui recusava "lançamento a vencer com data passada", o que fazia
     * sentido ao criar e nenhum ao corrigir: título vencido em aberto é estado
     * legítimo do sistema, e era impossível mexer na data de uma parcela que já
     * tinha vencido. Como `selecionada` é meia-noite do dia escolhido e `agora`
     * tem hora, ela recusava até o dia de hoje depois do primeiro minuto.
     */
    setCampo("data", selecionada);
  };

  const alternarDocumento = (relacionar: boolean) => {
    setForm((atual) => {
      if (!atual) return atual;
      if (relacionar) return { ...atual, relacionarDocumento: true };

      return {
        ...atual,
        relacionarDocumento: false,
        documento_tipo_id: null,
        documento_numero: null,
        documento_serie: null,
        documento_chave: null,
        documento_emitido_em: null,
        documento_valor: null,
        documento_observacao: null,
      };
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <TransactionSection
        eyebrow="Movimentação"
        title="Operação e valores"
        description="Natureza do lançamento, situação financeira e composição do valor."
        icon={CircleDollarSign}
      >
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-3">
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
              {metodosPagamento.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
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
          liquidoTravado={liquidoTravado}
        />
      </div>
      </TransactionSection>

      <TransactionSection
        eyebrow="Organização financeira"
        title="Classificação contábil"
        description="Conta de destino, categoria, plano de conta e centro de custo."
        icon={Tags}
      >
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="w-full space-y-2">
          <Label htmlFor="banco" className="flex items-center gap-1.5">
            Banco
            {antecipadoPor != null ? (
              <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
            ) : null}
          </Label>
          <SearchCombobox
            disabled={!editavel || !!errorBancos || antecipadoPor != null}
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
          {antecipadoPor != null ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              Sem banco de propósito: o dinheiro entrou pela antecipação #
              {antecipadoPor}, e é ela que carrega a conta. Preencher aqui faria o
              mesmo valor aparecer duas vezes no fluxo de caixa.
            </p>
          ) : null}
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
      </div>
      </TransactionSection>

      <TransactionSection
        eyebrow="Agenda e identificação"
        title="Datas e descrições"
        description="Vencimento ou pagamento, competência gerencial e textos de identificação."
        icon={CalendarClock}
      >
      <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
        <div className="w-full space-y-2">
          <Label htmlFor="data">
            {form.pendente ? "Data de vencimento" : "Data do pagamento"}
          </Label>
          <DatePicker
            disabled={!editavel}
            value={paraValorDeInputDate(form.data)}
            className="h-10 w-full rounded-none shadow-none sm:max-w-xs"
            // Sem piso: um título a vencer pode estar vencido, e a data dele
            // precisa continuar editável. O teto para transação já realizada
            // fica: dinheiro que entrou não entra amanhã.
            max={!form.pendente ? paraValorDeInputDate(new Date()) : undefined}
            onChange={alterarData}
          />
        </div>

        <div className="w-full space-y-2">
          <Label htmlFor="competencia" className="flex items-center gap-1.5">
            Competência
            {competenciaEditavel ? null : (
              <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
            )}
          </Label>
          <DatePicker
            disabled={!competenciaEditavel}
            value={paraValorDeInputDate(paraDataDaApi(form.competencia_em))}
            className="h-10 w-full rounded-none shadow-none sm:max-w-xs"
            onChange={alterarCompetencia}
          />
          <p className="text-xs text-muted-foreground">
            {competenciaEditavel
              ? "A que mês o fato pertence na DRE. Conta de julho sendo paga em agosto pertence a julho."
              : documentoDaCompetencia && !form.competencia_em
                ? `A ${documentoDaCompetencia} ainda não possui data de competência definida.`
              : documentoDaCompetencia
                ? `Definida pela ${documentoDaCompetencia} e acompanha ela.`
                : "Vem do documento de origem e acompanha ele."}
          </p>
        </div>

        <div className="w-full space-y-2 sm:col-span-2">
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

        <div className="w-full space-y-2 sm:col-span-2">
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
      </TransactionSection>

      {/*
        Só aparece quando o lançamento passou por maquineta.
        
        Somente leitura de propósito: mudar a bandeira aqui teria de refazer o
        líquido, e na edição o líquido não é campo — ele é resultado das linhas
        de acréscimo e desconto (ver `sincronizarTaxaRecebimento`). Escrever nos
        dois lugares seria uma segunda verdade sobre o mesmo número. Para
        corrigir a taxa de um lançamento já feito, o caminho é a aba Acréscimos e
        descontos, que é onde ela vive depois de gravada.
      */}
      {form.bandeira_id != null && (
        <TransactionSection
          eyebrow="Recebimento em cartão"
          title="Bandeira"
          description="Taxa da maquineta aplicada neste lançamento."
          icon={CreditCard}
        >
          <div className="grid gap-x-4 gap-y-5 sm:grid-cols-3">
            <div className="w-full space-y-2">
              <Label className="flex items-center gap-1.5">
                Bandeira
                <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
              </Label>
              <div className="flex h-10 items-center border border-border bg-muted/20 px-3 text-xs">
                {form.bandeira_dados?.nome ?? `Bandeira #${form.bandeira_id}`}
              </div>
            </div>
            <div className="w-full space-y-2">
              <Label>Parcelamento no cartão</Label>
              <div className="flex h-10 items-center border border-border bg-muted/20 px-3 text-xs">
                {form.bandeira_parcelas ? `${form.bandeira_parcelas}x` : "—"}
              </div>
            </div>
            <div className="w-full space-y-2">
              <Label>Taxa aplicada</Label>
              <div className="flex h-10 items-center border border-border bg-muted/20 px-3 text-xs">
                {form.bandeira_taxa_percentual != null
                  ? `${Number(form.bandeira_taxa_percentual).toFixed(2).replace(".", ",")}%`
                  : "—"}
              </div>
            </div>
          </div>
          {form.bandeira_taxa_ajustada ? (
            <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-300">
              A taxa deste lançamento foi corrigida à mão e não segue a tabela da
              bandeira.
            </p>
          ) : null}
        </TransactionSection>
      )}

      <TransactionSection
        eyebrow="Contraparte"
        title="Pagador ou recebedor"
        description="Identificação de quem realizou ou recebeu o pagamento."
        icon={UserRound}
      >
        <ContraparteEditor form={form} setForm={setForm} editavel={editavel} />
      </TransactionSection>

      <TransactionSection
        eyebrow="Comprovação"
        title="Documento relacionado"
        description="Nota, recibo ou comprovante que justifica este lançamento."
        icon={FileCheck2}
        action={
          <div className="flex items-center gap-2">
            <Label htmlFor="editar-relacionar-documento" className="cursor-pointer text-xs">
              Relacionar documento
            </Label>
            <Switch
              id="editar-relacionar-documento"
              disabled={!editavel}
              checked={form.relacionarDocumento}
              onCheckedChange={alternarDocumento}
            />
          </div>
        }
      >
        {form.relacionarDocumento ? (
          <div className="grid gap-4 border border-border bg-muted/10 p-4 sm:grid-cols-3">
            <div className="w-full space-y-2">
              <Label htmlFor="editar-documento-tipo">
                Tipo de documento <span className="text-red-500">*</span>
              </Label>
              <SearchCombobox
                disabled={!editavel || loadingTiposDocumento || !!errorTiposDocumento}
                loading={loadingTiposDocumento}
                value={form.documento_tipo_id?.toString() || ""}
                onValueChange={(valor) =>
                  setCampo("documento_tipo_id", valor ? Number(valor) : null)
                }
                placeholder={
                  form.documento_tipo_id
                    ? `Tipo #${form.documento_tipo_id}`
                    : errorTiposDocumento
                      ? "Erro ao carregar"
                      : "Selecione"
                }
                searchPlaceholder="Pesquisar documento..."
                emptyMessage="Nenhum tipo de documento encontrado."
                options={tiposDocumento.map((tipo) => ({
                  value: String(tipo.id),
                  label: tipo.nome,
                  description: tipo.descricao ?? undefined,
                }))}
              />
            </div>

            <div className="w-full space-y-2">
              <Label htmlFor="editar-documento-numero">Número</Label>
              <Input
                id="editar-documento-numero"
                disabled={!editavel}
                maxLength={60}
                value={form.documento_numero || ""}
                onChange={(evento) =>
                  setCampo("documento_numero", evento.target.value)
                }
                placeholder="Ex.: 1234"
              />
            </div>

            <div className="w-full space-y-2">
              <Label htmlFor="editar-documento-serie">Série</Label>
              <Input
                id="editar-documento-serie"
                disabled={!editavel}
                maxLength={20}
                value={form.documento_serie || ""}
                onChange={(evento) =>
                  setCampo("documento_serie", evento.target.value)
                }
                placeholder="Ex.: 1"
              />
            </div>

            <div className="w-full space-y-2">
              <Label htmlFor="editar-documento-emissao">Data de emissão</Label>
              <DatePicker
                disabled={!editavel}
                value={form.documento_emitido_em || ""}
                onChange={(valor) => setCampo("documento_emitido_em", valor || null)}
                className="h-10 w-full rounded-none shadow-none"
              />
            </div>

            <div className="w-full space-y-2">
              <Label htmlFor="editar-documento-valor">Valor do documento</Label>
              <ValueInput
                id="editar-documento-valor"
                disabled={!editavel}
                value={Number(form.documento_valor ?? 0)}
                onValueChange={(valor) => setCampo("documento_valor", valor)}
              />
              <p className="text-xs text-muted-foreground">
                Só referência. Não altera o valor da transação.
              </p>
            </div>

            <div className="w-full space-y-2 sm:col-span-3">
              <Label htmlFor="editar-documento-chave">
                Chave de acesso ou código de verificação
              </Label>
              <Input
                id="editar-documento-chave"
                disabled={!editavel}
                maxLength={120}
                value={form.documento_chave || ""}
                onChange={(evento) =>
                  setCampo("documento_chave", evento.target.value)
                }
                placeholder="Chave da NF-e/NFS-e, ou o código do comprovante"
              />
            </div>

            <div className="w-full space-y-2 sm:col-span-3">
              <Label htmlFor="editar-documento-observacao">Observação</Label>
              <Input
                id="editar-documento-observacao"
                disabled={!editavel}
                maxLength={500}
                value={form.documento_observacao || ""}
                onChange={(evento) =>
                  setCampo("documento_observacao", evento.target.value)
                }
                placeholder="Ex.: nota do fornecedor referente à peça trocada"
              />
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            {editavel
              ? "Ative a opção acima para relacionar um documento."
              : "Nenhum documento relacionado a esta transação."}
          </div>
        )}
      </TransactionSection>
    </div>
  );
}
