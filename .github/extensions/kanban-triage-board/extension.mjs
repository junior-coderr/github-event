// Extension: kanban-triage-board
// A Kanban board for triaging the repository's most urgent GitHub issues.
//
// This single-file skeleton is a starting point. For more complex canvases
// (multiple actions with non-trivial logic, shared state, a custom renderer,
// etc.) prefer splitting things out: move each action handler into its own
// function, extract `open`/`onClose` into helpers, and pull large units
// (renderer assets, schema definitions, shared utilities) into sibling files
// imported from this entry point. Keep extension.mjs focused on wiring.

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const execFileAsync = promisify(execFile);
const servers = new Map();

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function loadIssues() {
    const { stdout: repositoryOutput } = await execFileAsync("gh", [
        "repo",
        "view",
        "--json",
        "nameWithOwner",
        "--jq",
        ".nameWithOwner",
    ]);
    const repository = repositoryOutput.trim();
    const { stdout } = await execFileAsync("gh", [
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,body,labels,comments,createdAt,updatedAt,url,author",
    ]);
    const issues = JSON.parse(stdout);

    return {
        repository,
        issues: issues
            .map((issue) => {
                const ageInDays = Math.max(
                    0,
                    (Date.now() - Date.parse(issue.updatedAt)) / 86_400_000,
                );
                const priorityLabel = issue.labels.some((label) =>
                    /priority|urgent|critical|bug/i.test(label.name),
                );
                const score =
                    (priorityLabel ? 8 : 0) +
                    Math.min(issue.comments.length, 5) +
                    Math.min(ageInDays / 14, 4);
                const reasons = [];
                if (priorityLabel) reasons.push("has a priority, urgent, critical, or bug label");
                if (issue.comments.length > 0) {
                    reasons.push(`${issue.comments.length} comment${issue.comments.length === 1 ? "" : "s"} indicate active discussion`);
                }
                if (ageInDays >= 14) reasons.push("has not been updated for at least two weeks");
                if (reasons.length === 0) reasons.push("is one of the remaining open issues");
                return {
                    ...issue,
                    repository,
                    score,
                    reason: reasons.join("; "),
                };
            })
            .sort((left, right) => right.score - left.score || left.number - right.number),
    };
}

function issueCard(issue, showReason) {
    const labels = issue.labels
        .map((label) => `<span class="label">${escapeHtml(label.name)}</span>`)
        .join("");
    const description = issue.body?.trim() || "No description provided.";
    const reason = showReason
        ? `<p class="reason"><strong>Why now:</strong> ${escapeHtml(issue.reason)}</p>`
        : "";
    return `
      <article class="card">
        <div class="card-heading">
          <span class="number">#${issue.number}</span>
          <h3>${escapeHtml(issue.title)}</h3>
        </div>
        <div class="labels">${labels}</div>
        <p class="description">${escapeHtml(description.slice(0, 420))}${description.length > 420 ? "…" : ""}</p>
        ${reason}
        <button data-issue="${escapeHtml(JSON.stringify({
            number: issue.number,
            title: issue.title,
            url: issue.url,
            repository: issue.repository,
        }))}">Add to current context</button>
        <span class="status" aria-live="polite"></span>
      </article>`;
}

