"use client";

import * as React from "react";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function toValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toDate(value?: string) {
  if (!value) return undefined;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** "14:00:00" (como o Postgres devolve `time`) → "14:00". */
const hhmm = (value?: string | null) => (value ? String(value).slice(0, 5) : "");

/** De meia em meia hora; um horário fora da grade (14:15) entra na lista para continuar visível. */
export function timeOptions(current: string) {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    options.push(`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
  }
  if (current && !options.includes(current)) options.push(current);
  return options.sort();
}

type DateTimePickerProps = {
  /** Dia civil, `AAAA-MM-DD`. */
  date?: string;
  /** Horário, `HH:MM` (aceita `HH:MM:SS`). */
  time?: string | null;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
  min?: string;
  max?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
};

/**
 * Data e hora no mesmo campo: o calendário à esquerda e os horários à direita (abaixo,
 * no celular). Escolher o dia mantém aberto para conferir a hora; escolher a hora fecha.
 */
export function DateTimePicker({
  date,
  time,
  onDateChange,
  onTimeChange,
  min,
  max,
  id,
  disabled,
  placeholder = "Selecione",
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selectedTime = hhmm(time);
  const minDate = toDate(min);
  const maxDate = toDate(max);
  const selectedRef = React.useRef<HTMLButtonElement | null>(null);

  // Ao abrir, a hora escolhida aparece no meio da lista, não lá embaixo fora de vista.
  React.useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => selectedRef.current?.scrollIntoView({ block: "center", inline: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const dateLabel = toDate(date)?.toLocaleDateString("pt-BR");

  return (
    // Modal: dentro de um diálogo, a rolagem da lista de horários não fica presa no diálogo de trás.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          disabled={disabled}
          className={cn("h-9 w-full justify-start gap-2 text-left font-normal", className)}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !dateLabel && "text-muted-foreground")}>{dateLabel ?? placeholder}</span>
          {selectedTime ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {selectedTime}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          <Calendar
            mode="single"
            locale={ptBR}
            selected={toDate(date)}
            defaultMonth={toDate(date) ?? minDate}
            disabled={(day) => Boolean((minDate && day < minDate) || (maxDate && day > maxDate))}
            onSelect={(day) => {
              if (day) onDateChange(toValue(day));
            }}
            initialFocus
          />
          <div className="border-t sm:border-t-0 sm:border-l">
            <p className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Horário
            </p>
            <div className="flex gap-1 overflow-x-auto overscroll-contain px-3 pb-3 sm:h-[17rem] sm:w-28 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto">
              {timeOptions(selectedTime).map((option) => {
                const active = option === selectedTime;
                return (
                  <Button
                    key={option}
                    ref={active ? selectedRef : undefined}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "ghost"}
                    className="h-8 shrink-0 justify-center px-3 font-normal tabular-nums"
                    onClick={() => {
                      onTimeChange(option);
                      setOpen(false);
                    }}
                  >
                    {option}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
