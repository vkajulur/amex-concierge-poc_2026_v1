# Amex Concierge — Working POC

A proof-of-concept **AI Concierge** that lives inside a (simulated) logged-in American Express
Card Member experience. The member types natural language; an LLM with **tool use** decides
what to do and takes real action against mock account data:

1. **Navigate** to a section ("take me to dispute a charge")
2. **Download** a statement ("download my March 2026 statement")
3. **Find offers** while shopping ("I want to buy a laptop — any offers?") — add each offer or all
4. **Analyze spending** ("how many Uber trips have I taken this year?")
5. **Show FICO score** ("what's my credit score?") — rendered as a gauge
6. **Show routing number** ("routing number for my checking account?")
7. **Manage third-party permissions** ("manage third party permissions") — simulates the real
   click-path: Card → Account Services → Card Management → Manage Third Party Permissions
8. **Connect to a live agent** ("I'd like to speak to a person")

The chat opens from a **chat icon** at the bottom-right and greets the member ("Good morning/
afternoon/evening, John") based on the browser's local time.

> This is a demonstration prototype. It is **not** affiliated with American Express and uses
> entirely **fictional data**. There is no real integration with any Amex system.

---

## Why it's built this way

- **No build step.** Plain Express + static HTML/CSS/JS. Nothing to compile, so there's nothing
  to break in a live demo and it starts instantly on Replit.
- **The intelligence is server-side.** The browser never sees your API key. The agent loop
  (intent → tool call → execute → grounded answer) runs in `server.js`.
- **Answers are grounded, never hallucinated.** Spending numbers, statements, and offers all come
  from tool results computed over `data/*.json`. The model is instructed to report those exact
  numbers — the same "grounded, confirm-before-act" story in the pitch deck.

---

## Architecture

```
Browser (public/)                 Server (server.js)               Data (data/)
─────────────────                 ──────────────────               ────────────
Amex-styled dashboard             POST /api/chat                   transactions.json
 + Concierge chat widget   ─────▶   └ agent loop:                  statements.json
                                      1. Claude + tools             offers.json
 renders UI actions  ◀─────           2. run tool (lib/tools.js)
 (offer cards, insights,              3. tool_result → Claude
  statement download,                 4. final text + uiActions
  nav highlight)                    GET /api/statement/:id  (generates a download)
```

The four tools are defined in **`lib/tools.js`** — each has a schema (sent to the model) and an
executor (runs against the JSON). Add a tool by adding one schema + one executor function.

---

## Deploy on Replit (5 minutes)

1. **Create the Repl.** Easiest path: push this folder to a GitHub repo, then in Replit choose
   **Create Repl → Import from GitHub**. (Or **Create Repl → Node.js**, then drag in all these
   files.)
2. **Add your API key.** Open **Tools → Secrets** and add:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your key from <https://console.anthropic.com>
3. **Press Run.** The `.replit` file runs `npm install && npm start`. First run installs deps
   (~15s), then the server boots.
4. **Open the webview.** Replit shows the app in the preview pane and gives you a public URL you
   can share with the panel. Click **Concierge** (bottom-right) and try the suggested prompts.

That's it. No build, no database, no extra services.

### Run locally instead

```bash
npm install
cp .env.example .env        # then put your key in .env
ANTHROPIC_API_KEY=sk-ant-... npm start
# open http://localhost:3000
```

---

## The 3-minute demo script

Open the Concierge and run these in order — each shows a different "move":

| Say this | What the panel sees |
|---|---|
| `Take me to dispute a charge` | Concierge confirms + the **Dispute a Charge** tile highlights on the dashboard |
| `Download my March 2026 statement` | A **statement card** with balance + a working **Download** button |
| `I want to buy a laptop — any offers?` | **Offer cards**; **+ Add to Card** / **Add all** each ask for confirmation before committing |
| `How many Uber trips have I taken this year?` | A **spending-insight card**: count, total, and the full list (count matches the rows) |
| `What's my FICO score?` | A **FICO gauge** (782, Very Good) with the month-over-month change |
| `Routing number for my checking account?` | A **banking card** with routing number (copyable) + masked account |
| `Take me to manage third party permissions` | A **modal that walks the click-path**, then connected apps with toggles — **disconnect asks to confirm** |
| `I'd like to speak to a live agent` | A **"connecting…" → live agent connected** card (Maria R.) |

**The kicker** — ask an unscripted follow-up to prove it's reasoning over real data, not canned:
- `What about Lyft?` · `How much did I spend on dining last month?` · `Compare my Uber and Lyft spending this year`

> **Demo-day tip:** record a 60–90s screen capture of this exact flow as a fallback. Live demos
> fail on Wi-Fi, not logic.

---

## Customize

- **Member name:** defaults to **John** (set `MEMBER_NAME` in Secrets to change). The dashboard and
  the chat greeting update automatically; the greeting (morning/afternoon/evening) follows the
  viewer's local time.
- **Data:** edit `data/transactions.json`, `data/statements.json`, `data/offers.json`,
  `data/profile.json` (FICO + deposit accounts + live-agent queue), and `data/permissions.json`
  (third-party apps). Counts and totals recompute automatically.
- **Tone / behavior:** edit `SYSTEM_PROMPT` in `server.js`.
- **Card art:** real Amex product images live in `public/img/` (Rewards Checking, Savings, Business).
- **Add a capability:** add a schema to `toolSchemas` and an executor to `executors` in
  `lib/tools.js`. Return `{ result, ui }` — `ui` is optional structured data the frontend can
  render (see `renderAction` in `public/app.js`).

### SDK & model

Built on **`@anthropic-ai/sdk` v0.102.0** (full Claude 4 support). The model defaults to
**`claude-sonnet-4-5`** (current stable Claude 4 Sonnet). Override with a `MODEL` secret. For the
current model list see <https://docs.anthropic.com/en/docs/about-claude/models>. You can switch to a
faster model (e.g. a Haiku) if latency matters on stage.

---

## How the agent loop works (server.js)

```
loop (max 6 hops):
  response = Claude(messages, tools, system)
  append assistant turn to messages
  if stop_reason != "tool_use":  return final text + collected UI actions
  for each tool_use block:
      { result, ui } = runTool(name, input)   # executes against mock data
      collect ui action
      add tool_result to a single user turn
  append tool_results;  loop
```

This is the standard Anthropic tool-use protocol: the assistant's `tool_use` blocks are echoed back
verbatim, and each is answered with a matching `tool_result`. The full message history (including
tool turns) round-trips to the client so multi-turn follow-ups keep context.

---

## Security & scope notes (good to say out loud to the panel)

- The API key is **server-side only** — never shipped to the browser.
- Everything here is **read-mostly and simulated**. State-changing actions in the demo
  (**Add to Card**, **connect/disconnect a third-party app**) use an explicit **confirm-before-act**
  step, mirroring how a production build would gate anything that moves money or grants data access.
  A real build would call internal Amex APIs within the authenticated session, scoped to the
  member's token, with PII governance. Those are the dependencies/risks on the Implementation slide.
- This POC deliberately stays inside "surface info + take these four actions" — no regulated
  financial advice.

---

## File map

```
.replit                 Replit run config
package.json            deps: express, @anthropic-ai/sdk ^0.102.0
server.js               Express server + agent loop + routes (model: claude-sonnet-4-5)
lib/tools.js            tool schemas + executors (navigate, statement, offers, transactions,
                        fico, routing, live agent, third-party permissions)
data/                   transactions / statements / offers / profile / permissions (all mock)
public/index.html       Amex-styled dashboard + chat icon + permissions modal
public/styles.css       authentic Amex palette (#006fcf / #00175a), Helvetica stack
public/app.js           chat client, FICO gauge, greeting, UI-action rendering, permissions sim
public/img/             real Amex card art (checking / savings / business)
.env.example            env template
```
