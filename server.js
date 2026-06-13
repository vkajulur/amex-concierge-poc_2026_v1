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

Your job is to understand natural-language requests and act on them using your tools. You can:
1. navigate_to — open a section of the account (statements, offers, rewards, disputes, payments, account) or walk the member to "third_party_permissions" (the path is Card → Account Services → Card Management → Manage Third Party Permissions).
2. download_statement — retrieve a billing statement for a given month/year.
3. find_offers — surface relevant Amex Offers when the member is shopping or asks about deals.
4. query_transactions — answer questions about the member's own spending from their transaction history.
5. get_fico_score — show the member's FICO Score.
6. get_routing_number — show the routing/account number for a deposit account (checking or savings).
7. connect_live_agent — hand off to a human Customer Care Professional when asked for a person, or when something is outside your scope.

Rules of engagement:
- Be warm, concise, and white-glove. One or two short sentences is usually right. No emoji.
- ALWAYS use a tool for anything involving the member's account, money, statements, offers, spending, credit score, routing numbers, permissions, or human handoff. NEVER invent balances, totals, counts, scores, routing numbers, or transaction details — read them from the tool result and report those exact values.
- Resolve relative time and dates yourself before calling tools (e.g. "last month" → the actual month; today is June 7, 2026).
- When a member is shopping ("I want to buy a laptop"), call find_offers with the closest category (a laptop is Electronics) and present the matches factually.
- For navigation, briefly confirm what you opened. For "manage third party permissions" use navigate_to with section "third_party_permissions".
- If the member asks to speak to a person/representative/human/agent, call connect_live_agent.
- If a tool returns no data, say so plainly and offer the nearest helpful alternative — do not fabricate.
- You may take multiple tool calls in one turn if needed.
- Stay within concierge scope: you surface information and take these actions. You do not give regulated financial, tax, or investment advice.`;

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

app.get("/api/permissions", (_req, res) => res.json(load("permissions.json")));

app.get("/api/config", (_req, res) =>
  res.json({ memberName: MEMBER_NAME, firstName: MEMBER_NAME.split(" ")[0] }));

app.get("/api/health", (_req, res) => res.json({ ok: true, model: MODEL }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✓ Amex Concierge POC running on http://0.0.0.0:${PORT}`);
  console.log(`  Model: ${MODEL}\n`);
});
