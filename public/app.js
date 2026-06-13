// app.js — Concierge chat client + dashboard interactions
(() => {
  // ---- elements ----
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

  // ---- greeting based on LOCAL time ----
  function timeGreeting() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }

  // ---- bootstrap config (member name) + greetings + dashboard fico ----
  async function boot() {
    try {
      const cfg = await (await fetch("/api/config")).json();
      MEMBER = cfg.firstName || "John";
    } catch (_) {}
    const greet = timeGreeting();
    document.getElementById("heroGreeting").textContent = `${greet}, ${MEMBER}.`;
    document.getElementById("topGreet").textContent = `${greet}, ${MEMBER}`;
    document.getElementById("memberAvatar").textContent = MEMBER[0].toUpperCase();
    document.getElementById("cardName").textContent = (MEMBER + " A. Member").toUpperCase();
    // dashboard FICO gauge (static 782)
    document.getElementById("ficoGauge").innerHTML = ficoGaugeSVG(782);
    document.getElementById("ficoBand").textContent = "Very Good";
    // seed the chat greeting + suggestions
    seedChat(greet);
  }

  function seedChat(greet) {
    body.innerHTML = "";
    addBubble(`${greet}, ${MEMBER} — I'm your Concierge. Ask me anything, or try one of these:`, "bot");
    const wrap = document.createElement("div");
    wrap.className = "suggestions";
    const prompts = [
      ["Uber trips this year", "How many Uber trips have I taken this year?"],
      ["Download March statement", "Download my March 2026 statement"],
      ["Laptop offers", "I want to buy a laptop — any offers?"],
      ["My FICO score", "What's my FICO score?"],
      ["Checking routing number", "What's the routing number for my checking account?"],
      ["Manage third-party permissions", "Take me to manage third party permissions"],
      ["Talk to a person", "I'd like to speak to a live agent"],
    ];
    prompts.forEach(([label, prompt]) => {
      const b = document.createElement("button");
      b.textContent = label; b.dataset.prompt = prompt;
      wrap.appendChild(b);
    });
    body.appendChild(wrap);
    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-prompt]");
      if (btn) send(btn.dataset.prompt);
    });
  }

  // ---- FICO semicircular gauge (range 300–850) ----
  function ficoGaugeSVG(score) {
    const cx = 100, cy = 100, r = 78;
    const toXY = (frac) => {
      const a = Math.PI * (1 - frac); // 300→π (left), 850→0 (right)
      return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    };
    const arc = (f0, f1, color) => {
      const [x0, y0] = toXY(f0), [x1, y1] = toXY(f1);
      return `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${color}" stroke-width="13" fill="none" stroke-linecap="round"/>`;
    };
    const f = (s) => (Math.max(300, Math.min(850, s)) - 300) / 550;
    // FICO bands
    const bands = [
      [300, 580, "#b41601"], [580, 670, "#e08600"], [670, 740, "#e0c000"],
      [740, 800, "#5aa700"], [800, 850, "#00804a"],
    ];
    let segs = bands.map(([a, b, c]) => arc(f(a), f(b), c)).join("");
    const [nx, ny] = toXY(f(score));
    const needle = `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#1d1d1d" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="6" fill="#1d1d1d"/>`;
    return `<svg viewBox="0 0 200 118" width="100%">${segs}${needle}
      <text x="${cx}" y="86" text-anchor="middle" font-size="30" font-weight="700" fill="#00175a" font-family="Helvetica Neue,Arial,sans-serif">${score}</text>
      <text x="22" y="114" font-size="10" fill="#8c8c8c">300</text>
      <text x="178" y="114" text-anchor="end" font-size="10" fill="#8c8c8c">850</text></svg>`;
  }

  // ---- open / close (chat icon toggles the panel) ----
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

  // dashboard tiles / nav clicks
  document.querySelectorAll("[data-section]").forEach((el) => {
    if (el.classList.contains("tile") || el.closest(".topnav") || el.classList.contains("btn-primary")) {
      el.addEventListener("click", (e) => {
        if (el.tagName === "A") e.preventDefault();
        const sec = el.dataset.section;
        if (sec === "third_party_permissions") runPermissionsSim();
        else flashSection(sec);
      });
    }
  });

  // ---- bubbles / cards ----
  function addBubble(text, who) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${who}`;
    const b = document.createElement("div");
    b.className = "bubble"; b.textContent = text;
    wrap.appendChild(b); body.appendChild(wrap); scroll();
    return b;
  }
  function addTyping() {
    const wrap = document.createElement("div");
    wrap.className = "msg bot";
    wrap.innerHTML = `<div class="bubble typing"><span></span><span></span><span></span></div>`;
    body.appendChild(wrap); scroll(); return wrap;
  }
  function addCard(html) {
    const wrap = document.createElement("div");
    wrap.className = "msg bot";
    const card = document.createElement("div");
    card.className = "bubble result-card"; card.innerHTML = html;
    wrap.appendChild(card); body.appendChild(wrap); scroll();
    return card;
  }
  const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function scroll() { body.scrollTop = body.scrollHeight; }

  // ---- confirm-before-act: swaps a trigger button for an inline Confirm/Cancel prompt ----
  function confirmAction(triggerBtn, message, onConfirm, opts) {
    opts = opts || {};
    const confirmLabel = opts.confirmLabel || "Confirm";
    const danger = !!opts.danger;
    triggerBtn.style.display = "none";
    const box = document.createElement("span");
    box.className = "confirm-inline";
    box.innerHTML = `<span class="confirm-msg">${message}</span>` +
      `<button class="btn-confirm ${danger ? "danger" : ""}">${esc(confirmLabel)}</button>` +
      `<button class="btn-cancel">Cancel</button>`;
    triggerBtn.insertAdjacentElement("afterend", box);
    scroll();
    box.querySelector(".btn-confirm").addEventListener("click", () => { box.remove(); triggerBtn.style.display = ""; onConfirm(); scroll(); });
    box.querySelector(".btn-cancel").addEventListener("click", () => { box.remove(); triggerBtn.style.display = ""; });
  }

  // ---- render tool-driven UI actions ----
  function renderAction(a) {
    if (a.type === "navigate") flashSection(a.section);

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
      const card = addCard(`<div class="rc-title">Amex Offers for you</div>${rows}
        <button class="offer-add">Add all to Card</button>`);
      // per-offer add (confirm first)
      card.querySelectorAll(".offer-add-one").forEach((btn) => {
        btn.addEventListener("click", () => {
          const o = a.offers[Number(btn.dataset.i)];
          confirmAction(btn, `Add the ${esc(o.merchant)} offer to your Card?`, () => {
            btn.textContent = "✓ Added"; btn.classList.add("added"); btn.disabled = true;
          });
        });
      });
      // add all (confirm first)
      const addAll = card.querySelector(".offer-add");
      addAll.addEventListener("click", () => {
        confirmAction(addAll, `Add all ${a.offers.length} offers to your Card?`, () => {
          card.querySelectorAll(".offer-add-one").forEach((b) => { b.style.display = ""; b.textContent = "✓ Added"; b.classList.add("added"); b.disabled = true; });
          addAll.textContent = "✓ All offers added to Card"; addAll.disabled = true;
        });
      });
    }

    if (a.type === "insight") {
      // show ALL items so the displayed count matches the headline count
      const list = (a.items || []).map((s) =>
        `<div><span>${esc(s.date)} · ${esc(s.merchant)}</span><span>${money(s.amount)}</span></div>`).join("");
      addCard(`<div class="rc-title">Spending insight · ${esc(a.timeframe)}</div>
        <div class="insight-figure">
          <span class="insight-num">${a.count}</span>
          <span class="insight-sub">${esc(a.subject)} transaction${a.count === 1 ? "" : "s"}<br>totaling <strong>${money(a.total)}</strong></span>
        </div>
        <div class="insight-list">${list}</div>`);
    }

    if (a.type === "statement") {
      addCard(`<div class="rc-title">Statement ready</div>
        <div class="statement-chip">
          <div><div class="offer-merchant">${esc(a.label)}</div>
          <div class="statement-meta">Closing balance ${money(a.closingBalance)} · due ${esc(a.dueDate)}</div></div>
          <a class="statement-dl" href="${esc(a.downloadUrl)}">Download</a>
        </div>`);
    }

    if (a.type === "fico") {
      addCard(`<div class="rc-title">Your FICO® Score</div>
        <div class="fico-card-row">
          <div class="fico-gauge">${ficoGaugeSVG(a.score)}</div>
          <div>
            <div class="fico-card-band">${esc(a.band)}</div>
            <div class="fico-card-meta">▲ ${a.change} pts since last month<br>${esc(a.provider)}<br>Updated ${esc(a.updated)}</div>
          </div>
        </div>`);
    }

    if (a.type === "banking") {
      const img = a.image ? `<img src="${esc(a.image)}" alt="${esc(a.name)}"/>` : "";
      addCard(`<div class="rc-title">${esc(a.name)}</div>
        <div class="bank-card">${img}
          <div style="flex:1">
            <div class="bank-field"><span>Routing number</span><span class="v">${esc(a.routing)}<button class="copy-btn" data-copy="${esc(a.routing)}">Copy</button></span></div>
            <div class="bank-field"><span>Account number</span><span class="v">•••• ${esc(a.accountLast4)}</span></div>
            <div class="bank-field"><span>Bank</span><span class="v" style="font-weight:400">${esc(a.bank)}</span></div>
          </div>
        </div>`).querySelectorAll(".copy-btn").forEach((b) =>
          b.addEventListener("click", () => { navigator.clipboard?.writeText(b.dataset.copy); b.textContent = "Copied"; }));
    }

    if (a.type === "live_agent") {
      const card = addCard(`<div class="rc-title">Connecting to Customer Care</div>
        <div class="agent-connecting"><span class="spin"></span> Connecting you to a live agent…</div>`);
      setTimeout(() => {
        card.innerHTML = `<div class="rc-title">Live agent connected</div>
          <div class="agent-card">
            <div class="agent-avatar">${esc((a.agentName || "A")[0])}</div>
            <div><div class="agent-name">${esc(a.agentName)}</div>
            <div class="agent-meta">Customer Care Professional · ${esc(a.channel)}</div></div>
          </div>
          <div class="agent-meta" style="margin-top:10px">Topic: ${esc(a.topic)} · est. wait ${a.waitMinutes} min (queue #${a.queuePosition}). ${esc(a.hours)}.</div>`;
        scroll();
      }, 1600);
    }

    if (a.type === "nav_steps") runPermissionsSim(a.steps, a.connections, a.destination);
  }

  // ---- third-party permissions click-path simulation ----
  const overlay = document.getElementById("tppOverlay");
  const bc = document.getElementById("tppBreadcrumb");
  const stage = document.getElementById("tppStage");
  document.getElementById("tppClose").addEventListener("click", () => { overlay.hidden = true; });

  async function runPermissionsSim(steps, connections, destination) {
    // default path + data for the manual (dashboard tile) trigger
    steps = steps || ["Selecting your Card account", "Opening the Account Services tab", "Choosing Card Management", "Opening Manage Third Party Permissions"];
    destination = destination || "Manage Third Party Permissions";
    if (!connections) { try { connections = await (await fetch("/api/permissions")).json(); } catch (_) { connections = []; } }

    const crumbLabels = ["Card", "Account Services", "Card Management", "Manage Third Party Permissions"];
    overlay.hidden = false;
    bc.innerHTML = crumbLabels.map((c, i) => `${i ? '<span class="sep">›</span>' : ""}<span class="crumb" data-i="${i}">${c}</span>`).join("");
    stage.innerHTML = `<div style="text-align:center;padding:30px 0"><span class="spin"></span><div style="color:#737373;font-size:13px;margin-top:12px" id="tppStep"></div></div>`;
    const stepEl = document.getElementById("tppStep");

    for (let i = 0; i < steps.length; i++) {
      stepEl.textContent = steps[i];
      bc.querySelectorAll(".crumb")[i]?.classList.add("on");
      await new Promise((r) => setTimeout(r, 650));
    }
    // render permissions panel
    const rows = connections.map((c) => {
      const on = c.status === "Connected";
      return `<div class="perm">
        <div>
          <div class="perm-name">${esc(c.app)}</div>
          <div class="perm-purpose">${esc(c.purpose)}</div>
          <div class="perm-access">${esc(c.access)}${c.since ? " · since " + esc(c.since) : ""}</div>
        </div>
        <button class="perm-toggle ${on ? "on" : "off"}" data-app="${esc(c.app)}">${on ? "Connected" : "Connect"}</button>
      </div>`;
    }).join("");
    stage.innerHTML = `<h3>${esc(destination)}</h3>
      <div class="tpp-intro">Review and manage the third-party apps that can access your account data.</div>${rows}`;
    stage.querySelectorAll(".perm-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const on = btn.classList.contains("on");
        const app = esc(btn.dataset.app);
        if (on) {
          confirmAction(btn, `Disconnect ${app}? It will lose access to your account data.`, () => {
            btn.classList.remove("on"); btn.classList.add("off"); btn.textContent = "Connect";
          }, { confirmLabel: "Disconnect", danger: true });
        } else {
          confirmAction(btn, `Allow ${app} to access your account data?`, () => {
            btn.classList.remove("off"); btn.classList.add("on"); btn.textContent = "Connected";
          }, { confirmLabel: "Allow" });
        }
      });
    });
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
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json();
      typing.remove();
      if (!res.ok) {
        addBubble(data.error || "Something went wrong.", "bot").classList.add("error-bubble");
      } else {
        if (data.reply) addBubble(data.reply, "bot");
        (data.uiActions || []).forEach(renderAction);
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
