import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

export const LIMITS = {
  MAX_RESEARCH_ITERATIONS: 2,
  MAX_TOOL_CALLS: 5,
  MAX_RESULTS_PER_SEARCH: 5,
  MAX_TOTAL_SOURCES: 10,
};

export type Source = {
  id: string;
  sourceType: "web" | "academic";
  title: string;
  url: string;
  authors?: string;
  publishedDate?: string;
  snippet: string;
};

export type AgentEvent =
  | { type: "stage"; stage: string; progress: number; message: string }
  | { type: "plan"; plan: Plan }
  | { type: "tool"; tool: string; query: string; count: number; note?: string }
  | { type: "review"; review: Review; iteration: number }
  | { type: "sources"; sources: Source[] }
  | { type: "report"; content: string }
  | { type: "error"; message: string }
  | { type: "done" };

type ToolCall = { tool: "search_web" | "search_academic"; query: string };
type Plan = { objective: string; subtopics: string[]; toolCalls: ToolCall[] };
type Review = { status: "continue" | "finalize"; reason: string; missingTopics: string[]; nextQueries: ToolCall[] };

const LAG = "X-Lovable-AIG-Run-ID";

function makeLlm() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI is not configured (missing LOVABLE_API_KEY).");
  let runId: string | undefined;
  const openai = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: key,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId) headers.set(LAG, runId);
      const res = await fetch(input, { ...init, headers });
      runId ??= res.headers.get(LAG) ?? undefined;
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace settings.");
      if (res.status === 429) throw new Error("AI rate limit reached. Please try again in a minute.");
      if (res.status === 403) throw new Error("AI access was denied for this workspace.");
      return res;
    },
  });
  return async (system: string, prompt: string) => {
    let err: unknown;
    const r = streamText({
      model: openai.responses("openai/gpt-6-astra"),
      system,
      prompt,
      onError: ({ error }) => {
        err = error;
      },
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    });
    const text = await r.text;
    if (err) throw err instanceof Error ? err : new Error(String(err));
    return text;
  };
}

function parseJson<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Agent returned an unreadable response.");
  return JSON.parse(m[0]) as T;
}

function cleanCalls(calls: unknown): ToolCall[] {
  if (!Array.isArray(calls)) return [];
  return calls
    .filter((c) => c && typeof c.query === "string" && (c.tool === "search_web" || c.tool === "search_academic"))
    .map((c) => ({ tool: c.tool, query: String(c.query).slice(0, 200) }));
}

async function searchWeb(query: string): Promise<Omit<Source, "id">[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("Web search not configured (TAVILY_API_KEY missing)");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: LIMITS.MAX_RESULTS_PER_SEARCH }),
  });
  if (!res.ok) throw new Error(`Web search failed (${res.status})`);
  const data = (await res.json()) as { results?: { title: string; url: string; content: string; published_date?: string }[] };
  return (data.results ?? []).map((r) => ({
    sourceType: "web",
    title: r.title,
    url: r.url,
    publishedDate: r.published_date,
    snippet: (r.content ?? "").slice(0, 600),
  }));
}

async function searchAcademic(query: string): Promise<Omit<Source, "id">[]> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${LIMITS.MAX_RESULTS_PER_SEARCH}&fields=title,url,abstract,authors,year`;
  const headers: Record<string, string> = {};
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  const res = await fetch(url, { headers });
  if (!res.ok) return searchOpenAlex(query);
  const data = (await res.json()) as {
    data?: { title: string; url: string; abstract?: string; authors?: { name: string }[]; year?: number }[];
  };
  return (data.data ?? [])
    .filter((p) => p.url && p.title)
    .map((p) => ({
      sourceType: "academic",
      title: p.title,
      url: p.url,
      authors: (p.authors ?? []).slice(0, 4).map((a) => a.name).join(", "),
      publishedDate: p.year ? String(p.year) : undefined,
      snippet: (p.abstract ?? "No abstract available.").slice(0, 600),
    }));
}

async function searchOpenAlex(query: string): Promise<Omit<Source, "id">[]> {
  const res = await fetch(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${LIMITS.MAX_RESULTS_PER_SEARCH}&select=title,doi,id,publication_year,authorships,abstract_inverted_index`);
  if (!res.ok) throw new Error(`Academic search failed (${res.status})`);
  const data = (await res.json()) as { results?: any[] };
  return (data.results ?? []).filter((w) => w.title).map((w) => {
    let abs = "No abstract available.";
    if (w.abstract_inverted_index) {
      const words: string[] = [];
      for (const [word, pos] of Object.entries(w.abstract_inverted_index as Record<string, number[]>)) for (const i of pos) words[i] = word;
      abs = words.join(" ");
    }
    return {
      sourceType: "academic" as const,
      title: w.title,
      url: w.doi || w.id,
      authors: (w.authorships ?? []).slice(0, 4).map((a: any) => a.author?.display_name).filter(Boolean).join(", "),
      publishedDate: w.publication_year ? String(w.publication_year) : undefined,
      snippet: abs.slice(0, 600),
    };
  });
}

