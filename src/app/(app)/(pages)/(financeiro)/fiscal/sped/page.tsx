import type { Metadata } from "next";

import { SpedOneClick } from "./sped-one-click";

export const metadata: Metadata = {
  title: "SPED Fiscal",
};

export const dynamic = "force-dynamic";

export default function SpedPage() {
  return <SpedOneClick />;
}
