"use client";

import { FileText, ListChecks, Split, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { AcaoEmLote } from "./useSelecaoMultipla";

/**
 * Entrada única da seleção múltipla, no cabeçalho das listas de pagamento.
 *
 * Um botão só, e o tipo de seleção se escolhe dentro dele. Com um botão por
 * ação a barra crescia a cada ação nova — e elas são mutuamente exclusivas,
 * que é justamente o que um grupo de rádio comunica.
 *
 * Quando só há uma ação disponível — emissão desligada na configuração, ou o
 * usuário sem permissão de notas —, o menu não tem o que perguntar e o
 * componente vira um botão direto.
 */

const ACOES: Record<
  AcaoEmLote,
  { rotulo: string; rotuloCurto: string; descricao: string; Icone: typeof Split }
> = {
  PAGAMENTO: {
    rotulo: "Pagamento múltiplo",
    rotuloCurto: "Pagamento",
    descricao: "Um pagamento rateado entre os documentos marcados.",
    Icone: Split,
  },
  NOTA: {
    rotulo: "Emitir nota fiscal",
    rotuloCurto: "Nota fiscal",
    descricao: "Uma nota só, cobrindo tudo que for marcado do mesmo cliente.",
    Icone: FileText,
  },
};

export function SelecaoMultiplaMenu({
  acaoAlvo,
  disponiveis,
  onEscolher,
  onSair,
}: {
  acaoAlvo: AcaoEmLote | null;
  /** As ações que esta tela oferece, na ordem em que devem aparecer. */
  disponiveis: AcaoEmLote[];
  onEscolher: (acao: AcaoEmLote) => void;
  onSair: () => void;
}) {
  if (disponiveis.length === 0) return null;

  const ativa = acaoAlvo && disponiveis.includes(acaoAlvo) ? acaoAlvo : null;
  const IconeAtivo = ativa ? ACOES[ativa].Icone : ListChecks;

  if (disponiveis.length === 1) {
    const unica = disponiveis[0];
    const { rotulo, Icone } = ACOES[unica];
    return (
      <Button
        variant={ativa ? "secondary" : "ghost"}
        size="sm"
        className="hover:cursor-pointer"
        aria-pressed={ativa === unica}
        onClick={() => (ativa === unica ? onSair() : onEscolher(unica))}
      >
        <Icone className="h-4 w-4" aria-hidden />
        {rotulo}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={ativa ? "secondary" : "ghost"}
          size="sm"
          className="hover:cursor-pointer"
          aria-pressed={Boolean(ativa)}
        >
          <IconeAtivo className="h-4 w-4" aria-hidden />
          {ativa ? ACOES[ativa].rotuloCurto : "Selecionar"}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Tipo de seleção</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={ativa ?? ""}
          onValueChange={(valor) => onEscolher(valor as AcaoEmLote)}
        >
          {disponiveis.map((acao) => {
            const { rotulo, descricao, Icone } = ACOES[acao];
            return (
              <DropdownMenuRadioItem key={acao} value={acao} className="items-start gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <Icone className="h-4 w-4" aria-hidden />
                    {rotulo}
                  </span>
                  <span className="text-xs text-muted-foreground">{descricao}</span>
                </div>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>

        {ativa ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSair}>
              <X className="h-4 w-4" aria-hidden />
              Sair da seleção
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
