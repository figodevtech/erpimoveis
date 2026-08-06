"use client";

import { useRef } from "react";
import { Banknote, FileText, History, Layers, Link2, Loader2, Percent, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  CABECALHO_FIXO,
  COLUNA_CHEIA,
  MIOLO_ROLAVEL,
  RODAPE_FIXO,
  classesDoConteudo,
} from "./shell";
import { AdiantamentoTab } from "./tabs/adiantamento-tab";
import { AjustesTab } from "./tabs/ajustes-tab";
import { ClienteTab } from "./tabs/cliente-tab";
import { DetalhesTab } from "./tabs/detalhes-tab";
import { HistoricoTab } from "./tabs/historico-tab";
import { ParcelasTab } from "./tabs/parcelas-tab";
import { VinculoTab } from "./tabs/vinculo-tab";
import { tabsListClass, tabTriggerClass } from "./tabs/shared";
import { useTransacaoEdicao } from "./use-transacao-edicao";

interface EditContentProps {
  selectedTransactionId: number | undefined;
  isDesktop: boolean;
  editable: boolean;
  handleGetTransactions?: (pageNumber?: number) => void;
  setOpen?: (value: boolean) => void;
}

/** Ocupa a altura toda do miolo, sem tirar a rolagem dele. */
function MioloCentralizado({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 text-center">
      {children}
    </div>
  );
}

function AbaCarregando() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 py-16">
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      <span className="text-xs text-muted-foreground">Carregando</span>
    </div>
  );
}

/**
 * Dialog de visualização/edição de uma transação.
 *
 * Orquestra apenas: o carregamento vive no hook, e cada aba cuida do próprio
 * conteúdo e das próprias listas de apoio. O casco (cabeçalho fixo, miolo
 * rolável, rodapé fixo) é o mesmo nos três estados — carregando, erro e
 * carregado — para o dialog não mudar de tamanho enquanto abre.
 */
