"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, MinusCircle, PlusCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ValueInput from "@/components/ui/value-input";
import { taxaEhOUnicoDesconto, valorLiquidoEmEdicao } from "@/lib/financeiro/transacao";
import formatarEmReal from "@/utils/formatarEmReal";

import { Cartao, EstadoVazio, fmtDateTime } from "./shared";

/**
 * Acrescimos e descontos de um pagamento.
 *
 * A cadeia que a aba mostra e a mesma do banco:
 *
 *   base  ->  + acrescimos  ->  bruto  ->  - descontos  ->  liquido
 *
 * Os numeros vem da propria transacao, recalculada pelo gatilho a cada linha
 * inserida ou removida. O cartao de composicao so os reencadeia — face e
 * desconto saem do bruto e do liquido, pela mesma conta do gatilho, para que
 * valor digitado e ainda nao salvo na aba Detalhes apareca aqui inteiro.
 *
 * A taxa de recebimento e um desconto como os outros — deixou de ser a diferenca
 * implicita entre bruto e liquido e passou a ter linha propria, com nome.
 */

type TipoAjuste = {
  id: number;
  codigo: string;
  nome: string;
  natureza: "ACRESCIMO" | "DESCONTO";
  codigo_sistema: string | null;
};

export type LinhaAjuste = {
  id: number;
  natureza: "ACRESCIMO" | "DESCONTO";
  modo: "FIXO" | "PORCENTAGEM";
  valor_informado: number | string;
  valor_calculado: number | string;
  observacao: string | null;
  created_at: string;
  tipo: { id: number; codigo: string; nome: string; codigo_sistema: string | null } | null;
};

type Totais = {
  valor_base?: number | string | null;
  valor_acrescimos?: number | string | null;
  valor_descontos?: number | string | null;
  valor?: number | string | null;
  valorLiquido?: number | string | null;
  /** Entra em `valorLiquidoEfetivo`: despesa e depósito valem o próprio bruto. */
  tipo?: string | null;
};

const num = (valor: unknown) => {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
};

