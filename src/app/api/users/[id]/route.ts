export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUsuariosEdit } from "@/app/api/_authz/perms";
import { isValidUsername, normalizeUsername } from "@/lib/auth-identifier";

function parseNumberOrNull(v: any) {
  if (v === null || typeof v === "undefined" || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (Number.isNaN(n)) return null;
  return n;
}

function parseDateOrNull(v: any) {
  if (v === null || typeof v === "undefined" || v === "") return null;
  const s = String(v).trim();
  return s ? s : null;
}

/**
 * POST /api/users/[id]
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUsuariosEdit();
    const { id: userId } = await context.params;

    const body = (await req.json().catch(() => ({}))) as { acao?: string; senha?: string };

    const rawAcao = (body.acao ?? "convite").toString().toLowerCase().trim();

    let acao: "convite" | "definir_senha";
    if (rawAcao === "convite" || rawAcao === "invite") {
      acao = "convite";
    } else if (rawAcao === "definir_senha" || rawAcao === "set_password") {
      acao = "definir_senha";
    } else {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }

    const { data: usuario, error: uErr } = await supabaseAdmin
      .from("usuario")
      .select("id, email, nome")
      .eq("id", userId)
      .maybeSingle();

    if (uErr) throw uErr;
    if (!usuario) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    if (!usuario.email) return NextResponse.json({ error: "Usuário não possui e-mail cadastrado." }, { status: 400 });

    if (acao === "convite") {
      const redirectTo = process.env.SUPABASE_RESET_REDIRECT_URL || process.env.NEXT_PUBLIC_SITE_URL || undefined;

      const { error: mailErr } = await supabaseAdmin.auth.resetPasswordForEmail(usuario.email, { redirectTo });
      if (mailErr) throw mailErr;

      return NextResponse.json(
        { ok: true, acao: "convite", message: "Convite enviado (e-mail de definição de senha)." },
        { status: 200 }
      );
    }

    // definir senha
    const senha = (body.senha || "").trim();
    if (!senha || senha.length < 6) {
      return NextResponse.json(
        { error: "Informe uma senha com pelo menos 6 caracteres para definir a senha." },
        { status: 400 }
      );
    }

    const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: senha });
    if (upErr) throw upErr;

    return NextResponse.json(
      { ok: true, acao: "definir_senha", message: "Senha do usuário atualizada com sucesso." },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("[/api/users/:id POST] error:", e);
    const status = /não autenticado|unauth|auth/i.test(String(e?.message)) ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao processar ação do usuário" }, { status });
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    await requireUsuariosEdit();
    const actorId = ((session?.user as any)?.id as string | undefined) ?? null;

    const { id: userId } = await context.params;

    const body = await req.json().catch(() => ({}));

    const {
      nome,
      email,
      username: usernameRaw,
      perfilId,
      perfilNome,
      setorId,
      permissoes,
      ativo,

      // novos campos (aceita variações)
      salario: salarioRaw,
      comissao_percent: comissaoRaw,
      comissao_venda_percent: comissaoVendaRaw,
      comissaoVendaPercent,
      comissao_venda,
      comissaoPercent,
      comissao,
      comissao_criacao_servico_percent: comissaoCriacaoServicoRaw,
      comissao_criacao_produto_percent: comissaoCriacaoProdutoRaw,
      comissao_criacao_somente_comissionaveis: comissaoCriacaoSomenteRaw,
      data_admissao: admissaoRaw,
      dataAdmissao,
      data_demissao: demissaoRaw,
      dataDemissao,
    }: any = body ?? {};

    const username =
      typeof usernameRaw === "undefined" ? undefined : normalizeUsername(usernameRaw);

    if (typeof username !== "undefined") {
      if (!username || !isValidUsername(username)) {
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
        .neq("id", userId)
        .maybeSingle();
      if (usernameCheckError) throw usernameCheckError;
      if (usernameEmUso) {
        return NextResponse.json({ error: "Este nome de usuário já está em uso." }, { status: 409 });
      }
    }

    // 1) Auth (email)
    if (typeof email !== "undefined" && email) {
      const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { email });
      if (upErr) throw upErr;
    }

    // 2) resolve perfil
    let newPerfilId = perfilId as number | undefined;
    if (!newPerfilId && perfilNome) {
      const { data: p, error: perr } = await supabaseAdmin
        .from("perfil")
        .select("id")
        .eq("nome", perfilNome)
        .maybeSingle();
      if (perr) throw perr;
      if (!p?.id) throw new Error("Perfil não encontrado");
      newPerfilId = p.id as number;
    }

    // 3) carrega perfil atual (se necessário)
    let currentPerfilId: number | null = null;
    if (!newPerfilId || Array.isArray(permissoes)) {
      const { data: u, error: uerr } = await supabaseAdmin
        .from("usuario")
        .select("perfilid")
        .eq("id", userId)
        .maybeSingle();
      if (uerr) throw uerr;
      currentPerfilId = (u?.perfilid as number | null) ?? null;
    }

    // 4) novos campos (normalizados)
    const salario = parseNumberOrNull(salarioRaw);
    const comissao_percent = parseNumberOrNull(comissaoRaw ?? comissaoPercent ?? comissao);
    const comissao_venda_percent = parseNumberOrNull(
      comissaoVendaRaw ?? comissaoVendaPercent ?? comissao_venda
    );
    // Comissão por criação de OS: paga a quem abre a ordem, sobre o que ela
    // contém. Independente da de realização (`comissao_percent`).
    const comissao_criacao_servico_percent = parseNumberOrNull(comissaoCriacaoServicoRaw);
    const comissao_criacao_produto_percent = parseNumberOrNull(comissaoCriacaoProdutoRaw);
    const data_admissao = parseDateOrNull(admissaoRaw ?? dataAdmissao);
    const data_demissao = parseDateOrNull(demissaoRaw ?? dataDemissao);

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

    // 5) update usuario
    const updatePayload: Record<string, any> = {};
    if (typeof nome !== "undefined") updatePayload.nome = nome;
    if (typeof email !== "undefined") updatePayload.email = email;
    if (typeof username !== "undefined") updatePayload.username = username;
    if (typeof setorId !== "undefined") updatePayload.setorid = setorId;
    if (typeof newPerfilId !== "undefined") updatePayload.perfilid = newPerfilId;
    if (typeof ativo === "boolean") updatePayload.ativo = ativo;

    // ✅ novos campos: só atualiza se vierem no body (undefined = não mexe)
    if (typeof salarioRaw !== "undefined") updatePayload.salario = salario;
    if (
      typeof comissaoRaw !== "undefined" ||
      typeof comissaoPercent !== "undefined" ||
      typeof comissao !== "undefined"
    ) {
      updatePayload.comissao_percent = comissao_percent;
    }
    if (
      typeof comissaoVendaRaw !== "undefined" ||
      typeof comissaoVendaPercent !== "undefined" ||
      typeof comissao_venda !== "undefined"
    ) {
      updatePayload.comissao_venda_percent = comissao_venda_percent;
    }
    if (typeof comissaoCriacaoServicoRaw !== "undefined") {
      updatePayload.comissao_criacao_servico_percent = comissao_criacao_servico_percent;
    }
    if (typeof comissaoCriacaoProdutoRaw !== "undefined") {
      updatePayload.comissao_criacao_produto_percent = comissao_criacao_produto_percent;
    }
    if (typeof comissaoCriacaoSomenteRaw !== "undefined") {
      updatePayload.comissao_criacao_somente_comissionaveis = comissaoCriacaoSomenteRaw === true;
    }
    if (typeof admissaoRaw !== "undefined" || typeof dataAdmissao !== "undefined")
      updatePayload.data_admissao = data_admissao;
    if (typeof demissaoRaw !== "undefined" || typeof dataDemissao !== "undefined")
      updatePayload.data_demissao = data_demissao;

    if (Object.keys(updatePayload).length > 0) {
      if (actorId) updatePayload.updated_by = actorId;
      const { error: u2Err } = await supabaseAdmin
        .from("usuario")
        .update({ ...updatePayload, updatedat: new Date().toISOString() })
        .eq("id", userId);
      if (u2Err) throw u2Err;
    }

    // 6) permissões (mantido igual)
    if (Array.isArray(permissoes)) {
      const targetPerfilId = typeof newPerfilId !== "undefined" ? newPerfilId : currentPerfilId;
      if (!targetPerfilId) throw new Error("Sem perfil para aplicar permissões");

      const { data: allPerms, error: allErr } = await supabaseAdmin.from("permissao").select("id, nome");
      if (allErr) throw allErr;

      const byName = new Map<string, number>((allPerms ?? []).map((p) => [String(p.nome), Number(p.id)]));

      const desejadas = new Set<number>();

      for (const nomePerm of permissoes) {
        const pid = byName.get(nomePerm);
        if (pid) desejadas.add(pid);
      }

      const { error: permissoesErr } = await supabaseAdmin.rpc("atualizar_permissoes_perfil_auditado", {
        p_perfilid: targetPerfilId,
        p_permissoes_ids: [...desejadas],
        p_usuario_id: actorId,
      });
      if (permissoesErr) throw permissoesErr;
    }

    // Retorna a lista atualizada
    const { GET: listUsers } = await import("../route");
    return listUsers(req);
  } catch (e: any) {
    console.error("[/api/users/:id PUT] error:", e);
    const status = /não autenticado|unauth|auth/i.test(String(e?.message)) ? 401 : 500;
    return NextResponse.json({ error: e?.message ?? "Erro ao atualizar usuário" }, { status });
  }
}
