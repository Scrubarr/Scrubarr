import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export default function AnchoredTooltip({
  trigger,
  children,
  className = "",
  panelClassName = "",
  width = 288,
}) {
  const anchorRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const positionPanel = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || !open) return;

    const margin = 12;
    const gap = 8;
    const rect = anchor.getBoundingClientRect();

    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      close();
      return;
    }

    const panelWidth = Math.min(width, window.innerWidth - margin * 2);
    const measuredHeight = panelRef.current?.offsetHeight || 120;
    const left = clamp(
      rect.left + rect.width / 2 - panelWidth / 2,
      margin,
      window.innerWidth - panelWidth - margin,
    );

    let top = rect.bottom + gap;
    let maxHeight = window.innerHeight - top - margin;

    if (maxHeight < 96 && rect.top > window.innerHeight / 2) {
      maxHeight = rect.top - margin - gap;
      top = Math.max(margin, rect.top - Math.min(measuredHeight, maxHeight) - gap);
    }

    setStyle({
      left,
      top,
      width: panelWidth,
      maxHeight: Math.max(96, maxHeight),
    });
  }, [close, open, width]);

  useLayoutEffect(() => {
    positionPanel();
  }, [positionPanel]);

  useEffect(() => {
    if (!open) return undefined;

    const handleOutsidePointer = (event) => {
      if (!anchorRef.current?.contains(event.target)) close();
    };

    document.addEventListener("pointerdown", handleOutsidePointer);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", close, true);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", close, true);
    };
  }, [close, open, positionPanel]);

  return (
    <span
      ref={anchorRef}
      className={`relative inline-flex ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        setOpen(true);
      }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {trigger}
      <span
        ref={panelRef}
        role="tooltip"
        className={`pointer-events-none fixed z-50 overflow-auto shadow-2xl ${
          open ? "block" : "hidden"
        } ${panelClassName}`}
        style={style || undefined}
      >
        {children}
      </span>
    </span>
  );
}
