"use client";

import { Toaster } from "sonner";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "@/lib/toast";

export function RouteAwareToaster() {
  const pathname = usePathname() || "/";
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      toast.getToasts().forEach((item) => {
        if ("type" in item && item.type === "loading") toast.dismiss(item.id);
      });
      previousPathname.current = pathname;
    }
  }, [pathname]);

  // Ajuste a regex/lista abaixo com as suas rotas públicas
  const isPublic =
    /^\/(login|recuperar-senha|senha-alterada)(\/|$)/.test(pathname);

  return (
    <Toaster
      richColors
      closeButton
      // público: topo-centro | app: canto inferior direito
      position={isPublic ? "top-center" : "bottom-right"}
      toastOptions={{
        duration: 4000,
      }}
    />
  );
}
