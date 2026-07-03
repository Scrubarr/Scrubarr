import MediaTypeBadge from "./MediaTypeBadge.jsx";

export default function MediaMeta({
  item,
  className = "flex flex-wrap items-center gap-2 text-xs text-neutral-400",
  showArrId = false,
}) {
  const type = item?.Type || item?.type || "Media";
  const year = item?.Year || item?.year;
  const arr = item?.Arr || item?.arr;
  const arrId = item?.ArrId || item?.arrId;

  return (
    <div className={className}>
      <MediaTypeBadge type={type} />
      {year ? <span>{year}</span> : null}
      {arr ? (
        <span className={showArrId && arrId ? "text-neutral-400" : undefined}>
          {showArrId && arrId ? `${arr} #${arrId}` : arr}
        </span>
      ) : null}
    </div>
  );
}
