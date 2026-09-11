"use client";

// Cadastro dos dizeres impressos no rodape da ordem de servico.
//
// A lista inteira e editada em memoria e salva de uma vez (PUT
// /api/config/termos-os), como o card de destaque por status: sao poucos
// blocos, e trocar tudo junto evita a OS imprimir um estado pela metade.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileSignature,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rotuloStatusOS, STATUS_OS_VALIDOS, type StatusOSValido } from "@/lib/ordens/destaque";
import {
  ALVOS_TERMO,
  aplicarVariaveis,
  GRUPOS_STATUS_TERMO,
  nomeAlvo,
  TERMO_INTRO_MAX,
  TERMO_ITEM_MAX,
  TERMO_ITENS_MAX,
  TERMO_TITULO_MAX,
  VARIAVEIS_TERMO,
  type AlvoTermo,
  type TermoImpressao,
} from "@/lib/ordens/termos-impressao";
import { TERMOS_OS_PADRAO } from "@/lib/ordens/termos-impressao-padrao";

type TermoRascunho = {
  uid: string;
  titulo: string;
  intro: string;
  itens: string[];
  status: StatusOSValido[];
  alvos: AlvoTermo[];
};

/** Dados de exemplo da previa: empresa, OS e cliente so existem na hora de imprimir. */
const EXEMPLO_PREVIA = {
  empresaNome: "Sua Oficina",
  osNumero: "1234",
  clienteNome: "Nome do Cliente",
};

const TERMO_VAZIO: Omit<TermoRascunho, "uid"> = {
  titulo: "",
  intro: "Declaro estar ciente de que:",
  itens: [""],
  status: [],
  alvos: ["VEICULO", "PECA", "EQUIPAMENTO"],
};

let contadorUid = 0;
function novoUid() {
  contadorUid += 1;
  return `termo-${contadorUid}`;
}

function paraRascunho(termo: TermoImpressao): TermoRascunho {
  return {
    uid: novoUid(),
    titulo: termo.titulo,
    intro: termo.intro,
    itens: termo.itens.length > 0 ? [...termo.itens] : [""],
    status: [...termo.status],
    alvos: [...termo.alvos],
  };
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "Não foi possível concluir a operação.");
  return body;
}

