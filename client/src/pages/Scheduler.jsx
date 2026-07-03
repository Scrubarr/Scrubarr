import { useEffect, useState } from "react";
import {
  CalendarClock,
  Clock3,
  LoaderCircle,
  Save,
} from "lucide-react";
import { SelectInput } from "../components/FormControls.jsx";
import StatePanel from "../components/StatePanel.jsx";
import { requestJson } from "../lib/api.js";
import { inputClass } from "../lib/formClasses.js";
import { mediaServerFromStatus } from "../lib/mediaServerState.js";

const weekdays = [
  ["Sun", 0],
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6],
];

function displayDate(value, timezone) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function SummaryCard({ icon, label, value, detail }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-5">
      <div className="flex items-center gap-2 text-sm text-neutral-400">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
      {detail && <p className="mt-1 text-xs text-neutral-400">{detail}</p>}
    </div>
  );
}

export default function Scheduler() {
  const [status, setStatus] = useState(null);
  const [runtimeStatus, setRuntimeStatus] = useState(null);
  const [mediaServerProbe, setMediaServerProbe] = useState(null);
  const [config, setConfig] = useState(null);
  const [state, setState] = useState({ state: "loading", message: "" });

  async function load() {
    try {
      const [data, health, probe] = await Promise.all([
        requestJson("/api/scheduler"),
        requestJson("/api/health/status"),
        requestJson("/api/dashboard/stats").then(
          () => ({ ok: true, message: "" }),
          (requestError) => ({ ok: false, message: requestError.message }),
        ),
      ]);
      setStatus(data);
      setRuntimeStatus(health);
      setMediaServerProbe(probe);
      setConfig(data.config);
      setState({ state: "idle", message: "" });
    } catch (error) {
      setState({ state: "error", message: error.message });
    }
  }

  useEffect(() => {
    load();
  }, []);

  function toggleDay(day) {
    setConfig((current) => ({
      ...current,
      daysOfWeek: current.daysOfWeek.includes(day)
        ? current.daysOfWeek.filter((value) => value !== day)
        : [...current.daysOfWeek, day].sort(),
    }));
  }

  async function save(event) {
    event.preventDefault();
    setState({ state: "loading", message: "Saving schedule..." });
    try {
      const data = await requestJson("/api/scheduler", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      setStatus(data);
      setConfig(data.config);
      setState({ state: "success", message: "Schedule saved." });
      window.dispatchEvent(new Event("scrubarr:schedule-changed"));
    } catch (error) {
      setState({ state: "error", message: error.message });
    }
  }

  if (state.state === "error" && !config) {
    return <StatePanel tone="error">{state.message}</StatePanel>;
  }
  if (!config || !status || !runtimeStatus) return <StatePanel>Loading scheduler...</StatePanel>;

  const lastRun = status.lastRun;
  const mediaServer = mediaServerFromStatus(runtimeStatus);
  const schedulerSetupMessage = !mediaServer.selected
    ? "Choose Emby or Jellyfin in Settings before scheduled runs can scan or manage media."
    : !mediaServer.configured
      ? `Finish ${mediaServer.label} setup before scheduled runs can scan or manage media.`
      : mediaServerProbe?.ok === false
        ? `${mediaServer.label} is currently unavailable. Check the ${mediaServer.label} server URL, API key, and network access before relying on scheduled runs.`
      : "";
  const lastRunDetail = lastRun
    ? lastRun.status === "success"
      ? Number(lastRun.queued || 0) > 0
        ? `${lastRun.queued} queued from ${lastRun.candidates} candidates`
        : `${lastRun.candidates} candidates found`
      : "Run failed"
    : "No scheduler run recorded";

  return (
    <form className="space-y-6" onSubmit={save}>
      <section>
        <p className="text-sm font-medium text-accent">Automation</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Scheduler</h1>
        <p className="mt-2 max-w-3xl text-neutral-400">
          Choose when Scrubarr scans libraries, queues eligible media, syncs
          the media server, and checks pending deletions.
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          icon={
            <span
              className={`h-2 w-2 rounded-full ${
                config.enabled ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
          }
          label="Status"
          value={config.enabled ? "Scheduled" : "Not scheduled"}
          detail={
            config.enabled
              ? "Scrubarr is scheduled to run."
              : "Scrubarr is not scheduled to run."
          }
        />
        <SummaryCard
          icon={<CalendarClock size={16} />}
          label="Next run"
          value={displayDate(status.nextRun, status.timezone)}
          detail={status.timezone}
        />
        <SummaryCard
          icon={<Clock3 size={16} />}
          label="Last run"
          value={displayDate(lastRun?.completedAt, status.timezone)}
          detail={lastRunDetail}
        />
      </div>

      {schedulerSetupMessage && (
        <StatePanel tone="warning">{schedulerSetupMessage}</StatePanel>
      )}

      <section className="relative z-10 overflow-visible rounded-xl border border-line bg-panel">
        <div className="border-b border-line p-5">
          <div className="flex items-center gap-2">
            <CalendarClock className="text-accent" size={20} />
            <h2 className="text-lg font-semibold">Run schedule</h2>
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            Run times use {status.timezone}.
          </p>
        </div>
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <label className="flex cursor-pointer items-start justify-between gap-5 rounded-lg border border-line bg-canvas/60 p-4 md:col-span-2">
            <span>
              <span className="block text-sm font-medium">Enable scheduled runs</span>
              <span className="mt-1 block text-xs text-neutral-400">
                The scheduler resumes automatically when Scrubarr starts.
              </span>
            </span>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(event) =>
                setConfig({ ...config, enabled: event.target.checked })
              }
              className="mt-1 h-4 w-4 accent-yellow-400"
            />
          </label>

          <label>
            <span className="text-sm font-medium text-neutral-200">Frequency</span>
            <SelectInput
              value={config.frequency}
              onChange={(value) => setConfig({ ...config, frequency: value })}
            >
              <option value="daily">Every day</option>
              <option value="weekly">Selected days</option>
            </SelectInput>
          </label>

          <label>
            <span className="text-sm font-medium text-neutral-200">Run time</span>
            <input
              className={inputClass}
              type="time"
              value={config.time}
              onChange={(event) =>
                setConfig({ ...config, time: event.target.value })
              }
            />
          </label>

          {config.frequency === "weekly" && (
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-medium text-neutral-200">
                Run days
              </legend>
              <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                {weekdays.map(([label, day]) => {
                  const selected = config.daysOfWeek.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`min-h-10 rounded-lg border px-2 text-sm font-medium transition ${
                        selected
                          ? "border-accent bg-accent text-neutral-950"
                          : "border-line bg-canvas text-neutral-400 hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      </section>

      {lastRun?.status === "failed" && (
        <StatePanel tone="error">Last run failed: {lastRun.message}</StatePanel>
      )}

      <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-line bg-panel/95 p-4 shadow-2xl backdrop-blur">
        {state.message && (
          <span
            className={`mr-auto text-sm ${
              state.state === "error" ? "text-red-400" : "text-emerald-400"
            }`}
          >
            {state.message}
          </span>
        )}
        <button
          type="submit"
          disabled={state.state === "loading"}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-neutral-950 hover:bg-yellow-300 disabled:opacity-60"
        >
          {state.state === "loading" ? (
            <LoaderCircle className="animate-spin" size={17} />
          ) : (
            <Save size={17} />
          )}
          Save schedule
        </button>
      </div>
    </form>
  );
}
