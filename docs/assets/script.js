/* Sound Clash docs: shared script
 *
 * Single source of truth for navigation. Each HTML page declares its identity
 * via <html data-page="..."> and includes <header id="topnav"></header> +
 * <footer id="page-nav"></footer> placeholders. This script renders both from
 * the PAGES list below, so adding a new HTML page = one entry here.
 *
 * Also handles: theme toggle (light/dark/system, persisted), Mermaid init,
 * TOC scroll-spy active-link highlighting.
 */

(function () {
  "use strict";

  // ---------- Single source of truth: every HTML page in /docs ----------
  const PAGES = [
    { id: "home",     title: "Home",     short: "Home",      path: "index.html",          desc: "Documentation index" },
    { id: "internal", title: "Internal architecture", short: "Internal", path: "diagrams/internal.html", desc: "Browser ↔ FastAPI ↔ Supabase, buzz race" },
    { id: "external", title: "External services",     short: "External", path: "diagrams/external.html", desc: "Hosting, CI/CD, monitoring, deploy flow" },
  ];

  const EXTERNAL = {
    repo: "https://github.com/BenArtzi4/Sound-Clash",
    live: "https://soundclash.org",
  };

  const STORAGE_KEY = "sc-theme";
  const root = document.documentElement;

  // ---------- Path helpers ----------
  function basePath() {
    // Pages live at: /docs/index.html, /docs/diagrams/internal.html, etc.
    // Detect depth from the current location.
    const path = window.location.pathname;
    if (/\/diagrams\//.test(path)) return "..";
    return ".";
  }
  function hrefTo(page) {
    return basePath() + "/" + page.path;
  }
  function currentPageId() {
    return root.dataset.page || "home";
  }

  // ---------- Theme ----------
  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") {
      root.setAttribute("data-theme", theme);
    } else {
      root.removeAttribute("data-theme");
    }
  }

  function currentTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  // Apply persisted theme as early as possible (script is in <head> with defer)
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") applyTheme(stored);

  // ---------- Render: top navigation ----------
  // Icons inlined as SVG paths so we don't need an icon font.
  const ICONS = {
    github: '<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/></svg>',
    external: '<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V8a.5.5 0 0 0-1 0v4.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H8a.5.5 0 0 0 0-1z"/><path d="M9.146.146A.5.5 0 0 1 9.5 0h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0V1.707L6.354 9.354a.5.5 0 1 1-.708-.708L13.293 1H9.5a.5.5 0 0 1-.354-.854"/></svg>',
    moon: '<svg class="icon icon-moon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278"/></svg>',
    sun: '<svg class="icon icon-sun" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8m10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0m-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0m9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707M4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .708"/></svg>',
    arrowLeft: '<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8"/></svg>',
    arrowRight: '<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8"/></svg>',
  };

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") e.className = v;
        else if (k === "html") e.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") {
          e.addEventListener(k.slice(2).toLowerCase(), v);
        } else e.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  }

  function renderTopnav() {
    const host = document.getElementById("topnav");
    if (!host) return;
    const here = currentPageId();
    const home = PAGES.find((p) => p.id === "home");

    const tabs = el("nav", { class: "topnav-tabs", "aria-label": "Documentation pages" },
      ...PAGES.map((p) => {
        const isActive = p.id === here;
        return el("a", {
          class: "topnav-tab" + (isActive ? " active" : ""),
          href: hrefTo(p),
          "aria-current": isActive ? "page" : null,
          title: p.desc,
        }, p.short);
      })
    );

    const utility = el("div", { class: "topnav-utility" },
      el("a", {
        class: "topnav-link",
        href: EXTERNAL.live,
        target: "_blank",
        rel: "noopener",
        title: "Open the live game",
      }, el("span", { class: "label" }, "Live"), el("span", { html: ICONS.external })),
      el("a", {
        class: "topnav-link",
        href: EXTERNAL.repo,
        target: "_blank",
        rel: "noopener",
        title: "View source on GitHub",
      }, el("span", { class: "label" }, "GitHub"), el("span", { html: ICONS.github })),
      el("button", {
        id: "theme-toggle",
        class: "topnav-link icon-only",
        type: "button",
        "aria-label": "Toggle dark mode",
        title: "Toggle dark mode",
      },
        el("span", { html: ICONS.moon }),
        el("span", { html: ICONS.sun })
      )
    );

    const inner = el("div", { class: "topnav-inner" },
      el("a", { class: "topnav-brand", href: hrefTo(home), "aria-label": "Sound Clash docs home" },
        el("span", { class: "dot", "aria-hidden": "true" }),
        document.createTextNode("Sound Clash"),
        el("span", { class: "muted small" }, "docs")
      ),
      tabs,
      utility
    );

    // .topnav class is set in HTML so the bar has stable height from first
    // paint; here we just populate the inner content.
    host.replaceChildren(inner);
  }

  function renderPageNav() {
    const host = document.getElementById("page-nav");
    if (!host) return;
    const here = currentPageId();
    const idx = PAGES.findIndex((p) => p.id === here);
    if (idx === -1) return;
    const prev = PAGES[idx - 1];
    const next = PAGES[idx + 1];
    if (!prev && !next) return;

    const card = (page, dir) => {
      const arrow = dir === "prev" ? ICONS.arrowLeft : ICONS.arrowRight;
      const labelText = dir === "prev" ? "Previous" : "Next";
      return el("a", { class: `page-nav-card page-nav-${dir}`, href: hrefTo(page) },
        el("span", { class: "page-nav-dir" }, el("span", { html: arrow }), document.createTextNode(labelText)),
        el("span", { class: "page-nav-title" }, page.title),
        el("span", { class: "page-nav-desc" }, page.desc)
      );
    };

    // .page-nav class is set in HTML; here we just populate prev/next cards.
    host.replaceChildren(
      prev ? card(prev, "prev") : el("span", { class: "page-nav-spacer" }),
      next ? card(next, "next") : el("span", { class: "page-nav-spacer" })
    );
  }

  // ---------- Theme toggle wiring (after nav renders) ----------
  function setupThemeToggle() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      // Re-render diagrams against the new theme.
      renderMermaid();
    });
  }

  // ---------- Mermaid ----------
  // Cache the resolved module + the original source of each diagram so we
  // can re-render without re-fetching when the user toggles the theme.
  let mermaidModule = null;
  const mermaidSources = new WeakMap();

  function captureMermaidSources() {
    document.querySelectorAll(".mermaid").forEach((el) => {
      if (!mermaidSources.has(el)) {
        mermaidSources.set(el, el.textContent);
      }
    });
  }

  function isDarkTheme() {
    const explicit = root.getAttribute("data-theme");
    if (explicit === "dark") return true;
    if (explicit === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function renderMermaid() {
    const nodes = document.querySelectorAll(".mermaid");
    if (!nodes.length) return;
    captureMermaidSources();

    const run = (mermaid) => {
      // Reset any previously-rendered SVG back to its original Mermaid source
      // so mermaid.run() re-processes it under the current theme.
      nodes.forEach((el) => {
        el.removeAttribute("data-processed");
        const src = mermaidSources.get(el);
        if (src != null) el.textContent = src;
      });
      mermaid.initialize({
        startOnLoad: false,
        theme: isDarkTheme() ? "dark" : "default",
        securityLevel: "antiscript",
        flowchart: { htmlLabels: true, curve: "basis" },
        sequence: { mirrorActors: false, showSequenceNumbers: true },
      });
      mermaid.run({ querySelector: ".mermaid" }).catch((err) => {
        console.error("Mermaid render failed:", err);
      });
    };

    if (mermaidModule) {
      run(mermaidModule);
      return;
    }
    import("https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs")
      .then((mod) => {
        mermaidModule = mod.default;
        run(mermaidModule);
      })
      .catch((err) => {
        console.error("Mermaid failed to load:", err);
      });
  }

  // Keep the older name as a thin alias so the boot path reads the same.
  const initMermaid = renderMermaid;

  // ---------- TOC active-link on scroll ----------
  function setupTOC() {
    const toc = document.querySelector(".toc");
    if (!toc) return;
    const links = Array.from(toc.querySelectorAll("a[href^='#']"));
    if (!links.length) return;

    const targets = links
      .map((a) => {
        const id = decodeURIComponent(a.getAttribute("href").slice(1));
        return { id, link: a, el: document.getElementById(id) };
      })
      .filter((t) => t.el);

    function setActive() {
      const offset = 100;
      let active = targets[0];
      for (const t of targets) {
        if (t.el.getBoundingClientRect().top - offset <= 0) {
          active = t;
        } else {
          break;
        }
      }
      links.forEach((l) => l.classList.remove("active"));
      if (active && active.link) active.link.classList.add("active");
    }

    let ticking = false;
    window.addEventListener("scroll", () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setActive();
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
    setActive();
  }

  // ---------- Bootstrap ----------
  function boot() {
    renderTopnav();
    renderPageNav();
    setupThemeToggle();
    initMermaid();
    setupTOC();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
