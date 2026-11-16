"use client";
import { ArrowRight, Check, LoaderCircle, Play, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { Brand } from "./brand";

export function AuthScreen({ onReady }: { onReady: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function act(path: string, body: object = {}) {
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      onReady();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <section className="auth-story">
        <Brand />
        <div>
          <span className="eyebrow">
            <span className="live-dot" /> THE CREATOR’S CUT
          </span>
          <h1>
            More than <br />a recording.
            <br />
            <em>Your next story.</em>
          </h1>
          <p>
            Turn long recordings into moments worth watching.
            <br />
            Find, refine and export. Every creative decision stays yours.
          </p>
          <div className="auth-points">
            <span>
              <Check size={16} /> Your footage. Your control.
            </span>
            <span>
              <Check size={16} /> Every clip gets your final say.
            </span>
          </div>
        </div>
        <span className="auth-foot">
          <ShieldCheck size={16} /> Creator-controlled. Open source. Always.
        </span>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="tag coral">YOUR CREATOR WORKSPACE</span>
          <h2>{mode === "login" ? "Welcome to your studio." : "Create your studio."}</h2>
          <p>
            {mode === "login"
              ? "Sign in to pick up where you left off."
              : "Create a private studio for your recordings."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void act(`/auth/${mode}`, Object.fromEntries(form));
            }}
          >
            {mode === "register" && (
              <>
                <label>
                  Your name
                  <input name="name" autoComplete="name" required maxLength={80} placeholder="Alex Morgan" />
                </label>
                <label>
                  Workspace name
                  <input name="workspace" required maxLength={100} placeholder="Alex’s studio" />
                </label>
              </>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@yourstudio.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={12}
                maxLength={200}
                required
                placeholder="At least 12 characters"
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button primary full" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
              {mode === "login" ? "Enter your studio" : "Create workspace"}
            </button>
          </form>
          <div className="auth-switch">
            {mode === "login" ? "New to Cliplane?" : "Already have a workspace?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
            >
              {mode === "login" ? "Create a workspace" : "Sign in"}
            </button>
          </div>
          <div className="divider">
            <span>JUST LOOKING AROUND?</span>
          </div>
          <button
            type="button"
            className="button secondary full"
            disabled={busy}
            onClick={() => void act("/auth/demo")}
          >
            <Play size={15} fill="currentColor" /> Explore the sample studio
          </button>
          <p className="sample-note">
            Local demo with original synthetic footage.
            <br />
            Real workflow. No social accounts needed.
          </p>
        </div>
      </section>
    </main>
  );
}
