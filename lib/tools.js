// lib/tools.js
// The Concierge agent's tools. Each tool has (1) a schema sent to Claude and
// (2) an executor that runs against the mock data and returns BOTH a `result`
// string (for the model to read) and an optional `ui` action (for the frontend).

const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

// "Today" for the demo. Keep in sync with the seeded data (current year = 2026).
const TODAY = new Date("2026-06-07T00:00:00Z");

const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

// ---------------------------------------------------------------------------
// Tool schemas (advertised to Claude)
// ---------------------------------------------------------------------------
const toolSchemas = [
  {
    name: "navigate_to",
    description:
      "Open a section of the logged-in American Express account experience for the member. Use when the member wants to GO somewhere or perform an action that lives on a specific page (e.g. 'take me to dispute a charge', 'show my rewards', 'I need to make a payment', 'manage third party permissions'). For 'third_party_permissions' the UI will walk the member through the real click-path (Card → Account Services → Card Management → Manage Third Party Permissions).",
    input_schema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["statements", "offers", "rewards", "disputes", "payments", "account", "third_party_permissions"],
          description: "Which section to open.",
        },
      },
      required: ["section"],
    },
  },
  {
    name: "download_statement",
    description:
      "Retrieve a billing statement for a specific month and year and prepare it for the member to download. Use for requests like 'download my March 2025 statement' or 'get me last month's statement'.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Full month name, e.g. 'March'. Resolve relative terms like 'last month' to an actual month yourself before calling." },
        year: { type: "integer", description: "Four-digit year, e.g. 2026." },
      },
      required: ["month", "year"],
    },
  },
  {
    name: "find_offers",
    description:
      "Search the member's available Amex Offers. Use when the member is shopping or asks about deals/savings, e.g. 'I want to buy a laptop, any offers?' (category 'Electronics'), or 'any travel offers?'. Map the member's intent to the closest category, or pass a free-text keyword.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "One of: Electronics, Travel, Dining, Groceries, Shopping. For a laptop/computer/TV/phone, use 'Electronics'.",
        },
        keyword: { type: "string", description: "Optional free-text term to match against merchant or offer text (e.g. 'laptop', 'hotel')." },
      },
      required: [],
    },
  },
  {
    name: "query_transactions",
    description:
      "Answer questions about the member's own spending by querying their transaction history. Use for 'how many Uber trips this year', 'how much did I spend on dining last month', 'what did I spend at Amazon'. Returns a computed count and total plus the matching transactions. NEVER estimate spending yourself — always call this tool and report its numbers.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Merchant name or partial name, e.g. 'Uber'. Case-insensitive, matches substrings." },
        category: { type: "string", description: "Category filter, e.g. 'Dining', 'Travel', 'Electronics', 'Rideshare'." },
        timeframe: {
          type: "string",
          description: "Relative window: 'this_year', 'last_year', 'this_month', 'last_month', or a specific month as 'YYYY-MM' (e.g. '2026-03'). Defaults to this_year if omitted.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_fico_score",
    description:
      "Retrieve the member's FICO Score (free for eligible Card Members via American Express MyCredit Guide / Experian data). Use for 'what's my credit score', 'show my FICO score', etc.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_routing_number",
    description:
      "Retrieve the routing number (and masked account number) for the member's American Express deposit account. Use for 'what's my routing number', 'routing number for my checking account', 'account and routing number', etc.",
    input_schema: {
      type: "object",
      properties: {
        account_type: { type: "string", enum: ["checking", "savings"], description: "Which deposit account. Defaults to checking." },
      },
      required: [],
    },
  },
  {
    name: "connect_live_agent",
    description:
      "Hand the conversation off to a live American Express Customer Care Professional. Use when the member asks to talk to a person/human/representative/agent, or when a request is outside the Concierge's scope and needs a human.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Short summary of what the member needs help with, to pass to the agent." },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resolveTimeframe(tf) {
  const y = TODAY.getUTCFullYear();
  const m = TODAY.getUTCMonth(); // 0-indexed
  if (!tf || tf === "this_year") return [(d) => d.startsWith(`${y}-`), `this year (${y})`];
  if (tf === "last_year") return [(d) => d.startsWith(`${y - 1}-`), `last year (${y - 1})`];
  if (tf === "this_month") { const p = `${y}-${String(m + 1).padStart(2, "0")}`; return [(d) => d.startsWith(p), `this month (${p})`]; }
  if (tf === "last_month") {
    const lm = m === 0 ? 12 : m; const ly = m === 0 ? y - 1 : y;
    const p = `${ly}-${String(lm).padStart(2, "0")}`; return [(d) => d.startsWith(p), `last month (${p})`];
  }
  if (/^\d{4}-\d{2}$/.test(tf)) return [(d) => d.startsWith(tf), tf];
  return [() => true, "all time"];
}

