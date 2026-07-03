import { Film, Tv } from "lucide-react";

export function MediaIcon({ type, size = 18 }) {
  return type === "Series" || type === "Episode"
    ? <Tv size={size} />
    : <Film size={size} />;
}

export default function MediaTypeBadge({ type = "Item", label }) {
  const isSeriesLike = type === "Series" || type === "Episode";
  const classes = isSeriesLike
    ? "border-purple-500/30 bg-purple-500/15 text-purple-200"
    : "border-blue-500/30 bg-blue-500/15 text-blue-200";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${classes}`}
    >
      <MediaIcon type={type} size={13} />
      {label || type || "Item"}
    </span>
  );
}
