import { Info } from "lucide-react";
import AnchoredTooltip from "./AnchoredTooltip.jsx";

function dateSourceLabel(source) {
  return {
    arr: "Arr added date",
    "emby-created": "Media server created date",
    premiere: "Premiere date",
    "emby-last-played": "Media server last played",
    "emby-episode-last-played": "Latest episode watched",
  }[source] || source;
}

function reasonParts(reason) {
  return String(reason || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

export default function QualificationPopover({ item }) {
  const structuredRules = Array.isArray(item.QualificationReasons)
    ? item.QualificationReasons
        .map((rule) => String(rule || "").trim())
        .filter(Boolean)
    : [];
  const rules = structuredRules.length > 0
    ? [...structuredRules]
    : reasonParts(item.Reason);

  if (item.DateSource) {
    rules.push(`Source: ${dateSourceLabel(item.DateSource)}`);
  }

  if (
    structuredRules.length === 0 &&
    item.Type === "Series" &&
    item.SeriesInactiveDays !== undefined
  ) {
    rules.push(
      item.SeriesInactiveDays === null
        ? "No recorded episode playback"
        : `Latest episode playback was ${item.SeriesInactiveDays} days ago`,
    );
  }

  if (rules.length === 0) return null;

  return (
    <AnchoredTooltip
      className="mt-3"
      width={320}
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-neutral-300 outline-none transition hover:border-accent hover:text-accent focus:border-accent focus:text-accent"
          aria-label={`Show why ${item.Title} qualified`}
        >
          <Info size={13} />
          Why it qualified
        </button>
      }
      panelClassName="rounded-xl border border-line bg-neutral-950 p-3 text-xs text-neutral-200"
    >
        <p className="font-semibold text-amber-200">Qualification reasons</p>
        <ul className="mt-2 list-disc space-y-1.5 break-words pl-4 leading-5">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
    </AnchoredTooltip>
  );
}
