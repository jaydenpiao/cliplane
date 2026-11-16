"use client";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Clock3,
  ExternalLink,
  Film,
  FolderOpen,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TrendingUp,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AuthScreen } from "../components/auth-screen";
import { Brand } from "../components/brand";
import { EditorDialog } from "../components/editor-dialog";
import { UploadDialog } from "../components/upload-dialog";
import { api, date, duration, type Moment } from "../lib/api";
import { useDialog } from "../lib/use-dialog";

const navigation = [
  { id: "overview", label: "Studio", icon: LayoutDashboard },
  { id: "moments", label: "My moments", icon: Clapperboard },
  { id: "recordings", label: "Recordings", icon: FolderOpen },
  { id: "insights", label: "Insights", icon: TrendingUp },
] as const;
type View = (typeof navigation)[number]["id"] | "rights" | "activity" | "settings";
export default function Studio() {
  const [user, setUser] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [dashboard, setDashboard] = useState<any>(null),
    [sources, setSources] = useState<any[]>([]),
    [moments, setMoments] = useState<Moment[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [events, setEvents] = useState<any[]>([]);
  const [view, setView] = useState<View>("overview"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("score"),
    [uploading, setUploading] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(""),
    [mobileMenu, setMobileMenu] = useState(false),
    [info, setInfo] = useState(false);
  const helpDialog = useDialog(() => setInfo(false), false, info);
  const refresh = useCallback(async () => {
    const [d, s, m, j, e] = await Promise.all([
      api("/dashboard"),
      api<any[]>("/sources"),
      api<Moment[]>("/candidates"),
      api<any[]>("/jobs"),
      api<any[]>("/events"),
    ]);
    setDashboard(d);
    setSources(s);
    setMoments(m);
    setJobs(j);
    setEvents(e);
    setError("");
  }, []);
  const signIn = useCallback(async () => {
    try {
      const me = await api("/me");
      setUser(me);
      await refresh();
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [refresh]);
  useEffect(() => {
    void signIn();
  }, [signIn]);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      void refresh().catch((e) => setError(e.message));
    }, 5000);
    return () => clearInterval(timer);
  }, [user, refresh]);
  const stats = dashboard?.stats || {
    sources: 0,
    source_hours: 0,
    needs_review: 0,
    rendered: 0,
    active_jobs: 0,
    accepted: 0,
    rejected: 0,
  };
  const selectedMoment = moments.find((m) => m.id === selected);
  const filtered = moments
    .filter(
      (m) =>
        (filter === "all"
          ? m.status !== "rejected" && m.status !== "expired"
          : filter === "needs_review"
            ? m.status === "needs_review"
            : filter === "rendered"
              ? m.status === "rendered"
              : m.status === "rejected") &&
        `${m.title} ${m.game} ${m.creator}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => (sort === "score" ? b.score - a.score : a.start_ms - b.start_ms));
  function navigate(next: View) {
    setView(next);
    setMobileMenu(false);
    setQuery("");
  }
  async function removeSource(id: string) {
    if (
      !window.confirm(
        "Delete this recording and every derived clip? This removes the local files permanently.",
      )
    )
      return;
    try {
      await api(`/sources/${id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading)
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" size={23} />
        <p>Opening your studio…</p>
      </div>
    );
  if (!user) return <AuthScreen onReady={() => void signIn()} />;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            type="button"
            className="icon-button mobile-close"
            aria-label="Close menu"
            onClick={() => setMobileMenu(false)}
          >
            <X size={19} />
          </button>
        </div>
        <button type="button" className="workspace-picker" onClick={() => navigate("settings")}>
          <span className="workspace-avatar">{user.workspaceName?.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{user.workspaceName}</strong>
            <small>Creator workspace</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === "moments" && stats.needs_review > 0 && (
                <span className="nav-count">{stats.needs_review}</span>
              )}
            </button>
          ))}
          <div className="nav-divider" />
          <button
            type="button"
            className={view === "rights" ? "active" : ""}
            onClick={() => navigate("rights")}
          >
            <ShieldCheck size={18} />
            <span>Rights & permissions</span>
          </button>
          <button
            type="button"
            className={view === "activity" ? "active" : ""}
            onClick={() => navigate("activity")}
          >
            <Activity size={18} />
            <span>Activity</span>
            {stats.active_jobs > 0 && <span className="job-dot" />}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="studio-note">
            <span className="studio-note-icon">
              <ShieldCheck size={18} />
            </span>
            <strong>You're in the director’s chair.</strong>
            <p>Every export starts with your approval.</p>
            <button type="button" onClick={() => navigate("rights")}>
              Review permissions <ArrowRight size={14} />
            </button>
          </div>
          <button type="button" className="sidebar-help" onClick={() => setInfo(true)}>
            <CircleHelp size={17} /> Help & workflow <ExternalLink size={13} />
          </button>
          <button type="button" className="user-profile" onClick={() => navigate("settings")}>
            <span className="user-avatar">
              {user.name
                ?.split(" ")
                .map((s: string) => s[0])
                .join("")
                .slice(0, 2)}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace-content">
        <header className="topbar">
          <div>
            <button
              type="button"
              className="icon-button menu-button"
              aria-label="Open menu"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Studio <ChevronRight size={13} />{" "}
              <strong>
                {navigation.find((n) => n.id === view)?.label ||
                  (view === "rights"
                    ? "Rights & permissions"
                    : view === "settings"
                      ? "Workspace settings"
                      : "Activity")}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="system-status">
              <span className={`live-dot ${stats.active_jobs ? "working" : ""}`} />
              {stats.active_jobs
                ? `${stats.active_jobs} job${stats.active_jobs > 1 ? "s" : ""} processing`
                : "Studio ready"}
            </span>
            <span className="topbar-divider" />
            <button
              type="button"
              className="icon-button notification-button"
              aria-label="View activity"
              onClick={() => navigate("activity")}
            >
              <Bell size={18} />
              {stats.active_jobs > 0 && <i />}
            </button>
            <span className="tiny-avatar">{user.name?.[0]}</span>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button type="button" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {view === "overview" && (
            <section className="page-heading studio-heading">
              <div>
                <span className="eyebrow">YOUR CREATIVE WORKSPACE</span>
                <h1>From recording to remarkable.</h1>
                <p>Find your moment. Shape the story. Make the final call.</p>
              </div>
              <button type="button" className="button primary" onClick={() => setUploading(true)}>
                <Plus size={18} /> Upload recording
              </button>
            </section>
          )}
          {(view === "overview" || view === "moments") && (
            <section className="moments-section">
              {view === "moments" && (
                <section className="page-heading">
                  <div>
                    <span className="eyebrow">YOUR CLIP LIBRARY</span>
                    <h1>
                      Your moments<span className="coral-text">.</span>
                    </h1>
                    <p>Every promising bit deserves a second look.</p>
                  </div>
                  <button type="button" className="button primary" onClick={() => setUploading(true)}>
                    <Plus size={18} /> Upload recording
                  </button>
                </section>
              )}
              <div className="section-heading">
                <div>
                  <h2>
                    {view === "overview" ? "Your shortlist" : "All moments"}
                    <span className="count-pill">{moments.length}</span>
                  </h2>
                  {view === "overview" && (
                    <p>Promising moments from your recordings, ready for a closer look.</p>
                  )}
                </div>
                {view === "overview" && (
                  <button type="button" className="button text" onClick={() => navigate("moments")}>
                    View all moments <ArrowRight size={15} />
                  </button>
                )}
              </div>
              <div className="filter-row">
                <div className="filter-tabs">
                  {[
                    { id: "all", label: "All moments" },
                    { id: "needs_review", label: "Needs review" },
                    { id: "rendered", label: "Exported" },
                    ...(view === "moments" ? [{ id: "rejected", label: "Rejected" }] : []),
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={filter === item.id ? "active" : ""}
                      onClick={() => setFilter(item.id)}
                    >
                      {item.label}
                      {item.id === "needs_review" && stats.needs_review > 0 && (
                        <span>{stats.needs_review}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="filter-tools">
                  <label className="search-input">
                    <Search size={15} />
                    <input
                      aria-label="Search moments"
                      placeholder="Find a moment…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <select aria-label="Sort moments" value={sort} onChange={(e) => setSort(e.target.value)}>
                    <option value="score">Top signals</option>
                    <option value="time">Source order</option>
                  </select>
                </div>
              </div>
              {filtered.length > 0 ? (
                <div className="moment-grid">
                  {filtered.slice(0, view === "overview" ? 6 : 500).map((m) => (
                    <MomentCard key={m.id} moment={m} onClick={() => setSelected(m.id)} />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span>
                    <Clapperboard size={28} />
                  </span>
                  <h3>
                    {moments.length === 0 ? "The next great moment starts here." : "A little breathing room."}
                  </h3>
                  <p>
                    {moments.length === 0
                      ? "Upload an authorized recording. We’ll find a few promising places to start."
                      : "No moments match this view. Try another filter or search."}
                  </p>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      if (moments.length === 0) setUploading(true);
                      else {
                        setFilter("all");
                        setQuery("");
                      }
                    }}
                  >
                    {moments.length === 0 ? "Upload your first recording" : "Show all moments"}
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </section>
          )}
          {view === "overview" && (
            <div className="bottom-grid">
              <section className="recording-section">
                <div className="section-heading">
                  <h2>Recent recordings</h2>
                  <button type="button" className="button text" onClick={() => navigate("recordings")}>
                    All recordings <ArrowRight size={15} />
                  </button>
                </div>
                {sources.length > 0 ? (
                  sources.slice(0, 3).map((s) => (
                    <div className="recording-row" key={s.id}>
                      <span className="recording-icon">
                        <Film size={19} />
                      </span>
                      <div>
                        <strong>{s.title}</strong>
                        <small>
                          {s.creator} · {duration(s.metadata.durationMs)} · {date(s.created_at)}
                        </small>
                      </div>
                      <Status value={s.status} />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`View ${s.title}`}
                        onClick={() => {
                          const m = moments.find((m) => m.source_id === s.id);
                          if (m) setSelected(m.id);
                          else navigate("activity");
                        }}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="subtle-note">Your recordings will appear here after upload.</p>
                )}
              </section>
              <section className="permission-note">
                <ShieldCheck size={22} />
                <h3>Your footage. Your final say.</h3>
                <p>
                  Nothing leaves the studio without your review. Rights, music and creator permission stay
                  part of the process.
                </p>
                <button type="button" onClick={() => navigate("rights")}>
                  Check your permissions <ArrowRight size={14} />
                </button>
              </section>
            </div>
          )}
          {view === "recordings" && (
            <>
              <section className="page-heading">
                <div>
                  <span className="eyebrow">SOURCE LIBRARY</span>
                  <h1>
                    Your recordings<span className="coral-text">.</span>
                  </h1>
                  <p>Originals, provenance and processing — in one place.</p>
                </div>
                <button type="button" className="button primary" onClick={() => setUploading(true)}>
                  <Plus size={18} /> Upload recording
                </button>
              </section>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Recording</th>
                      <th>Source</th>
                      <th>Duration</th>
                      <th>Moments</th>
                      <th>Retention</th>
                      <th>Status</th>
                      <th>
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.title}</strong>
                          <small>
                            {s.creator} · {s.game}
                          </small>
                        </td>
                        <td>{s.source_platform.replaceAll("_", " ")}</td>
                        <td>{duration(s.metadata.durationMs)}</td>
                        <td>{s.candidate_count}</td>
                        <td>{date(s.retention_deadline)}</td>
                        <td>
                          <Status value={s.status} />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button text danger-text"
                            onClick={() => void removeSource(s.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sources.length === 0 && (
                  <div className="empty-state">
                    <FolderOpen size={28} />
                    <h3>Room for your first stream.</h3>
                    <p>Bring in an original recording to get started.</p>
                  </div>
                )}
              </div>
              <div className="info-note">
                <Clock3 size={19} />
                <p>
                  Originals and analysis files expire after 7 days. Completed approved renders stay available.
                  Deleting a recording removes every derived file.
                </p>
              </div>
            </>
          )}
          {view === "insights" && (
            <>
              <section className="page-heading">
                <div>
                  <span className="eyebrow">BETTER MOMENTS START WITH FEEDBACK</span>
                  <h1>
                    Look at your progress<span className="coral-text">.</span>
                  </h1>
                  <p>Real workflow signals, from the decisions you make.</p>
                </div>
              </section>
              <div className="stats-grid">
                <Stat
                  icon={Check}
                  label="Accepted moments"
                  value={String(stats.accepted)}
                  note="Your current approved selections"
                  tone="green"
                />
                <Stat
                  icon={X}
                  label="Rejected moments"
                  value={String(stats.rejected)}
                  note="Feedback that sharpens the process"
                />
                <Stat
                  icon={ArrowDownToLine}
                  label="Finished exports"
                  value={String(stats.rendered)}
                  note="Rendered from your approved edit"
                  tone="coral"
                />
                <Stat
                  icon={Clock3}
                  label="Source hours"
                  value={Number(stats.source_hours).toFixed(2)}
                  note="From your uploaded recordings"
                />
              </div>
              <div className="insights-grid">
                <section className="chart-card">
                  <span className="eyebrow">LAST 7 DAYS</span>
                  <h2>A week in the studio</h2>
                  <p>Uploads, edits, reviews and completed jobs.</p>
                  <div className="bar-chart">
                    {(dashboard?.activity || []).map((d: any) => (
                      <div key={d.day}>
                        <span className="bar-value">{d.events}</span>
                        <span
                          className="chart-bar"
                          style={{
                            height: `${Math.max(3, (d.events / Math.max(1, ...dashboard.activity.map((v: any) => v.events))) * 150)}px`,
                          }}
                        />
                        <small>{date(`${d.day}T12:00:00`)}</small>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="chart-card">
                  <span className="eyebrow">HOW THE BASELINE IS DOING</span>
                  <h2>Review is the real signal.</h2>
                  <p>
                    Candidate scores combine audio energy, scene activity and boundary quality. Your
                    accept/reject history is recorded for evaluation.
                  </p>
                  <div className="metric-line">
                    <span>Completed analyses</span>
                    <strong>
                      {jobs.filter((j) => j.kind === "analyze" && j.status === "succeeded").length}
                    </strong>
                  </div>
                  <div className="metric-line">
                    <span>Average processing time</span>
                    <strong>
                      {jobs.some((j) => j.telemetry?.wallSeconds)
                        ? `${(jobs.filter((j) => j.telemetry?.wallSeconds).reduce((sum, j) => sum + j.telemetry.wallSeconds, 0) / jobs.filter((j) => j.telemetry?.wallSeconds).length).toFixed(1)}s`
                        : "—"}
                    </strong>
                  </div>
                  <div className="metric-line">
                    <span>Paid inference used</span>
                    <strong>$0.00</strong>
                  </div>
                  <small className="subtle-note">
                    Social views and watch time need an official platform integration. They are not collected
                    in this build.
                  </small>
                </section>
              </div>
            </>
          )}
          {view === "rights" && (
            <>
              <section className="page-heading">
                <div>
                  <span className="eyebrow">PERMISSION IS PART OF THE PROCESS</span>
                  <h1>
                    Built on good ground<span className="coral-text">.</span>
                  </h1>
                  <p>Recording ownership, game rights and music — each has its own story.</p>
                </div>
              </section>
              <div className="info-note">
                <ShieldCheck size={22} />
                <p>
                  Creator permission does not grant rights in game assets or music. Unknown rights stay
                  unknown until you review them. Approval is recorded against a specific edit and rights
                  revision.
                </p>
              </div>
              <div className="rights-list">
                {sources.map((s) => (
                  <div className="rights-source" key={s.id}>
                    <span className="recording-icon">
                      <ShieldCheck size={22} />
                    </span>
                    <div>
                      <h3>{s.title}</h3>
                      <p>
                        {s.creator} · {s.game}
                      </p>
                      <div className="rights-badges">
                        <span className="tag green">Source authorized</span>
                        <span className={`tag ${s.rights.gameRights === "authorized" ? "green" : "amber"}`}>
                          Game: {s.rights.gameRights}
                        </span>
                        <span className={`tag ${s.rights.musicRights === "unknown" ? "amber" : "green"}`}>
                          Music: {s.rights.musicRights}
                        </span>
                        {s.rights.embargoed && <span className="tag coral">Embargo locked</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!moments.some((m) => m.source_id === s.id && m.source_status === "ready")}
                      onClick={() => {
                        const m = moments.find((m) => m.source_id === s.id);
                        if (m) setSelected(m.id);
                      }}
                    >
                      Review <ArrowRight size={14} />
                    </button>
                  </div>
                ))}
              </div>
              {sources.length === 0 && (
                <div className="empty-state">
                  <ShieldCheck size={28} />
                  <h3>Your rights ledger starts with an upload.</h3>
                  <p>Every recording carries an authorization record and explicit rights states.</p>
                </div>
              )}
            </>
          )}
          {view === "activity" && (
            <>
              <section className="page-heading">
                <div>
                  <span className="eyebrow">THE STUDIO, IN MOTION</span>
                  <h1>
                    Behind every moment<span className="coral-text">.</span>
                  </h1>
                  <p>Processing jobs and the decisions that got you here.</p>
                </div>
                <button type="button" className="button secondary" onClick={() => void refresh()}>
                  Refresh
                </button>
              </section>
              <section className="activity-jobs">
                <h2>Processing queue</h2>
                {jobs.map((j) => (
                  <div className="job-row" key={j.id}>
                    <span className="recording-icon">
                      {j.status === "running" ? (
                        <LoaderCircle className="spin" size={19} />
                      ) : j.kind === "render" ? (
                        <Clapperboard size={19} />
                      ) : (
                        <WandSparkles size={19} />
                      )}
                    </span>
                    <div>
                      <strong>{j.kind === "render" ? "Clip render" : "Find promising moments"}</strong>
                      <small>
                        {j.error ||
                          `${date(j.created_at)} · Attempt ${j.attempts} of 3${j.telemetry?.wallSeconds ? ` · ${j.telemetry.wallSeconds.toFixed(1)}s` : ""}`}
                      </small>
                    </div>
                    <Status value={j.status} />
                    {j.status === "failed" && (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() =>
                          void api(`/jobs/${j.id}/retry`, { method: "POST", body: "{}" })
                            .then(refresh)
                            .catch((e) => setError(e.message))
                        }
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}
                {jobs.length === 0 && (
                  <p className="subtle-note">No jobs yet. Your next upload will get things moving.</p>
                )}
              </section>
              <section className="event-feed">
                <h2>Creator audit trail</h2>
                {events.map((event) => (
                  <div className="event-row" key={event.id}>
                    <span className="event-dot" />
                    <div>
                      <strong>{event.kind.replaceAll(".", " · ").replaceAll("_", " ")}</strong>
                      <small>
                        {event.data?.reason || event.data?.candidates !== undefined
                          ? event.data.reason || `${event.data.candidates} candidates generated`
                          : "Recorded in your workspace"}
                      </small>
                    </div>
                    <time>{new Date(event.created_at).toLocaleString()}</time>
                  </div>
                ))}
              </section>
            </>
          )}
          {view === "settings" && (
            <>
              <section className="page-heading">
                <div>
                  <span className="eyebrow">WORKSPACE SETTINGS</span>
                  <h1>
                    Your workspace<span className="coral-text">.</span>
                  </h1>
                  <p>
                    {user.workspaceName} · {user.email}
                  </p>
                </div>
              </section>
              <div className="settings-grid">
                <section className="chart-card">
                  <Settings2 size={23} />
                  <h2>Local studio · v0.1.0</h2>
                  <p>
                    Next.js, TypeScript, PostgreSQL, Python and FFmpeg. The open-source core processes
                    authorized footage on this machine.
                  </p>
                  <div className="metric-line">
                    <span>Raw source retention</span>
                    <strong>7 days</strong>
                  </div>
                  <div className="metric-line">
                    <span>Default review policy</span>
                    <strong>Human approval</strong>
                  </div>
                  <div className="metric-line">
                    <span>Live social posting</span>
                    <strong>Not configured</strong>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      void api("/auth/logout", { method: "POST", body: "{}" }).then(() => setUser(null))
                    }
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </section>
                <section className="chart-card">
                  <ShieldCheck size={23} />
                  <h2>Integrations, when you’re ready.</h2>
                  <p>
                    This first version ends at an approved download. Official publishing, authorized Twitch
                    ingest, cloud storage and billing are tracked in the project backlog.
                  </p>
                  <div className="integration-row">
                    <span className="integration-letter">B</span>
                    <span>
                      Buffer<small>Official publishing adapter planned</small>
                    </span>
                    <span className="tag">Later milestone</span>
                  </div>
                  <div className="integration-row">
                    <span className="integration-letter dark">▶</span>
                    <span>
                      YouTube / TikTok<small>OAuth & creator consent required</small>
                    </span>
                    <span className="tag">Not connected</span>
                  </div>
                  <p className="subtle-note">
                    No social accounts are connected and no public content is posted.
                  </p>
                </section>
              </div>
            </>
          )}
          <footer className="workspace-footer">
            <span>
              <span className="brand-tiny">✳</span> Cliplane · Creator studio
            </span>
            <span>Open source. Yours to create.</span>
          </footer>
        </main>
      </div>
      {uploading && (
        <UploadDialog
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            void refresh();
          }}
        />
      )}
      {selectedMoment && (
        <EditorDialog moment={selectedMoment} onClose={() => setSelected(null)} onUpdate={refresh} />
      )}
      {info && (
        <div className="modal-backdrop">
          <section
            ref={helpDialog}
            tabIndex={-1}
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <button
              type="button"
              className="icon-button close-top"
              aria-label="Close help"
              onClick={() => setInfo(false)}
            >
              <X size={20} />
            </button>
            <span className="tag green">A QUICK STUDIO TOUR</span>
            <h2 id="help-title">Make room for the good stuff.</h2>
            <ol>
              <li>
                <strong>Bring in your recording.</strong>
                <p>Upload an original file and confirm creator authorization.</p>
              </li>
              <li>
                <strong>Find a promising moment.</strong>
                <p>Audio and scene signals surface a short list. You decide what’s worth keeping.</p>
              </li>
              <li>
                <strong>Make it yours.</strong>
                <p>Trim, compose and add captions. Review game and music rights separately.</p>
              </li>
              <li>
                <strong>Give it your final say.</strong>
                <p>Approve the exact edit, render and download. Nothing is posted automatically.</p>
              </li>
            </ol>
            <button type="button" className="button primary full" onClick={() => setInfo(false)}>
              Got it <Check size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function MomentCard({ moment: m, onClick }: { moment: Moment; onClick: () => void }) {
  const [previewing, setPreviewing] = useState(false);
  const cleared =
    m.rights.gameRights === "authorized" &&
    (m.rights.musicRights !== "unknown" || m.edit_plan.muteAudio) &&
    !m.rights.embargoed;
  return (
    <article className="moment-card">
      <button
        type="button"
        className="moment-image"
        aria-label={`Review ${m.title}`}
        onClick={onClick}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
            setPreviewing(true);
        }}
        onPointerLeave={() => setPreviewing(false)}
        onBlur={() => setPreviewing(false)}
      >
        {/* biome-ignore lint/performance/noImgElement: Private authenticated thumbnails bypass the shared optimizer cache. */}
        <img src={`/api/candidates/${m.id}/thumbnail`} alt={`${m.game} recording preview`} loading="lazy" />
        {previewing && (
          <video
            className="card-video"
            muted
            autoPlay
            playsInline
            preload="none"
            src={`/api/sources/${m.source_id}/media#t=${m.start_ms / 1000},${m.end_ms / 1000}`}
            onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime >= m.end_ms / 1000)
                event.currentTarget.currentTime = m.start_ms / 1000;
            }}
            tabIndex={-1}
            aria-hidden="true"
          />
        )}
        <span className="score-tag">
          <span>✳</span> {m.score} <small>signal</small>
        </span>
        <span className="clip-duration">{duration(m.edit_plan.endMs - m.edit_plan.startMs)}</span>
        <span className="card-play">
          <PlayIcon />
        </span>
        {m.status === "rendered" && (
          <span className="rendered-tag">
            <Check size={12} /> Ready
          </span>
        )}
      </button>
      <div className="moment-card-body">
        <div className="game-line">
          <span className="game-dot" />
          {m.game}
          <span>·</span>
          <span>{m.creator}</span>
        </div>
        <button type="button" className="moment-title" onClick={onClick}>
          {m.title}
        </button>
        <p className="moment-source">{m.source_title}</p>
        <div className="moment-card-footer">
          <span className={cleared ? "rights-ok" : "rights-pending"}>
            <ShieldCheck size={13} />
            {cleared ? "Rights reviewed" : "Review rights"}
          </span>
          <button type="button" onClick={onClick}>
            {m.status === "rendering" ? "Rendering" : m.status === "rendered" ? "View clip" : "Review"}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}
function Stat({
  icon: Icon,
  label,
  value,
  note,
  tone = "",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <section className={`stat-card ${tone}`}>
      <div>
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </section>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status-label ${value}`}>
      <span />
      {value.replaceAll("_", " ")}
    </span>
  );
}
function PlayIcon() {
  return (
    <svg width="15" height="17" viewBox="0 0 15 17" fill="currentColor" aria-hidden="true">
      <path d="M14 7.63a1 1 0 0 1 0 1.74L2 16.3a1 1 0 0 1-1.5-.87V1.57A1 1 0 0 1 2 .7l12 6.93Z" />
    </svg>
  );
}
