"use client";
import { Check, FileVideo, LoaderCircle, ShieldCheck, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useDialog } from "../lib/use-dialog";

export function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useDialog(onClose, busy);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) {
      setError("Choose a recording first.");
      return;
    }
    const values = new FormData(e.currentTarget);
    const body = new FormData();
    body.append(
      "metadata",
      JSON.stringify({
        title: values.get("title"),
        creator: values.get("creator"),
        game: values.get("game"),
        platform: values.get("platform"),
        capturedAt: new Date(String(values.get("capturedAt"))).toISOString(),
        authorizationBasis: values.get("authorizationBasis"),
        attestation: values.get("attestation") === "on",
        voiceAuthorized: values.get("voiceAuthorized") === "on",
        embargoed: values.get("embargoed") === "on",
      }),
    );
    body.append("file", file);
    setBusy(true);
    setError("");
    const request = new XMLHttpRequest();
    request.open("POST", "/api/sources");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      setBusy(false);
      if (request.status === 201) onDone();
      else {
        let message = "Upload failed. Please try again.";
        try {
          const result = JSON.parse(request.responseText);
          message = [result.error, ...(result.details || [])].join(". ");
        } catch {}
        setError(message);
      }
    };
    request.onerror = () => {
      setBusy(false);
      setError("Connection interrupted. Please retry the upload.");
    };
    request.send(body);
  }
  return (
    <div className="modal-backdrop">
      <section
        ref={dialog}
        tabIndex={-1}
        className="modal upload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-title"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">IT STARTS WITH YOUR STREAM</span>
            <h2 id="upload-title">Bring in a recording.</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close upload"
            disabled={busy}
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        <form onSubmit={(e) => void submit(e)}>
          <button
            type="button"
            className={`dropzone ${file ? "has-file" : ""}`}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) setFile(e.dataTransfer.files[0] || null);
            }}
          >
            <span className="upload-icon">{file ? <FileVideo size={24} /> : <Upload size={24} />}</span>
            <strong>{file ? file.name : "Drop your recording here"}</strong>
            <span>
              {file
                ? `${(file.size / 1048576).toFixed(1)} MB · Click to change`
                : "or click to browse · MP4, MOV, MKV, WebM · up to 2 GB"}
            </span>
          </button>
          <input
            aria-label="Recording file"
            className="visually-hidden"
            ref={fileInput}
            type="file"
            accept="video/*,.mkv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <div className="form-grid">
            <label>
              Recording title
              <input
                name="title"
                placeholder="Friday night, unforgettable moments"
                defaultValue={file?.name.replace(/\.[^.]+$/, "")}
                required
                maxLength={160}
              />
            </label>
            <label>
              Creator
              <input name="creator" placeholder="Your creator name" required maxLength={100} />
            </label>
            <label>
              Game
              <input name="game" placeholder="e.g. Grand Theft Auto" required maxLength={100} />
            </label>
            <label>
              Source
              <select name="platform">
                <option value="local">Original local recording</option>
                <option value="obs">OBS recording</option>
                <option value="twitch_export">Authorized Twitch export</option>
                <option value="youtube_export">Creator YouTube export</option>
                <option value="other">Other authorized source</option>
              </select>
            </label>
            <label>
              Captured at
              <input
                name="capturedAt"
                type="datetime-local"
                defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
                  .toISOString()
                  .slice(0, 16)}
                required
              />
            </label>
            <label>
              Authorization basis
              <input
                name="authorizationBasis"
                placeholder="I own this recording and authorize editing"
                minLength={8}
                maxLength={2000}
                required
              />
            </label>
          </div>
          <div className="attestation">
            <span>
              <ShieldCheck size={18} /> A little permission goes a long way.
            </span>
            <label className="check-label">
              <input type="checkbox" name="attestation" required /> I own or am authorized to process and edit
              this recording.
            </label>
            <label className="check-label">
              <input type="checkbox" name="voiceAuthorized" required /> The creator authorizes use of their
              voice and likeness.
            </label>
            <label className="check-label muted">
              <input type="checkbox" name="embargoed" /> This contains embargoed or pre-release material
              (export will be locked).
            </label>
            <small>Game and music rights are reviewed separately. Originals are retained for 7 days.</small>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {busy && (
            <div className="upload-progress">
              <span style={{ width: `${progress}%` }} />
              <p>{progress === 100 ? "Checking the recording…" : `Uploading ${progress}%`}</p>
            </div>
          )}
          <footer className="modal-footer">
            <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{" "}
              {busy ? "Bringing it in…" : "Find my moments"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
