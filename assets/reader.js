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

  // ---- post a reaction ----
  function post(kind) {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !story) return;
    try {
      fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/reactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + cfg.SUPABASE_ANON_KEY,
          "Prefer": "resolution=ignore-duplicates,return=minimal"
        },
        body: JSON.stringify({
          story_date: story.date, story_slug: story.slug,
          visitor_id: VISITOR, kind: kind
        })
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

  // ---- finished beacon (scrolled to the end sentinel) ----
  var end = document.getElementById("omc-end");
  if (end && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { once("finished", function () { post("finished"); }); io.disconnect(); }
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

      // sentiment: one per story; clicking another switches it
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
})();
