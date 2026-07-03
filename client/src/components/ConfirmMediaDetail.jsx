import MediaMeta from "./MediaMeta.jsx";
import MediaPoster from "./MediaPoster.jsx";

export default function ConfirmMediaDetail({ item }) {
  if (!item) return null;

  return (
    <div className="flex min-w-0 gap-4">
      <MediaPoster item={item} />
      <div className="min-w-0 self-center">
        <div className="text-sm text-neutral-400">Media</div>
        <div className="mt-1 line-clamp-2 font-semibold text-accent">
          {item.Title}
        </div>
        <MediaMeta
          item={item}
          className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-400"
          showArrId
        />
      </div>
    </div>
  );
}
