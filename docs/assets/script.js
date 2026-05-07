/* Sound Clash docs — shared script
 * - Theme toggle (light / dark / system) persisted in localStorage
 * - Mermaid initialization (consistent config across all pages)
 * - TOC active-link highlighting on scroll (only if .toc exists)
 */

(function () {
  "use strict";

  // ---------- Theme ----------
  const STORAGE_KEY = "sc-theme";
  const root = document.documentElement;

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

  function setupThemeToggle() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
    });
  }

  // ---------- Mermaid ----------
  function initMermaid() {
    if (!document.querySelector(".mermaid")) return;
    import("https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs")
      .then((mod) => {
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: true,
          theme: "default", // diagrams render on white background regardless of page theme
          securityLevel: "loose",
          flowchart: { htmlLabels: true, curve: "basis" },
          sequence: { mirrorActors: false, showSequenceNumbers: true },
        });
      })
      .catch((err) => {
        console.error("Mermaid failed to load:", err);
      });
  }

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
      const offset = 100; // sticky nav height + buffer
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
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setupThemeToggle();
      initMermaid();
      setupTOC();
    });
  } else {
    setupThemeToggle();
    initMermaid();
    setupTOC();
  }
})();
