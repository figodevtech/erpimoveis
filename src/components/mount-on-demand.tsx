"use client";

import { useState, type ReactNode } from "react";

/** Adia a primeira montagem e preserva estado e animacoes nas proximas aberturas. */
export function MountOnDemand({ active, children }: { active: boolean; children: ReactNode }) {
  const [activated, setActivated] = useState(active);

  if (active && !activated) setActivated(true);

  return active || activated ? children : null;
}
