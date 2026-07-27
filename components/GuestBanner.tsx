import Link from "next/link";

// Shown across the tab bar shell while browsing as an anonymous "guest". Sticky so
// the nudge to create a real account stays in view.
export default function GuestBanner() {
  return (
    <aside
      aria-label="Guest account"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        // Top inset belongs on the top edge; the notch overlaps this band, not its base.
        padding: "calc(4px + env(safe-area-inset-top)) 16px 4px",
        background: "color-mix(in srgb, var(--accent) 14%, var(--bg))",
        borderBottom: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
        fontSize: 14,
      }}
    >
      <span
        style={{
          color: "var(--ink)",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        You&apos;re just looking around.
      </span>
      <Link
        href="/login"
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          minHeight: 44,
          color: "var(--accent)",
          fontWeight: 700,
          whiteSpace: "nowrap",
        }}
      >
        Create your account ▸
      </Link>
    </aside>
  );
}
