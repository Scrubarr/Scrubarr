import { getRunOutcome } from "../lib/runPresentation.js";

const toneClasses = {
  success: "border-emerald-900/60 bg-emerald-950/30 text-emerald-300",
  warning: "border-amber-900/60 bg-amber-950/30 text-amber-200",
  error: "border-red-900/70 bg-red-950/30 text-red-200",
  neutral: "border-line bg-white/5 text-neutral-300",
};

export default function RunStatusPill({ entry, className = "" }) {
  const outcome = getRunOutcome(entry);
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${toneClasses[outcome.tone]} ${className}`}
    >
      {outcome.label}
    </span>
  );
}
