import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DanfeView } from "@/components/danfe/danfe-view";
import { carregarDadosDanfe } from "@/lib/nfe/danfeData";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ origem?: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return { title: "DANFE" };
  const { data } = await supabaseAdmin.from("nfe").select("numero").eq("id", id).maybeSingle();
  return { title: data?.numero ? `DANFE NF-e #${data.numero}` : "DANFE" };
}

export default async function DanfePage({ params, searchParams }: PageProps) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  const search = searchParams ? await searchParams : {};
  const dados = await carregarDadosDanfe(id, search.origem === "terceiros" ? "terceiros" : "proprias");
  if (!dados) notFound();

  return <DanfeView data={dados.view} />;
}