function mensagemErro(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

function trocar<T>(lista: T[], de: number, para: number) {
  if (para < 0 || para >= lista.length) return lista;
  const copia = [...lista];
  [copia[de], copia[para]] = [copia[para], copia[de]];
  return copia;
}

export function TermosImpressaoOSCard() {
  const [termos, setTermos] = useState<TermoRascunho[]>([]);
  const [padrao, setPadrao] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [alterado, setAlterado] = useState(false);

  const [dialogAberto, setDialogAberto] = useState(false);
  const [editandoUid, setEditandoUid] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<TermoRascunho>({ uid: "", ...TERMO_VAZIO });
  const [alvoPrevia, setAlvoPrevia] = useState<AlvoTermo>("VEICULO");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const body = await requestJson("/api/config/termos-os");
      setTermos(((body.termos ?? []) as TermoImpressao[]).map(paraRascunho));
      setPadrao(Boolean(body.padrao));
      setAlterado(false);
    } catch (error) {
      toast.error(mensagemErro(error));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const atualizarTermos = useCallback((proximos: TermoRascunho[]) => {
    setTermos(proximos);
    setAlterado(true);
  }, []);

  const salvar = useCallback(async () => {
    setSalvando(true);
    try {
      const body = await requestJson("/api/config/termos-os", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termos: termos.map((termo) => ({
            titulo: termo.titulo,
            intro: termo.intro,
            itens: termo.itens,
            status: termo.status,
            alvos: termo.alvos,
          })),
        }),
      });
      setTermos(((body.termos ?? []) as TermoImpressao[]).map(paraRascunho));
      setPadrao(Boolean(body.padrao));
      setAlterado(false);
      toast.success("Dizeres da ordem de serviço salvos.");
    } catch (error) {
      toast.error(mensagemErro(error));
    } finally {
      setSalvando(false);
    }
  }, [termos]);

  const abrirNovo = () => {
    setEditandoUid(null);
    setRascunho({ uid: novoUid(), ...TERMO_VAZIO, itens: [""] });
    setAlvoPrevia("VEICULO");
    setDialogAberto(true);
  };

  const abrirEdicao = (termo: TermoRascunho) => {
    setEditandoUid(termo.uid);
    setRascunho({
      ...termo,
      itens: [...termo.itens],
      status: [...termo.status],
      alvos: [...termo.alvos],
    });
    setAlvoPrevia(termo.alvos[0] ?? "VEICULO");
    setDialogAberto(true);
  };

  const aplicarRascunho = () => {
    const itens = rascunho.itens.map((item) => item.trim()).filter((item) => item.length > 0);
    if (!rascunho.titulo.trim()) {
      toast.error("Informe o título do bloco.");
      return;
    }
    if (itens.length === 0) {
      toast.error("Escreva ao menos um item de dizeres.");
      return;
    }

    const limpo: TermoRascunho = {
      ...rascunho,
      titulo: rascunho.titulo.trim(),
      intro: rascunho.intro.trim(),
      itens,
    };
    atualizarTermos(
      editandoUid
        ? termos.map((termo) => (termo.uid === editandoUid ? limpo : termo))
        : [...termos, limpo],
    );
    setDialogAberto(false);
  };

  /**
   * Traz de volta os textos de fábrica — os mesmos que a migration semeou e que
   * já eram impressos antes de os dizeres virarem cadastro. Só entra na lista
   * em memória: nada é gravado enquanto o usuário não salvar.
   */
  const restaurarPadrao = () => {
    atualizarTermos(TERMOS_OS_PADRAO.map(paraRascunho));
    toast.info("Textos padrão carregados. Salve para aplicá-los à impressão.");
  };

  const previa = useMemo(() => {
    const ctx = { alvo: alvoPrevia, ...EXEMPLO_PREVIA };
    return {
      titulo: aplicarVariaveis(rascunho.titulo, ctx),
      intro: aplicarVariaveis(rascunho.intro, ctx),
      itens: rascunho.itens.filter((item) => item.trim()).map((item) => aplicarVariaveis(item, ctx)),
    };
  }, [rascunho, alvoPrevia]);

  const alternarStatus = (status: StatusOSValido) => {
    setRascunho((atual) => ({
      ...atual,
      status: atual.status.includes(status)
        ? atual.status.filter((item) => item !== status)
        : [...atual.status, status],
    }));
  };

  const alternarAlvo = (alvo: AlvoTermo) => {
    setRascunho((atual) => ({
      ...atual,
      alvos: atual.alvos.includes(alvo)
        ? atual.alvos.filter((item) => item !== alvo)
        : [...atual.alvos, alvo],
    }));
  };

  return (
    <Card className="border-primary/10 shadow-sm lg:col-span-12">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" />
            <CardTitle>Dizeres da impressão da ordem de serviço</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={restaurarPadrao}
              disabled={carregando || salvando}
              title="Volta aos textos que o sistema já imprimia antes do cadastro"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Restaurar padrão
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={abrirNovo} disabled={carregando}>
              <Plus className="mr-2 h-4 w-4" />
              Novo bloco
            </Button>
            <Button type="button" size="sm" onClick={salvar} disabled={!alterado || salvando}>
              {salvando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Salvar dizeres
            </Button>
          </div>
        </div>
        <CardDescription>
          O texto que o cliente assina no rodapé da OS. Cada bloco escolhe em quais status e em
          quais tipos de objeto ele é impresso — dois blocos no mesmo status saem um abaixo do
          outro, na ordem da lista.
          {padrao &&
            " Atenção: a tabela de dizeres ainda não existe neste banco, então a lista abaixo vem" +
              " dos textos padrão do sistema e o salvamento só funcionará depois da migration."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {carregando ? (
          <div className="space-y-3">
            {[0, 1, 2].map((linha) => (
              <div key={linha} className="h-20 animate-pulse rounded-lg border bg-muted/30" />
            ))}
          </div>
        ) : termos.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum bloco cadastrado. A ordem de serviço é impressa sem termo de aceite — use
            &ldquo;Restaurar padrão&rdquo; para trazer de volta os textos do sistema.
          </p>
        ) : (
          <div className="space-y-3">
            {termos.map((termo, indice) => (
              <div key={termo.uid} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <p className="font-medium leading-tight">{termo.titulo}</p>
                    <div className="flex flex-wrap gap-1">
                      {termo.alvos.length === 0 ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Nenhum tipo de objeto
                        </Badge>
                      ) : (
                        termo.alvos.map((alvo) => (
                          <Badge key={alvo} variant="secondary">
                            {ALVOS_TERMO.find((item) => item.valor === alvo)?.label}
                          </Badge>
                        ))
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {termo.status.length === 0 ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          Nenhum status — não será impresso
                        </Badge>
                      ) : (
                        termo.status.map((status) => (
                          <Badge key={status} variant="outline" className="font-normal">
                            {rotuloStatusOS(status)}
                          </Badge>
                        ))
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {termo.itens.length} {termo.itens.length === 1 ? "item" : "itens"}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Mover para cima"
                      disabled={indice === 0}
                      onClick={() => atualizarTermos(trocar(termos, indice, indice - 1))}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Mover para baixo"
                      disabled={indice === termos.length - 1}
                      onClick={() => atualizarTermos(trocar(termos, indice, indice + 1))}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Editar"
                      onClick={() => abrirEdicao(termo)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir"
                      onClick={() => atualizarTermos(termos.filter((item) => item.uid !== termo.uid))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {alterado && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            Há alterações não salvas. Elas só chegam à impressão depois de salvar.
          </p>
        )}
      </CardContent>

      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editandoUid ? "Editar bloco de dizeres" : "Novo bloco de dizeres"}
            </DialogTitle>
            <DialogDescription>
              O bloco é impresso quando a OS estiver em um dos status marcados e for do tipo de
              objeto escolhido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="termo-titulo">Título</Label>
                <Input
                  id="termo-titulo"
                  value={rascunho.titulo}
                  maxLength={TERMO_TITULO_MAX}
                  placeholder="Ex.: Termo de aceite do orçamento"
                  onChange={(e) => setRascunho((atual) => ({ ...atual, titulo: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="termo-intro">Introdução (opcional)</Label>
                <Input
                  id="termo-intro"
                  value={rascunho.intro}
                  maxLength={TERMO_INTRO_MAX}
                  placeholder="Ex.: Declaro estar ciente de que:"
                  onChange={(e) => setRascunho((atual) => ({ ...atual, intro: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Itens</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={rascunho.itens.length >= TERMO_ITENS_MAX}
                  onClick={() => setRascunho((atual) => ({ ...atual, itens: [...atual.itens, ""] }))}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar item
                </Button>
              </div>

              {rascunho.itens.map((item, indice) => (
                <div key={indice} className="flex items-start gap-2">
                  <Textarea
                    value={item}
                    rows={3}
                    maxLength={TERMO_ITEM_MAX}
                    placeholder="Texto do item, uma frase por item."
                    onChange={(e) =>
                      setRascunho((atual) => ({
                        ...atual,
                        itens: atual.itens.map((valor, i) => (i === indice ? e.target.value : valor)),
                      }))
                    }
                  />
                  <div className="flex flex-col gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Mover item para cima"
                      disabled={indice === 0}
                      onClick={() =>
                        setRascunho((atual) => ({
                          ...atual,
                          itens: trocar(atual.itens, indice, indice - 1),
                        }))
                      }
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Mover item para baixo"
                      disabled={indice === rascunho.itens.length - 1}
                      onClick={() =>
                        setRascunho((atual) => ({
                          ...atual,
                          itens: trocar(atual.itens, indice, indice + 1),
                        }))
                      }
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remover item"
                      disabled={rascunho.itens.length === 1}
                      onClick={() =>
                        setRascunho((atual) => ({
                          ...atual,
                          itens: atual.itens.filter((_, i) => i !== indice),
                        }))
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}

              <div className="text-xs text-muted-foreground">
                Variáveis disponíveis:
                <ul className="mt-1 space-y-0.5">
                  {VARIAVEIS_TERMO.map((variavel) => (
                    <li key={variavel.chave}>
                      <code className="rounded bg-muted px-1">{`{{${variavel.chave}}}`}</code>{" "}
                      {variavel.descricao}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tipos de objeto</Label>
              <div className="flex flex-wrap gap-4">
                {ALVOS_TERMO.map((alvo) => (
                  <label key={alvo.valor} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={rascunho.alvos.includes(alvo.valor)}
                      onCheckedChange={() => alternarAlvo(alvo.valor)}
                    />
                    {alvo.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Status da OS</Label>
                <div className="flex gap-2">
                  {GRUPOS_STATUS_TERMO.map((grupo) => (
                    <Button
                      key={grupo.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      title={grupo.descricao}
                      onClick={() => setRascunho((atual) => ({ ...atual, status: [...grupo.status] }))}
                    >
                      {grupo.label}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRascunho((atual) => ({ ...atual, status: [] }))}
                  >
                    Limpar
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {STATUS_OS_VALIDOS.map((status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant={rascunho.status.includes(status) ? "default" : "outline"}
                    className="h-7 text-xs font-normal"
                    onClick={() => alternarStatus(status)}
                  >
                    {rotuloStatusOS(status)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Pré-visualização</Label>
                <div className="flex gap-2">
                  {ALVOS_TERMO.map((alvo) => (
                    <Button
                      key={alvo.valor}
                      type="button"
                      size="sm"
                      variant={alvoPrevia === alvo.valor ? "secondary" : "ghost"}
                      className="h-7 text-xs"
                      onClick={() => setAlvoPrevia(alvo.valor)}
                    >
                      {alvo.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                <p className="font-bold uppercase tracking-wider text-primary">
                  {previa.titulo || "Título do bloco"}
                </p>
                {previa.intro && <p className="mt-1 font-semibold">{previa.intro}</p>}
                {previa.itens.map((item, indice) => (
                  <p key={indice} className="mt-1 leading-snug">
                    {item}
                  </p>
                ))}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Empresa, número da OS e cliente aparecem aqui como exemplo — na impressão vêm da
                  ordem de serviço. Alvo em exibição: {nomeAlvo(alvoPrevia)}.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogAberto(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={aplicarRascunho}>
              {editandoUid ? "Aplicar alterações" : "Adicionar bloco"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
