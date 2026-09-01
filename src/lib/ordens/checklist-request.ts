import { isIP } from "node:net";
import { getClientIp } from "@/lib/login-security";

export function checklistRequestAudit(request: Request) {
  const candidate = getClientIp(request);
  return {
    ip: isIP(candidate) ? candidate : null,
    userAgent: request.headers.get("user-agent")?.slice(0, 1000) || null,
  };
}
