"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

export function EntityVideoPreview({ id, name, access, open, className = "h-full w-full" }: {
  id: string; name: string; access: (id: string) => Promise<{ url: string }>;
  open: (id: string) => void; className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      access(id).then(result => { if (active) setUrl(result.url); }).catch(() => undefined);
    });
    if (ref.current) observer.observe(ref.current);
    return () => { active = false; observer.disconnect(); };
  }, [id, access]);
  return <button ref={ref} type="button" onClick={() => open(id)} aria-label={`Assistir ${name}`}
    className={`relative flex items-center justify-center overflow-hidden bg-black text-white ${className}`}>
    {url && <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />}
    <span className="relative rounded-full bg-black/65 p-2"><Play className="size-5" /></span>
    <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px]">Vídeo</span>
  </button>;
}
