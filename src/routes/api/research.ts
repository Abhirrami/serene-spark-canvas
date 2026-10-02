import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { runAgent, type AgentEvent } from "@/lib/agent.server";

export const Route = createFileRoute("/api/research")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const parsed = z.object({ query: z.string().trim().min(10).max(500) }).safeParse(body);
        if (!parsed.success) {
          return Response.json({ error: "Please enter a research question between 10 and 500 characters." }, { status: 400 });
        }
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const emit = (e: AgentEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
            try {
              await runAgent(parsed.data.query, emit);
            } catch (e) {
              emit({ type: "error", message: (e as Error).message || "The agent failed unexpectedly." });
            }
            emit({ type: "done" });
            controller.close();
          },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
      },
    },
  },
});
