import {
  operationalRealtimeCredentialsSchema,
  operationalSnapshotSchema,
  type OperationalRealtimeCredentials,
  type OperationalPeriod,
  type OperationalSnapshot,
} from "@/lib/central-operacional/contracts";

export class OperationalApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

async function operationalFetch<T>(
  url: string,
  parser: (value: unknown) => T,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new OperationalApiError(String(body?.error ?? "CENTRAL_REQUEST_ERROR"), response.status);
  }
  return parser(body);
}

export function fetchOperationalSnapshot(
  period: OperationalPeriod,
  signal?: AbortSignal,
): Promise<OperationalSnapshot> {
  return operationalFetch(
    `/api/central-operacional/snapshot?periodo=${period}`,
    (value) => operationalSnapshotSchema.parse(value),
    signal,
  );
}

export function fetchOperationalRealtimeCredentials(signal?: AbortSignal): Promise<OperationalRealtimeCredentials> {
  return operationalFetch(
    "/api/central-operacional/realtime-token",
    (value) => operationalRealtimeCredentialsSchema.parse(value),
    signal,
  );
}
