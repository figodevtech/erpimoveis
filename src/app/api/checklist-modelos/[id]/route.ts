// app/api/checklist-modelos/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { PERMS, requireAny, requireConfigEdit } from "@/app/api/_authz/perms";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ItemSchema = z.object({
  titulo: z.string().min(1),

  // null / undefined -> ""
  descricao: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? ""),

  // null / undefined -> ""
  categoria: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? ""),

  // qualquer coisa truthy -> true, senão false
  obrigatorio: z
    .boolean()
    .nullable()
    .optional()
    .transform((v) => !!v),

  // null / undefined / coisa estranha -> 0
  ordem: z
    .number()
    .int()
    .nullable()
    .optional()
    .transform((v) =>
      typeof v === "number" && Number.isFinite(v) ? v : 0
    ),
});

const ModeloUpdateSchema = z.object({
  nome: z.string().min(1),

  // null / undefined -> ""
  descricao: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? ""),

  // null / undefined -> ""
  categoria: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? ""),

  // null / undefined -> true
  ativo: z
    .boolean()
    .nullable()
    .optional()
    .transform((v) =>
      typeof v === "boolean" ? v : true
    ),

  itens: z.array(ItemSchema).min(1),
});

type Params = { id: string };

function mapItemRow(row: any) {
  return {
    id: String(row.id),
    titulo: row.titulo,
    descricao: row.descricao ?? null,
    obrigatorio: !!row.obrigatorio,
    categoria: row.categoria ?? null,
    ordem: row.ordem ?? null,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    await requireAny([PERMS.CONFIG, PERMS.ORDENS]);

    const { id } = await params;
    const modeloId = Number(id);

    if (!Number.isFinite(modeloId)) {
      return NextResponse.json(
        { ok: false, error: "ID inválido" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("checklist_modelo")
      .select(
        "id, nome, descricao, categoria, ativo, criado_em, atualizado_em, checklist_modelo_item(*)"
      )
      .eq("id", modeloId)
      .order("ordem", {
        ascending: true,
        foreignTable: "checklist_modelo_item",
      })
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Não encontrado" },
        { status: 404 }
      );
    }

    const itensRaw = (data as any).checklist_modelo_item ?? [];
    const itens = itensRaw.map(mapItemRow);

    const item = {
      id: String(data.id),
      nome: data.nome,
      descricao: data.descricao ?? null,
      categoria: data.categoria ?? null,
      ativo: !!data.ativo,
      criado_em: data.criado_em,
      atualizado_em: data.atualizado_em,
      itens,
    };

    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Erro ao carregar" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    await requireConfigEdit();

    const { id } = await params;
    const modeloId = Number(id);

    if (!Number.isFinite(modeloId)) {
      return NextResponse.json(
        { ok: false, error: "ID inválido" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const parsed = ModeloUpdateSchema.parse(body);

    // Atualiza cabeçalho
    const { error: e1 } = await supabaseAdmin
      .from("checklist_modelo")
      .update({
        nome: parsed.nome,
        descricao: parsed.descricao || null,
        categoria: parsed.categoria || "",
        ativo: parsed.ativo,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", modeloId);

    if (e1) {
      if ((e1 as any).code === "23505") {
        return NextResponse.json(
          { ok: false, error: "Já existe um modelo com esse nome" },
          { status: 409 }
        );
      }
      throw e1;
    }

    // Substitui todos os itens
    const { error: e2 } = await supabaseAdmin
      .from("checklist_modelo_item")
      .delete()
      .eq("modelo_id", modeloId);
    if (e2) throw e2;

    const itensToInsert = parsed.itens.map((it, idx) => ({
      modelo_id: modeloId,
      titulo: it.titulo,
      descricao: it.descricao || null,
      categoria: it.categoria || "",
      obrigatorio: !!it.obrigatorio,
      ordem:
        typeof it.ordem === "number" && Number.isFinite(it.ordem)
          ? it.ordem
          : idx,
    }));

    const { error: e3 } = await supabaseAdmin
      .from("checklist_modelo_item")
      .insert(itensToInsert);
    if (e3) throw e3;

    // Retorna atualizado
    const { data, error: e4 } = await supabaseAdmin
      .from("checklist_modelo")
      .select(
        "id, nome, descricao, categoria, ativo, criado_em, atualizado_em, checklist_modelo_item(*)"
      )
      .eq("id", modeloId)
      .order("ordem", {
        ascending: true,
        foreignTable: "checklist_modelo_item",
      })
      .single();
    if (e4) throw e4;

    const itensRaw = (data as any).checklist_modelo_item ?? [];
    const itens = itensRaw.map(mapItemRow);

    const item = {
      id: String(data.id),
      nome: data.nome,
      descricao: data.descricao ?? null,
      categoria: data.categoria ?? null,
      ativo: !!data.ativo,
      criado_em: data.criado_em,
      atualizado_em: data.atualizado_em,
      itens,
    };

    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (e: any) {
    if (e instanceof ZodError) {
      const flat = e.flatten();
      const firstFieldError = Object.values(flat.fieldErrors)
        .flat()
        .find((msg) => !!msg) as string | undefined;
      const firstFormError = flat.formErrors[0];

      const msg =
        firstFieldError ||
        firstFormError ||
        "Dados inválidos. Verifique os campos do checklist.";

      return NextResponse.json(
        { ok: false, error: msg, issues: flat },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { ok: false, error: e?.message ?? "Erro ao atualizar" },
      { status: 500 }
    );
  }
}

// export async function DELETE(
//   _req: NextRequest,
//   { params }: { params: Promise<Params> }
// ) {
//   try {
//     await requireConfigEdit();

//     const { id } = await params;
//     const modeloId = Number(id);

//     if (!Number.isFinite(modeloId)) {
//       return NextResponse.json(
//         { ok: false, error: "ID inválido" },
//         { status: 400 }
//       );
//     }

//     const { error } = await supabaseAdmin
//       .from("checklist_modelo")
//       .delete()
//       .eq("id", modeloId);
//     if (error) throw error;

//     return NextResponse.json({ ok: true }, { status: 200 });
//   } catch (e: any) {
//     return NextResponse.json(
//       { ok: false, error: e?.message ?? "Erro ao excluir" },
//       { status: 500 }
//     );
//   }
// }
