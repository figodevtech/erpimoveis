import { normalizePermission, PERMS } from "@/app/api/_authz/permission-constants";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type SystemNotificationInput = {
  category: "MARKETPLACE" | "SALES" | "STOCK" | "FINANCIAL" | "SYSTEM";
  priority?: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  href?: string | null;
  source: string;
  sourceEventId: string;
  metadata?: Record<string, unknown>;
};

export async function notifySalesUsers(input: SystemNotificationInput) {
  return notifyUsersWithPermission(PERMS.VENDAS, [input]);
}

export async function notifySalesUsersBatch(inputs: SystemNotificationInput[]) {
  return notifyUsersWithPermission(PERMS.VENDAS, inputs);
}

export async function notifyUsersWithPermission(permission: string, inputs: SystemNotificationInput[]) {
  if (!inputs.length) return 0;
  const { data: users, error: usersError } = await supabaseAdmin
    .from("usuario")
    .select("id, perfilid")
    .eq("ativo", true);
  if (usersError) throw usersError;

  const profileIds = Array.from(new Set(
    (users ?? []).map((user) => Number(user.perfilid)).filter((id) => Number.isFinite(id) && id > 0),
  ));
  if (!profileIds.length) return 0;

  const { data: grants, error: grantsError } = await supabaseAdmin
    .from("perfilpermissao")
    .select("perfilid, permissao:permissaoid(nome)")
    .in("perfilid", profileIds);
  if (grantsError) throw grantsError;

  const target = normalizePermission(permission);
  const permittedProfiles = new Set(
    (grants ?? [])
      .filter((grant: any) => normalizePermission(grant?.permissao?.nome) === target)
      .map((grant: any) => Number(grant.perfilid)),
  );
  const recipients = (users ?? []).filter((user) => permittedProfiles.has(Number(user.perfilid)));
  if (!recipients.length) return 0;

  const rows = recipients.flatMap((user) => inputs.map((input) => ({
      usuario_id: user.id,
      category: input.category,
      priority: input.priority ?? "INFO",
      title: input.title.trim().slice(0, 160),
      message: input.message.trim().slice(0, 1000),
      href: input.href?.trim() || null,
      source: input.source.trim().slice(0, 80),
      source_event_id: input.sourceEventId.trim().slice(0, 240),
      metadata: input.metadata ?? {},
    })));

  const { error } = await supabaseAdmin
    .from("system_notification")
    .upsert(rows, { onConflict: "usuario_id,source,source_event_id", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}
