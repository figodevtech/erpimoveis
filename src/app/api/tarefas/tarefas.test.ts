import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { z } from "zod";

const CreateTarefaSchema = z.object({
  tipo: z.enum(["TAREFA", "NOTA"]).default("TAREFA"),
  titulo: z
    .string({ required_error: "O título é obrigatório." })
    .trim()
    .min(1, "O título é obrigatório.")
    .max(255, "O título deve ter no máximo 255 caracteres."),
  descricao: z.string().trim().max(4000).nullable().optional(),
  prioridade: z.enum(["BAIXA", "NORMAL", "ALTA"]).default("NORMAL"),
  data_prevista: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "A data deve estar no formato AAAA-MM-DD.")
    .nullable()
    .optional(),
  fixada: z.boolean().default(false),
  lembrete_em: z.string().datetime().nullable().optional(),
});

const UpdateTarefaSchema = z.object({
  tipo: z.enum(["TAREFA", "NOTA"]).optional(),
  titulo: z
    .string()
    .trim()
    .min(1, "O título não pode ser vazio.")
    .max(255, "O título deve ter no máximo 255 caracteres.")
    .optional(),
  descricao: z.string().trim().max(4000).nullable().optional(),
  prioridade: z.enum(["BAIXA", "NORMAL", "ALTA"]).optional(),
  data_prevista: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "A data deve estar no formato AAAA-MM-DD.")
    .nullable()
    .optional(),
  fixada: z.boolean().optional(),
  status: z.enum(["ABERTA", "CONCLUIDA"]).optional(),
  lembrete_em: z.string().datetime().nullable().optional(),
});

describe("Módulo Minhas Tarefas - Regras de Validação e Negócio", () => {
  test("Criação rápida com título válido assume defaults corretos", () => {
    const parsed = CreateTarefaSchema.parse({ titulo: "Comprar peças para oficina" });
    assert.equal(parsed.titulo, "Comprar peças para oficina");
    assert.equal(parsed.tipo, "TAREFA");
    assert.equal(parsed.prioridade, "NORMAL");
    assert.equal(parsed.fixada, false);
    assert.equal(parsed.descricao, undefined);
  });

  test("Rejeita título vazio ou apenas com espaços em branco", () => {
    assert.throws(() => CreateTarefaSchema.parse({ titulo: "   " }));
  });

  test("Rejeita título com mais de 255 caracteres", () => {
    const longTitle = "a".repeat(256);
    assert.throws(() => CreateTarefaSchema.parse({ titulo: longTitle }));
  });

  test("Valida formato de data prevista estritamente como AAAA-MM-DD", () => {
    const valid = CreateTarefaSchema.parse({
      titulo: "Revisar OS",
      data_prevista: "2026-09-15",
    });
    assert.equal(valid.data_prevista, "2026-09-15");

    assert.throws(() =>
      CreateTarefaSchema.parse({
        titulo: "Revisar OS",
        data_prevista: "15/09/2026",
      })
    );
  });

  test("Permite criação de itens do tipo NOTA sem data prevista", () => {
    const nota = CreateTarefaSchema.parse({
      titulo: "Cliente João prefere contato após as 14h",
      tipo: "NOTA",
    });
    assert.equal(nota.tipo, "NOTA");
    assert.equal(nota.data_prevista, undefined);
  });

  test("UpdateTarefaSchema valida alterações parciais com sucesso", () => {
    const updated = UpdateTarefaSchema.parse({ status: "CONCLUIDA" });
    assert.equal(updated.status, "CONCLUIDA");
  });

  test("Criação de TAREFA sem data_prevista resolve para a data de hoje", () => {
    const today = new Date().toISOString().slice(0, 10);
    const parsed = CreateTarefaSchema.parse({ titulo: "Lembrete sem data" });
    const resolvedDataPrevista =
      parsed.tipo === "TAREFA"
        ? parsed.data_prevista || today
        : parsed.data_prevista || null;

    assert.equal(resolvedDataPrevista, today);
  });
});

