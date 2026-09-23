"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ValueInput } from "@/components/ui/value-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Car, Cog, Package, Plus, Target, User2, Wrench, X } from "lucide-react";
import { toast } from "@/lib/toast";

import ProductSelect from "@/app/(app)/components/productSelect";
import ServiceSelect from "@/app/(app)/components/serviceSelect";
import CustomerSelect from "@/app/(app)/components/customerSelect";
import VehicleSelect from "@/app/(app)/components/vehicleSelect";

import { useCarrinhoOrcamento } from "../../ordens/components/orcamento/ganchos/use-carrinho-orcamento";
import { TabelaItensProduto } from "../../ordens/components/orcamento/components/tabela-itens-produto";
import { TabelaItensServico } from "../../ordens/components/orcamento/components/tabela-tens-servico";
import { ProdutosAvulsos } from "../../ordens/components/orcamento/components/produtos-avulsos";
import { CampoDesconto } from "../../ordens/components/orcamento/components/campo-desconto";
import { dinheiro } from "../../ordens/components/orcamento/util";
import type { ProdutoBusca, ServicoBusca } from "../../ordens/components/orcamento/tipos";

import { carregarOrcamento, criarOrcamento, salvarOrcamento } from "../lib/api";
import type {
  AlvoTipoOrcamento,
  ClienteResumo,
  PayloadOrcamento,
  VeiculoResumo,
} from "../types";

export type OrcamentoAvulsoFormHandle = {
  salvar: () => Promise<number>;
};

export type OrcamentoAvulsoFormProps = {
  /** Ausente = orçamento novo: o carrinho começa vazio e só existe ao salvar. */
  orcamentoId?: number;
  onTotaisChange?: (totais: { totalProdutos: number; totalServicos: number; totalGeral: number }) => void;
  onLoadingChange?: (carregando: boolean) => void;
  onSalvo?: (id: number) => void;
};

const ALTURA_CONTROLE = "h-10";

const OPCOES_ALVO: Array<{
  valor: AlvoTipoOrcamento;
  rotulo: string;
  ajuda: string;
  icone: typeof Car;
}> = [
  { valor: "VEICULO", rotulo: "Veículo", ajuda: "Carro, moto ou frota do cliente", icone: Car },
  { valor: "PECA", rotulo: "Peça", ajuda: "Componente recebido no balcão", icone: Package },
  { valor: "EQUIPAMENTO", rotulo: "Equipamento", ajuda: "Máquina, gerador, implemento", icone: Cog },
];

/** Label + controle com o mesmo respiro em toda a tela. */
function Campo({
  label,
  ajuda,
  className,
  children,
}: {
  label: string;
  ajuda?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={["space-y-1.5", className].filter(Boolean).join(" ")}>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {ajuda ? <p className="text-[11px] leading-snug text-muted-foreground">{ajuda}</p> : null}
    </div>
  );
}

