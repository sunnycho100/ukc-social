// Ice-shard mark + "Icebreaker" text — replaces the old raster logo.png.
export default function Wordmark({ size = "md" }: { size?: "sm" | "md" }) {
  const shard = size === "sm" ? 8 : 9;
  const fontSize = size === "sm" ? 17 : 19;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        aria-hidden
        style={{
          width: shard,
          height: shard,
          transform: "rotate(45deg)",
          background: "var(--accent)",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-display), sans-serif",
          fontSize,
          fontWeight: 800,
          letterSpacing: "-0.01em",
          color: "var(--ink)",
        }}
      >
        Icebreaker
      </span>
    </span>
  );
}