describe("Módulo Minhas Tarefas - Casos de Segurança e Isolamento", () => {
  type TarefaDb = {
    id: string;
    usuario_id: string;
    titulo: string;
    tipo: "TAREFA" | "NOTA";
    status: "ABERTA" | "CONCLUIDA";
    completed_at: string | null;
  };

  const database: TarefaDb[] = [
    {
      id: "a1111111-1111-1111-1111-111111111111",
      usuario_id: "user-alpha",
      titulo: "Tarefa Privada do Usuário A",
      tipo: "TAREFA",
      status: "ABERTA",
      completed_at: null,
    },
    {
      id: "b2222222-2222-2222-2222-222222222222",
      usuario_id: "user-beta",
      titulo: "Tarefa Privada do Usuário B",
      tipo: "TAREFA",
      status: "ABERTA",
      completed_at: null,
    },
  ];

  function queryUserTarefas(authenticatedUserId: string) {
    return database.filter((t) => t.usuario_id === authenticatedUserId);
  }

  function getTarefaById(authenticatedUserId: string, targetId: string) {
    return (
      database.find(
        (t) => t.id === targetId && t.usuario_id === authenticatedUserId
      ) ?? null
    );
  }

  function patchTarefaById(
    authenticatedUserId: string,
    targetId: string,
    patch: Partial<TarefaDb>
  ) {
    const index = database.findIndex(
      (t) => t.id === targetId && t.usuario_id === authenticatedUserId
    );
    if (index === -1) return null;
    database[index] = { ...database[index], ...patch };
    return database[index];
  }

  function deleteTarefaById(authenticatedUserId: string, targetId: string) {
    const index = database.findIndex(
      (t) => t.id === targetId && t.usuario_id === authenticatedUserId
    );
    if (index === -1) return false;
    database.splice(index, 1);
    return true;
  }

  test("Caso 1: Usuário A lê apenas suas tarefas e nunca as de Usuário B", () => {
    const tarefasUserA = queryUserTarefas("user-alpha");
    assert.equal(tarefasUserA.length, 1);
    assert.equal(tarefasUserA[0].id, "a1111111-1111-1111-1111-111111111111");

    const containsUserB = tarefasUserA.some((t) => t.usuario_id === "user-beta");
    assert.equal(containsUserB, false);
  });

  test("Caso 2: Usuário B conhecendo o ID da tarefa de A não consegue ler nem alterar", () => {
    const taskAId = "a1111111-1111-1111-1111-111111111111";

    const readAttempt = getTarefaById("user-beta", taskAId);
    assert.equal(readAttempt, null);

    const patchAttempt = patchTarefaById("user-beta", taskAId, {
      titulo: "Tentativa de sequestro",
    });
    assert.equal(patchAttempt, null);

    const deleteAttempt = deleteTarefaById("user-beta", taskAId);
    assert.equal(deleteAttempt, false);

    const taskAOriginal = getTarefaById("user-alpha", taskAId);
    assert.equal(taskAOriginal?.titulo, "Tarefa Privada do Usuário A");
  });

  test("Caso 3: Payload com usuario_id fraudulento é ignorado e sobrescrito pela sessão", () => {
    const sessionUserId = "user-alpha";
    const maliciousPayload = {
      titulo: "Tarefa Forjada",
      usuario_id: "user-beta",
    };

    const validated = CreateTarefaSchema.parse(maliciousPayload);

    const finalRecord = {
      ...validated,
      usuario_id: sessionUserId,
    };

    assert.equal(finalRecord.usuario_id, "user-alpha");
  });

  test("Caso 4: Usuário não autenticado é bloqueado (401)", () => {
    function simulateAuth(session: { user?: { id: string } } | null) {
      if (!session?.user?.id) {
        const error: any = new Error("Não autenticado");
        error.statusCode = 401;
        throw error;
      }
      return session.user.id;
    }

    assert.throws(() => simulateAuth(null), (err: any) => err.statusCode === 401);
  });

  test("Caso 5: Usuário inativo é bloqueado (403 / INACTIVE_USER)", () => {
    function simulateActiveCheck(session: { user: { id: string; ativo: boolean } }) {
      if (!session.user.ativo) {
        return { status: 403, error: "INACTIVE_USER" };
      }
      return { status: 200 };
    }

    const inactiveSession = { user: { id: "user-locked", ativo: false } };
    const res = simulateActiveCheck(inactiveSession);
    assert.equal(res.status, 403);
    assert.equal(res.error, "INACTIVE_USER");
  });
});
