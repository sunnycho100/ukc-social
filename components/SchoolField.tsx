"use client";

import { useEffect, useRef, useState } from "react";
import { searchSchools } from "@/app/actions/schools";
import { matchCanonical, type School } from "@/lib/schools";

// The School / Company field. Suggests canonical university names as you type
// so that two people at the same school end up with the same string, which is
// what the People filter groups on. It never blocks what you typed: companies
// and anything ROR does not carry stay exactly as entered.
export default function SchoolField({
  id,
  value,
  onChange,
  placeholder = "Enter here",
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [hits, setHits] = useState<School[]>([]);
  const [open, setOpen] = useState(false);
  // What the last lookup was for. Suggestions are only shown for text the user
  // typed, never for a value that arrived from the server or from picking.
  const typed = useRef("");

  useEffect(() => {
    if (typed.current !== value) return;
    let alive = true;
    const t = setTimeout(async () => {
      const q = value.trim();
      const found = q.length < 2 ? [] : await searchSchools(q);
      if (!alive || typed.current !== value) return;
      setHits(found);
      setOpen(found.length > 0);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [value]);

  const exact = hits.some((h) => h.name === value);

  return (
    <div className="sf">
      <input
        id={id}
        className="ob-field"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          typed.current = e.target.value;
          onChange(e.target.value);
        }}
        onFocus={() => hits.length && setOpen(true)}
        // A click on a suggestion has to land before the list closes.
        //
        // Leaving the field also settles what was typed. Picking a suggestion
        // was the only thing that canonicalised, so anyone who typed "UW
        // Madison" and moved on was stored under a name of their own and never
        // grouped with their own school again. matchCanonical only rewrites an
        // exact name-or-alias hit, so a company or anything ROR does not carry
        // is still left exactly as entered.
        onBlur={() => {
          const canon = matchCanonical(value, hits);
          if (canon && canon !== value) {
            typed.current = "";
            onChange(canon);
          }
          setTimeout(() => setOpen(false), 150);
        }}
      />

      {open && !exact && (
        <ul className="sf-list">
          {hits.map((h) => (
            <li key={h.name}>
              <button
                type="button"
                className="sf-item"
                onClick={() => {
                  typed.current = "";
                  onChange(h.name);
                  setOpen(false);
                }}
              >
                <span className="sf-name">{h.name}</span>
                {h.aliases.length > 0 && <span className="sf-alias">{h.aliases.join(" · ")}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .sf { position: relative; }
        .sf-list {
          position: absolute;
          left: 0;
          right: 0;
          top: 100%;
          z-index: 70;
          margin-top: 4px;
          padding: 4px 0;
          list-style: none;
          background: var(--surface, #101B27);
          border: 1px solid var(--line);
          border-radius: 12px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
          max-height: 240px;
          overflow-y: auto;
        }
        .sf-item {
          display: block;
          width: 100%;
          text-align: left;
          padding: 9px 14px;
          background: none;
          border: none;
          cursor: pointer;
        }
        .sf-item:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
        .sf-name { display: block; font-size: 14px; color: var(--ink); }
        .sf-alias {
          display: block;
          margin-top: 2px;
          font-size: 12px;
          color: var(--ink-3);
        }
      `}</style>
    </div>
  );
}
