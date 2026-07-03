import { MediaIcon } from "./MediaTypeBadge.jsx";

const defaultClassName =
  "grid h-28 w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-canvas text-neutral-600";

export default function MediaPoster({
  item,
  className = defaultClassName,
  iconSize = 28,
}) {
  const itemId = item?.ItemId || item?.itemId;
  const hasPrimaryImage = item?.HasPrimaryImage || item?.hasPrimaryImage;
  const type = item?.Type || item?.type || "Media";

  return (
    <div className={className}>
      {hasPrimaryImage && itemId ? (
        <img
          src={`/api/exclusions/image/${encodeURIComponent(itemId)}`}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <MediaIcon type={type} size={iconSize} />
      )}
    </div>
  );
}
