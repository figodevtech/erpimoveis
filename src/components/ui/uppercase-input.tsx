"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type UppercaseInputProps = Omit<React.ComponentProps<typeof Input>, "value" | "defaultValue" | "onChange"> & {
  value?: string | null;
  onValueChange?: (value: string) => void;
  /**
   * Ajuste depois das maiúsculas: filtro de caracteres, limite, hífen da placa.
   * Também é aplicado ao trecho antes do cursor para achar a nova posição dele,
   * então precisa tratar o começo do texto do mesmo jeito que o texto inteiro.
   */
  format?: (value: string) => string;
};

/**
 * Campo que converte para maiúsculas enquanto se digita, sem tirar o cursor do
 * lugar. Devolver ao state um valor diferente do que está no campo faz o React
 * reescrevê-lo inteiro, e o cursor pula para o fim: quem voltava para inserir
 * uma palavra no meio via o resto da digitação cair no final. Aqui o valor
 * convertido é gravado direto no campo, com a seleção recalculada, e o React
 * encontra o mesmo valor e não mexe.
 *
 * Durante a composição (acento com tecla morta, teclado do celular) o texto fica
 * como veio e só é convertido no compositionend — trocar no meio dela duplica
 * ou perde letras. O `uppercase` do CSS cobre a aparência nesse intervalo.
 */
export function UppercaseInput({
  value,
  onValueChange,
  format,
  className,
  onCompositionEnd,
  ...props
}: UppercaseInputProps) {
  const normalizar = (texto: string) => {
    const maiusculo = texto.toLocaleUpperCase("pt-BR");
    return format ? format(maiusculo) : maiusculo;
  };

  const aplicar = (input: HTMLInputElement) => {
    const { value: digitado, selectionStart, selectionEnd } = input;
    const proximo = normalizar(digitado);
    if (proximo !== digitado) {
      input.value = proximo;
      if (selectionStart !== null && selectionEnd !== null) {
        input.setSelectionRange(
          normalizar(digitado.slice(0, selectionStart)).length,
          normalizar(digitado.slice(0, selectionEnd)).length,
        );
      }
    }
    onValueChange?.(proximo);
  };

  return (
    <Input
      {...props}
      value={value ?? ""}
      className={cn("uppercase placeholder:normal-case", className)}
      onChange={(event) => {
        if ((event.nativeEvent as InputEvent).isComposing) onValueChange?.(event.target.value);
        else aplicar(event.target);
      }}
      onCompositionEnd={(event) => {
        aplicar(event.currentTarget);
        onCompositionEnd?.(event);
      }}
    />
  );
}

export default UppercaseInput;