const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------
const executors = {
  navigate_to({ section }) {
    if (section === "third_party_permissions") {
      const steps = [
        "Selecting your Card account",
        "Opening the Account Services tab",
        "Choosing Card Management",
        "Opening Manage Third Party Permissions",
      ];
      const connections = load("permissions.json");
      const active = connections.filter((c) => c.status === "Connected").length;
      return {
        result:
          `Walked the member to Manage Third Party Permissions via Account Services \u2192 Card Management. ` +
          `They have ${active} connected third-party app(s): ` +
          connections.map((c) => `${c.app} (${c.status})`).join(", ") + ".",
        ui: { type: "nav_steps", destination: "Manage Third Party Permissions", steps, connections },
      };
    }
    const labels = {
      statements: "Statements & Activity", offers: "Amex Offers", rewards: "Membership Rewards",
      disputes: "Dispute a Charge", payments: "Make a Payment", account: "Account Overview",
    };
    const label = labels[section] || section;
    return { result: `Opened the "${label}" section for the member.`, ui: { type: "navigate", section, label } };
  },

  download_statement({ month, year }) {
    const statements = load("statements.json");
    const mi = MONTHS.indexOf(String(month).toLowerCase());
    const stmt = statements.find((s) => s.year === Number(year) && MONTHS.indexOf(s.month.toLowerCase()) === mi);
    if (!stmt) {
      const available = statements.map((s) => `${s.month} ${s.year}`).join(", ");
      return { result: `No statement found for ${month} ${year}. Available statements: ${available}.` };
    }
    return {
      result: `Statement for ${stmt.month} ${stmt.year} is ready. Closing balance ${money(stmt.closingBalance)}, minimum due ${money(stmt.minimumDue)} by ${stmt.dueDate}. A download link has been prepared for the member.`,
      ui: { type: "statement", id: stmt.id, label: `${stmt.month} ${stmt.year} Statement`, closingBalance: stmt.closingBalance, dueDate: stmt.dueDate, downloadUrl: `/api/statement/${stmt.id}` },
    };
  },

  find_offers({ category, keyword }) {
    let offers = load("offers.json");
    if (category) offers = offers.filter((o) => o.category.toLowerCase() === String(category).toLowerCase());
    if (keyword) {
      const k = String(keyword).toLowerCase();
      offers = offers.filter((o) => (o.merchant + " " + o.offer + " " + o.detail + " " + o.category).toLowerCase().includes(k));
    }
    if (!offers.length) return { result: `No matching offers found${category ? ` in ${category}` : ""}. Suggest the member browse all Amex Offers.` };
    const summary = offers.map((o) => `${o.merchant}: ${o.offer} (expires ${o.expires})`).join("; ");
    return { result: `Found ${offers.length} relevant offer(s): ${summary}.`, ui: { type: "offers", offers } };
  },

  query_transactions({ merchant, category, timeframe }) {
    const txns = load("transactions.json");
    const [inWindow, label] = resolveTimeframe(timeframe);
    let rows = txns.filter((t) => inWindow(t.date));
    if (merchant) { const m = String(merchant).toLowerCase(); rows = rows.filter((t) => t.merchant.toLowerCase().includes(m)); }
    if (category) { const c = String(category).toLowerCase(); rows = rows.filter((t) => t.category.toLowerCase() === c); }

    const count = rows.length;
    const total = Math.round(rows.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const subject = merchant || category || "transactions";
    // Send ALL matching rows to the UI so the displayed list matches the count exactly.
    const items = rows.map((t) => ({ date: t.date, merchant: t.merchant, amount: t.amount }));
    const preview = items.slice(0, 3).map((s) => `${s.date} ${s.merchant} ${money(s.amount)}`).join(", ");

    return {
      result:
        count === 0
          ? `No ${subject} transactions found for ${label}.`
          : `For ${label}: ${count} ${subject} transaction(s) totaling ${money(total)}. e.g. ${preview}.`,
      ui: { type: "insight", subject, timeframe: label, count, total, items },
    };
  },

  get_fico_score() {
    const f = load("profile.json").fico;
    return {
      result: `The member's FICO Score is ${f.score} (${f.band}), from ${f.provider}, updated ${f.updated}. Change since last month: ${f.change >= 0 ? "+" : ""}${f.change} points.`,
      ui: { type: "fico", ...f },
    };
  },

  get_routing_number({ account_type }) {
    const type = (account_type || "checking").toLowerCase();
    const acct = load("profile.json").deposit[type];
    if (!acct) return { result: `No ${type} account found.` };
    return {
      result: `${acct.name} \u2014 routing number ${acct.routing}, account number ending ${acct.accountLast4}.`,
      ui: { type: "banking", accountType: type, ...acct },
    };
  },

  connect_live_agent({ topic }) {
    const q = load("profile.json").liveAgent;
    return {
      result: `Connecting the member to a live Customer Care Professional${topic ? ` about: ${topic}` : ""}. Estimated wait ${q.waitMinutes} min; queue position ${q.queuePosition}. Agent ${q.agentName} will join shortly.`,
      ui: { type: "live_agent", topic: topic || "General assistance", ...q },
    };
  },
};

function runTool(name, input) {
  const fn = executors[name];
  if (!fn) return { result: `Unknown tool: ${name}` };
  try {
    return fn(input || {});
  } catch (err) {
    return { result: `Tool ${name} failed: ${err.message}` };
  }
}

module.exports = { toolSchemas, runTool, load };
