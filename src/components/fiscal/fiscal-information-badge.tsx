"use client";

import { Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type FiscalInformationBadgeProps = {
  messages: readonly string[];
};

export function FiscalInformationBadge({ messages }: FiscalInformationBadgeProps) {
  if (messages.length === 0) return null;

  const label = `${messages.length} ${messages.length === 1 ? "informação" : "informações"}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          tabIndex={0}
          aria-label={`${label}. Passe o mouse ou use o foco para consultar.`}
          className="cursor-help gap-1 border-sky-400 bg-sky-50 text-sky-800 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
        >
          <Info className="h-3 w-3" aria-hidden="true" />
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" sideOffset={6} className="max-w-sm whitespace-normal">
        <p className="font-medium">Informações fiscais opcionais</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {messages.map((message, index) => (
            <li key={`${message}-${index}`}>{message}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
