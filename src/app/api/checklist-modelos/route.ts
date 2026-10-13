// app/api/checklist-modelos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PERMS, requireAny, requireConfigEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// helper booleano para querystring
function isTrue(v: string | null) {
  if (!v) return false;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export async function GET(req: NextRequest) {
  try {
    // Os modelos servem à OS e aos checklists de saída e retorno do aluguel.
    await requireAny([PERMS.CONFIG, PERMS.ORDENS, PERMS.ALUGUEIS]);
    const { searchParams } = new URL(req.url);
    const onlyActive = isTrue(searchParams.get("ativos"));

    // 1) Modelos
    let q = supabaseAdmin
      .from("checklist_modelo")
      .select("id, nome, descricao, categoria, ativo")
      .order("nome", { ascending: true });

    if (onlyActive) q = q.eq("ativo", true);

    const { data: modelos, error: e1 } = await q;

    if (e1) {
      return NextResponse.json({ ok: false, error: e1.message }, { status: 500 });
    }
    if (!modelos?.length) {
      return NextResponse.json({ ok: true, items: [] }, { status: 200 });
    }

    // 2) Itens por modelo
    const ids = modelos.map((m) => m.id);
    const { data: itens, error: e2 } = await supabaseAdmin
      .from("checklist_modelo_item")
      .select("id, modelo_id, titulo, descricao, obrigatorio, categoria, ordem")
      .in("modelo_id", ids)
      .order("ordem", { ascending: true });

    if (e2) {
      return NextResponse.json({ ok: false, error: e2.message }, { status: 500 });
    }

    // 3) Agrupa
    const porModelo = new Map<number, any[]>();
    for (const it of itens ?? []) {
      const list = porModelo.get(it.modelo_id) ?? [];
      list.push({
        id: String(it.id),
        titulo: it.titulo,
        descricao: it.descricao ?? null,
        obrigatorio: !!it.obrigatorio,
        categoria: it.categoria ?? null,
        ordem: it.ordem ?? null,
      });
      porModelo.set(it.modelo_id, list);
    }

    const items = modelos.map((m) => ({
      id: String(m.id),
      nome: m.nome,
      descricao: m.descricao ?? null,
      categoria: m.categoria ?? null,
      ativo: !!m.ativo,
      itens: porModelo.get(m.id) ?? [],
    }));

    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Erro inesperado" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireConfigEdit();
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Body JSON inválido" },
        { status: 400 }
      );
    }

    const {
      nome,
      descricao = null,
      categoria = null,
      ativo = true,
      itens = [],
    } = body as {
      nome?: string;
      descricao?: string | null;
      categoria?: string | null;
      ativo?: boolean;
      itens?: any[];
    };

    if (!nome || typeof nome !== "string" || !nome.trim()) {
      return NextResponse.json(
        { ok: false, error: "Campo 'nome' é obrigatório" },
        { status: 400 }
      );
    }

    // 1) Cria o modelo
    const { data: modelo, error: e1 } = await supabaseAdmin
      .from("checklist_modelo")
      .insert({
        nome: nome.trim(),
        descricao: descricao ?? null,
        categoria: categoria ?? null,
        ativo: !!ativo,
      })
      .select("id, nome, descricao, categoria, ativo")
      .single();

    if (e1 || !modelo) {
      const status =
        (e1 as any)?.code === "23505" /* unique_violation */ ? 409 : 500;

      return NextResponse.json(
        {
          ok: false,
          error:
            (e1 as any)?.code === "23505"
              ? "Já existe um modelo com esse nome"
              : e1?.message ?? "Erro ao criar checklist modelo",
        },
        { status }
      );
    }

    let itensCriados: any[] = [];

    // 2) Se vieram itens, cria os itens vinculados ao modelo
    if (Array.isArray(itens) && itens.length > 0) {
      const rows = itens
        .filter(
          (it: any) =>
            it &&
            typeof it.titulo === "string" &&
            it.titulo.trim().length > 0
        )
        .map((it: any, index: number) => ({
          modelo_id: modelo.id,
          titulo: it.titulo.trim(),
          descricao: it.descricao ?? null,
          categoria: it.categoria ?? null,
          obrigatorio: !!it.obrigatorio,
          ordem:
            typeof it.ordem === "number" && Number.isFinite(it.ordem)
              ? it.ordem
              : index,
        }));

      if (rows.length > 0) {
        const { data: itensInsert, error: e2 } = await supabaseAdmin
          .from("checklist_modelo_item")
          .insert(rows)
          .select("id, modelo_id, titulo, descricao, obrigatorio, categoria, ordem");

        if (e2) {
          // tenta "rollback" simples: remove o modelo recém-criado
          await supabaseAdmin.from("checklist_modelo").delete().eq("id", modelo.id);
          return NextResponse.json(
            {
              ok: false,
              error: e2.message ?? "Erro ao criar itens do checklist",
            },
            { status: 500 }
          );
        }

        itensCriados = (itensInsert ?? []).map((it: any) => ({
          id: String(it.id),
          titulo: it.titulo,
          descricao: it.descricao ?? null,
          obrigatorio: !!it.obrigatorio,
          categoria: it.categoria ?? null,
          ordem: it.ordem ?? null,
        }));
      }
    }

    const item = {
      id: String(modelo.id),
      nome: modelo.nome,
      descricao: modelo.descricao ?? null,
      categoria: modelo.categoria ?? null,
      ativo: !!modelo.ativo,
      itens: itensCriados,
    };

    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Erro inesperado" },
      { status: 500 }
    );
  }
}
