// lib/tools.js
// The Concierge agent's tools. Each tool has (1) a schema sent to Claude and
// (2) an executor that runs against the mock data and returns BOTH a `result`
// string (for the model) and an optional `ui` action (for the frontend).

const fs = require("fs");
const path = require("path");
const DATA = path.join(__dirname, "..", "data");
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

const TODAY = new Date("2026-06-07T00:00:00Z");
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

// confirm-action card helper (state change is simulated client-side after the member confirms)
const confirmCard = (title, lines, confirmLabel, successText, opts = {}) => ({
  type: "confirm_action", title, lines, confirmLabel, successText, danger: !!opts.danger, effect: opts.effect || null,
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const toolSchemas = [
  { name: "list_capabilities",
    description: "Use when the member asks what you can do, how you can help, or 'what all can you help with'. Returns tappable suggestion buttons. Do NOT list capabilities in plain text — call this tool.",
    input_schema: { type: "object", properties: {}, required: [] } },

  { name: "navigate_to",
    description: "Open a section of the logged-in experience (statements, offers, rewards, disputes, payments, account), or give the member a LINK to the Manage Third Party Permissions page ('third_party_permissions').",
    input_schema: { type: "object", properties: {
      section: { type: "string", enum: ["statements","offers","rewards","disputes","payments","account","third_party_permissions"] } }, required: ["section"] } },

  { name: "download_statement",
    description: "Retrieve a billing statement for a month/year and prepare it for download.",
    input_schema: { type: "object", properties: {
      month: { type: "string", description: "Full month name; resolve relative terms yourself." },
      year: { type: "integer" } }, required: ["month","year"] } },

  { name: "find_offers",
    description: "Search available Amex Offers by category or keyword (a laptop is 'Electronics').",
    input_schema: { type: "object", properties: {
      category: { type: "string" }, keyword: { type: "string" } }, required: [] } },

  { name: "offers_by_spend",
    description: "Recommend Amex Offers tailored to the member's actual spending pattern (their top spend categories). Use for 'show offers based on my spend' or 'personalized offers'.",
    input_schema: { type: "object", properties: {}, required: [] } },

  { name: "savings_recommendations",
    description: "Analyze the member's spending and recommend concrete ways to SAVE MONEY: dollars saved by activating relevant Amex Offers, and extra rewards they'd earn with an upgraded card. Use for 'how can I save', 'recommendations based on my spend', 'savings opportunities', 'what would I save with a better card', 'how much could I save'.",
    input_schema: { type: "object", properties: {}, required: [] } },

  { name: "query_transactions",
    description: "Answer spending questions from transaction history (e.g. 'how many Uber trips this year'). Returns count, total, the matching transactions, and a per-month breakdown for charting. NEVER estimate — always call this.",
    input_schema: { type: "object", properties: {
      merchant: { type: "string" }, category: { type: "string" },
      timeframe: { type: "string", description: "'this_year','last_year','this_month','last_month', or 'YYYY-MM'. Defaults this_year." } }, required: [] } },

  { name: "spending_report",
    description: "Generate a spend-pattern report across categories for a date range, with a downloadable file. ALWAYS ask the member for a start and end month first if they haven't given a range. Pass months as 'YYYY-MM'.",
    input_schema: { type: "object", properties: {
      start: { type: "string", description: "Start month 'YYYY-MM'." },
      end: { type: "string", description: "End month 'YYYY-MM'." } }, required: ["start","end"] } },

  { name: "get_fico_score",
    description: "Show the member's FICO Score.",
    input_schema: { type: "object", properties: {}, required: [] } },

  { name: "get_routing_number",
    description: "Show routing + masked account number for a deposit account (checking or savings). They have different routing numbers.",
    input_schema: { type: "object", properties: {
      account_type: { type: "string", enum: ["checking","savings"] } }, required: [] } },

  { name: "get_rates",
    description: "Show current rates: savings APY, personal loan APR, and card APR. Use for 'APR on savings', 'personal loan rate', etc.",
    input_schema: { type: "object", properties: {}, required: [] } },

  { name: "pay_bill",
    description: "Pay the member's card bill. Confirmation happens on screen. If no amount is given, default to the full current balance.",
    input_schema: { type: "object", properties: {
      amount: { type: "number", description: "Amount to pay; omit for full balance." } }, required: [] } },

  { name: "check_card_upgrade",
    description: "Check whether the member is eligible for an upgraded card and, if so, present the offer with an option to apply. Use for 'am I eligible for a better card', 'card upgrade', 'apply for a new card'.",
    input_schema: { type: "object", properties: {}, required: [] } },

  { name: "set_spend_alert",
    description: "Set an alert that notifies the member when card spend exceeds a limit. Ask for the limit amount if not provided.",
    input_schema: { type: "object", properties: {
      limit: { type: "number", description: "Spend threshold in dollars." } }, required: ["limit"] } },

  { name: "freeze_card",
    description: "Freeze or unfreeze the member's card. Use for 'freeze my card', 'lock card', 'unfreeze'.",
    input_schema: { type: "object", properties: {
      action: { type: "string", enum: ["freeze","unfreeze"] } }, required: ["action"] } },

  { name: "refer_friend",
    description: "Refer a friend to American Express. You MUST collect the friend's full name and email first (ask the member if missing), then call this.",
    input_schema: { type: "object", properties: {
      name: { type: "string" }, email: { type: "string" } }, required: ["name","email"] } },

  { name: "update_income",
    description: "Update the member's stated annual income. Ask for the amount if not provided.",
    input_schema: { type: "object", properties: {
      amount: { type: "number" } }, required: ["amount"] } },

  { name: "request_credit_increase",
    description: "Request a credit limit increase. ASK the member for the desired new limit first if they haven't given one. A decision is returned immediately once they confirm.",
    input_schema: { type: "object", properties: {
      amount: { type: "number", description: "Requested new credit limit in dollars." } }, required: ["amount"] } },

  { name: "update_contact",
    description: "Update the member's mobile number or email address. Ask for the new value if not provided.",
    input_schema: { type: "object", properties: {
      field: { type: "string", enum: ["mobile","email"] }, value: { type: "string" } }, required: ["field","value"] } },

  { name: "change_password",
    description: "Start a password change by sending a secure reset link. Never collect the actual password.",
    input_schema: { type: "object", properties: {}, required: [] } },

  { name: "connect_live_agent",
    description: "Hand off to a human Customer Care Professional when the member asks for a person, or for anything outside your scope.",
    input_schema: { type: "object", properties: { topic: { type: "string" } }, required: [] } },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resolveTimeframe(tf) {
  const y = TODAY.getUTCFullYear(), m = TODAY.getUTCMonth();
  if (!tf || tf === "this_year") return [(d) => d.startsWith(`${y}-`), `this year (${y})`];
  if (tf === "last_year") return [(d) => d.startsWith(`${y-1}-`), `last year (${y-1})`];
  if (tf === "this_month") { const p = `${y}-${String(m+1).padStart(2,"0")}`; return [(d) => d.startsWith(p), `this month (${p})`]; }
  if (tf === "last_month") { const lm = m===0?12:m, ly = m===0?y-1:y; const p = `${ly}-${String(lm).padStart(2,"0")}`; return [(d) => d.startsWith(p), `last month (${p})`]; }
  if (/^\d{4}-\d{2}$/.test(tf)) return [(d) => d.startsWith(tf), tf];
  return [() => true, "all time"];
}
const monthLabel = (ym) => { const [y,m] = ym.split("-"); return MONTHS[+m-1].slice(0,3) + " " + y.slice(2); };

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------
const executors = {
  list_capabilities() {
    const prompts = [
      ["My Uber trips this year", "How many Uber trips have I taken this year?"],
      ["Download a statement", "Download my March 2026 statement"],
      ["Laptop offers", "I want to buy a laptop \u2014 any offers?"],
      ["Offers for my spending", "Show me offers based on my spend pattern"],
      ["Ways to save", "What savings do you recommend based on my spend?"],
      ["Spending report", "Show me a spending report across categories"],
      ["My FICO score", "What's my FICO score?"],
      ["Routing numbers", "What's the routing number for my checking account?"],
      ["Savings / loan rates", "What's the APR on savings and personal loan?"],
      ["Pay my bill", "I'd like to pay my bill"],
      ["Card upgrade", "Am I eligible for an upgraded card?"],
      ["Set a spend alert", "Alert me if my card spend exceeds a limit"],
      ["Freeze my card", "Freeze my card"],
      ["Credit limit increase", "Request a credit limit increase"],
      ["Refer a friend", "I'd like to refer a friend"],
      ["Update income", "Update my income"],
      ["Update mobile / email", "I need to update my mobile number"],
      ["Change password", "Change my password"],
      ["Manage permissions", "Take me to manage third party permissions"],
      ["Talk to a person", "I'd like to speak to a live agent"],
    ];
    return { result: "Presented the member with a menu of things I can help with.", ui: { type: "suggestions", intro: "Here are some things I can help you with:", prompts } };
  },

  navigate_to({ section }) {
    if (section === "third_party_permissions") {
      return {
        result: "Gave the member a link to Manage Third Party Permissions (Account Services \u2192 Card Management).",
        ui: { type: "link", url: "/permissions.html", label: "Open Manage Third Party Permissions",
          sub: "Account Services \u2192 Card Management \u2192 Manage Third Party Permissions" },
      };
    }
    const labels = { statements:"Statements & Activity", offers:"Amex Offers", rewards:"Membership Rewards", disputes:"Dispute a Charge", payments:"Make a Payment", account:"Account Overview" };
    return { result: `Opened "${labels[section]||section}".`, ui: { type: "navigate", section, label: labels[section]||section } };
  },

  download_statement({ month, year }) {
    const statements = load("statements.json");
    const mi = MONTHS.indexOf(String(month).toLowerCase());
    const stmt = statements.find((s) => s.year === Number(year) && MONTHS.indexOf(s.month.toLowerCase()) === mi);
    if (!stmt) return { result: `No statement for ${month} ${year}. Available: ${statements.map(s=>s.month+" "+s.year).join(", ")}.` };
    return { result: `Statement for ${stmt.month} ${stmt.year} ready (closing ${money(stmt.closingBalance)}).`,
      ui: { type: "statement", id: stmt.id, label: `${stmt.month} ${stmt.year} Statement`, closingBalance: stmt.closingBalance, dueDate: stmt.dueDate, downloadUrl: `/api/statement/${stmt.id}` } };
  },

  find_offers({ category, keyword }) {
    let offers = load("offers.json");
    if (category) offers = offers.filter((o) => o.category.toLowerCase() === String(category).toLowerCase());
    if (keyword) { const k = String(keyword).toLowerCase(); offers = offers.filter((o) => (o.merchant+" "+o.offer+" "+o.detail+" "+o.category).toLowerCase().includes(k)); }
    if (!offers.length) return { result: `No matching offers${category?` in ${category}`:""}.` };
    return { result: `Found ${offers.length} offer(s): ${offers.map(o=>o.merchant+" "+o.offer).join("; ")}.`, ui: { type: "offers", offers } };
  },

  offers_by_spend() {
    const txns = load("transactions.json").filter((t) => t.date.startsWith("2026-"));
    const byCat = {};
    txns.forEach((t) => { byCat[t.category] = (byCat[t.category]||0) + t.amount; });
    const ranked = Object.entries(byCat).sort((a,b) => b[1]-a[1]).map(([c]) => c);
    const offers = load("offers.json");
    // map spend categories to offer categories present
    const offerCats = [...new Set(offers.map(o=>o.category))];
    const top = ranked.filter((c) => offerCats.includes(c)).slice(0, 3);
    let matched = offers.filter((o) => top.includes(o.category));
    if (!matched.length) matched = offers.slice(0, 4);
    return {
      result: `Based on top spend (${top.join(", ")}), recommending ${matched.length} offers.`,
      ui: { type: "offers", intro: `Because you spend most on ${top.join(", ")}:`, offers: matched },
    };
  },

  savings_recommendations() {
    const p = load("profile.json");
    const txns = load("transactions.json").filter((t) => t.date.startsWith("2026-"));
    const offers = load("offers.json");
    const byMerchant = {}, byCat = {};
    txns.forEach((t) => { byMerchant[t.merchant] = (byMerchant[t.merchant]||0) + t.amount; byCat[t.category] = (byCat[t.category]||0) + t.amount; });

    // 1) Offer-activation savings (based on actual spend)
    const offerRecs = [];
    offers.forEach((o) => {
      if (o.valueUSD == null) return;
      const mSpend = byMerchant[o.merchant] || 0;
      const cSpend = byCat[o.category] || 0;
      const relevant = mSpend > 0 ? mSpend : cSpend;
      if (relevant <= 0) return;
      const minSpend = o.minSpend || 0;
      let saving = minSpend > 0 ? Math.min(o.valueUSD, o.valueUSD * (relevant / minSpend)) : o.valueUSD;
      saving = Math.round(saving);
      if (saving <= 0) return;
      offerRecs.push({ kind: "offer", title: `Activate the ${o.merchant} offer`,
        detail: `You've spent ${money(relevant)} on ${mSpend>0 ? o.merchant : o.category} \u2014 ${o.offer}`,
        amount: saving, offer: { id: o.id, merchant: o.merchant, offer: o.offer, detail: o.detail, expires: o.expires } });
    });
    offerRecs.sort((a, b) => b.amount - a.amount);
    const topOffers = offerRecs.slice(0, 4);

    // 2) Upgraded-card rewards (extra Membership Rewards vs current ~1x; ~$0.01/point)
    const dining = byCat["Dining"]||0, groceries = byCat["Groceries"]||0, travel = byCat["Travel"]||0;
    const PT = 0.01;
    const upgradeSaving = Math.round((dining + groceries) * 3 * PT + travel * 4 * PT);
    const recs = [...topOffers];
    if (upgradeSaving > 0) recs.push({ kind: "upgrade",
      title: `Earn more with ${p.upgrade.offeredCard.replace(" from American Express", "")}`,
      detail: `On ${money(dining + groceries)} dining & groceries (4x) and ${money(travel)} travel (5x), an upgraded rewards card would earn about this much more per year.`,
      amount: upgradeSaving });

    const total = recs.reduce((s, r) => s + r.amount, 0);
    if (!recs.length) return { result: "No notable savings opportunities found from current spend." };
    return {
      result: `~${money0(total)}/yr in savings opportunities: ` + recs.map((r) => `${r.title} (~${money0(r.amount)})`).join("; ") + ".",
      ui: { type: "savings_recs", total, recs },
    };
  },

  query_transactions({ merchant, category, timeframe }) {
    const txns = load("transactions.json");
    const [inWindow, label] = resolveTimeframe(timeframe);
    let rows = txns.filter((t) => inWindow(t.date));
    if (merchant) { const m = String(merchant).toLowerCase(); rows = rows.filter((t) => t.merchant.toLowerCase().includes(m)); }
    if (category) { const c = String(category).toLowerCase(); rows = rows.filter((t) => t.category.toLowerCase() === c); }
    const count = rows.length;
    const total = Math.round(rows.reduce((s,t)=>s+t.amount,0)*100)/100;
    const subject = merchant || category || "transactions";
    const items = rows.map((t) => ({ date: t.date, merchant: t.merchant, amount: t.amount }));
    // per-month aggregation for the bar graph
    const mm = {};
    rows.forEach((t) => { const k = t.date.slice(0,7); if (!mm[k]) mm[k] = { count:0, total:0 }; mm[k].count++; mm[k].total += t.amount; });
    const byMonth = Object.keys(mm).sort().map((k) => ({ month: k, label: monthLabel(k), count: mm[k].count, total: Math.round(mm[k].total*100)/100 }));
    return {
      result: count===0 ? `No ${subject} transactions for ${label}.` : `For ${label}: ${count} ${subject} transaction(s) totaling ${money(total)}.`,
      ui: { type: "insight", subject, timeframe: label, count, total, items, byMonth },
    };
  },

  spending_report({ start, end }) {
    const txns = load("transactions.json").filter((t) => t.date.slice(0,7) >= start && t.date.slice(0,7) <= end);
    const byCat = {};
    txns.forEach((t) => { if (!byCat[t.category]) byCat[t.category] = { total:0, count:0 }; byCat[t.category].total += t.amount; byCat[t.category].count++; });
    const categories = Object.entries(byCat).map(([category,v]) => ({ category, total: Math.round(v.total*100)/100, count: v.count })).sort((a,b)=>b.total-a.total);
    const total = Math.round(categories.reduce((s,c)=>s+c.total,0)*100)/100;
    return {
      result: `Spend ${start} to ${end}: ${money(total)} across ${categories.length} categories. Top: ${categories.slice(0,3).map(c=>c.category).join(", ")}.`,
      ui: { type: "spend_report", start, end, total, categories, count: txns.length, downloadUrl: `/api/spending-report?start=${start}&end=${end}` },
    };
  },

  get_fico_score() {
    const f = load("profile.json").fico;
    return { result: `FICO ${f.score} (${f.band}), ${f.change>=0?"+":""}${f.change} since last month.`, ui: { type: "fico", ...f } };
  },

  get_routing_number({ account_type }) {
    const type = (account_type||"checking").toLowerCase();
    const acct = load("profile.json").deposit[type];
    if (!acct) return { result: `No ${type} account found.` };
    return { result: `${acct.name}: routing ${acct.routing}, account ending ${acct.accountLast4}.`, ui: { type: "banking", accountType: type, ...acct } };
  },

  get_rates() {
    const r = load("profile.json").rates;
    return { result: `Savings ${r.savingsAPY}; personal loan ${r.personalLoanAPR}; card ${r.cardAPR}.`,
      ui: { type: "rates", rates: [
        { label: "High Yield Savings", value: r.savingsAPY, note: "Annual percentage yield" },
        { label: "Personal Loan", value: r.personalLoanAPR, note: "Based on creditworthiness" },
        { label: "Card Purchase APR", value: r.cardAPR, note: "Varies with the market" },
      ] } };
  },

  pay_bill({ amount }) {
    const a = load("profile.json").account;
    const amt = amount != null ? Number(amount) : a.currentBalance;
    return { result: `Prepared a payment of ${money(amt)} for confirmation.`,
      ui: confirmCard("Confirm payment",
        [`Pay ${money(amt)} to American Express`, `From: Rewards Checking \u2022\u20224417`, `Due ${a.dueDate} \u00b7 posts immediately`],
        "Confirm payment", `Payment of ${money(amt)} scheduled. Confirmation #AX${Math.floor(100000+Math.random()*900000)}.`) };
  },

  check_card_upgrade() {
    const p = load("profile.json"), u = p.upgrade, a = p.account;
    if (!u.eligible) return { result: "Not currently pre-qualified for an upgrade.", ui: { type: "card_upgrade", eligible: false } };
    const prefill = { name: a.name, email: a.email, mobile: a.mobile, income: money0(a.income) };
    return { result: `Eligible to upgrade to ${u.offeredCard}; the application will be pre-filled from the member's profile.`,
      ui: { type: "card_upgrade", eligible: true, ...u, prefill } };
  },

  set_spend_alert({ limit }) {
    const L = Number(limit);
    return { result: `Prepared a spend alert at ${money(L)} for confirmation.`,
      ui: confirmCard("Set spend alert",
        [`Notify me when card spend exceeds ${money(L)}`, "Channel: push + email", "Applies to the current statement period"],
        "Set alert", `Spend alert set. You'll be notified if spend passes ${money(L)}.`) };
  },

  freeze_card({ action }) {
    const freeze = action === "freeze";
    return { result: `Prepared to ${action} the card for confirmation.`,
      ui: confirmCard(freeze ? "Freeze card" : "Unfreeze card",
        freeze ? ["Temporarily block new charges on your card", "Recurring payments may still post", "Unfreeze anytime"] : ["Re-enable charges on your card"],
        freeze ? "Freeze card" : "Unfreeze card",
        freeze ? "Your card is now frozen. New charges are blocked." : "Your card is active again.",
        { danger: freeze, effect: freeze ? "freeze" : "unfreeze" }) };
  },

  refer_friend({ name, email }) {
    return { result: `Prepared a referral for ${name} (${email}) for confirmation.`,
      ui: confirmCard("Refer a friend",
        [`Refer ${name}`, `Email: ${email}`, "They'll get a personalized invitation"],
        "Send referral", `Referral sent to ${email}. You'll earn bonus points when ${name} is approved.`) };
  },

  update_income({ amount }) {
    const A = Number(amount);
    return { result: `Prepared income update to ${money0(A)} for confirmation.`,
      ui: confirmCard("Update annual income", [`New total annual income: ${money0(A)}`, "Used for credit decisions"], "Update income", `Annual income updated to ${money0(A)}.`) };
  },

  request_credit_increase({ amount }) {
    const a = load("profile.json").account;
    const requested = Number(amount);
    const cap = Math.max(30000, a.creditLimit * 2);
    const approved = requested <= cap ? requested : cap;
    const decision = approved >= requested
      ? `Approved! Your new credit limit is ${money0(approved)}, effective immediately.`
      : `Approved for ${money0(approved)} (a portion of your ${money0(requested)} request), effective immediately.`;
    return { result: `Prepared a credit limit increase request to ${money0(requested)}.`,
      ui: confirmCard("Request credit limit increase",
        [`Current limit: ${money0(a.creditLimit)}`, `Requested limit: ${money0(requested)}`, "Soft pull \u2014 won't affect your score"],
        "Submit request", decision) };
  },

  update_contact({ field, value }) {
    const label = field === "mobile" ? "mobile number" : "email address";
    const a = load("profile.json").account;
    const sentTo = field === "mobile" ? a.mobile : a.email;
    return { result: `Sent a verification code to ${sentTo}; awaiting the code before updating the ${label} to ${value}.`,
      ui: { type: "verify_update", field, label, newValue: String(value), sentTo, demoCode: "123456" } };
  },

  change_password() {
    return { result: "Prepared a password reset for confirmation.",
      ui: confirmCard("Change password", ["We'll email you a secure reset link", "The link expires in 30 minutes"], "Send reset link", "A password reset link has been sent to your email.") };
  },

  connect_live_agent({ topic }) {
    const q = load("profile.json").liveAgent;
    return { result: `Connecting to ${q.agentName}${topic?` about ${topic}`:""}.`, ui: { type: "live_agent", topic: topic||"General assistance", ...q } };
  },
};

function runTool(name, input) {
  const fn = executors[name];
  if (!fn) return { result: `Unknown tool: ${name}` };
  try { return fn(input || {}); } catch (err) { return { result: `Tool ${name} failed: ${err.message}` }; }
}

module.exports = { toolSchemas, runTool, load };
