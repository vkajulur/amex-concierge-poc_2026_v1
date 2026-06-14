// server.js — Amex Concierge POC
// Serves the static frontend and runs the agent loop against the Anthropic API.

const express = require("express");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { toolSchemas, runTool, load } = require("./lib/tools");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || "claude-sonnet-4-5"; // current stable Claude 4 Sonnet; see README
const MEMBER_NAME = process.env.MEMBER_NAME || "John";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("\n⚠  ANTHROPIC_API_KEY is not set. Add it in Replit → Tools → Secrets (or a local .env).\n");
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the American Express Concierge — a premium, AI concierge embedded inside the logged-in Card Member experience on americanexpress.com. The Card Member you are assisting is ${MEMBER_NAME}.

Your job is to understand natural-language requests and act on them using your tools:
- list_capabilities — when the member asks what you can do / "what all can you help with" (don't list in text; call this).
- navigate_to — open a section, or give a LINK to third_party_permissions.
- download_statement — a statement for a month/year.
- find_offers / offers_by_spend — generic offers, or offers tailored to the member's spending.
- savings_recommendations — concrete dollar savings: what they'd save by activating relevant offers, plus extra rewards from an upgraded card, computed from real spend.
- query_transactions — spending questions (returns a per-month breakdown for charts).
- spending_report — category spend report for a date range (ASK for the start and end month first if not given).
- get_fico_score, get_routing_number, get_rates — credit score; routing/account numbers; savings/loan/card rates.
- pay_bill — pay the card bill (defaults to full balance).
- check_card_upgrade — eligibility for an upgraded card and the option to apply.
- set_spend_alert — alert when spend exceeds a limit (ASK for the limit if not given).
- freeze_card — freeze/unfreeze the card.
- refer_friend — COLLECT the friend's full name and email first, then call.
- update_income; request_credit_increase (ASK for the desired new limit; the decision is shown immediately on screen); update_contact (mobile/email — the member verifies a one-time code on screen before it updates); change_password — profile/account updates.
- connect_live_agent — hand off to a human.

Rules of engagement:
- Be warm, concise, white-glove. No emoji.
- ALWAYS use a tool for anything about the member's account, money, statements, offers, spending, score, rates, routing numbers, permissions, profile changes, or human handoff. NEVER invent values — report exactly what the tool returns.
- Many tools return an on-screen card that handles its own confirmation (pay bill, set alert, freeze, apply, refer, update income/contact, password, credit increase). When you call those, the member will confirm on screen — so keep your own text very brief; the card carries the detail.
- Gather any required inputs first by asking a short question (e.g. the spend-alert limit, the report's date range, the friend's name + email, a new mobile/email, requested credit limit, income amount).
- Resolve relative dates yourself; today is June 7, 2026.
- A laptop/computer/TV/phone maps to the 'Electronics' offer category.
- If a tool returns no data, say so plainly. Stay within concierge scope; no regulated financial, tax, or investment advice.`;

// ---- The agent loop -------------------------------------------------------
// Accepts the running conversation, lets Claude call tools until it produces a
// final text answer, and collects any UI actions to send back to the client.
async function runAgent(messages) {
  const uiActions = [];
  let guard = 0;

  while (guard++ < 6) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: toolSchemas,
      messages,
    });

    // Record the assistant turn verbatim (required for the tool-use protocol).
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text, uiActions, messages };
    }

    // Execute every tool_use block and return the results in one user turn.
    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const { result, ui } = runTool(block.name, block.input);
      if (ui) uiActions.push(ui);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { text: "Sorry — I wasn't able to complete that. Please try rephrasing.", uiActions, messages };
}

// ---- Routes ---------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  try {
    const incoming = Array.isArray(req.body.messages) ? req.body.messages : [];
    // Normalize: the client sends {role, content(string)} for plain turns.
    const messages = incoming.map((m) =>
      typeof m.content === "string" ? { role: m.role, content: m.content } : m
    );
    const { text, uiActions, messages: full } = await runAgent(messages);
    res.json({ reply: text, uiActions, messages: full });
  } catch (err) {
    console.error("chat error:", err);
    const hint = !process.env.ANTHROPIC_API_KEY
      ? "ANTHROPIC_API_KEY is missing — add it in Secrets."
      : err?.error?.error?.message || err.message || "Unknown error.";
    res.status(500).json({ error: hint });
  }
});

// Generates a simple downloadable statement file on the fly (demo artifact).
app.get("/api/statement/:id", (req, res) => {
  const stmt = load("statements.json").find((s) => s.id === req.params.id);
  if (!stmt) return res.status(404).send("Statement not found");
  const lines = [
    "AMERICAN EXPRESS  —  MONTHLY STATEMENT  (DEMO / POC)",
    "============================================================",
    `Card Member:      ${MEMBER_NAME}`,
    `Statement Period: ${stmt.month} ${stmt.year}`,
    `Closing Balance:  $${stmt.closingBalance.toFixed(2)}`,
    `Minimum Due:      $${stmt.minimumDue.toFixed(2)}`,
    `Payment Due Date: ${stmt.dueDate}`,
    "============================================================",
    "This is a simulated statement generated by the Concierge POC.",
  ];
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", `attachment; filename="amex_${stmt.period}_statement.txt"`);
  res.send(lines.join("\n"));
});

// Generates a downloadable spend-pattern report (CSV) for a date range.
app.get("/api/spending-report", (req, res) => {
  const { start, end } = req.query;
  const txns = load("transactions.json").filter((t) => t.date.slice(0, 7) >= start && t.date.slice(0, 7) <= end);
  const byCat = {};
  txns.forEach((t) => { if (!byCat[t.category]) byCat[t.category] = { total: 0, count: 0 }; byCat[t.category].total += t.amount; byCat[t.category].count++; });
  const rows = Object.entries(byCat).map(([c, v]) => [c, v.count, v.total.toFixed(2)]).sort((a, b) => b[2] - a[2]);
  const total = rows.reduce((s, r) => s + Number(r[2]), 0).toFixed(2);
  const csv = [
    `American Express Spend Report (DEMO),${start} to ${end}`,
    `Card Member,${MEMBER_NAME}`,
    "",
    "Category,Transactions,Total ($)",
    ...rows.map((r) => r.join(",")),
    `TOTAL,${txns.length},${total}`,
  ].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="amex_spend_${start}_${end}.csv"`);
  res.send(csv);
});

app.get("/api/permissions", (_req, res) => res.json(load("permissions.json")));

app.get("/api/config", (_req, res) =>
  res.json({ memberName: MEMBER_NAME, firstName: MEMBER_NAME.split(" ")[0] }));

app.get("/api/health", (_req, res) => res.json({ ok: true, model: MODEL }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✓ Amex Concierge POC running on http://0.0.0.0:${PORT}`);
  console.log(`  Model: ${MODEL}\n`);
});
