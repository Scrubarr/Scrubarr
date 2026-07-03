import { CircleAlert } from "lucide-react";
import { createPortal } from "react-dom";

export default function ConfirmDialog({
  open,
  icon,
  title,
  message,
  detail,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "accent",
  busy = false,
  showConfirm = true,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  const confirmClass =
    tone === "danger"
      ? "bg-red-500 text-white hover:bg-red-400"
      : "bg-accent text-neutral-950 hover:bg-yellow-300";
  const iconClass =
    tone === "danger"
      ? "bg-red-500/15 text-red-300"
      : "bg-accent/15 text-accent";

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-6 backdrop-blur-sm sm:items-center">
      <div className="max-h-[calc(100vh-3rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-panel p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${iconClass}`}>
            {icon || <CircleAlert size={22} />}
          </div>
          <div>
            <h3 className="text-xl font-semibold">{title}</h3>
            {message && (
              <p className="mt-2 text-sm leading-6 text-neutral-400">
                {message}
              </p>
            )}
          </div>
        </div>

        {detail && (
          <div className="mt-5 rounded-xl border border-line bg-canvas/60 p-4">
            {detail}
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          {showConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${confirmClass}`}
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
