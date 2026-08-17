import type { Metadata } from "next";

import { PreferenciasClient } from "./preferencias-client";

export const metadata: Metadata = {
  title: "Preferências",
};

export default function PreferenciasPage() {
  return <PreferenciasClient />;
}
