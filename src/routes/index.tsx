import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ResearchPilot — Agentic AI Research Assistant" },
      { name: "description", content: "ResearchPilot plans research, searches web and academic sources, reviews evidence, and writes a cited report." },
      { property: "og:title", content: "ResearchPilot — Agentic AI Research Assistant" },
      { property: "og:description", content: "Autonomous research planning, tool use, evidence review and cited reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Source = { id: string; sourceType: string; title: string; url: string; authors?: string; publishedDate?: string; snippet: string };
type Ev = { type: string; [k: string]: any };

const EXAMPLES = [
  "Find recent approaches for detecting hallucinations in LLMs.",
  "What are the main methods for carbon capture and how do they compare?",
  "How effective is spaced repetition for long-term learning?",
];

function Index() {
  const [q, setQ] = useState("");
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<Ev[]>([]);
  const [stage, setStage] = useState({ stage: "", progress: 0, message: "" });
  const [sources, setSources] = useState<Source[]>([]);
  const [report, setReport] = useState("");
  const [error, setError] = useState("");

  async function start(question: string) {
    if (question.trim().length < 10) return setError("Please write a question of at least 10 characters.");
    setRunning(true); setEvents([]); setSources([]); setReport(""); setError("");
    setStage({ stage: "starting", progress: 3, message: "Starting agent" });
    try {
      const res = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line) as Ev;
          if (e.type === "stage") setStage({ stage: e.stage, progress: e.progress, message: e.message });
          else if (e.type === "sources") setSources(e.sources);
          else if (e.type === "report") setReport(e.content);
          else if (e.type === "error") setError(e.message);
          if (e.type !== "sources" && e.type !== "report" && e.type !== "done") setEvents((p) => [...p, e]);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const started = events.length > 0 || running;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-baseline gap-3 px-6 py-4">
          <span className="font-display text-2xl text-foreground">ResearchPilot</span>
          <span className="text-sm text-muted-foreground">Agentic AI Research Assistant</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {!started && (
          <section className="mb-8 max-w-2xl">
            <h1 className="font-display text-5xl leading-tight text-foreground">Ask a question. Watch the agent research it.</h1>
            <p className="mt-4 text-muted-foreground">
              ResearchPilot autonomously plans research, searches web and academic sources, evaluates evidence, and generates a structured report with source citations.
            </p>
          </section>
        )}

        <form onSubmit={(e) => { e.preventDefault(); start(q); }} className="rounded-lg border border-border bg-card p-4">
          <textarea
            value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} rows={3} disabled={running}
            placeholder="e.g. Find recent approaches for detecting hallucinations in LLMs."
            className="w-full resize-none bg-transparent text-lg text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{q.length}/500</span>
            <button disabled={running} className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
              {running ? "Researching…" : "Start research"}
            </button>
          </div>
        </form>

        {!started && (
          <div className="mt-4 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => { setQ(ex); start(ex); }} className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:border-primary hover:text-foreground">
                {ex}
              </button>
            ))}
          </div>
        )}

        {error && <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

        {started && (
          <div className="mt-8 grid gap-6 md:grid-cols-[1fr_320px]">
            <section>
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-medium capitalize text-foreground">{stage.stage}</span>
                <span className="text-muted-foreground">{stage.progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all duration-500" style={{ width: `${stage.progress}%` }} />
              </div>

              <h2 className="mt-6 mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Agent trace</h2>
              <ol className="space-y-2 border-l border-border pl-4">
                {events.map((e, i) => <TraceItem key={i} e={e} />)}
                {running && <li className="animate-pulse text-sm text-muted-foreground">{stage.message}…</li>}
              </ol>

              {report && (
                <article className="mt-10 rounded-lg border border-border bg-card p-6">
                  <h2 className="font-display text-3xl text-foreground">Research Report</h2>
                  <Markdown text={report} sources={sources} />
                  <h3 className="mt-6 mb-2 font-display text-xl text-foreground">Sources</h3>
                  <ul className="space-y-1 text-sm">
                    {sources.map((s) => (
                      <li key={s.id} id={s.id}>
                        <span className="font-mono text-primary">[{s.id}]</span>{" "}
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-foreground underline decoration-border underline-offset-2 hover:decoration-primary">{s.title}</a>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6 flex gap-2">
                    <button onClick={() => navigator.clipboard.writeText(report)} className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted">Copy report</button>
                    <button onClick={() => { setEvents([]); setReport(""); setSources([]); setQ(""); }} className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted">New research</button>
                  </div>
                </article>
              )}
            </section>

            <aside>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Sources found ({sources.length})</h2>
              <div className="space-y-2">
                {sources.map((s) => (
                  <a key={s.id} href={s.url} target="_blank" rel="noreferrer" className="block rounded-md border border-border bg-card p-3 transition hover:border-primary">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-primary">{s.id}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{s.sourceType}</span>
                      {s.publishedDate && <span className="text-muted-foreground">{s.publishedDate.slice(0, 10)}</span>}
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm text-foreground">{s.title}</div>
                  </a>
                ))}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function TraceItem({ e }: { e: Ev }) {
  const box = (label: string, body: ReactNode) => (
    <li className="text-sm">
      <span className="mr-2 font-mono text-xs text-primary">{label}</span>
      <span className="text-foreground">{body}</span>
    </li>
  );
  if (e.type === "stage") return box("STAGE", e.message);
  if (e.type === "plan")
    return box("PLAN", (
      <span>
        {e.plan.objective}
        <ul className="mt-1 list-disc pl-5 text-muted-foreground">{e.plan.subtopics.map((s: string) => <li key={s}>{s}</li>)}</ul>
      </span>
    ));
  if (e.type === "tool")
    return box("TOOL", <span><code className="text-accent-foreground">{e.tool}("{e.query}")</code> → {e.note ? <span className="text-destructive">{e.note}</span> : `${e.count} new sources`}</span>);
  if (e.type === "review")
    return box(`REVIEW ${e.iteration}`, <span><b className="uppercase">{e.review.status}</b> — {e.review.reason}</span>);
  if (e.type === "error") return box("ERROR", <span className="text-destructive">{e.message}</span>);
  return null;
}

function inline(text: string, sources: Source[]) {
  return text.split(/(\[S\d+\]|\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = part.match(/^\[(S\d+)\]$/);
    if (m) {
      const s = sources.find((x) => x.id === m[1]);
      return <a key={i} href={s?.url ?? `#${m[1]}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary hover:underline">[{m[1]}]</a>;
    }
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

function Markdown({ text, sources }: { text: string; sources: Source[] }) {
  return (
    <div className="mt-4 space-y-3 leading-relaxed text-foreground">
      {text.split("\n").map((line, i) => {
        const t = line.trim();
        if (!t) return null;
        if (t.startsWith("#")) return <h3 key={i} className="mt-6 font-display text-xl">{t.replace(/^#+\s*/, "")}</h3>;
        if (/^[-*]\s/.test(t)) return <p key={i} className="pl-4 before:mr-2 before:text-primary before:content-['•']">{inline(t.slice(2), sources)}</p>;
        return <p key={i}>{inline(t, sources)}</p>;
      })}
    </div>
  );
}
