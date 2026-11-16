import { z } from "zod";

export const rectSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().min(0.02).max(1),
    height: z.number().finite().min(0.02).max(1),
  })
  .strict()
  .refine((r) => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001, "Crop exceeds source boundaries");

export const editPlanSchema = z
  .object({
    version: z.literal(1),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    layout: z.enum(["crop", "facecam", "blur", "original"]),
    crop: rectSchema,
    facecam: rectSchema,
    muteAudio: z.boolean(),
    captions: z
      .array(
        z
          .object({
            startMs: z.number().int().nonnegative(),
            endMs: z.number().int().positive(),
            text: z.string().trim().min(1).max(180),
            id: z.uuid().optional(),
          })
          .strict(),
      )
      .max(80),
    profile: z.enum(["standard", "preview"]).default("standard"),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.endMs - p.startMs < 100 || p.endMs - p.startMs > 180000)
      ctx.addIssue({ code: "custom", message: "Clip duration must be between 100 ms and 3 minutes" });
    for (const cue of p.captions)
      if (cue.endMs <= cue.startMs || cue.endMs > p.endMs - p.startMs)
        ctx.addIssue({ code: "custom", message: "Caption must fit within the clip" });
  });
export type EditPlan = z.infer<typeof editPlanSchema>;

export const rightsSchema = z
  .object({
    sourceAuthorized: z.boolean(),
    voiceAuthorized: z.boolean(),
    gameRights: z.enum(["unknown", "authorized", "restricted"]),
    musicDetected: z.enum(["unknown", "likely", "unlikely"]),
    musicRights: z.enum(["unknown", "licensed", "removed"]),
    spoilerRisk: z.enum(["low", "medium", "high"]),
    embargoed: z.boolean(),
    thirdParty: z.boolean(),
    evidence: z.string().trim().min(8).max(2000),
  })
  .strict();
export type RightsAssessment = z.infer<typeof rightsSchema>;

export const uploadMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    creator: z.string().trim().min(1).max(100),
    game: z.string().trim().min(1).max(100),
    platform: z.enum(["local", "obs", "twitch_export", "youtube_export", "other"]),
    capturedAt: z.iso.datetime(),
    authorizationBasis: z.string().trim().min(8).max(2000),
    attestation: z.literal(true),
    voiceAuthorized: z.literal(true),
    embargoed: z.boolean().default(false),
  })
  .strict();
export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;

export function approvalBlockers(rights: RightsAssessment, plan: Pick<EditPlan, "muteAudio">): string[] {
  const blockers: string[] = [];
  if (!rights.sourceAuthorized) blockers.push("Source recording authorization is required");
  if (!rights.voiceAuthorized) blockers.push("Creator voice and likeness authorization is required");
  if (rights.gameRights !== "authorized") blockers.push("Game rights need review");
  if (rights.musicRights === "unknown" && !plan.muteAudio)
    blockers.push("Clear music rights or mute all audio");
  if (rights.embargoed) blockers.push("Embargoed or pre-release material cannot be exported");
  if (rights.thirdParty) blockers.push("Resolve third-party content rights");
  if (rights.spoilerRisk === "high") blockers.push("High spoiler risk requires an alternative edit");
  return blockers;
}

export function defaultEditPlan(startMs: number, endMs: number): EditPlan {
  return {
    version: 1,
    startMs,
    endMs,
    layout: "blur",
    crop: { x: 0, y: 0, width: 1, height: 1 },
    facecam: { x: 0, y: 0, width: 0.25, height: 0.3 },
    muteAudio: false,
    captions: [],
    profile: "standard",
  };
}

export function temporalDeduplicate<T extends { startMs: number; endMs: number; score: number }>(
  windows: T[],
  threshold = 0.3,
): T[] {
  const selected: T[] = [];
  for (const w of [...windows].sort((a, b) => b.score - a.score || a.startMs - b.startMs)) {
    const overlaps = selected.some((s) => {
      const intersection = Math.max(0, Math.min(w.endMs, s.endMs) - Math.max(w.startMs, s.startMs));
      const union = Math.max(w.endMs, s.endMs) - Math.min(w.startMs, s.startMs);
      return union > 0 && intersection / union > threshold;
    });
    if (!overlaps) selected.push(w);
  }
  return selected;
}

export type PublicationState =
  | "DETECTED"
  | "EDITED"
  | "RIGHTS_CHECKED"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "SCHEDULED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "METRICS_SYNCED"
  | "AMBIGUOUS"
  | "FAILED";
export interface PublicationRequest {
  idempotencyKey: string;
  workspaceId: string;
  candidateId: string;
  approvedRevision: number;
  accountId: string;
  caption: string;
}
export interface PublicationResult {
  state: PublicationState;
  externalRequestId?: string;
  externalPostId?: string;
  confirmationUrl?: string;
}
export interface Publisher {
  readonly name: string;
  publish(request: PublicationRequest): Promise<PublicationResult>;
}

export interface User {
  id: string;
  email: string;
  name: string;
}
export interface Workspace {
  id: string;
  name: string;
}
export interface CreatorIdentity {
  id: string;
  workspaceId: string;
  name: string;
}
export interface AudioTrack {
  index: number;
  role: "mixed" | "microphone" | "game";
}
export interface MediaMetadata {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
  fps: number;
  codec: string;
  audioTracks: AudioTrack[];
}
