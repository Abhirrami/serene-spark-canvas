# Fix source retrieval on the published site

## Why it fails only on the live site
- Your screenshot shows the **old live version**. The fixes from my last change only exist here in the editor until you publish again.
- **Web search (401):** Tavily rejects the key the live site uses. Either that key is missing or outdated, or the old code is sending it in a way Tavily refuses.
- **Academic search (429):** the live site runs on shared servers, so Semantic Scholar and OpenAlex see many requests from the same place. When those requests don't say who they're from, both services block them as "too many requests".

## Steps
1. **Publish** the version that already has the fixes: the Tavily key goes with each request, and both academic searches include a contact name.
2. **Make academic search more reliable:**
   - If Semantic Scholar refuses, try OpenAlex.
   - If OpenAlex also refuses, wait briefly and try once more.
   - Then fall back to a third free academic index (Crossref), so the run still gets papers.
3. **Show clearer messages:** a refused web key now reads "Web search key rejected: re-enter your Tavily key," not just "401".
4. **Test the live site** with a real question, then check that it returns sources and a report.
5. If web search still says the key is rejected, I'll open a secure form so you can re-enter your Tavily key, and then publish again.

## Technical details
- `searchAcademic` order: Semantic Scholar, then OpenAlex (one retry after about 1.5s on 429), then the Crossref `/works?query=` endpoint with a `mailto` parameter.
- The Tavily 401 maps to a clear note shown in the run's search log.
- The research flow and its limits stay the same.
