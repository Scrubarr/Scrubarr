import MediaMeta from "./MediaMeta.jsx";
import MediaPoster from "./MediaPoster.jsx";
import QualificationPopover from "./QualificationPopover.jsx";

export default function MediaCard({
  item,
  actions,
  actionsClassName = "mt-5 flex flex-wrap gap-2",
  aside,
  children,
  className = "",
  contentClassName = "flex min-w-0 flex-1 flex-col justify-center",
  metaClassName = "mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-400",
  posterClassName,
  posterIconSize,
  selectControl,
  selected = false,
  showArrId = false,
  showMeta = true,
  showQualification = false,
  subtitle,
  titleAside,
  titleClassName = "line-clamp-2 text-lg font-semibold leading-tight text-accent",
}) {
  const title = item?.Title || item?.title || "Untitled media";
  const selectedClassName = selected
    ? "border-accent ring-1 ring-accent/30"
    : "border-line";

  return (
    <article
      className={`relative flex min-w-0 gap-5 rounded-xl border bg-panel p-5 ${selectedClassName} ${className}`}
    >
      {selectControl}
      <MediaPoster
        item={item}
        className={posterClassName}
        iconSize={posterIconSize}
      />
      <div className={contentClassName}>
        {titleAside ? (
          <div className="flex min-w-0 items-start justify-between gap-2">
            <h3 className={titleClassName}>{title}</h3>
            {titleAside}
          </div>
        ) : (
          <h3 className={titleClassName}>{title}</h3>
        )}
        {subtitle}
        {showMeta ? (
          <MediaMeta
            item={item}
            className={metaClassName}
            showArrId={showArrId}
          />
        ) : null}
        {showQualification ? <QualificationPopover item={item} /> : null}
        {children}
        {actions ? <div className={actionsClassName}>{actions}</div> : null}
      </div>
      {aside}
    </article>
  );
}