function LinhaTotal({
  rotulo,
  valor,
  sinal,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  sinal?: "mais" | "menos";
  destaque?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1 text-sm ${
        destaque ? "font-semibold" : "text-muted-foreground"
      }`}
    >
      <span>{rotulo}</span>
      <span
        className={
          sinal === "mais"
            ? "text-emerald-600 dark:text-emerald-400"
            : sinal === "menos"
              ? "text-destructive"
              : undefined
        }
      >
        {sinal === "mais" ? "+ " : sinal === "menos" ? "− " : ""}
        {formatarEmReal(valor)}
      </span>
    </div>
  );
}

/*
 * O que sobrevive à troca de aba.
 *
 * O Radix desmonta o conteúdo da aba inativa, então toda volta para cá remontava
 * o componente, zerava o estado e refazia as duas consultas — com spinner. Para
 * quem lança três descontos seguidos, a aba piscava a cada ida e volta.
 *
 * O catálogo de tipos é global e não muda enquanto a página está aberta: uma
 * busca por sessão basta. As linhas são por transação, então ficam num mapa
 * pela chave do id — voltar para a aba mostra o que já estava lá e revalida por
 * baixo, sem spinner.
 */
let catalogoDeTipos: TipoAjuste[] | null = null;
const linhasPorTransacao = new Map<number, LinhaAjuste[]>();

/** Chamada ao fechar o dialog: o cache não deve atravessar transações. */
export function esquecerAjustesEmCache(transacaoId?: number) {
  if (transacaoId == null) linhasPorTransacao.clear();
  else linhasPorTransacao.delete(transacaoId);
}

export function AjustesTab({
  transacaoId,
  totais,
  pendente,
  editavel,
  valoresPendentes = false,
  sincronizarValores,
  onAlterado,
}: {
  transacaoId: number;
  totais: Totais;
  /** Acrescimo mexe no bruto, e bruto de transacao baixada e imutavel. */
  pendente: boolean;
  editavel: boolean;
  /** Bruto ou liquido digitados na aba Detalhes e ainda nao salvos. */
  valoresPendentes?: boolean;
  /**
   * Poe esses valores no banco antes de a linha nova entrar.
   *
   * Lancar ou remover uma linha grava na hora, e o servidor devolve a transacao
   * recalculada a partir do BANCO — que nao conhece o que ainda esta so na tela.
   * Sem esta passagem, o liquido digitado era sobrescrito nessa volta e a taxa
   * que a pessoa tinha acabado de pedir sumia sem aviso.
   *
   * Devolve false quando a gravacao falhou: ai a linha nao chega a ser lancada,
   * porque ela seria calculada sobre um valor que nao e o da tela.
   */
  sincronizarValores?: () => Promise<boolean>;
  /** Recebe a transação já recalculada, para o dialog atualizar sem refetch. */
  onAlterado?: (transacao?: Totais, travouOLiquido?: boolean) => void;
}) {
  const [tipos, setTipos] = useState<TipoAjuste[]>(catalogoDeTipos ?? []);
  const [linhas, setLinhas] = useState<LinhaAjuste[]>(
    () => linhasPorTransacao.get(transacaoId) ?? [],
  );
  // Só mostra spinner quando não há nada em cache para mostrar no lugar.
  const [carregando, setCarregando] = useState(
    () => !linhasPorTransacao.has(transacaoId),
  );
  const [salvando, setSalvando] = useState(false);

  const [tipoId, setTipoId] = useState<string>("");
  const [modo, setModo] = useState<"FIXO" | "PORCENTAGEM">("FIXO");
  const [valor, setValor] = useState<string>("");

  /**
   * `mostrarSpinner` só na primeira carga. Depois de lançar ou remover uma
   * linha, a lista se atualiza por baixo: trocar o conteúdo por um spinner faria
   * a aba piscar e tiraria o usuário de onde ele estava olhando.
   */
  const carregarLinhas = async (mostrarSpinner: boolean) => {
    if (mostrarSpinner) setCarregando(true);
    try {
      const requisicoes: Promise<unknown>[] = [
        axios.get(`/api/transaction/${transacaoId}/ajustes`),
      ];
      // Catálogo global: uma busca por sessão, guardada fora do componente.
      if (!catalogoDeTipos) requisicoes.push(axios.get("/api/tipos/ajustes-transacao"));

      const [linhasRes, tiposRes] = (await Promise.all(requisicoes)) as Array<{
        data?: { data?: unknown };
      }>;

      const atuais = (linhasRes?.data?.data as LinhaAjuste[]) ?? [];
      linhasPorTransacao.set(transacaoId, atuais);
      setLinhas(atuais);

      if (tiposRes) {
        catalogoDeTipos = (tiposRes.data?.data as TipoAjuste[]) ?? [];
        setTipos(catalogoDeTipos);
      }
      return atuais;
    } catch {
      toast.error("Não foi possível carregar os ajustes.");
      return null;
    } finally {
      if (mostrarSpinner) setCarregando(false);
    }
  };

  /*
   * Lançar um desconto comercial tira o líquido das mãos da aba Detalhes, e
   * removê-lo devolve. Quem decide é a mesma regra do servidor, não a contagem:
   * um desconto que não seja a taxa de recebimento já trava.
   */
  const travouOLiquido = (atuais: LinhaAjuste[] | null) =>
    atuais ? !taxaEhOUnicoDesconto(atuais) : undefined;

  useEffect(() => {
    if (!transacaoId) return;
    /*
     * Com algo em cache, revalida por baixo: a aba abre já preenchida e o
     * spinner só aparece na primeira vez de cada transação. É o que tira o
     * piscar de quem vai e volta entre Detalhes e Ajustes.
     */
    void carregarLinhas(!linhasPorTransacao.has(transacaoId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transacaoId]);

  /*
   * A composicao e derivada do bruto e do liquido, nao lida coluna a coluna.
   *
   * `totais` e o formulario da aba Detalhes, onde bruto e liquido podem ter sido
   * digitados e ainda nao salvos. `valor_base` e `valor_descontos` so mudam no
   * banco, entao le-los direto mostrava "Valor de face" e "Descontos" antigos ao
   * lado de um "Valor cobrado" ja novo — o cartao se contradizia.
   *
   * Derivar reproduz exatamente o que o gatilho grava
   * (`tg_transacao_valor_coerente`): face = bruto - acrescimos, e o desconto e a
   * diferenca ate o liquido. Sem edicao pendente da nos mesmos numeros das
   * colunas; com edicao pendente, mostra o resultado dela.
   */
  const arredondar = (numero: number) => Math.round(numero * 100) / 100;

  const bruto = num(totais.valor);
  const acrescimos = num(totais.valor_acrescimos);
  const base = arredondar(bruto - acrescimos);
  const liquido = valorLiquidoEmEdicao(totais, !taxaEhOUnicoDesconto(linhas));
  const descontos = Math.max(0, arredondar(bruto - liquido));

  const tipoEscolhido = useMemo(
    () => tipos.find((t) => String(t.id) === tipoId) ?? null,
    [tipos, tipoId],
  );

  // Acrescimo altera o bruto; depois da baixa isso e recusado pelo banco. Tirar
  // da lista evita oferecer uma opcao que so daria erro ao salvar.
  const tiposDisponiveis = pendente
    ? tipos
    : tipos.filter((t) => t.natureza === "DESCONTO");

  const adicionar = async () => {
    const informado = Number(String(valor).replace(",", "."));
    if (!tipoEscolhido) {
      toast.error("Escolha o tipo do ajuste.");
      return;
    }
    if (!Number.isFinite(informado) || informado <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }

    setSalvando(true);
    try {
      // O valor digitado na aba Detalhes entra no banco primeiro: a linha nova é
      // calculada sobre o bruto de agora, não sobre o que sobrou de antes.
      if (sincronizarValores && !(await sincronizarValores())) return;

      const resposta = await axios.post(`/api/transaction/${transacaoId}/ajustes`, {
        tipoId: tipoEscolhido.id,
        modo,
        valorInformado: informado,
      });
      setValor("");
      const atuais = await carregarLinhas(false);
      // A resposta ja traz a transacao recalculada: o dialog costura os totais
      // em memoria em vez de recarregar a tela. O estado do liquido vai junto
      // porque e ele que decide se o campo da aba Detalhes continua editavel.
      onAlterado?.(resposta.data?.data?.transacao, travouOLiquido(atuais));
      toast.success("Ajuste lançado.");
    } catch (error) {
      const mensagem =
        axios.isAxiosError(error) && error.response?.data?.error
          ? String(error.response.data.error)
          : "Não foi possível lançar o ajuste.";
      toast.error(mensagem);
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (ajusteId: number) => {
    setSalvando(true);
    try {
      if (sincronizarValores && !(await sincronizarValores())) return;

      const resposta = await axios.delete(
        `/api/transaction/${transacaoId}/ajustes?ajusteId=${ajusteId}`,
      );
      const atuais = await carregarLinhas(false);
      onAlterado?.(resposta.data?.data?.transacao, travouOLiquido(atuais));
      toast.success("Ajuste removido.");
    } catch (error) {
      const mensagem =
        axios.isAxiosError(error) && error.response?.data?.error
          ? String(error.response.data.error)
          : "Não foi possível remover o ajuste.";
      toast.error(mensagem);
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando ajustes
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Cartao titulo="Composição do valor">
        <LinhaTotal rotulo="Valor de face" valor={base} />
        {acrescimos > 0 ? (
          <LinhaTotal rotulo="Acréscimos" valor={acrescimos} sinal="mais" />
        ) : null}
        <LinhaTotal rotulo="Valor cobrado" valor={bruto} destaque />
        {descontos > 0 ? (
          <LinhaTotal rotulo="Descontos" valor={descontos} sinal="menos" />
        ) : null}
        <div className="mt-1 border-t pt-1">
          <LinhaTotal rotulo="Entra na conta" valor={liquido} destaque />
        </div>
      </Cartao>

      <Cartao titulo="Lançamentos">
        {linhas.length === 0 ? (
          <EstadoVazio>Nenhum acréscimo ou desconto lançado neste pagamento.</EstadoVazio>
        ) : (
          <ul className="divide-y">
            {linhas.map((linha) => {
              const ehAcrescimo = linha.natureza === "ACRESCIMO";
              const podeRemover = editavel && (pendente || !ehAcrescimo);
              return (
                <li key={linha.id} className="flex items-center gap-3 py-2">
                  {ehAcrescimo ? (
                    <PlusCircle
                      className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  ) : (
                    <MinusCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {linha.tipo?.nome ?? "Ajuste"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {linha.modo === "PORCENTAGEM"
                        ? `${num(linha.valor_informado)}% sobre o valor de face`
                        : "Valor fixo"}
                      {" · "}
                      {fmtDateTime(linha.created_at)}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-semibold ${
                      ehAcrescimo
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive"
                    }`}
                  >
                    {ehAcrescimo ? "+ " : "− "}
                    {formatarEmReal(num(linha.valor_calculado))}
                  </span>
                  {podeRemover ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={salvando}
                      onClick={() => remover(linha.id)}
                      aria-label={`Remover ${linha.tipo?.nome ?? "ajuste"}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>

      {editavel ? (
        <Cartao titulo="Lançar ajuste">
          {valoresPendentes ? (
            <p className="mb-3 border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Há valor digitado na aba Detalhes que ainda não foi salvo. Ele é
              gravado antes desta linha, para o ajuste novo incidir sobre o valor
              de agora.
            </p>
          ) : null}
          {!pendente ? (
            <p className="mb-3 text-xs text-muted-foreground">
              Esta transação já foi baixada. Só é possível lançar desconto, porque
              acréscimo alteraria o valor bruto, que vira histórico depois da baixa.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={tipoId} onValueChange={setTipoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {tiposDisponiveis.map((tipo) => (
                    <SelectItem key={tipo.id} value={String(tipo.id)}>
                      {tipo.natureza === "ACRESCIMO" ? "+ " : "− "}
                      {tipo.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Modo</Label>
              <Select
                value={modo}
                onValueChange={(valor) => setModo(valor as "FIXO" | "PORCENTAGEM")}
              >
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXO">Em reais</SelectItem>
                  <SelectItem value="PORCENTAGEM">Percentual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                {modo === "PORCENTAGEM" ? "Percentual" : "Valor"}
              </Label>
              {/*
                Em reais o campo é dinheiro e usa a máscara de sempre; em
                percentual, não — "R$ 10,00" para dizer 10% seria mentira na
                tela. O estado continua um só, em texto, porque é ele que a
                rota recebe e é o mesmo número nos dois modos.
              */}
              {modo === "PORCENTAGEM" ? (
                <Input
                  inputMode="decimal"
                  value={valor}
                  onChange={(evento) => setValor(evento.target.value)}
                  placeholder="10"
                  className="w-full sm:w-28"
                />
              ) : (
                <ValueInput
                  value={Number(String(valor).replace(",", ".")) || 0}
                  onValueChange={(novo) => setValor(String(novo))}
                  className="w-full sm:w-36"
                />
              )}
            </div>

            <Button
              onClick={adicionar}
              disabled={salvando}
              className="sm:w-auto"
            >
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Lançar"}
            </Button>
          </div>
          {modo === "PORCENTAGEM" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              O percentual incide sobre o valor de face ({formatarEmReal(base)}), não
              sobre o acumulado — duas linhas de 10% somam 20%.
            </p>
          ) : null}
        </Cartao>
      ) : null}
    </div>
  );
}
