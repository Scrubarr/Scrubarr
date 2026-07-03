export default function StatePanel({ children, tone = "neutral" }) {
  const toneClass =
    tone === "error"
      ? "border-red-900/70 bg-red-950/30 text-red-200"
      : tone === "warning"
        ? "border-amber-800/60 bg-amber-950/20 text-amber-100"
      : "border-line bg-panel text-neutral-400";

  return (
    <div className={`rounded-xl border p-5 text-sm ${toneClass}`}>
      {children}
    </div>
  );
}
