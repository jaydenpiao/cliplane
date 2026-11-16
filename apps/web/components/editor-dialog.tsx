"use client";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  Crop,
  Film,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Play,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  VolumeX,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EditPlan, RightsAssessment } from "../../../packages/domain/src/index";
import { approvalBlockers } from "../../../packages/domain/src/index";
import { api, type Moment, time } from "../lib/api";

const layouts = [
  { id: "blur", name: "Full frame", hint: "Blurred background", icon: Monitor },
  { id: "crop", name: "Vertical crop", hint: "Fill the frame", icon: Crop },
  { id: "facecam", name: "Facecam split", hint: "Creator + gameplay", icon: Film },
  { id: "original", name: "Original", hint: "Keep source ratio", icon: SlidersHorizontal },
] as const;

export function EditorDialog({
  moment,
  onClose,
  onUpdate,
}: {
  moment: Moment & { rights_revision?: number };
  onClose: () => void;
  onUpdate: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<EditPlan>(structuredClone(moment.edit_plan)),
    [rights, setRights] = useState<RightsAssessment>({ ...moment.rights }),
    [title, setTitle] = useState(moment.title);
  const [tab, setTab] = useState<"edit" | "rights">("edit"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState("Reviewed by creator"),
    [showRender, setShowRender] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const sourceDuration = moment.metadata.durationMs / 1000;
  const editDirty = title !== moment.title || JSON.stringify(plan) !== JSON.stringify(moment.edit_plan);
  const rightsDirty = JSON.stringify(rights) !== JSON.stringify(moment.rights);
  const blockers = approvalBlockers(rights, plan);
  const incoming = JSON.stringify({ plan: moment.edit_plan, title: moment.title, rights: moment.rights });
  useEffect(() => {
    const current = JSON.parse(incoming);
    setPlan(current.plan);
    setTitle(current.title);
    setRights(current.rights);
  }, [incoming]);
  async function action(name: string, work: () => Promise<void>) {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await work();
      await onUpdate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function save(): Promise<{ editRevision: number; rightsRevision: number }> {
    let editRevision = moment.edit_revision,
      rightsRevision = moment.rights_revision || 1;
    if (editDirty) {
      await api(`/candidates/${moment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, editPlan: plan, expectedRevision: editRevision }),
      });
      editRevision++;
    }
    if (rightsDirty) {
      await api(`/sources/${moment.source_id}/rights`, {
        method: "PATCH",
        body: JSON.stringify({ ...rights, expectedRevision: rightsRevision }),
      });
      rightsRevision++;
    }
    return { editRevision, rightsRevision };
  }
  function setBoundary(which: "startMs" | "endMs", seconds: number) {
    setPlan((p) => {
      const next = { ...p, [which]: Math.round(seconds * 1000) };
      const length = next.endMs - next.startMs;
      return {
        ...next,
        captions: p.captions
          .filter((c) => c.startMs < length)
          .map((c) => ({ ...c, endMs: Math.min(c.endMs, length) })),
      };
    });
  }
  return (
    <div className="modal-backdrop editor-backdrop">
      <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <header className="editor-header">
          <button type="button" className="button text" onClick={onClose} disabled={!!busy}>
            <ChevronLeft size={17} /> Back to moments
          </button>
          <div>
            <span className={`status-dot ${moment.status}`} />
            {moment.status.replaceAll("_", " ")}
            <span className="revision">Edit {moment.edit_revision}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close editor"
            disabled={!!busy}
          >
            <X size={20} />
          </button>
        </header>
        <div className="editor-body">
          <div className="editor-preview">
            <div className="preview-top">
              <span className="eyebrow">{showRender ? "RENDERED OUTPUT" : "SOURCE PREVIEW"}</span>
              <span>{showRender ? "Final composition" : "Edits apply on render"}</span>
            </div>
            <div className={`video-stage ${showRender ? "render-mode" : ""}`}>
              <video
                ref={video}
                controls
                playsInline
                preload="metadata"
                key={`${moment.id}-${showRender}`}
                src={
                  showRender
                    ? `/api/candidates/${moment.id}/rendered`
                    : `/api/sources/${moment.source_id}/media#t=${plan.startMs / 1000},${plan.endMs / 1000}`
                }
                onLoadedMetadata={() => {
                  if (video.current && !showRender) video.current.currentTime = plan.startMs / 1000;
                }}
                onTimeUpdate={() => {
                  if (video.current && !showRender && video.current.currentTime * 1000 >= plan.endMs)
                    video.current.pause();
                }}
              />
            </div>
            <div className="preview-bottom">
              <span>
                <Film size={15} /> {moment.game}
              </span>
              <span>
                {moment.metadata.width} × {moment.metadata.height} · {Math.round(moment.metadata.fps)} fps
              </span>
            </div>
            <div className="trim-timeline">
              <div className="timeline-labels">
                <span>{time(plan.startMs)}</span>
                <strong>{((plan.endMs - plan.startMs) / 1000).toFixed(1)}s selected</strong>
                <span>{time(plan.endMs)}</span>
              </div>
              <div className="timeline-track">
                <div
                  style={{
                    left: `${(plan.startMs / moment.metadata.durationMs) * 100}%`,
                    width: `${((plan.endMs - plan.startMs) / moment.metadata.durationMs) * 100}%`,
                  }}
                />
              </div>
              <div className="trim-fields">
                <label>
                  Start (seconds)
                  <input
                    type="number"
                    min={0}
                    max={sourceDuration}
                    step={0.1}
                    value={plan.startMs / 1000}
                    onChange={(e) => setBoundary("startMs", Number(e.target.value))}
                  />
                </label>
                <label>
                  End (seconds)
                  <input
                    type="number"
                    min={0}
                    max={sourceDuration}
                    step={0.1}
                    value={plan.endMs / 1000}
                    onChange={(e) => setBoundary("endMs", Number(e.target.value))}
                  />
                </label>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    if (video.current) {
                      video.current.currentTime = plan.startMs / 1000;
                      void video.current.play();
                    }
                  }}
                >
                  <Play size={15} /> Play selection
                </button>
              </div>
            </div>
            <div className="signal-explainer">
              <span className="score-bubble">{moment.score}</span>
              <div>
                <strong>Why this moment?</strong>
                <p>{moment.reason}. Baseline signal ranking; your judgment comes next.</p>
              </div>
            </div>
            {moment.status === "rendered" && (
              <button
                type="button"
                className="button secondary full"
                onClick={() => setShowRender(!showRender)}
              >
                {showRender ? "Return to source preview" : "Watch rendered output"}
              </button>
            )}
          </div>
          <div className="editor-controls">
            <div className="editor-title">
              <span className="eyebrow">MAKE IT YOURS</span>
              <h2 id="editor-title">
                One moment.
                <br />
                Your point of view.
              </h2>
            </div>
            <div className="tabbar">
              <button type="button" className={tab === "edit" ? "active" : ""} onClick={() => setTab("edit")}>
                <SlidersHorizontal size={15} /> Edit clip
              </button>
              <button
                type="button"
                className={tab === "rights" ? "active" : ""}
                onClick={() => setTab("rights")}
              >
                <ShieldCheck size={15} /> Rights & review
                {blockers.length > 0 && <span>{blockers.length}</span>}
              </button>
            </div>
            {tab === "edit" ? (
              <div className="control-content">
                <label>
                  Clip title
                  <input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <span className="control-label">Composition</span>
                <div className="layout-grid">
                  {layouts.map((layout) => (
                    <button
                      type="button"
                      key={layout.id}
                      className={`layout-option ${plan.layout === layout.id ? "selected" : ""}`}
                      onClick={() => setPlan({ ...plan, layout: layout.id })}
                    >
                      <layout.icon size={20} />
                      <strong>{layout.name}</strong>
                      <small>{layout.hint}</small>
                      {plan.layout === layout.id && <Check size={13} className="layout-check" />}
                    </button>
                  ))}
                </div>
                <details className="crop-settings">
                  <summary>Manual gameplay crop</summary>
                  <CropFields rect={plan.crop} onChange={(crop) => setPlan({ ...plan, crop })} />
                </details>
                {plan.layout === "facecam" && (
                  <details className="crop-settings" open>
                    <summary>Facecam region in original source</summary>
                    <CropFields rect={plan.facecam} onChange={(facecam) => setPlan({ ...plan, facecam })} />
                  </details>
                )}
                <div className="label-row">
                  <span className="control-label">Captions</span>
                  <button
                    type="button"
                    className="mini-button"
                    disabled={plan.captions.length >= 80}
                    onClick={() =>
                      setPlan({
                        ...plan,
                        captions: [
                          ...plan.captions,
                          {
                            startMs: 0,
                            endMs: plan.endMs - plan.startMs,
                            text: "Your caption",
                            id: crypto.randomUUID(),
                          },
                        ],
                      })
                    }
                  >
                    + Add cue
                  </button>
                </div>
                {plan.captions.length === 0 && (
                  <div className="caption-empty">
                    <MessageSquare size={17} />
                    <span>Add a caption to give the moment context.</span>
                  </div>
                )}
                {plan.captions.map((cue, index) => (
                  <div className="caption-cue" key={cue.id || `cue-${cue.startMs}-${cue.endMs}`}>
                    <textarea
                      aria-label={`Caption ${index + 1}`}
                      value={cue.text}
                      maxLength={180}
                      onChange={(e) =>
                        setPlan({
                          ...plan,
                          captions: plan.captions.map((c, i) =>
                            i === index ? { ...c, text: e.target.value } : c,
                          ),
                        })
                      }
                    />
                    <div>
                      <label>
                        From
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          value={cue.startMs / 1000}
                          onChange={(e) =>
                            setPlan({
                              ...plan,
                              captions: plan.captions.map((c, i) =>
                                i === index
                                  ? { ...c, startMs: Math.round(Number(e.target.value) * 1000) }
                                  : c,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        To
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          value={cue.endMs / 1000}
                          onChange={(e) =>
                            setPlan({
                              ...plan,
                              captions: plan.captions.map((c, i) =>
                                i === index ? { ...c, endMs: Math.round(Number(e.target.value) * 1000) } : c,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Remove caption ${index + 1}`}
                        onClick={() =>
                          setPlan({ ...plan, captions: plan.captions.filter((_, i) => i !== index) })
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                <label className="toggle-row">
                  <span>
                    <VolumeX size={18} />
                    <span>
                      <strong>Mute all audio</strong>
                      <small>Remove game, music and microphone audio</small>
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={plan.muteAudio}
                    onChange={(e) => setPlan({ ...plan, muteAudio: e.target.checked })}
                  />
                </label>
                <p className="subtle-note">
                  Exports are H.264 MP4 at 720 × 1280, or the original aspect ratio. Source framing stays
                  intact.
                </p>
              </div>
            ) : (
              <div className="control-content rights-controls">
                <div className="info-note">
                  <ShieldCheck size={18} />
                  <p>
                    Your recording permission is separate from game and music rights. Review your basis for
                    each before approval.
                  </p>
                </div>
                <label>
                  Game / underlying content rights
                  <select
                    value={rights.gameRights}
                    onChange={(e) =>
                      setRights({ ...rights, gameRights: e.target.value as RightsAssessment["gameRights"] })
                    }
                  >
                    <option value="unknown">Unknown · review required</option>
                    <option value="authorized">Authorized · I have a valid basis</option>
                    <option value="restricted">Restricted · do not export</option>
                  </select>
                </label>
                <label>
                  Music rights
                  <select
                    value={rights.musicRights}
                    onChange={(e) =>
                      setRights({ ...rights, musicRights: e.target.value as RightsAssessment["musicRights"] })
                    }
                  >
                    <option value="unknown">Unknown · mute or clear rights</option>
                    <option value="licensed">Licensed / original audio</option>
                    <option value="removed">Removed / no music in recording</option>
                  </select>
                </label>
                <label>
                  Spoiler risk
                  <select
                    value={rights.spoilerRisk}
                    onChange={(e) =>
                      setRights({ ...rights, spoilerRisk: e.target.value as RightsAssessment["spoilerRisk"] })
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium · creator reviewed</option>
                    <option value="high">High · alternative edit required</option>
                  </select>
                </label>
                <label>
                  Rights evidence / authorization basis
                  <textarea
                    value={rights.evidence}
                    minLength={8}
                    maxLength={2000}
                    onChange={(e) => setRights({ ...rights, evidence: e.target.value })}
                  />
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={rights.sourceAuthorized}
                    onChange={(e) => setRights({ ...rights, sourceAuthorized: e.target.checked })}
                  />{" "}
                  Recording owner authorizes processing
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={rights.voiceAuthorized}
                    onChange={(e) => setRights({ ...rights, voiceAuthorized: e.target.checked })}
                  />{" "}
                  Creator voice and likeness authorized
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={rights.thirdParty}
                    onChange={(e) => setRights({ ...rights, thirdParty: e.target.checked })}
                  />{" "}
                  Unresolved third-party content
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={rights.embargoed}
                    disabled={moment.rights.embargoed}
                    onChange={(e) => setRights({ ...rights, embargoed: e.target.checked })}
                  />{" "}
                  Embargoed / pre-release material
                </label>
                <p className="subtle-note">
                  Embargo locks cannot be cleared in this workflow. Music detection remains unknown until
                  reviewed.
                </p>
                <label>
                  Review or rejection note
                  <textarea
                    value={reason}
                    minLength={3}
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                {blockers.length > 0 && (
                  <div className="rights-blockers">
                    <strong>Before this can leave your studio</strong>
                    {blockers.map((b) => (
                      <p key={b}>• {b}</p>
                    ))}
                  </div>
                )}
                <p className="subtle-note">
                  Rights changes apply to every candidate from this source and revoke previous approvals. An
                  export approval does not guarantee monetization eligibility.
                </p>
              </div>
            )}
          </div>
        </div>
        {error && (
          <div className="editor-feedback form-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="editor-feedback success-note" role="status">
            {notice}
          </div>
        )}
        <footer className="editor-footer">
          <span>
            <ShieldCheck size={15} /> Your final say. Every time.
          </span>
          <div>
            <button
              type="button"
              className="button text reject"
              disabled={!!busy || reason.trim().length < 3}
              onClick={() =>
                void action("reject", async () => {
                  const revisions = await save();
                  await api(`/candidates/${moment.id}/review`, {
                    method: "POST",
                    body: JSON.stringify({
                      decision: "rejected",
                      reason,
                      expectedRevision: revisions.editRevision,
                      expectedRightsRevision: revisions.rightsRevision,
                    }),
                  });
                  setNotice("Moment rejected. Your feedback is recorded.");
                })
              }
            >
              Reject
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!!busy || (!editDirty && !rightsDirty)}
              onClick={() =>
                void action("save", async () => {
                  await save();
                  setNotice("Changes saved. Review this revision before export.");
                })
              }
            >
              <Save size={15} /> Save
            </button>
            {moment.status === "rendered" && !editDirty && !rightsDirty ? (
              <a className="button primary" href={`/api/candidates/${moment.id}/download`}>
                <ArrowDownToLine size={16} /> Download
              </a>
            ) : (
              <button
                type="button"
                className="button primary"
                disabled={
                  !!busy || blockers.length > 0 || reason.trim().length < 3 || moment.status === "rendering"
                }
                onClick={() =>
                  void action("render", async () => {
                    const revisions = await save();
                    await api(`/candidates/${moment.id}/review`, {
                      method: "POST",
                      body: JSON.stringify({
                        decision: "approved",
                        reason,
                        expectedRevision: revisions.editRevision,
                        expectedRightsRevision: revisions.rightsRevision,
                      }),
                    });
                    await api(`/candidates/${moment.id}/render`, { method: "POST", body: "{}" });
                    setNotice("Approved. Your export is rendering in the background.");
                  })
                }
              >
                {busy || moment.status === "rendering" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                {moment.status === "rendering" ? "Rendering…" : "Approve & render"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

function CropFields({
  rect,
  onChange,
}: {
  rect: EditPlan["crop"];
  onChange: (rect: EditPlan["crop"]) => void;
}) {
  return (
    <div className="crop-fields">
      {(["x", "y", "width", "height"] as const).map((key) => (
        <label key={key}>
          {key} %
          <input
            type="number"
            value={Math.round(rect[key] * 100)}
            min={0}
            max={100}
            step={1}
            onChange={(e) => onChange({ ...rect, [key]: Number(e.target.value) / 100 })}
          />
        </label>
      ))}
    </div>
  );
}
