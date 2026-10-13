import type { ReactNode } from "react";
import { PinchLock } from "@/components/pinch-lock";

import "./central-operacional.css";

export const dynamic = "force-dynamic";

export default function CentralOperacionalLayout({ children }: { children: ReactNode }) {
  return (
    <div data-pinch="off" className="contents">
      <PinchLock />
      {children}
    </div>
  );
}
