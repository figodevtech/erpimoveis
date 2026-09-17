import type { Metadata } from "next";

import { SpedWorkspace } from "./sped-workspace";

export const metadata: Metadata = {
  title: "SPED Fiscal",
};

export const dynamic = "force-dynamic";

export default function SpedPage() {
  return <SpedWorkspace />;
}