export async function runAgent(question: string, emit: (e: AgentEvent) => void) {
  const llm = makeLlm();
  const sources: Source[] = [];
  let toolCalls = 0;

  // STEP 1-2: Plan
  emit({ type: "stage", stage: "planning", progress: 10, message: "Planner is breaking down the question" });
  const plan = parseJson<Plan>(
    await llm(
      `You are the Planner stage of ResearchPilot, a research agent. Break the question into 2-4 subtopics and choose tool calls.
Tools: "search_web" (general web, news, blogs, benchmarks, industry) and "search_academic" (peer-reviewed papers).
Pick the tool that best fits each query. Propose at most 3 tool calls. Queries must be short keyword searches.
Respond ONLY with JSON: {"objective": string, "subtopics": string[], "toolCalls": [{"tool": "search_web"|"search_academic", "query": string}]}`,
      `Research question: ${question}`,
    ),
  );
  plan.toolCalls = cleanCalls(plan.toolCalls).slice(0, 3);
  plan.subtopics = Array.isArray(plan.subtopics) ? plan.subtopics.slice(0, 4) : [];
  emit({ type: "plan", plan });

  let queue = plan.toolCalls;
  for (let iteration = 1; iteration <= LIMITS.MAX_RESEARCH_ITERATIONS; iteration++) {
    // STEP 3: Research loop
    emit({ type: "stage", stage: "searching", progress: 20 + iteration * 15, message: `Research iteration ${iteration}` });
    for (const call of queue) {
      if (toolCalls >= LIMITS.MAX_TOOL_CALLS || sources.length >= LIMITS.MAX_TOTAL_SOURCES) break;
      toolCalls++;
      try {
        const found = call.tool === "search_web" ? await searchWeb(call.query) : await searchAcademic(call.query);
        const fresh = found.filter((f) => !sources.some((s) => s.url === f.url));
        const room = LIMITS.MAX_TOTAL_SOURCES - sources.length;
        const added = fresh.slice(0, room).map((f, i) => ({ ...f, id: `S${sources.length + i + 1}` }) as Source);
        sources.push(...added);
        emit({ type: "tool", tool: call.tool, query: call.query, count: added.length });
      } catch (e) {
        emit({ type: "tool", tool: call.tool, query: call.query, count: 0, note: (e as Error).message });
      }
    }
    emit({ type: "sources", sources });

    // STEP 4: Review
    const lastIteration = iteration === LIMITS.MAX_RESEARCH_ITERATIONS || toolCalls >= LIMITS.MAX_TOOL_CALLS || sources.length >= LIMITS.MAX_TOTAL_SOURCES;
    if (lastIteration) {
      emit({ type: "review", iteration, review: { status: "finalize", reason: "Research budget reached; proceeding with the collected evidence.", missingTopics: [], nextQueries: [] } });
      break;
    }
    emit({ type: "stage", stage: "reviewing", progress: 55, message: "Reviewer is evaluating the evidence" });
    const review = parseJson<Review>(
      await llm(
        `You are the Reviewer stage of ResearchPilot. Judge whether collected evidence covers the subtopics.
If important gaps remain, return status "continue" with at most 2 new tool calls targeting the gaps. Otherwise "finalize".
Respond ONLY with JSON: {"status":"continue"|"finalize","reason":string,"missingTopics":string[],"nextQueries":[{"tool":"search_web"|"search_academic","query":string}]}`,
        `Question: ${question}\nSubtopics: ${plan.subtopics.join("; ")}\nEvidence:\n${sources.map((s) => `[${s.id}] (${s.sourceType}) ${s.title}: ${s.snippet.slice(0, 250)}`).join("\n") || "(none)"}`,
      ),
    );
    review.nextQueries = cleanCalls(review.nextQueries).slice(0, 2);
    emit({ type: "review", iteration, review });
    if (review.status !== "continue" || review.nextQueries.length === 0) break;
    queue = review.nextQueries;
  }

  // STEP 5: Report
  if (sources.length === 0) {
    emit({ type: "error", message: "No sources could be found, so no report was written (to avoid inventing facts)." });
    return;
  }
  emit({ type: "stage", stage: "writing", progress: 80, message: "Report writer is synthesizing findings" });
  const report = await llm(
    `You are the Report Writer stage of ResearchPilot. Write a structured research report in Markdown using ONLY the provided sources.
Cite claims inline as [S1], [S2]. Never invent sources, numbers or citations. If evidence is thin, say so.
Use exactly these "## " sections: Executive Summary, Research Question, Research Method, Key Findings, Major Approaches, Comparative Analysis, Research Gaps, Conclusion.
Do not write a Sources section (it is added automatically). Keep it under 900 words.`,
    `Question: ${question}\nMethod: ${toolCalls} tool calls across web and academic search, ${sources.length} sources.\nSources:\n${sources
      .map((s) => `[${s.id}] (${s.sourceType}) ${s.title}${s.authors ? ` — ${s.authors}` : ""}${s.publishedDate ? ` (${s.publishedDate})` : ""}\n${s.snippet}`)
      .join("\n\n")}`,
  );
  emit({ type: "report", content: report });
  emit({ type: "stage", stage: "completed", progress: 100, message: "Research complete" });
}
