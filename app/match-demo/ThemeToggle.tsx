"use client";

import { useEffect, useState } from "react";

// Dev convenience: flip <html data-theme> between dark (default) and light.
// Lives inside a sticky bar (see page.tsx) so it never floats over content.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("theme") === "light" ? "light" : "dark";
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="theme-toggle"
    >
      <span aria-hidden>{theme === "dark" ? "☀" : "☾"}</span>
      <style>{`
        .theme-toggle {
          width: 44px; height: 44px;
          display: grid; place-items: center;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: var(--glass-solid);
          color: var(--ink-2);
          font-size: 17px; line-height: 1;
          cursor: pointer;
          transition: color 0.15s ease, border-color 0.15s ease;
        }
        .theme-toggle:hover { color: var(--accent); border-color: var(--accent); }
        .theme-toggle:active { transform: scale(0.94); }
        @media (prefers-reduced-motion: reduce) { .theme-toggle { transition: none; } .theme-toggle:active { transform: none; } }
      `}</style>
    </button>
  );
}
