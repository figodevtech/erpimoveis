"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  formatarDataDigitada,
  interpretarDataDigitada,
  mascararDataDigitada,
} from "@/lib/data-digitada";
import { cn } from "@/lib/utils";

function formatDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateValue(value?: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDisplayDate(value?: string) {
  const date = parseDateValue(value);
  return date ? date.toLocaleDateString("pt-BR") : "";
}

type DatePickerProps = {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  id?: string;
  "aria-label"?: string;
  /**
   * Libera digitar a data no campo, com o calendário no ícone ao lado.
   *
   * Fica de fora por padrão: onde se escolhe uma data só, o botão de sempre
   * basta. Vale ligar onde a tela pede várias datas seguidas — aí navegar mês a
   * mês em cada uma é o que custa caro.
   */
  allowTyping?: boolean;
};

export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  min,
  max,
  id,
  "aria-label": ariaLabel,
  allowTyping = false,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const minDate = parseDateValue(min);
  const maxDate = parseDateValue(max);
  const foraDoIntervalo = (date: Date) =>
    Boolean((minDate && date < minDate) || (maxDate && date > maxDate));

  const calendario = (
    <Calendar
      mode="single"
      selected={parseDateValue(value)}
      disabled={(date) => foraDoIntervalo(date)}
      onSelect={(date) => {
        if (!date) return;
        onChange(formatDateValue(date));
        setOpen(false);
      }}
      initialFocus
    />
  );

  if (!allowTyping) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            aria-label={ariaLabel}
            variant="outline"
            disabled={disabled}
            className={cn("h-9 w-full justify-start text-left font-normal", !value && "text-muted-foreground", className)}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? formatDisplayDate(value) : placeholder ?? "Selecione"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          {calendario}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <DateInput
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? "dd/mm/aaaa"}
      className={className}
      disabled={disabled}
      id={id}
      aria-label={ariaLabel}
      foraDoIntervalo={foraDoIntervalo}
      open={open}
      setOpen={setOpen}
      calendario={calendario}
    />
  );
}

function DateInput({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  id,
  "aria-label": ariaLabel,
  foraDoIntervalo,
  open,
  setOpen,
  calendario,
}: {
  value?: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  foraDoIntervalo: (date: Date) => boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  calendario: React.ReactNode;
}) {
  const [rascunho, setRascunho] = React.useState(() => formatarDataDigitada(value));
  const [digitando, setDigitando] = React.useState(false);

  /*
   * O valor também muda por fora: pelo calendário, por um "restaurar", por um
   * recarregamento depois de salvar. Enquanto o cursor está no campo, porém,
   * quem manda é o que a pessoa está escrevendo — sincronizar no meio da
   * digitação apagaria a data pela metade.
   */
  React.useEffect(() => {
    if (!digitando) setRascunho(formatarDataDigitada(value));
  }, [value, digitando]);

  /** Publica a data se ela existir e couber no intervalo. Devolve o que valeu. */
  const comitar = (texto: string): string | null => {
    const iso = interpretarDataDigitada(texto);
    if (!iso) return null;

    const data = parseDateValue(iso);
    if (!data || foraDoIntervalo(data)) return null;

    if (iso !== value) onChange(iso);
    return iso;
  };

  const digitar = (texto: string) => {
    const mascarado = mascararDataDigitada(texto);
    setRascunho(mascarado);

    // Oito dígitos já é data inteira: vale na hora, para quem digita e segue de
    // Tab em Tab sem confirmar nada.
    if (mascarado.replace(/\D/g, "").length === 8) comitar(mascarado);
  };

  /** Sair do campo decide: ou a data vale e fica normalizada, ou volta o que era. */
  const encerrar = () => {
    setDigitando(false);

    const texto = rascunho.trim();
    if (!texto) {
      if (value) onChange("");
      setRascunho("");
      return;
    }

    const iso = comitar(texto);
    setRascunho(formatarDataDigitada(iso ?? value));
  };

  return (
    <div className="relative">
      <Input
        id={id}
        aria-label={ariaLabel}
        value={rascunho}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        className={cn("pr-9", className)}
        onFocus={() => setDigitando(true)}
        onChange={(evento) => digitar(evento.target.value)}
        onBlur={encerrar}
        onKeyDown={(evento) => {
          // Enter confirma sem tirar o foco: o Tab seguinte continua sendo do
          // usuário, e o diálogo em volta não recebe a tecla.
          if (evento.key !== "Enter") return;
          evento.preventDefault();
          const iso = comitar(rascunho);
          if (iso) setRascunho(formatarDataDigitada(iso));
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Escolher no calendário"
            className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          {calendario}
        </PopoverContent>
      </Popover>
    </div>
  );
}
