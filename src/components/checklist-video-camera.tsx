"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Video } from "lucide-react";

/** Requests the device's native video capture instead of a browser camera stream. */
export function ChecklistVideoCamera({ disabled, onCapture }: { disabled?: boolean; onCapture: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}><Video className="size-4 shrink-0" />Gravar vídeo</Button>
    <input
      ref={input}
      type="file"
      accept="video/*"
      capture="environment"
      className="hidden"
      aria-label="Gravar vídeo com a câmera do celular"
      disabled={disabled}
      onChange={event => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) onCapture(file);
      }}
    />
  </>;
}
