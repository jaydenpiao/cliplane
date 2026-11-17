export class APIError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export async function api<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${url}`, { ...options, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new APIError(
      [data.error, ...(data.details || [])].filter(Boolean).join(". ") || "Something went wrong. Try again.",
      response.status,
    );
  return data as T;
}
export function time(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
export function date(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export interface Moment {
  id: string;
  source_id: string;
  title: string;
  source_title: string;
  game: string;
  creator: string;
  start_ms: number;
  end_ms: number;
  score: number;
  component_scores: Record<string, number>;
  reason: string;
  edit_plan: import("../../../packages/domain/src/index").EditPlan;
  edit_revision: number;
  rights_revision: number;
  status: string;
  source_status: string;
  rights: import("../../../packages/domain/src/index").RightsAssessment;
  metadata: import("../../../packages/domain/src/index").MediaMetadata;
}
