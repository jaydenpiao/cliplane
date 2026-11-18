"use client";
import { ArrowRight, LoaderCircle, Play } from "lucide-react";
import Image from "next/image";
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
      <header>
        <Brand />
      </header>
      <div className="auth-layout">
        <section className="auth-story">
          <h1>Turn long recordings into clips.</h1>
          <p>Find moments worth keeping, trim and caption them, and approve each edit before export.</p>
        </section>
        <section className="auth-card">
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
          <div className="auth-sample">
            <button
              type="button"
              className="button secondary full"
              disabled={busy}
              onClick={() => void act("/auth/demo")}
            >
              <Play size={15} fill="currentColor" /> Explore the sample studio
            </button>
            <p>Try the editor with original sample footage.</p>
          </div>
        </section>
        <figure className="auth-preview">
          <Image
            src="/sample-editor.png"
            alt="Cliplane editor with a captioned racing clip, trim timeline and framing controls."
            width={1600}
            height={900}
            sizes="(max-width: 760px) 100vw, (max-width: 1380px) 55vw, 735px"
          />
          <figcaption>Sample studio preview</figcaption>
        </figure>
      </div>
    </main>
  );
}
