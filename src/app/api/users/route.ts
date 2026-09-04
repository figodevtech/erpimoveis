export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUsuariosAccess, requireUsuariosCreate } from "@/app/api/_authz/perms";
import { isValidUsername, normalizeUsername } from "@/lib/auth-identifier";

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
        "username",
        "createdat",
        "updatedat",
        "ativo",
        "salario",
        "comissao_percent",
        "comissao_venda_percent",
        "comissao_criacao_servico_percent",
        "comissao_criacao_produto_percent",
        "comissao_criacao_somente_comissionaveis",
        "data_admissao",
        "data_demissao",
        "perfil:perfilid(id,nome)",
        "setor:setorid(id,nome)",
      ].join(",")
    )
    .order("createdat", { ascending: false });

  if (onlyActive) {
    query = query.eq("ativo", true);
  }

  if (q) {
    query = query.or(`nome.ilike.%${q}%,email.ilike.%${q}%,username.ilike.%${q}%`);
  }

  const { data: usuarios, error: uErr } = await query;
  if (uErr) throw uErr;

  return (usuarios ?? []).map((u: any) => ({
    id: u.id as string,
    nome: u.nome as string,
    email: u.email as string,
    username: (u.username as string | null) ?? null,
    createdAt: u.createdat as string | null,
    updatedAt: u.updatedat as string | null,
    ativo: typeof u.ativo === "boolean" ? u.ativo : true,

    salario: u.salario as number | null,
    comissao_percent: u.comissao_percent as number | null,
    comissao_venda_percent: u.comissao_venda_percent as number | null,
    comissao_criacao_servico_percent: u.comissao_criacao_servico_percent as number | null,
    comissao_criacao_produto_percent: u.comissao_criacao_produto_percent as number | null,
    comissao_criacao_somente_comissionaveis: u.comissao_criacao_somente_comissionaveis === true,
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
    await requireUsuariosAccess();

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
    const session = await auth();
    await requireUsuariosCreate();
    const actorId = ((session?.user as any)?.id as string | undefined) ?? null;

    const body = (await req.json().catch(() => ({}))) as any;

    const nome = (body.nome ?? "").toString().trim();
    const email = (body.email ?? "").toString().trim();
    const username = normalizeUsername(body.username);

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
    // Comissão por criação de OS: paga a quem abre a ordem, sobre o que ela
    // contém. Independente da de realização (`comissao_percent`).
    const comissao_criacao_servico_percent = parseNumberOrNull(
      body.comissao_criacao_servico_percent ?? body.comissaoCriacaoServicoPercent
    );
    const comissao_criacao_produto_percent = parseNumberOrNull(
      body.comissao_criacao_produto_percent ?? body.comissaoCriacaoProdutoPercent
    );
    const comissao_criacao_somente_comissionaveis =
      (body.comissao_criacao_somente_comissionaveis ??
        body.comissaoCriacaoSomenteComissionaveis) === true;
    const data_admissao = parseDateOrNull(body.data_admissao ?? body.dataAdmissao);
    const data_demissao = parseDateOrNull(body.data_demissao ?? body.dataDemissao);

    if (!nome || !email || !username) {
      return NextResponse.json(
        { error: "Nome, e-mail e nome de usuário são obrigatórios." },
        { status: 400 }
      );
    }
    if (!isValidUsername(username)) {
      return NextResponse.json(
        {
          error:
            "O nome de usuário deve ter de 3 a 30 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.",
        },
        { status: 400 }
      );
    }

    const { data: usernameEmUso, error: usernameCheckError } = await supabaseAdmin
      .from("usuario")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (usernameCheckError) throw usernameCheckError;
    if (usernameEmUso) {
      return NextResponse.json({ error: "Este nome de usuário já está em uso." }, { status: 409 });
    }

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

    if (
      comissao_criacao_servico_percent != null &&
      (comissao_criacao_servico_percent < 0 || comissao_criacao_servico_percent > 100)
    ) {
      throw new Error("Comissão de criação sobre serviços deve estar entre 0 e 100.");
    }

    if (
      comissao_criacao_produto_percent != null &&
      (comissao_criacao_produto_percent < 0 || comissao_criacao_produto_percent > 100)
    ) {
      throw new Error("Comissão de criação sobre produtos deve estar entre 0 e 100.");
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
        username,
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
        username,
        nome,
        setorid,
        perfilid: resolvedPerfilId,
        ativo,
        salario,
        comissao_percent,
        comissao_venda_percent,
        comissao_criacao_servico_percent,
        comissao_criacao_produto_percent,
        comissao_criacao_somente_comissionaveis,
        data_admissao,
        data_demissao,
        created_by: actorId,
        updated_by: actorId,

        updatedat: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (upErr) {
      const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (cleanupError) {
        console.error("[/api/users POST] erro ao desfazer usuario do Auth:", cleanupError);
      }
      throw upErr;
    }

    const users = await carregarUsuarios();
    return NextResponse.json({ users });
  } catch (e: any) {
    console.error("[/api/users POST] error:", e);
    const status = /não autenticado|unauth|auth/i.test(String(e?.message)) ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao criar usuário" }, { status });
  }
}
