export const runtime = "nodejs";

import { NextResponse } from "next/server";

import municipiosPorUf from "@/data/municipios-por-uf.json";

/**
 * Lista de municipios por UF, servida do dataset embutido em
 * `src/data/municipios-por-uf.json`.
 *
 * Antes o combo de cidade consultava o IBGE direto do browser
 * (servicodados.ibge.gov.br). Toda vez que aquele servico ficava fora do ar, o
 * cadastro de cliente travava sem alternativa. O `id` devolvido aqui e o codigo
 * IBGE do municipio, gravado em `cliente.codigomunicipio` e usado na emissao de
 * nota — por isso o dataset e validado contra uma segunda fonte antes de entrar
 * no repositorio (veja `scripts/localidades/gerar-municipios.mjs`).
 */

type Municipio = { id: number; nome: string };

const CATALOGO = municipiosPorUf as Record<string, Municipio[]>;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const uf = (searchParams.get("uf") ?? "").trim().toUpperCase();

  if (!uf) {
    return NextResponse.json({ error: "Informe a UF." }, { status: 400 });
  }

  const cidades = CATALOGO[uf];

  if (!cidades) {
    return NextResponse.json({ error: `UF desconhecida: ${uf}.` }, { status: 404 });
  }

  return NextResponse.json(cidades, {
    headers: {
      // Lista estatica: muda apenas quando o dataset e regerado e o app, redeploy.
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
