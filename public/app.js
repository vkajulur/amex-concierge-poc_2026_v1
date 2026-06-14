// app.js — Concierge chat client + dashboard interactions
(() => {
  const fab = document.getElementById("conciergeFab");
  const panel = document.getElementById("conciergePanel");
  const closeBtn = document.getElementById("conciergeClose");
  const body = document.getElementById("chatBody");
  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");

  let history = [];
  let busy = false;
  let MEMBER = "John";

  const INITIAL_PROMPTS = [
    ["What can you help with?", "What all can you help with?"],
    ["My Uber trips this year", "How many Uber trips have I taken this year?"],
    ["Download March statement", "Download my March 2026 statement"],
    ["Laptop offers", "I want to buy a laptop — any offers?"],
    ["My FICO score", "What's my FICO score?"],
    ["Pay my bill", "I'd like to pay my bill"],
  ];

  // ---- greeting (local time) ----
  function timeGreeting() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }

  async function boot() {
    try { const cfg = await (await fetch("/api/config")).json(); MEMBER = cfg.firstName || "John"; } catch (_) {}
    const greet = timeGreeting();
    document.getElementById("heroGreeting").textContent = `${greet}, ${MEMBER}.`;
    document.getElementById("topGreet").textContent = `${greet}, ${MEMBER}`;
    document.getElementById("memberAvatar").textContent = MEMBER[0].toUpperCase();
    const cn = document.getElementById("cardName"); if (cn) cn.textContent = (MEMBER + " A. Member").toUpperCase();
    seedChat(greet);
  }

  function seedChat(greet) {
    body.innerHTML = "";
    addBubble(`${greet}, ${MEMBER} — I'm your Concierge. Ask me anything, or try one of these:`, "bot");
    renderSuggestions(INITIAL_PROMPTS);
  }

  function renderSuggestions(prompts, intro) {
    if (intro) addBubble(intro, "bot");
    const wrap = document.createElement("div");
    wrap.className = "suggestions";
    prompts.forEach(([label, prompt]) => {
      const b = document.createElement("button");
      b.textContent = label; b.dataset.prompt = prompt;
      wrap.appendChild(b);
    });
    body.appendChild(wrap); scroll();
    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-prompt]");
      if (btn) send(btn.dataset.prompt);
    });
  }

  // ---- FICO gauge (chat card only) ----
  function ficoGaugeSVG(score) {
    const cx = 100, cy = 100, r = 78;
    const toXY = (frac) => { const a = Math.PI * (1 - frac); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
    const arc = (f0, f1, color) => { const [x0, y0] = toXY(f0), [x1, y1] = toXY(f1);
      return `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${color}" stroke-width="13" fill="none" stroke-linecap="round"/>`; };
    const f = (s) => (Math.max(300, Math.min(850, s)) - 300) / 550;
    const bands = [[300,580,"#b41601"],[580,670,"#e08600"],[670,740,"#e0c000"],[740,800,"#5aa700"],[800,850,"#00804a"]];
    const segs = bands.map(([a,b,c]) => arc(f(a), f(b), c)).join("");
    const [nx, ny] = toXY(f(score));
    const needle = `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#1d1d1d" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="6" fill="#1d1d1d"/>`;
    return `<svg viewBox="0 0 200 118" width="100%">${segs}${needle}<text x="${cx}" y="86" text-anchor="middle" font-size="30" font-weight="700" fill="#00175a" font-family="Helvetica Neue,Arial,sans-serif">${score}</text></svg>`;
  }

  // ---- open / close ----
  function openPanel() { panel.hidden = false; fab.style.display = "none"; setTimeout(() => input.focus(), 50); }
  function closePanel() { panel.hidden = true; fab.style.display = "grid"; }
  fab.addEventListener("click", openPanel);
  closeBtn.addEventListener("click", closePanel);

  // ---- nav highlight ----
  function flashSection(section) {
    document.querySelectorAll(".topnav a").forEach((a) => a.classList.toggle("active", a.dataset.section === section));
    const tile = document.querySelector(`.tile[data-section="${section}"]`);
    if (tile) { tile.classList.remove("flash"); void tile.offsetWidth; tile.classList.add("flash"); tile.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
  document.querySelectorAll("[data-section]").forEach((el) => {
    if (el.classList.contains("tile") || el.closest(".topnav") || el.classList.contains("btn-primary")) {
      el.addEventListener("click", (e) => { if (el.tagName === "A") e.preventDefault(); flashSection(el.dataset.section); });
    }
  });

  // ---- bubbles / cards ----
  function addBubble(text, who) {
    const wrap = document.createElement("div"); wrap.className = `msg ${who}`;
    const b = document.createElement("div"); b.className = "bubble"; b.textContent = text;
    wrap.appendChild(b); body.appendChild(wrap); scroll(); return b;
  }
  function addTyping() {
    const wrap = document.createElement("div"); wrap.className = "msg bot";
    wrap.innerHTML = `<div class="bubble typing"><span></span><span></span><span></span></div>`;
    body.appendChild(wrap); scroll(); return wrap;
  }
  function addCard(html) {
    const wrap = document.createElement("div"); wrap.className = "msg bot";
    const card = document.createElement("div"); card.className = "bubble result-card"; card.innerHTML = html;
    wrap.appendChild(card); body.appendChild(wrap); scroll(); return card;
  }
  const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const moneyWhole = (n) => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function scroll() { body.scrollTop = body.scrollHeight; }

  // ---- confirm-before-act ----
  function confirmAction(triggerBtn, message, onConfirm, opts) {
    opts = opts || {};
    triggerBtn.style.display = "none";
    const box = document.createElement("span");
    box.className = "confirm-inline";
    box.innerHTML = `<span class="confirm-msg">${message}</span>` +
      `<button class="btn-confirm ${opts.danger ? "danger" : ""}">${esc(opts.confirmLabel || "Confirm")}</button>` +
      `<button class="btn-cancel">Cancel</button>`;
    triggerBtn.insertAdjacentElement("afterend", box);
    scroll();
    box.querySelector(".btn-confirm").addEventListener("click", () => { box.remove(); triggerBtn.style.display = ""; onConfirm(); scroll(); });
    box.querySelector(".btn-cancel").addEventListener("click", () => { box.remove(); triggerBtn.style.display = ""; });
  }

  // ---- charts ----
  function monthBars(byMonth, key) {
    if (!byMonth || byMonth.length < 2) return "";
    const max = Math.max(...byMonth.map((m) => m[key])) || 1;
    const bars = byMonth.map((m) => {
      const h = Math.round((m[key] / max) * 90) + 6;
      return `<div class="bar-col"><div class="bar-val">${m[key]}</div><div class="bar" style="height:${h}px"></div><div class="bar-lbl">${esc(m.label)}</div></div>`;
    }).join("");
    return `<div class="bar-chart">${bars}</div>`;
  }
  function categoryBars(categories, total) {
    const max = Math.max(...categories.map((c) => c.total)) || 1;
    return categories.map((c) => {
      const w = Math.round((c.total / max) * 100);
      return `<div class="catbar-row"><div class="catbar-top"><span>${esc(c.category)}</span><span>${money(c.total)}</span></div>
        <div class="catbar-track"><div class="catbar-fill" style="width:${w}%"></div></div></div>`;
    }).join("");
  }

  // ---- dashboard effects (freeze) ----
  function applyEffect(effect) {
    const card = document.querySelector(".amex-card");
    if (!card) return;
    let badge = card.querySelector(".frozen-badge");
    if (effect === "freeze") { if (!badge) { badge = document.createElement("div"); badge.className = "frozen-badge"; badge.textContent = "❄ FROZEN"; card.appendChild(badge); } }
    else if (effect === "unfreeze" && badge) badge.remove();
  }

  // ---- render tool-driven UI actions ----
  function renderAction(a) {
    if (a.type === "navigate") { flashSection(a.section); return; }

    if (a.type === "suggestions") { renderSuggestions(a.prompts, a.intro); return; }

    if (a.type === "link") {
      addCard(`<div class="rc-title">Navigate</div>
        <a class="link-card" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">
          <span><strong>${esc(a.label)}</strong>${a.sub ? `<div class="link-sub">${esc(a.sub)}</div>` : ""}</span>
          <span class="link-arrow">→</span>
        </a>`);
      return;
    }

    if (a.type === "offers") {
      const rows = a.offers.map((o, i) => `
        <div class="offer">
          <div>
            <div class="offer-merchant">${esc(o.merchant)}</div>
            <div class="offer-detail">${esc(o.detail)} · expires ${esc(o.expires)}</div>
            <button class="offer-add-one" data-i="${i}">+ Add to Card</button>
          </div>
          <div class="offer-value">${esc(o.offer)}</div>
        </div>`).join("");
      const card = addCard(`<div class="rc-title">${esc(a.intro || "Amex Offers for you")}</div>${rows}
        <button class="offer-add">Add all to Card</button>`);
      card.querySelectorAll(".offer-add-one").forEach((btn) => {
        btn.addEventListener("click", () => {
          const o = a.offers[Number(btn.dataset.i)];
          confirmAction(btn, `Add the ${esc(o.merchant)} offer to your Card?`, () => { btn.textContent = "✓ Added"; btn.classList.add("added"); btn.disabled = true; });
        });
      });
      const addAll = card.querySelector(".offer-add");
      addAll.addEventListener("click", () => {
        confirmAction(addAll, `Add all ${a.offers.length} offers to your Card?`, () => {
          card.querySelectorAll(".offer-add-one").forEach((b) => { b.style.display = ""; b.textContent = "✓ Added"; b.classList.add("added"); b.disabled = true; });
          addAll.textContent = "✓ All offers added to Card"; addAll.disabled = true;
        });
      });
      return;
    }

    if (a.type === "insight") {
      const list = (a.items || []).map((s) => `<div><span>${esc(s.date)} · ${esc(s.merchant)}</span><span>${money(s.amount)}</span></div>`).join("");
      addCard(`<div class="rc-title">Spending insight · ${esc(a.timeframe)}</div>
        <div class="insight-figure"><span class="insight-num">${a.count}</span>
          <span class="insight-sub">${esc(a.subject)} transaction${a.count === 1 ? "" : "s"}<br>totaling <strong>${money(a.total)}</strong></span></div>
        ${monthBars(a.byMonth, "count")}
        <div class="insight-list">${list}</div>`);
      return;
    }

    if (a.type === "spend_report") {
      addCard(`<div class="rc-title">Spend report · ${esc(a.start)} → ${esc(a.end)}</div>
        <div class="insight-figure"><span class="insight-num">${money(a.total)}</span>
          <span class="insight-sub">across ${a.categories.length} categories<br>${a.count} transactions</span></div>
        <div class="catbars">${categoryBars(a.categories, a.total)}</div>
        <a class="statement-dl" href="${esc(a.downloadUrl)}" style="display:inline-block;margin-top:10px">Download report (CSV)</a>`);
      return;
    }

    if (a.type === "statement") {
      addCard(`<div class="rc-title">Statement ready</div>
        <div class="statement-chip"><div><div class="offer-merchant">${esc(a.label)}</div>
          <div class="statement-meta">Closing balance ${money(a.closingBalance)} · due ${esc(a.dueDate)}</div></div>
          <a class="statement-dl" href="${esc(a.downloadUrl)}">Download</a></div>`);
      return;
    }

    if (a.type === "fico") {
      addCard(`<div class="rc-title">Your FICO® Score</div>
        <div class="fico-card-row"><div class="fico-gauge">${ficoGaugeSVG(a.score)}</div>
          <div><div class="fico-card-band">${esc(a.band)}</div>
          <div class="fico-card-meta">▲ ${a.change} pts since last month<br>${esc(a.provider)}<br>Updated ${esc(a.updated)}</div></div></div>`);
      return;
    }

    if (a.type === "banking") {
      const img = a.image ? `<img src="${esc(a.image)}" alt="${esc(a.name)}"/>` : "";
      addCard(`<div class="rc-title">${esc(a.name)}</div>
        <div class="bank-card">${img}<div style="flex:1">
          <div class="bank-field"><span>Routing number</span><span class="v">${esc(a.routing)}<button class="copy-btn" data-copy="${esc(a.routing)}">Copy</button></span></div>
          <div class="bank-field"><span>Account number</span><span class="v">•••• ${esc(a.accountLast4)}</span></div>
          <div class="bank-field"><span>Bank</span><span class="v" style="font-weight:400">${esc(a.bank)}</span></div>
        </div></div>`).querySelectorAll(".copy-btn").forEach((b) => b.addEventListener("click", () => { navigator.clipboard?.writeText(b.dataset.copy); b.textContent = "Copied"; }));
      return;
    }

    if (a.type === "rates") {
      const rows = a.rates.map((r) => `<div class="rate-row"><div><div class="rate-label">${esc(r.label)}</div><div class="rate-note">${esc(r.note)}</div></div><div class="rate-val">${esc(r.value)}</div></div>`).join("");
      addCard(`<div class="rc-title">Current rates</div>${rows}`);
      return;
    }

    if (a.type === "card_upgrade") {
      if (!a.eligible) { addCard(`<div class="rc-title">Card upgrade</div><div>You're not pre-qualified for an upgrade right now. We'll let you know when an offer is available.</div>`); return; }
      const pf = a.prefill || {};
      const prefillHtml = `<div class="prefill">
        <div class="prefill-head">✓ We'll pre-fill your application from your profile</div>
        <div class="prefill-grid">
          <span>Name</span><span>${esc(pf.name || "—")}</span>
          <span>Email</span><span>${esc(pf.email || "—")}</span>
          <span>Mobile</span><span>${esc(pf.mobile || "—")}</span>
          <span>Annual income</span><span>${esc(pf.income || "—")}</span>
        </div>
        <div class="prefill-note">No re-typing — just review and submit.</div>
      </div>`;
      const card = addCard(`<div class="rc-title">You're pre-qualified ✦</div>
        <div class="upgrade-name">${esc(a.offeredCard)}</div>
        <div class="upgrade-meta">Annual fee ${esc(a.annualFee)}</div>
        <div class="upgrade-bonus">${esc(a.welcomeBonus)}</div>
        <div class="upgrade-benefits">${esc(a.keyBenefits)}</div>
        ${prefillHtml}
        <button class="offer-add">Review &amp; apply</button>`);
      const apply = card.querySelector(".offer-add");
      apply.addEventListener("click", () => {
        confirmAction(apply, `Submit your pre-filled application for the ${esc(a.offeredCard)}?`, () => { apply.textContent = "✓ Application submitted (pre-filled from your profile)"; apply.disabled = true; }, { confirmLabel: "Apply" });
      });
      return;
    }

    if (a.type === "confirm_action") {
      const lines = (a.lines || []).map((l) => `<div class="ca-line">${esc(l)}</div>`).join("");
      const card = addCard(`<div class="rc-title">${esc(a.title)}</div>${lines}<button class="ca-btn">${esc(a.confirmLabel || "Confirm")}</button>`);
      const btn = card.querySelector(".ca-btn");
      if (a.danger) btn.classList.add("danger");
      btn.addEventListener("click", () => {
        confirmAction(btn, "Are you sure?", () => {
          card.innerHTML = `<div class="rc-title">Done</div><div class="ca-success">✓ ${esc(a.successText)}</div>`;
          if (a.effect) applyEffect(a.effect);
        }, { confirmLabel: a.confirmLabel || "Confirm", danger: a.danger });
      });
      return;
    }

    if (a.type === "verify_update") {
      const card = addCard(`<div class="rc-title">Verify to update your ${esc(a.label)}</div>
        <div class="ca-line" style="font-weight:400">We sent a 6-digit code to <strong>${esc(a.sentTo)}</strong>. Enter it to update your ${esc(a.label)} to <strong>${esc(a.newValue)}</strong>.</div>
        <div class="verify-row">
          <input class="verify-input" inputmode="numeric" maxlength="6" placeholder="Enter code" />
          <button class="verify-btn">Verify &amp; update</button>
        </div>
        <div class="verify-hint">Demo code: ${esc(a.demoCode)}</div>
        <div class="verify-err" hidden>That code isn't right — please try again.</div>`);
      const inp = card.querySelector(".verify-input");
      const btn = card.querySelector(".verify-btn");
      const err = card.querySelector(".verify-err");
      const submit = () => {
        if (inp.value.trim() === String(a.demoCode)) {
          card.innerHTML = `<div class="rc-title">Done</div><div class="ca-success">✓ Your ${esc(a.label)} has been updated to ${esc(a.newValue)}.</div>`;
          scroll();
        } else { err.hidden = false; inp.focus(); }
      };
      btn.addEventListener("click", submit);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      return;
    }

    if (a.type === "savings_recs") {
      const rows = a.recs.map((r, i) => {
        const action = r.kind === "offer"
          ? `<button class="rec-add" data-i="${i}">+ Add to Card</button>`
          : `<button class="rec-view">View card upgrade</button>`;
        return `<div class="rec">
          <div class="rec-main"><div class="rec-title-s">${esc(r.title)}</div><div class="rec-detail">${esc(r.detail)}</div>${action}</div>
          <div class="rec-amt">+${moneyWhole(r.amount)}</div>
        </div>`;
      }).join("");
      const card = addCard(`<div class="rc-title">Your savings opportunities</div>
        <div class="insight-figure"><span class="insight-num">${moneyWhole(a.total)}</span>
          <span class="insight-sub">in potential savings &amp; rewards<br>based on your spend this year</span></div>
        <div class="recs">${rows}</div>`);
      card.querySelectorAll(".rec-add").forEach((btn) => {
        btn.addEventListener("click", () => {
          const r = a.recs[Number(btn.dataset.i)];
          confirmAction(btn, `Add the ${esc(r.offer.merchant)} offer to your Card?`, () => { btn.textContent = "✓ Added"; btn.classList.add("added"); btn.disabled = true; });
        });
      });
      card.querySelectorAll(".rec-view").forEach((btn) => {
        btn.addEventListener("click", () => send("Am I eligible for an upgraded card?"));
      });
      return;
    }

    if (a.type === "live_agent") {
      const card = addCard(`<div class="rc-title">Connecting to Customer Care</div>
        <div class="agent-connecting"><span class="spin"></span> Connecting you to a live agent…</div>`);
      setTimeout(() => {
        card.innerHTML = `<div class="rc-title">Live agent connected</div>
          <div class="agent-card"><div class="agent-avatar">${esc((a.agentName || "A")[0])}</div>
            <div><div class="agent-name">${esc(a.agentName)}</div><div class="agent-meta">Customer Care Professional · ${esc(a.channel)}</div></div></div>
          <div class="agent-meta" style="margin-top:10px">Topic: ${esc(a.topic)} · est. wait ${a.waitMinutes} min (queue #${a.queuePosition}). ${esc(a.hours)}.</div>`;
        scroll();
      }, 1600);
      return;
    }
  }

  // ---- send ----
  async function send(text) {
    if (busy || !text.trim()) return;
    if (panel.hidden) openPanel();
    busy = true; sendBtn.disabled = true;
    document.querySelectorAll(".suggestions").forEach((s) => (s.style.display = "none"));

    addBubble(text, "user");
    history.push({ role: "user", content: text });
    input.value = "";
    const typing = addTyping();

    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history }) });
      const data = await res.json();
      typing.remove();
      if (!res.ok) {
        addBubble(data.error || "Something went wrong.", "bot").classList.add("error-bubble");
      } else {
        const hasUI = Array.isArray(data.uiActions) && data.uiActions.length > 0;
        // show the model's text only when there's no richer card to show
        if (data.reply && !hasUI) addBubble(data.reply, "bot");
        if (hasUI) data.uiActions.forEach(renderAction);
        if (Array.isArray(data.messages)) history = data.messages;
      }
    } catch (err) {
      typing.remove();
      addBubble("Network error — is the server running?", "bot").classList.add("error-bubble");
    } finally {
      busy = false; sendBtn.disabled = false; input.focus();
    }
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  boot();
})();
