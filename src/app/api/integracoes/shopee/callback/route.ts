import { NextResponse } from "next/server";

// Compatibilidade com URLs antigas. O callback oficial agora é recebido pela
// Figo Central, que devolve o usuário diretamente às Configurações Gerais.
export function GET() {
  return NextResponse.redirect(new URL("/configuracoes/geral?integracao=shopee&status=callback-central", process.env.APP_URL || "http://localhost:3000"));
}
