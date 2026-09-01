import type { Metadata } from "next";
import { ChecklistVerification } from "./verification-client";

export const metadata: Metadata = {
  title: "Verificar checklist",
  robots: { index: false, follow: false },
};

export default async function ChecklistVerificationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ChecklistVerification token={token} />;
}
