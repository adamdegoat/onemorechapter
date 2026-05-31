/* One More Chapter — reader interactions.
   - reading progress bar
   - anonymous visitor id (localStorage, no PII, no login)
   - "open" + "finished" engagement beacons
   - like/love/meh/not-for-me/share reactions
   All events POST to Supabase (insert-only via the anon key). If the backend
   isn't configured, everything still works locally (buttons give feedback). */
(function () {
  "use strict";
  var cfg = window.OMC_CONFIG || {};
  var story = window.OMC_STORY || null;

  // ---- visitor id ----
  function vid() {
    try {
      var k = "omc_vid", v = localStorage.getItem(k);
      if (!v) {
        v = (crypto && crypto.randomUUID) ? crypto.randomUUID()
          : "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return "anon"; }
  }
  var VISITOR = vid();

  // ---- attribution (where did this reader arrive from?) ----
  // Only sent when cfg.TRACK_SOURCE is on AND the source/campaign columns exist;
  // remembered for the visit so a deep-linked open is credited to the email even
  // after they navigate. Off by default → never risks the insert.
  function attribution() {
    if (!cfg.TRACK_SOURCE) return null;
    try {
      var p = new URLSearchParams(location.search);
      var src = p.get("src"), cmp = p.get("cmp");
      if (src) { try { sessionStorage.setItem("omc_src", src); if (cmp) sessionStorage.setItem("omc_cmp", cmp); } catch (e) {} }
      src = src || (function () { try { return sessionStorage.getItem("omc_src"); } catch (e) { return null; } })();
      cmp = cmp || (function () { try { return sessionStorage.getItem("omc_cmp"); } catch (e) { return null; } })();
      return src ? { source: src, campaign: cmp || null } : null;
    } catch (e) { return null; }
  }

  // ---- post a reaction ----
  function post(kind) {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !story) return;
    try {
      var payload = {
        story_date: story.date, story_slug: story.slug,
        visitor_id: VISITOR, kind: kind
      };
      var attr = attribution();
      if (attr) { payload.source = attr.source; payload.campaign = attr.campaign; }
      fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/reactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + cfg.SUPABASE_ANON_KEY,
          "Prefer": "resolution=ignore-duplicates,return=minimal"
        },
        body: JSON.stringify(payload)
      }).catch(function () {});
    } catch (e) {}
  }

  function once(flag, fn) {
    if (!story) return;
    var k = "omc_" + flag + "_" + story.slug;
    try { if (localStorage.getItem(k)) return; localStorage.setItem(k, "1"); } catch (e) {}
    fn();
  }

  // ---- progress bar ----
  var bar = document.getElementById("omc-progress");
  function onScroll() {
    var h = document.documentElement;
    var max = (h.scrollHeight - h.clientHeight) || 1;
    var p = Math.min(1, Math.max(0, h.scrollTop / max));
    if (bar) bar.style.width = (p * 100).toFixed(1) + "%";
  }
  document.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- open beacon (once per visitor per story) ----
  once("open", function () { post("open"); });

  // ---- finished beacon (genuinely reached the end) ----
  // Guard against false positives: only count "finished" if the reader actually
  // scrolled AND spent real time on the page, so short stories / tall screens
  // don't auto-fire the strongest quality signal on load.
  var startedAt = Date.now(), didScroll = false;
  document.addEventListener("scroll", function () { didScroll = true; },
    { passive: true, once: true });
  var end = document.getElementById("omc-end");
  if (end && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && didScroll && (Date.now() - startedAt) > 8000) {
        once("finished", function () { post("finished"); });
        io.disconnect();
      }
    }, { threshold: 0.1 });
    io.observe(end);
  }

  // ---- reaction buttons ----
  var box = document.getElementById("reactions");
  var thanks = document.getElementById("react-thanks");
  if (box) {
    box.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-kind]");
      if (!btn) return;
      var kind = btn.getAttribute("data-kind");

      if (kind === "share") {
        var url = (story && location) ? location.href : location.href;
        var title = document.title;
        if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () {}); }
        else if (navigator.clipboard) {
          navigator.clipboard.writeText(url);
          btn.querySelector("span").textContent = "Link copied!";
        }
        post("share");
        return;
      }

      // sentiment: one per story in the UI. NOTE (accepted limitation): the
      // backend keys on (slug, visitor_id, kind), so a reader who switches their
      // mind leaves a row for each kind — counted additively server-side. Fine at
      // low traffic; revisit with an upsert Edge Function if it ever skews rewards.
      Array.prototype.forEach.call(box.querySelectorAll("button:not(.share)"),
        function (b) { b.classList.remove("chosen"); });
      btn.classList.add("chosen");
      if (thanks) thanks.hidden = false;
      try { localStorage.setItem("omc_react_" + story.slug, kind); } catch (e) {}
      post(kind);
    });

    // restore prior choice
    try {
      var prev = story && localStorage.getItem("omc_react_" + story.slug);
      if (prev) {
        var b = box.querySelector('button[data-kind="' + prev + '"]');
        if (b) { b.classList.add("chosen"); if (thanks) thanks.hidden = false; }
      }
    } catch (e) {}
  }

  // ---- newsletter signup (stores email in Supabase, insert-only) ----
  function nlShow(el, text, isErr) {
    if (!el) return; el.textContent = text; el.hidden = false;
    el.style.color = isErr ? "#b14a63" : "#8e2740";
  }
  var nlForm = document.getElementById("nl-form");
  if (nlForm) {
    nlForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var emailEl = document.getElementById("nl-email");
      var msg = document.getElementById("nl-msg");
      var email = (emailEl.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        nlShow(msg, "Please enter a valid email.", true); return;
      }
      if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
        nlShow(msg, "Thanks! Signups open very soon. 💌"); return;
      }
      var btn = nlForm.querySelector("button"); btn.disabled = true;
      fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/subscribers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + cfg.SUPABASE_ANON_KEY,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({ email: email, source: (story && story.slug) || "site" })
      }).then(function (r) {
        if (r.ok) { nlShow(msg, "You're in 💌 Tomorrow's story lands in your inbox."); nlForm.reset(); }
        else if (r.status === 409) { nlShow(msg, "You're already on the list — see you tomorrow 💌"); }
        else { nlShow(msg, "Hmm, that didn't work. Try again?", true); btn.disabled = false; }
      }).catch(function () { nlShow(msg, "Network hiccup — try again?", true); btn.disabled = false; });
    });
  }

  // ---- marquee: tap to expand the quote/habit of the day ----
  var mq = document.getElementById("marquee");
  var mqp = document.getElementById("marquee-panel");
  if (mq && mqp) {
    function toggleMq() {
      var open = mqp.hidden;
      mqp.hidden = !open;
      mq.setAttribute("aria-expanded", String(open));
    }
    mq.addEventListener("click", toggleMq);
    mq.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleMq(); }
    });
  }

  // ---- carousel: auto-advancing story slides ----
  var car = document.getElementById("carousel");
  if (car) {
    var slides = car.querySelectorAll(".slide");
    var dots = car.querySelectorAll(".dots button");
    var idx = 0, timer = null;
    function go(n) {
      idx = (n + slides.length) % slides.length;
      for (var i = 0; i < slides.length; i++) slides[i].classList.toggle("on", i === idx);
      for (var j = 0; j < dots.length; j++) dots[j].classList.toggle("on", j === idx);
    }
    function start() { if (slides.length > 1) timer = setInterval(function () { go(idx + 1); }, 6500); }
    function reset() { clearInterval(timer); start(); }
    for (var d = 0; d < dots.length; d++) {
      (function (btn) {
        btn.addEventListener("click", function () { go(+btn.getAttribute("data-i")); reset(); });
      })(dots[d]);
    }
    var arrows = car.querySelectorAll(".car-arrow");
    for (var a = 0; a < arrows.length; a++) {
      (function (arr) {
        arr.addEventListener("click", function () { go(idx + (+arr.getAttribute("data-dir"))); reset(); });
      })(arrows[a]);
    }
    start();
  }

  // ---- The Daily Stars (pick your sign, remembered) ----
  var stars = window.OMC_STARS;
  var picker = document.querySelector(".star-picker");
  var readEl = document.getElementById("star-read");
  if (stars && picker && readEl) {
    function esc2(s) { return String(s).replace(/[<>&]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]; }); }
    function renderSign(sign) {
      var d = stars[sign];
      if (!d) return;
      readEl.innerHTML = '<div class="star-glyph">' + esc2(d.g) + '</div>' +
        '<div class="star-name">' + esc2(d.n) + ' <span class="star-dates">' + esc2(d.d) + '</span></div>' +
        '<p class="star-text">' + esc2(d.t) + '</p>';
      var bs = picker.querySelectorAll(".star-btn");
      for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("on", bs[i].getAttribute("data-sign") === sign);
      try { localStorage.setItem("omc_sign", sign); } catch (e) {}
    }
    picker.addEventListener("click", function (e) {
      var b = e.target.closest(".star-btn");
      if (b) renderSign(b.getAttribute("data-sign"));
    });
    var saved = null; try { saved = localStorage.getItem("omc_sign"); } catch (e) {}
    if (saved && stars[saved]) renderSign(saved);
    else { var f0 = picker.querySelector(".star-btn"); if (f0) f0.classList.add("on"); }
  }

  // ---- live "next edition" countdown to 07:00 SGT (== 23:00 UTC) ----
  var ne = document.getElementById("next-ed");
  if (ne) {
    function nextEd() {
      var now = new Date();
      var t = new Date(now);
      t.setUTCHours(23, 0, 0, 0);
      if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
      var ms = t - now, h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      ne.textContent = "✦ Next edition in " + h + "h " + m + "m";
    }
    nextEd();
    setInterval(nextEd, 60000);
  }

  function ymd(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  // ---- reading streak (consecutive mornings, localStorage) ----
  (function () {
    var el = document.getElementById("omc-streak");
    if (!el) return;
    try {
      var now = new Date(), today = ymd(now);
      var y = new Date(now); y.setDate(y.getDate() - 1); var yday = ymd(y);
      var last = localStorage.getItem("omc_streak_last");
      var count = parseInt(localStorage.getItem("omc_streak_count") || "0", 10) || 0;
      var best = parseInt(localStorage.getItem("omc_streak_best") || "0", 10) || 0;
      if (last !== today) {
        count = (last === yday) ? count + 1 : 1;
        localStorage.setItem("omc_streak_last", today);
        localStorage.setItem("omc_streak_count", String(count));
        if (count > best) { best = count; localStorage.setItem("omc_streak_best", String(best)); }
      }
      el.textContent = "🔥 " + count + (count === 1 ? " morning" : " mornings") + " in a row" +
        (count >= 3 ? " — lovely" : "");
      el.hidden = false;
    } catch (e) {}
  })();

  // ---- The Breakfast Word — daily 5-letter word game ----
  (function () {
    var root = document.getElementById("breakfast-word");
    if (!root) return;
    var grid = document.getElementById("bw-grid"),
        keysEl = document.getElementById("bw-keys"),
        msg = document.getElementById("bw-msg"),
        shareBtn = document.getElementById("bw-share");
    var WORDS;
    try { WORDS = atob("YnJlYWQsdG9hc3QsaG9uZXksY29jb2EsamVsbHksYmVycnkscGVhY2gsbGVtb24sbWVsb24sb2xpdmUsYmFzaWwsbWFuZ28sc2NvbmUsY3JlYW0sc3VnYXIsc3BpY2UsY2FuZHksZG9udXQsZnJ1aXQsc2VlZHMsYmxvb20sZGFpc3ksdHVsaXAscml2ZXIsYmVhY2gsY2xvdWQsb2NlYW4sZmllbGQsZ3JvdmUsZmxvcmEscGxhbnQsc21pbGUscGVhY2UsaGFwcHksYnJhdmUsbWVycnksam9sbHksY2hhcm0sZ3JhY2Usc3dlZXQsZHJlYW0sbHVja3ksYmxpc3MsZ2xvcnksY2hlZXIsdHJ1c3Qsc3Vubnksc2hpbmUsbGlnaHQsZ2xlYW0sc3BhcmssZmxhbWUscXVpbHQsY2FiaW4sYm9va3Msc3Rvcnksbm92ZWwscGFnZXMsd3JpdGUscmh5bWUsdmVyc2UscHVwcHksa2l0dHksYnVubnkscm9iaW4sb3R0ZXIscGFuZGEsa29hbGEsaG9yc2Usc2hlZXAsZ29vc2UsbXVzaWMsZGFuY2UscGFydHksZ2lmdHMsd2F0ZXIsZWFydGgsbGluZW4=").split(","); }
    catch (e) { root.style.display = "none"; return; }

    var now = new Date();
    var dayNum = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(2026, 0, 1)) / 86400000);
    var idx = ((dayNum % WORDS.length) + WORDS.length) % WORDS.length;
    var ANSWER = (WORDS[idx] || "bread").toUpperCase();
    var KEY = "omc_bw_" + ymd(now), ROWS = 6, COLS = 5, cur = "";
    var state = { guesses: [], done: false, win: false, answer: ANSWER };
    try { var saved = JSON.parse(localStorage.getItem(KEY)); if (saved && saved.answer === ANSWER) state = saved; } catch (e) {}

    var tiles = [];
    for (var r = 0; r < ROWS; r++) {
      var row = document.createElement("div"); row.className = "bw-row"; var tr = [];
      for (var c = 0; c < COLS; c++) { var t = document.createElement("div"); t.className = "bw-tile"; row.appendChild(t); tr.push(t); }
      grid.appendChild(row); tiles.push(tr);
    }
    var keyEls = {};
    [["Q","W","E","R","T","Y","U","I","O","P"], ["A","S","D","F","G","H","J","K","L"],
     ["ENTER","Z","X","C","V","B","N","M","BACK"]].forEach(function (kr) {
      var krow = document.createElement("div"); krow.className = "bw-krow";
      kr.forEach(function (k) {
        var b = document.createElement("button"); b.className = "bw-key"; b.dataset.k = k;
        if (k === "ENTER") { b.textContent = "Enter"; b.classList.add("wide"); }
        else if (k === "BACK") { b.textContent = "⌫"; b.classList.add("wide"); }
        else b.textContent = k;
        krow.appendChild(b); keyEls[k] = b;
      });
      keysEl.appendChild(krow);
    });

    function colorOf(guess) {
      var res = ["absent","absent","absent","absent","absent"], ans = ANSWER.split("");
      for (var i = 0; i < COLS; i++) if (guess[i] === ans[i]) { res[i] = "correct"; ans[i] = null; }
      for (var i = 0; i < COLS; i++) { if (res[i] === "correct") continue; var j = ans.indexOf(guess[i]); if (j > -1) { res[i] = "present"; ans[j] = null; } }
      return res;
    }
    function paintRow(r, guess, res) {
      for (var c = 0; c < COLS; c++) {
        tiles[r][c].textContent = guess[c]; tiles[r][c].className = "bw-tile filled " + res[c];
        var ke = keyEls[guess[c]];
        if (ke) {
          if (res[c] === "correct") ke.className = "bw-key correct";
          else if (res[c] === "present" && !ke.classList.contains("correct")) ke.className = "bw-key present";
          else if (res[c] === "absent" && !ke.classList.contains("correct") && !ke.classList.contains("present")) ke.classList.add("absent");
        }
      }
    }
    function setMsg(t) { msg.textContent = t || ""; }
    function finishUI() {
      setMsg(state.win ? "Nice — fresh word tomorrow ☕" : "Today’s word was " + ANSWER + ". Back tomorrow!");
      shareBtn.hidden = false;
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
    function submit() {
      var r = state.guesses.length;
      if (cur.length < COLS) { var rw = grid.children[r]; if (rw) { rw.classList.remove("shake"); void rw.offsetWidth; rw.classList.add("shake"); } setMsg("Need five letters"); return; }
      var res = colorOf(cur); paintRow(r, cur, res); state.guesses.push(cur);
      var won = cur === ANSWER; cur = "";
      if (won) { state.win = true; state.done = true; }
      else if (state.guesses.length >= ROWS) { state.done = true; }
      save(); if (state.done) finishUI(); else setMsg("");
    }
    function type(ch) {
      if (state.done) return; var r = state.guesses.length;
      if (ch === "ENTER") return submit();
      if (ch === "BACK") { if (cur.length) { cur = cur.slice(0, -1); tiles[r][cur.length].textContent = ""; tiles[r][cur.length].className = "bw-tile"; } return; }
      if (!/^[A-Z]$/.test(ch) || cur.length >= COLS) return;
      tiles[r][cur.length].textContent = ch; tiles[r][cur.length].className = "bw-tile typed"; cur += ch;
    }
    keysEl.addEventListener("click", function (e) { var b = e.target.closest("button[data-k]"); if (b) type(b.dataset.k); });
    document.addEventListener("keydown", function (e) {
      if (state.done) return; var tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "Enter") type("ENTER");
      else if (e.key === "Backspace") type("BACK");
      else if (/^[a-zA-Z]$/.test(e.key)) type(e.key.toUpperCase());
    });
    shareBtn.addEventListener("click", function () {
      var em = { correct: "🟩", present: "🟨", absent: "⬛" };
      var lines = ["The Breakfast Word · " + ymd(now), (state.win ? state.guesses.length : "X") + "/6", ""];
      state.guesses.forEach(function (g) { lines.push(colorOf(g).map(function (x) { return em[x]; }).join("")); });
      lines.push("", "Play with your coffee at The Breakfast Times");
      var txt = lines.join("\n");
      if (navigator.share) navigator.share({ text: txt }).catch(function () {});
      else if (navigator.clipboard) { navigator.clipboard.writeText(txt); shareBtn.textContent = "Copied!"; setTimeout(function () { shareBtn.textContent = "Share result"; }, 1500); }
    });

    for (var g = 0; g < state.guesses.length; g++) paintRow(g, state.guesses[g], colorOf(state.guesses[g]));
    if (state.done) finishUI();
  })();
})();
