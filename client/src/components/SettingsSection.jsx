import {
  LoaderCircle,
  Unplug,
} from "lucide-react";
import { requestJson } from "../lib/api.js";

export function SettingsSection({
  id,
  title,
  description,
  action,
  logo,
  icon,
  children,
}) {
  return (
    <section id={id} className="rounded-xl border border-line bg-panel">
      <div className="border-b border-line p-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {logo && (
              <img
                src={logo}
                alt=""
                className="h-5 w-5 shrink-0"
                aria-hidden="true"
              />
            )}
            {!logo && icon && (
              <span className="text-accent" aria-hidden="true">
                {icon}
              </span>
            )}
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-neutral-400">{description}</p>}
          {action && <div className="mt-4 min-w-0">{action}</div>}
        </div>
      </div>
      <div className="grid min-w-0 gap-4 p-5 md:grid-cols-2">{children}</div>
    </section>
  );
}

export function ConnectionTestResult({ result, compact = false }) {
  if (!result?.message) return null;

  const isSuccess = result.state === "success";
  const isError = result.state === "error";
  const label = isSuccess ? "Success!" : isError ? "Failed" : "Testing...";
  const pillClass = isSuccess
    ? "bg-emerald-600 text-white"
    : isError
      ? "bg-red-600 text-white"
      : "bg-neutral-700 text-white";
  const detailClass = isSuccess
    ? "text-emerald-300"
    : isError
      ? "text-red-300"
      : "text-neutral-400";
  const detailWidthClass = compact ? "w-[149px]" : "w-56 sm:w-72";

  return (
    <div className="min-w-0 max-w-full sm:max-w-72">
      <span
        className={`inline-flex cursor-default items-center rounded-lg px-3 py-2 text-sm font-semibold ${pillClass}`}
        aria-live="polite"
      >
        {label}
      </span>
      {result.message !== "Testing..." && (
        <p
          className={`mt-1 max-w-full break-words text-xs leading-5 ${detailWidthClass} ${detailClass}`}
          title={result.message}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}

export function ServiceTestButton({
  service,
  settings,
  result,
  setResult,
  onSuccess,
}) {
  async function test() {
    setResult({ state: "loading", message: "Testing..." });
    try {
      const data = await requestJson(`/api/settings/test/${service}`, {
        method: "POST",
        body: JSON.stringify(settings),
      });
      setResult({
        state: "success",
        message: `${data.name}${data.version ? ` ${data.version}` : ""}`,
      });
      onSuccess?.(data);
    } catch (error) {
      setResult({ state: "error", message: error.message });
    }
  }

  return (
    <div className="flex max-w-full flex-col items-start gap-2">
      <button
        type="button"
        onClick={test}
        disabled={result?.state === "loading"}
        className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
      >
        {result?.state === "loading" ? (
          <LoaderCircle className="animate-spin" size={16} />
        ) : (
          <Unplug size={16} />
        )}
        Test connection
      </button>
      <ConnectionTestResult result={result} compact />
    </div>
  );
}
