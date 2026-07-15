export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ensureAccess } from "./_authz";
import { requireUsuariosAccess, requireUsuariosCreate } from "@/app/api/_authz/perms";

function isOpen() {
  const v = (process.env.OPEN_PERMISSIONS ?? "").toString().trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function gerarSenhaTemporaria() {
  if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID().replace(/-/g, "").slice(0, 16);
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function parseNumberOrNull(v: any) {
  if (v === null || typeof v === "undefined" || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (Number.isNaN(n)) return null;
  return n;
}

function parseDateOrNull(v: any) {
  if (v === null || typeof v === "undefined" || v === "") return null;
  // aceita "YYYY-MM-DD" ou ISO
  const s = String(v).trim();
  return s ? s : null;
}

// Agora recebe opções pra filtrar (ativos / busca)
async function carregarUsuarios(opts?: { onlyActive?: boolean; q?: string }) {
  const onlyActive = opts?.onlyActive ?? false;
  const q = (opts?.q ?? "").trim();

  let query = supabaseAdmin
    .from("usuario")
    .select(
      [
        "id",
        "nome",
        "email",
        "createdat",
        "updatedat",
        "ativo",
        "salario",
        "comissao_percent",
        "comissao_venda_percent",
        "data_admissao",
        "data_demissao",
        "perfil:perfilid(id,nome)",
        "setor:setorid(id,nome)",
      ].join(",")
    )
    .order("createdat", { ascending: false });

    query=query.eq("is_root", false); // sempre excluir usuários root

  if (onlyActive) {
    query = query.eq("ativo", true);
  }

  if (q) {
    query = query.or(`nome.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data: usuarios, error: uErr } = await query;
  if (uErr) throw uErr;

  return (usuarios ?? []).map((u: any) => ({
    id: u.id as string,
    nome: u.nome as string,
    email: u.email as string,
    createdAt: u.createdat as string | null,
    updatedAt: u.updatedat as string | null,
    ativo: typeof u.ativo === "boolean" ? u.ativo : true,

    salario: u.salario as number | null,
    comissao_percent: u.comissao_percent as number | null,
    comissao_venda_percent: u.comissao_venda_percent as number | null,
    data_admissao: u.data_admissao as string | null,
    data_demissao: u.data_demissao as string | null,

    perfil: u.perfil ? { id: u.perfil.id as number, nome: u.perfil.nome as string } : null,
    setor: u.setor ? { id: u.setor.id as number, nome: u.setor.nome as string } : null,

    // mantém compatibilidade com seu front atual
    perfilId: u.perfil?.id as number | undefined,
    setorId: u.setor?.id as number | undefined,
  }));
}

// GET /api/users
// GET /api/users?ativos=1&q=fulano
export async function GET(req: NextRequest) {
  try {
    const session = isOpen() ? null : await auth();
    if (isOpen()) await ensureAccess(session);
    else await requireUsuariosAccess();

    const { searchParams } = new URL(req.url);
    const ativos = searchParams.get("ativos"); // "1" => só ativos
    const q = searchParams.get("q") ?? "";

    const users = await carregarUsuarios({
      onlyActive: ativos === "1",
      q,
    });

    return NextResponse.json({ users });
  } catch (e: any) {
    console.error("[/api/users GET] error:", e);
    const status = /não autenticado|unauth|auth/i.test(String(e?.message)) ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao listar usuários" }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const session = isOpen() ? null : await auth();
    if (isOpen()) await ensureAccess(session);
    else await requireUsuariosCreate();
    const actorId = ((session?.user as any)?.id as string | undefined) ?? null;

    const body = (await req.json().catch(() => ({}))) as any;

    const nome = (body.nome ?? "").toString().trim();
    const email = (body.email ?? "").toString().trim();

    // aceitamos tanto perfilid / setorid quanto perfilId / setorId
    const perfilidRaw = body.perfilid ?? body.perfilId ?? null;
    const perfilNome = body.perfilNome as string | undefined;
    const setoridRaw = body.setorid ?? body.setorId ?? null;
    const bodyAtivo = body.ativo as boolean | undefined;

    // novos campos
    const salario = parseNumberOrNull(body.salario);
    const comissao_percent = parseNumberOrNull(body.comissao_percent ?? body.comissaoPercent ?? body.comissao);
    const comissao_venda_percent = parseNumberOrNull(
      body.comissao_venda_percent ?? body.comissaoVendaPercent ?? body.comissao_venda
    );
    const data_admissao = parseDateOrNull(body.data_admissao ?? body.dataAdmissao);
    const data_demissao = parseDateOrNull(body.data_demissao ?? body.dataDemissao);

    if (!nome || !email) throw new Error("Nome e e-mail são obrigatórios");

    if (salario != null && salario < 0) throw new Error("Salário não pode ser negativo.");
    if (comissao_percent != null && (comissao_percent < 0 || comissao_percent > 100)) {
      throw new Error("Comissão deve estar entre 0 e 100.");
    }

    if (
      comissao_venda_percent != null &&
      (comissao_venda_percent < 0 || comissao_venda_percent > 100)
    ) {
      throw new Error("Comissão de venda deve estar entre 0 e 100.");
    }

    let resolvedPerfilId: number | null = null;
    if (typeof perfilidRaw === "number") resolvedPerfilId = perfilidRaw;

    if (!resolvedPerfilId && perfilNome) {
      const { data: p, error: perr } = await supabaseAdmin
        .from("perfil")
        .select("id")
        .eq("nome", perfilNome)
        .maybeSingle();
      if (perr) throw perr;
      if (!p?.id) throw new Error("Perfil não encontrado");
      resolvedPerfilId = p.id as number;
    }

    if (!resolvedPerfilId) throw new Error("Informe o perfil do usuário.");

    const setorid = typeof setoridRaw === "number" ? (setoridRaw as number) : null;
    const ativo = typeof bodyAtivo === "boolean" ? bodyAtivo : true;

    const senhaTemp = gerarSenhaTemporaria();

    const { data: created, error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senhaTemp,
      email_confirm: true,
      user_metadata: {
        nome,
        setorid,
        perfilid: resolvedPerfilId,
        salario,
        comissao_percent,
        comissao_venda_percent,
        data_admissao,
        data_demissao,
        created_by: actorId,
      },
    });

    if (cErr || !created?.user) throw cErr ?? new Error("Falha ao criar usuário no Auth");

    const userId = created.user.id;

    const { error: upErr } = await supabaseAdmin.from("usuario").upsert(
      {
        id: userId,
        email,
        nome,
        setorid,
        perfilid: resolvedPerfilId,
        ativo,
        salario,
        comissao_percent,
        comissao_venda_percent,
        data_admissao,
        data_demissao,
        created_by: actorId,
        updated_by: actorId,

        updatedat: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (upErr) throw upErr;

    const users = await carregarUsuarios();
    return NextResponse.json({ users });
  } catch (e: any) {
    console.error("[/api/users POST] error:", e);
    const status = /não autenticado|unauth|auth/i.test(String(e?.message)) ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao criar usuário" }, { status });
  }
}