export const OrcamentoAvulsoForm = forwardRef<OrcamentoAvulsoFormHandle, OrcamentoAvulsoFormProps>(
  function OrcamentoAvulsoForm({ orcamentoId, onTotaisChange, onLoadingChange, onSalvo }, ref) {
    const [cliente, setCliente] = useState<ClienteResumo | null>(null);
    const [descricao, setDescricao] = useState("");
    const [observacoes, setObservacoes] = useState("");
    const [clienteAberto, setClienteAberto] = useState(false);
    const [produtoAberto, setProdutoAberto] = useState(false);
    const [servicoAberto, setServicoAberto] = useState(false);
    const [pronto, setPronto] = useState(false);

    // Alvo: mesma escolha da OS, para a conversão não perguntar de novo o que
    // já se sabia na hora de cotar.
    const [alvoTipo, setAlvoTipo] = useState<AlvoTipoOrcamento>("VEICULO");
    const [veiculo, setVeiculo] = useState<VeiculoResumo | null>(null);
    const [veiculoAberto, setVeiculoAberto] = useState(false);
    const [pecaTitulo, setPecaTitulo] = useState("");
    const [pecaDescricao, setPecaDescricao] = useState("");
    const [pecaLacre, setPecaLacre] = useState("");
    const [equipamentoNome, setEquipamentoNome] = useState("");
    const [equipamentoPatrimonio, setEquipamentoPatrimonio] = useState("");
    const [equipamentoAno, setEquipamentoAno] = useState("");
    const [equipamentoHorimetro, setEquipamentoHorimetro] = useState("");

    // Uma unica leitura preenche cabecalho e carrinho: o GET devolve os dois, e
    // buscar duas vezes deixaria a tela abrir com metade do estado defasada.
    const carregar = useCallback(async () => {
      const detalhe = await carregarOrcamento(orcamentoId as number);
      setCliente(detalhe.cliente ?? null);
      setDescricao(detalhe.descricao ?? "");
      setObservacoes(detalhe.observacoes ?? "");
      setAlvoTipo(detalhe.alvoTipo ?? "VEICULO");
      setVeiculo(detalhe.veiculo ?? null);
      setPecaTitulo(detalhe.peca?.titulo ?? "");
      setPecaDescricao(detalhe.peca?.descricao ?? "");
      setPecaLacre(detalhe.peca?.lacre ?? "");
      setEquipamentoNome(detalhe.equipamento?.nome ?? "");
      setEquipamentoPatrimonio(detalhe.equipamento?.patrimonio ?? "");
      setEquipamentoAno(detalhe.equipamento?.ano == null ? "" : String(detalhe.equipamento.ano));
      setEquipamentoHorimetro(
        detalhe.equipamento?.horimetro == null ? "" : String(detalhe.equipamento.horimetro),
      );
      return {
        produtos: detalhe.produtos ?? [],
        produtosAvulsos: detalhe.produtosAvulsos ?? [],
        servicos: detalhe.servicos ?? [],
        descontoTipo: detalhe.descontoTipo ?? null,
        desconto: Number(detalhe.desconto) || 0,
        valorFrete: Number(detalhe.valorFrete) || 0,
      };
    }, [orcamentoId]);

    const {
      itensProduto,
      itensServico,
      itensProdutoAvulso,
      carregarItens,
      adicionarProduto,
      adicionarServico,
      atualizarProduto,
      atualizarServico,
      removerProduto,
      removerServico,
      adicionarProdutoAvulso,
      atualizarProdutoAvulso,
      removerProdutoAvulso,
      descontoTipo,
      desconto,
      valorFrete,
      setDescontoTipo,
      setDesconto,
      setValorFrete,
      subtotal,
      descontoAplicado,
      totalGeral,
      totalProdutos,
      totalServicos,
    } = useCarrinhoOrcamento(orcamentoId ? carregar : null);

    useEffect(() => {
      onTotaisChange?.({ totalProdutos, totalServicos, totalGeral });
    }, [onTotaisChange, totalProdutos, totalServicos, totalGeral]);

    // Orçamento novo não tem nada a buscar: entra pronto, com o carrinho vazio.
    useEffect(() => {
      let vivo = true;

      if (!orcamentoId) {
        setPronto(true);
        return;
      }

      (async () => {
        onLoadingChange?.(true);
        setPronto(false);
        try {
          await carregarItens();
          if (!vivo) return;
          setPronto(true);
        } catch (erro: any) {
          if (!vivo) return;
          toast.error(erro?.message ?? "Falha ao carregar orçamento");
        } finally {
          if (vivo) onLoadingChange?.(false);
        }
      })();

      return () => {
        vivo = false;
      };
    }, [orcamentoId, carregarItens, onLoadingChange]);

    // Trocar o cliente derruba o veículo: o que estava escolhido pertence à
    // garagem de quem saiu, e mantê-lo faria o orçamento sair com o carro de
    // outra pessoa.
    const trocarCliente = useCallback((novo: ClienteResumo | null) => {
      setCliente((anterior) => {
        if (anterior?.id !== novo?.id) setVeiculo(null);
        return novo;
      });
    }, []);

    const escolherVeiculo = useCallback((selecionado: any) => {
      setVeiculo({
        id: Number(selecionado.id),
        placa: selecionado.placa ?? null,
        modelo: selecionado.modelo ?? null,
        marca: selecionado.marca ?? null,
        ano: selecionado.ano ?? null,
        cor: selecionado.cor ?? null,
      });
    }, []);

    const escolherCliente = useCallback(
      (selecionado: any) =>
        trocarCliente({
          id: Number(selecionado.id),
          nomerazaosocial: selecionado.nomerazaosocial ?? selecionado.nome ?? null,
          cpfcnpj: selecionado.cpfcnpj ?? null,
          telefone: selecionado.telefone ?? null,
          email: selecionado.email ?? null,
        }),
      [trocarCliente],
    );

    const montarPayload = useCallback((): PayloadOrcamento => {
      return {
        clienteid: cliente?.id ?? null,
        alvoTipo,
        // Fora do alvo VEICULO o banco exige veiculoid nulo; mandar o que ficou
        // guardado na tela quebraria o CHECK de coerência.
        veiculoid: alvoTipo === "VEICULO" ? veiculo?.id ?? null : null,
        peca:
          alvoTipo === "PECA"
            ? {
                titulo: pecaTitulo.trim(),
                descricao: pecaDescricao.trim() || null,
                lacre: pecaLacre.trim() || null,
              }
            : null,
        equipamento:
          alvoTipo === "EQUIPAMENTO"
            ? {
                nome: equipamentoNome.trim(),
                patrimonio: equipamentoPatrimonio.trim() || null,
                ano: equipamentoAno.trim() ? Number(equipamentoAno) : null,
                horimetro: equipamentoHorimetro.trim() ? Number(equipamentoHorimetro) : null,
              }
            : null,
        descricao: descricao.trim() || null,
        observacoes: observacoes.trim() || null,
        produtos: itensProduto.map((item) => ({
          produtoid: item.produtoid,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          descontoTipo: item.descontoTipo ?? null,
          desconto: item.desconto ?? 0,
        })),
        servicos: itensServico.map((item) => ({
          servicoid: item.servicoid,
          descricao: item.descricaoServico ?? null,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          descontoTipo: item.descontoTipo ?? null,
          desconto: item.desconto ?? 0,
        })),
        produtosAvulsos: itensProdutoAvulso.map((item) => ({
          descontoInformativoTipo: item.descontoInformativoTipo ?? null,
          descontoInformativo: item.descontoInformativo ?? 0,
          titulo: item.titulo,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          descontoTipo: item.descontoTipo ?? null,
          desconto: item.desconto ?? 0,
        })),
        descontoTipo: descontoTipo ?? null,
        desconto: desconto ?? 0,
        valorFrete: valorFrete ?? 0,
      };
    }, [
      cliente,
      alvoTipo,
      veiculo,
      pecaTitulo,
      pecaDescricao,
      pecaLacre,
      equipamentoNome,
      equipamentoPatrimonio,
      equipamentoAno,
      equipamentoHorimetro,
      descricao,
      observacoes,
      itensProduto,
      itensServico,
      itensProdutoAvulso,
      descontoTipo,
      desconto,
      valorFrete,
    ]);

    const salvar = useCallback(async () => {
      const vazio =
        itensProduto.length === 0 && itensServico.length === 0 && itensProdutoAvulso.length === 0;
      if (vazio) {
        const erro = new Error("Adicione ao menos um produto ou serviço ao orçamento.");
        toast.error(erro.message);
        throw erro;
      }

      // A API valida o mesmo; avisar aqui evita a ida ao servidor só para voltar
      // com o campo obrigatório em branco.
      if (alvoTipo === "PECA" && !pecaTitulo.trim()) {
        const erro = new Error("Informe o nome da peça que será atendida.");
        toast.error(erro.message);
        throw erro;
      }
      if (alvoTipo === "EQUIPAMENTO" && !equipamentoNome.trim()) {
        const erro = new Error("Informe o nome da máquina ou equipamento.");
        toast.error(erro.message);
        throw erro;
      }

      const payload = montarPayload();

      try {
        if (orcamentoId) {
          await salvarOrcamento(orcamentoId, payload);
          toast.success("Orçamento salvo.");
          onSalvo?.(orcamentoId);
          return orcamentoId;
        }

        const { id } = await criarOrcamento(payload);
        toast.success("Orçamento criado.");
        onSalvo?.(id);
        return id;
      } catch (erro: any) {
        toast.error(erro?.message ?? "Falha ao salvar orçamento");
        // Propaga para o dialog não fechar em cima do erro.
        throw erro;
      }
    }, [
      itensProduto,
      itensServico,
      itensProdutoAvulso,
      alvoTipo,
      pecaTitulo,
      equipamentoNome,
      montarPayload,
      orcamentoId,
      onSalvo,
    ]);

    useImperativeHandle(ref, () => ({ salvar }), [salvar]);

    const nomeCliente = useMemo(
      () => cliente?.nomerazaosocial?.trim() || (cliente ? `Cliente #${cliente.id}` : ""),
      [cliente],
    );

    const veiculoRotulo = useMemo(() => {
      if (!veiculo) return "";
      const nome = [veiculo.marca, veiculo.modelo].filter(Boolean).join(" ").trim();
      return nome || `Veículo #${veiculo.id}`;
    }, [veiculo]);

    const selecionarProduto = (produto: any) => {
      const adaptado: ProdutoBusca = {
        id: produto.id,
        codigo: String(produto.codigo ?? produto.referencia ?? produto.codigobarras ?? produto.id),
        referencia: String(produto.referencia ?? produto.codigo ?? "").trim() || null,
        etiqueta: String(produto.etiqueta ?? "").trim() || null,
        descricao: produto.titulo ?? produto.descricao ?? String(produto.id),
        precounitario: Number(produto.precovenda ?? produto.precounitario ?? 0),
        estoque: Number(produto.estoque ?? produto.estoque_atual) || 0,
      };
      adicionarProduto(adaptado);
      toast.success(`Produto "${adaptado.descricao}" adicionado.`);
    };

    const selecionarServico = (servico: any) => {
      const adaptado: ServicoBusca = {
        id: servico.id,
        codigo: String(servico.codigo ?? servico.id),
        referencia: String(servico.codigo ?? "").trim() || null,
        descricao: servico.descricao ?? String(servico.id),
        precohora: Number(servico.precohora ?? servico.valor ?? servico.preco ?? 0),
      };
      adicionarServico(adaptado);
      toast.success(`Serviço "${adaptado.descricao}" adicionado.`);
    };

    if (!pronto) return null;

    return (
      <div className="space-y-6">
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <User2 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base sm:text-lg">Cliente e identificação</CardTitle>
            </div>
            <CardDescription>
              O cliente é opcional — um orçamento de balcão pode ser feito para quem ainda não tem
              cadastro.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <Campo label="Cliente">
              {cliente ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2">
                  <User2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium">{nomeCliente}</span>
                  {cliente.telefone ? (
                    <span className="text-xs text-muted-foreground">{cliente.telefone}</span>
                  ) : null}
                  {cliente.cpfcnpj ? (
                    <span className="text-xs text-muted-foreground">{cliente.cpfcnpj}</span>
                  ) : null}

                  <div className="ml-auto flex items-center gap-1">
                    <CustomerSelect
                      open={clienteAberto}
                      setOpen={setClienteAberto}
                      OnSelect={escolherCliente}
                    >
                      <Button type="button" variant="ghost" size="sm" className="h-7">
                        Trocar
                      </Button>
                    </CustomerSelect>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => trocarCliente(null)}
                      aria-label="Remover cliente"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <CustomerSelect
                  open={clienteAberto}
                  setOpen={setClienteAberto}
                  OnSelect={escolherCliente}
                >
                  <Button
                    type="button"
                    variant="outline"
                    className={`w-full justify-start ${ALTURA_CONTROLE} font-normal text-muted-foreground`}
                  >
                    <User2 className="mr-2 h-4 w-4" />
                    Selecionar cliente
                  </Button>
                </CustomerSelect>
              )}
            </Campo>

            <Campo label="Descrição">
              <Input
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex.: revisão de freios"
                className={ALTURA_CONTROLE}
              />
            </Campo>

            <Campo label="Observações">
              <Textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                rows={3}
                placeholder="Condições, prazo de validade combinado, etc."
                className="resize-y"
              />
            </Campo>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <CardTitle className="text-base sm:text-lg">O que será atendido</CardTitle>
            </div>
            <CardDescription>
              O alvo escolhido aqui vai junto para a OS na conversão — não será perguntado de novo.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <RadioGroup
              value={alvoTipo}
              onValueChange={(valor) => setAlvoTipo(valor as AlvoTipoOrcamento)}
              className="grid gap-2 sm:grid-cols-3"
            >
              {OPCOES_ALVO.map(({ valor, rotulo, ajuda, icone: Icone }) => (
                <Label
                  key={valor}
                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <RadioGroupItem value={valor} className="mt-0.5" />
                  <span className="space-y-0.5">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Icone className="h-4 w-4 text-primary" />
                      {rotulo}
                    </span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {ajuda}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>

            {alvoTipo === "VEICULO" ? (
              <Campo
                label="Veículo"
                ajuda={
                  cliente
                    ? "A busca já vem filtrada pelos veículos deste cliente."
                    : "Selecione o cliente primeiro para a busca trazer só a garagem dele."
                }
              >
                {veiculo ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2">
                    <Car className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-medium">{veiculoRotulo}</span>
                    {veiculo.placa ? (
                      <span className="rounded bg-background px-1.5 py-0.5 text-xs font-semibold tracking-wide">
                        {veiculo.placa}
                      </span>
                    ) : null}
                    {veiculo.ano ? (
                      <span className="text-xs text-muted-foreground">{veiculo.ano}</span>
                    ) : null}

                    <div className="ml-auto flex items-center gap-1">
                      <VehicleSelect
                        open={veiculoAberto}
                        setOpen={setVeiculoAberto}
                        clienteId={cliente?.id ?? null}
                        OnSelect={escolherVeiculo}
                      >
                        <Button type="button" variant="ghost" size="sm" className="h-7">
                          Trocar
                        </Button>
                      </VehicleSelect>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setVeiculo(null)}
                        aria-label="Remover veículo"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <VehicleSelect
                    open={veiculoAberto}
                    setOpen={setVeiculoAberto}
                    clienteId={cliente?.id ?? null}
                    OnSelect={escolherVeiculo}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      className={`w-full justify-start ${ALTURA_CONTROLE} font-normal text-muted-foreground`}
                    >
                      <Car className="mr-2 h-4 w-4" />
                      Selecionar veículo
                    </Button>
                  </VehicleSelect>
                )}
              </Campo>
            ) : alvoTipo === "PECA" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo label="Nome da peça *" className="sm:col-span-2">
                  <Input
                    value={pecaTitulo}
                    onChange={(e) => setPecaTitulo(e.target.value)}
                    placeholder="Ex.: bomba injetora"
                    className={ALTURA_CONTROLE}
                  />
                </Campo>
                <Campo label="Descrição">
                  <Input
                    value={pecaDescricao}
                    onChange={(e) => setPecaDescricao(e.target.value)}
                    placeholder="Marca, modelo, código"
                    className={ALTURA_CONTROLE}
                  />
                </Campo>
                <Campo label="Lacre">
                  <Input
                    value={pecaLacre}
                    onChange={(e) => setPecaLacre(e.target.value)}
                    placeholder="Número do lacre, se houver"
                    className={ALTURA_CONTROLE}
                  />
                </Campo>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo label="Nome da máquina ou equipamento *" className="sm:col-span-2">
                  <Input
                    value={equipamentoNome}
                    onChange={(e) => setEquipamentoNome(e.target.value)}
                    placeholder="Ex.: retroescavadeira 416E"
                    className={ALTURA_CONTROLE}
                  />
                </Campo>
                <Campo label="Patrimônio">
                  <Input
                    value={equipamentoPatrimonio}
                    onChange={(e) => setEquipamentoPatrimonio(e.target.value)}
                    placeholder="Código interno"
                    className={ALTURA_CONTROLE}
                  />
                </Campo>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo label="Ano">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1900}
                      max={3000}
                      value={equipamentoAno}
                      onChange={(e) => setEquipamentoAno(e.target.value)}
                      className={ALTURA_CONTROLE}
                    />
                  </Campo>
                  <Campo label="Horímetro">
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.1"
                      value={equipamentoHorimetro}
                      onChange={(e) => setEquipamentoHorimetro(e.target.value)}
                      className={ALTURA_CONTROLE}
                    />
                  </Campo>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-primary" />
              <CardTitle className="text-base sm:text-lg">Itens do orçamento</CardTitle>
            </div>

            <CardDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm">
                Orçamento não reserva estoque: o saldo só é movimentado quando ele virar uma OS.
              </span>

              <div className="flex flex-row items-center gap-3">
                <ServiceSelect open={servicoAberto} setOpen={setServicoAberto} OnSelect={selecionarServico}>
                  <Button className="hover:cursor-pointer" type="button">
                    <Plus className="h-4 w-4" />
                    Serviço
                  </Button>
                </ServiceSelect>

                <ProductSelect open={produtoAberto} setOpen={setProdutoAberto} OnSelect={selecionarProduto}>
                  <Button className="hover:cursor-pointer" type="button">
                    <Plus className="h-4 w-4" />
                    Produto
                  </Button>
                </ProductSelect>
              </div>
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            <TabelaItensProduto
              itens={itensProduto}
              errosEstoque={{}}
              onAtualizar={atualizarProduto}
              onRemover={(indice) => {
                removerProduto(indice);
                toast.success("Produto removido");
              }}
            />

            <Separator />

            {/* Sempre disponível aqui: cotar peça que a oficina não tem cadastrada
                é justamente o que se faz num orçamento. O flag
                permitir_produto_avulso_os continua valendo só dentro da OS. */}
            <ProdutosAvulsos
              itens={itensProdutoAvulso}
              onAdicionar={adicionarProdutoAvulso}
              onAtualizar={atualizarProdutoAvulso}
              onRemover={removerProdutoAvulso}
            />

            <Separator />

            <TabelaItensServico
              itens={itensServico}
              onAtualizar={atualizarServico}
              onRemover={(indice) => {
                removerServico(indice);
                toast.success("Serviço removido");
              }}
            />

            <Separator />

            <div className="grid gap-5 rounded-md border bg-muted/20 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">Desconto e frete</h3>
                  <p className="text-xs text-muted-foreground">
                    O desconto total é aplicado depois dos descontos individuais dos itens.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px]">
                  <Campo label="Tipo e valor do desconto">
                    <CampoDesconto
                      tipo={descontoTipo}
                      valor={desconto}
                      onTipoChange={setDescontoTipo}
                      onValorChange={setDesconto}
                      className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                      selectClassName={ALTURA_CONTROLE}
                      inputClassName={ALTURA_CONTROLE}
                    />
                  </Campo>

                  <Campo label="Frete">
                    <ValueInput
                      value={valorFrete}
                      onValueChange={setValorFrete}
                      className={ALTURA_CONTROLE}
                    />
                  </Campo>
                </div>
              </div>

              <div className="space-y-2 rounded-md border bg-background/70 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="min-w-[130px] text-right font-medium tabular-nums">
                    {dinheiro(subtotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Desconto</span>
                  <span className="min-w-[130px] text-right font-medium tabular-nums">
                    - {dinheiro(descontoAplicado)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Frete</span>
                  <span className="min-w-[130px] text-right font-medium tabular-nums">
                    + {dinheiro(valorFrete)}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-3 text-base">
                  <span className="font-medium">Total</span>
                  <span className="min-w-[130px] text-right font-bold tabular-nums">
                    {dinheiro(totalGeral)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  },
);

export default OrcamentoAvulsoForm;