export default function EditContent({
  selectedTransactionId,
  isDesktop,
  editable,
  handleGetTransactions,
  setOpen,
}: EditContentProps) {
  const {
    form,
    setForm,
    setCampo,
    contexto,
    carregando,
    carregandoContexto,
    salvando,
    erro,
    salvar,
    recarregar,
    descontos,
    aplicarTotais,
    recarregarContextoSilencioso,
  } = useTransacaoEdicao(selectedTransactionId);

  /**
   * Lançar acréscimo ou desconto muda o valor da transação, e a lista atrás do
   * dialog mostra esse valor. Refazer a lista a cada linha faria a tela piscar,
   * então a atualização é adiada para quando o dialog fechar — que é quando o
   * usuário volta a olhar para ela.
   */
  const listaDesatualizada = useRef(false);

  const fechar = () => {
    if (listaDesatualizada.current) {
      listaDesatualizada.current = false;
      handleGetTransactions?.();
    }
  };

  const Content = isDesktop ? DialogContent : DrawerContent;
  const Header = isDesktop ? DialogHeader : DrawerHeader;
  const Footer = isDesktop ? DialogFooter : DrawerFooter;
  const Title = isDesktop ? DialogTitle : DrawerTitle;
  const Description = isDesktop ? DialogDescription : DrawerDescription;
  const Close = isDesktop ? DialogClose : DrawerClose;

  const origem = contexto?.relacionadas.origem ?? "NENHUM";
  /**
   * Em OS e venda o editor rateia mantendo a soma do documento. Em avulso — solto
   * ou parcelado — nao ha soma a preservar: cada parcela e editada por conta
   * propria e o total do parcelamento acompanha. Antes disso, avulso nao tinha
   * nenhum caminho de correcao pela tela.
   */
  const permiteRateio = origem === "OS" || origem === "VENDA";
  const permiteEditarValor = editable && !permiteRateio;

  const salvarEFechar = async () => {
    const deuCerto = await salvar();
    if (!deuCerto) return;
    handleGetTransactions?.();
    setOpen?.(false);
  };

  const descricao = carregando
    ? "Carregando os dados da transação"
    : !form
      ? (erro ?? "Nenhuma transação selecionada.")
      : editable
        ? "Altere os dados da transação"
        : "Visualize os dados da transação";

  return (
    <Content className={classesDoConteudo(isDesktop)}>
      <div className={COLUNA_CHEIA}>
        <Header className={CABECALHO_FIXO}>
          <Title>
            {selectedTransactionId ? `Transação #${selectedTransactionId}` : "Transação"}
          </Title>
          <Description>{descricao}</Description>
        </Header>

        <div className={`${MIOLO_ROLAVEL} bg-muted-foreground/5 px-4 py-6`}>
          {carregando ? (
            <MioloCentralizado>
              <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
              <span className="text-sm text-primary">Carregando</span>
            </MioloCentralizado>
          ) : !form ? (
            <MioloCentralizado>
              <p className="max-w-sm text-sm text-muted-foreground">
                {erro ?? "Selecione uma transação para ver os detalhes."}
              </p>
              {erro ? (
                <Button variant="outline" onClick={recarregar}>
                  Tentar novamente
                </Button>
              ) : null}
            </MioloCentralizado>
          ) : (
            <Tabs defaultValue="detalhes" className="space-y-3">
              <div className="overflow-x-auto pb-1">
                <TabsList className={tabsListClass}>
                  <TabsTrigger value="detalhes" className={tabTriggerClass}>
                    <span className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                      Detalhes
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="parcelas" className={tabTriggerClass}>
                    <span className="flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5" aria-hidden />
                      Parcelas
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="ajustes" className={tabTriggerClass}>
                    <span className="flex items-center gap-2">
                      <Percent className="h-3.5 w-3.5" aria-hidden />
                      Acréscimos e descontos
                    </span>
                  </TabsTrigger>
                  {form.eh_adiantamento || form.adiantamento_id ? (
                    <TabsTrigger value="adiantamento" className={tabTriggerClass}>
                      <span className="flex items-center gap-2">
                        <Banknote className="h-3.5 w-3.5" aria-hidden />
                        Adiantamento
                      </span>
                    </TabsTrigger>
                  ) : null}
                  <TabsTrigger value="cliente" className={tabTriggerClass}>
                    <span className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5" aria-hidden />
                      Cliente
                    </span>
                  </TabsTrigger>
                  {contexto?.vinculo ? (
                    <TabsTrigger value="vinculo" className={tabTriggerClass}>
                      <span className="flex items-center gap-2">
                        <Link2 className="h-3.5 w-3.5" aria-hidden />
                        {contexto.vinculo.tipo === "OS" ? "Ordem de serviço" : "Venda"}
                      </span>
                    </TabsTrigger>
                  ) : null}
                  <TabsTrigger value="historico" className={tabTriggerClass}>
                    <span className="flex items-center gap-2">
                      <History className="h-3.5 w-3.5" aria-hidden />
                      Histórico
                    </span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="detalhes" className="mt-0">
                <DetalhesTab
                  form={form}
                  setForm={setForm}
                  setCampo={setCampo}
                  editavel={editable}
                  permiteRateio={permiteRateio}
                  permiteEditarValor={permiteEditarValor}
                  descontos={descontos}
                />
              </TabsContent>

              <TabsContent value="parcelas" className="mt-0">
                {carregandoContexto || !contexto ? (
                  <AbaCarregando />
                ) : (
                  <ParcelasTab
                    origem={contexto.relacionadas.origem}
                    itens={contexto.relacionadas.itens}
                    resumo={contexto.relacionadas.resumo}
                    transacaoAtualId={form.id}
                    editavel={editable}
                    onAjustado={() => {
                      recarregar();
                      handleGetTransactions?.();
                    }}
                  />
                )}
              </TabsContent>

              <TabsContent value="ajustes" className="mt-0">
                <AjustesTab
                  transacaoId={form.id}
                  totais={form}
                  pendente={Boolean(form.pendente)}
                  editavel={editable}
                  onAlterado={(transacao, quantidadeDeDescontos) => {
                    // Costura os totais no formulário em vez de recarregar: o
                    // usuário continua na aba, e o que ele digitou nos outros
                    // campos e ainda não salvou não se perde.
                    aplicarTotais(transacao, quantidadeDeDescontos);
                    // A aba Parcelas mostra bruto e líquido de cada irmã, e isso
                    // vem do contexto, não do formulário. Sem esta releitura ela
                    // seguiria com o valor velho — que foi o que apareceu na #87.
                    recarregarContextoSilencioso();
                    // A lista atrás só precisa saber no fim. Refazê-la a cada
                    // linha lançada faria a tela inteira piscar.
                    listaDesatualizada.current = true;
                  }}
                />
              </TabsContent>

              <TabsContent value="adiantamento" className="mt-0">
                <AdiantamentoTab transacaoId={form.id} />
              </TabsContent>

              <TabsContent value="cliente" className="mt-0">
                {carregandoContexto || !contexto ? (
                  <AbaCarregando />
                ) : (
                  <ClienteTab
                    cliente={contexto.cliente}
                    fornecedor={contexto.fornecedor}
                    nomepagador={form.nomepagador}
                    cpfcnpjpagador={form.cpfcnpjpagador}
                  />
                )}
              </TabsContent>

              {contexto?.vinculo ? (
                <TabsContent value="vinculo" className="mt-0">
                  <VinculoTab vinculo={contexto.vinculo} />
                </TabsContent>
              ) : null}

              <TabsContent value="historico" className="mt-0">
                {carregandoContexto || !contexto ? (
                  <AbaCarregando />
                ) : (
                  <HistoricoTab
                    baixa={contexto.baixa}
                    ajustes={contexto.ajustes ?? []}
                    auditoria={contexto.auditoria}
                  />
                )}
              </TabsContent>
            </Tabs>
          )}
        </div>

        <Footer className={RODAPE_FIXO}>
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:gap-3">
            <Close asChild>
              <Button variant="outline" className="w-full sm:w-auto" onClick={fechar}>
                {form ? "Cancelar" : "Fechar"}
              </Button>
            </Close>
            {editable && form ? (
              <Button
                className="w-full sm:w-auto"
                onClick={() => void salvarEFechar()}
                disabled={salvando}
              >
                {salvando ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Salvando...
                  </>
                ) : (
                  "Salvar alterações"
                )}
              </Button>
            ) : null}
          </div>
        </Footer>
      </div>
    </Content>
  );
}