async function renderHtml(_instanceId) {
    let board;
    let error = "";
    try {
        board = await loadIssues();
    } catch (loadError) {
        error = loadError instanceof Error ? loadError.message : String(loadError);
    }

    if (error) {
        return `<!doctype html><html><body><main><h1>Kanban triage board</h1><p class="error">Unable to load open issues: ${escapeHtml(error)}</p></main></body></html>`;
    }

    const topIssues = board.issues.slice(0, 3);
    const remainingIssues = board.issues.slice(3);
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kanban triage board</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; padding: 24px; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font: 14px/1.5 var(--font-sans, system-ui, sans-serif); }
      main { max-width: 1000px; margin: auto; }
      h1 { margin: 0 0 4px; font-size: 26px; }
      .subtitle, .muted { color: var(--text-color-muted, #656d76); }
      .section { margin-top: 28px; }
      .section h2 { font-size: 18px; margin-bottom: 12px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
      .card { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 10px; padding: 16px; background: var(--background-color-muted, #f6f8fa); }
      .card-heading { display: flex; gap: 8px; align-items: baseline; }
      .card h3 { margin: 0; font-size: 16px; }
      .number { color: var(--text-color-muted, #656d76); font-family: var(--font-mono, monospace); }
      .labels { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0; }
      .label { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 999px; padding: 1px 7px; font-size: 12px; }
      .description { white-space: pre-line; }
      .reason { color: var(--text-color-muted, #656d76); font-size: 13px; }
      button { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 6px; padding: 7px 10px; background: var(--background-color-default, #fff); color: inherit; cursor: pointer; font-weight: 600; }
      button:hover { border-color: var(--true-color-blue, #0969da); }
      button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px; }
      .status { display: block; min-height: 20px; margin-top: 8px; color: var(--text-color-muted, #656d76); font-size: 12px; }
      .error { color: var(--true-color-red, #cf222e); }
    </style>
  </head>
  <body>
    <main>
      <h1>Kanban triage board</h1>
      <p class="subtitle">${escapeHtml(board.repository)} · ${board.issues.length} open issue${board.issues.length === 1 ? "" : "s"}</p>
      <section class="section">
        <h2>Needs attention now</h2>
        <div class="grid">${topIssues.length ? topIssues.map((issue) => issueCard(issue, true)).join("") : '<p class="muted">No open issues.</p>'}</div>
      </section>
      <section class="section">
        <h2>Remaining open issues</h2>
        <div class="grid">${remainingIssues.length ? remainingIssues.map((issue) => issueCard(issue, false)).join("") : '<p class="muted">Everything is in the top section.</p>'}</div>
      </section>
    </main>
    <script>
      for (const button of document.querySelectorAll("button[data-issue]")) {
        button.addEventListener("click", async () => {
          const status = button.nextElementSibling;
          button.disabled = true;
          status.textContent = "Adding…";
          try {
            const response = await fetch("/context", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: button.dataset.issue,
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Request failed");
            status.textContent = "Added to the current context.";
          } catch (requestError) {
            status.textContent = requestError.message;
            button.disabled = false;
          }
        });
      }
    </script>
  </body>
</html>`;
}

async function startServer(instanceId) {
    const server = createServer(async (req, res) => {
        if (req.method === "POST" && req.url === "/context") {
            let body = "";
            for await (const chunk of req) body += chunk;
            try {
                const issue = JSON.parse(body);
                await addIssueToContext(issue);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            } catch (requestError) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: requestError instanceof Error ? requestError.message : String(requestError) }));
            }
            return;
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(await renderHtml(instanceId));
    });
    // Port 0 = let the OS pick a free ephemeral port. Bind to loopback only.
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

async function addIssueToContext(issue) {
    if (!issue || !issue.number || !issue.title || !issue.url || !issue.repository) {
        throw new Error("Issue details are incomplete.");
    }
    await session.send({
        prompt: `Add ${issue.repository}#${issue.number} to the current work context. Issue: "${issue.title}" (${issue.url}). Start by reviewing its details and proposing the next concrete implementation step.`,
    });
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "kanban-triage-board",
            displayName: "Kanban triage board",
            description: "Triage open GitHub issues and add any issue to the current session context.",
            actions: [
                {
                    name: "add_issue_to_context",
                    description: "Add a GitHub issue from the board to the current session context.",
                    inputSchema: {
                        type: "object",
                        required: ["number", "title", "url", "repository"],
                        properties: {
                            number: { type: "integer" },
                            title: { type: "string" },
                            url: { type: "string" },
                            repository: { type: "string" },
                        },
                    },
                    handler: async (ctx) => {
                        await addIssueToContext(ctx.input);
                        return { ok: true };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    servers.set(ctx.instanceId, entry);
                }
                return {
                    title: "Kanban triage board",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
