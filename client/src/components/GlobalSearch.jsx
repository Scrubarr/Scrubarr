import { useEffect, useRef, useState } from "react";
import {
  CircleCheck,
  CircleX,
  ClipboardCheck,
  LoaderCircle,
  Plus,
  Search,
  ShieldPlus,
  Trash2,
  X,
} from "lucide-react";
import ConfirmDialog from "./ConfirmDialog.jsx";
import ConfirmMediaDetail from "./ConfirmMediaDetail.jsx";
import MediaCard from "./MediaCard.jsx";
import { requestJson } from "../lib/api.js";

function SearchStatePill({ item }) {
  if (item.Pending) {
    return (
      <span className="rounded-full border border-amber-700/50 bg-amber-950/25 px-2 py-0.5 text-xs text-amber-100">
        Pending
      </span>
    );
  }
  if (item.Excluded) {
    return (
      <span className="rounded-full border border-emerald-800/60 bg-emerald-950/40 px-2 py-0.5 text-xs text-emerald-200">
        Excluded
      </span>
    );
  }
  return (
    <span className="rounded-full border border-line bg-canvas/70 px-2 py-0.5 text-xs text-neutral-400">
      Available
    </span>
  );
}

function confirmCopy(confirm) {
  if (!confirm) return {};
  const titles = {
    "add-exclusion": "Add exclusion?",
    "remove-exclusion": "Remove exclusion?",
    "remove-pending": "Remove from pending?",
    "remove-pending-exclude": "Remove and exclude?",
  };
  const messages = {
    "add-exclusion":
      "Scrubarr will protect this item from future cleanup results.",
    "remove-exclusion":
      "Scrubarr will stop protecting this item. It may appear in cleanup results again if it matches the saved rules.",
    "remove-pending":
      "Scrubarr will remove this item from the pending queue. It may appear again in a future scan if it still matches the cleanup rules.",
    "remove-pending-exclude":
      "Scrubarr will remove this item from pending and add it to exclusions.",
  };
  const labels = {
    "add-exclusion": "Add exclusion",
    "remove-exclusion": "Remove exclusion",
    "remove-pending": "Remove",
    "remove-pending-exclude": "Remove + exclude",
  };
  const dangerActions = new Set(["remove-exclusion", "remove-pending"]);
  return {
    title: titles[confirm.action],
    message: messages[confirm.action],
    confirmLabel: labels[confirm.action],
    tone: dangerActions.has(confirm.action) ? "danger" : "accent",
    icon: dangerActions.has(confirm.action)
      ? <Trash2 size={22} />
      : <ShieldPlus size={22} />,
  };
}

function CleanupDecisionDetail({ decision }) {
  if (!decision) return null;
  const Icon = decision.eligible ? CircleCheck : CircleX;
  const toneClass = decision.eligible ? "text-emerald-300" : "text-amber-200";
  const title = decision.eligible
    ? "Would be added to pending"
    : "Would not be added";

  return (
    <div className="space-y-4">
      <ConfirmMediaDetail item={decision.item} />
      <div className="rounded-xl border border-line bg-canvas/60 p-4">
        <div className={`flex items-center gap-2 text-sm font-semibold ${toneClass}`}>
          <Icon size={17} />
          {title}
        </div>
        <p className="mt-2 text-sm leading-6 text-neutral-300">
          {decision.reason}
        </p>
      </div>
    </div>
  );
}

export default function GlobalSearch({ mediaServer }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [state, setState] = useState({ state: "idle", message: "" });
  const [open, setOpen] = useState(false);
  const [busyItem, setBusyItem] = useState("");
  const [decisionBusyItem, setDecisionBusyItem] = useState("");
  const [decision, setDecision] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState({ state: "idle", message: "" });
  const [refreshKey, setRefreshKey] = useState(0);
  const containerRef = useRef(null);
  const searchReady = mediaServer?.selected === true && mediaServer?.configured === true;
  const placeholder = !mediaServer?.selected
    ? "Set up a media server first"
    : !mediaServer?.configured
      ? `Finish ${mediaServer.label || "media server"} setup to search`
      : "Search movies and series";

  useEffect(() => {
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!searchReady) {
      setResults([]);
      setState({ state: "idle", message: "" });
      setOpen(false);
      return undefined;
    }

    const trimmed = term.trim();
    if (!trimmed) {
      setResults([]);
      setState({ state: "idle", message: "" });
      setOpen(false);
      return undefined;
    }

    setOpen(true);
    setNotice({ state: "idle", message: "" });
    if (trimmed.length < 2) {
      setResults([]);
      setState({ state: "idle", message: "Type at least 2 characters." });
      return undefined;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setState({ state: "loading", message: "" });
      try {
        const data = await requestJson(
          `/api/dashboard/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const items = data.items || [];
        setResults(items);
        setState({
          state: "success",
          message:
            items.length > 0
              ? `${items.length} result${items.length === 1 ? "" : "s"}`
              : "No matching media found.",
        });
      } catch (requestError) {
        if (requestError.name === "AbortError") return;
        setResults([]);
        setState({ state: "error", message: requestError.message });
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [term, refreshKey, searchReady]);

  function clearSearch() {
    setTerm("");
    setResults([]);
    setState({ state: "idle", message: "" });
    setNotice({ state: "idle", message: "" });
    setConfirm(null);
    setDecision(null);
    setOpen(false);
  }

  function refreshSearch() {
    window.dispatchEvent(
      new CustomEvent("scrubarr:data-changed", {
        detail: { source: "global-search" },
      }),
    );
    setRefreshKey((value) => value + 1);
  }

  async function confirmAction() {
    const current = confirm;
    if (!current) return;
    const item = current.item;
    setConfirm(null);
    setBusyItem(item.ItemId);
    setNotice({ state: "idle", message: "" });

    try {
      if (current.action === "add-exclusion") {
        await requestJson("/api/exclusions", {
          method: "POST",
          body: JSON.stringify(item),
        });
        setNotice({
          state: "success",
          message: `${item.Title} was added to exclusions.`,
        });
      } else if (current.action === "remove-exclusion") {
        const exclusionItemId = item.ExclusionItemId || item.ItemId;
        await requestJson(
          `/api/exclusions/${encodeURIComponent(exclusionItemId)}`,
          { method: "DELETE" },
        );
        setNotice({
          state: "success",
          message: `${item.Title} was removed from exclusions.`,
        });
      } else {
        const pendingItemId = item.PendingItemId || item.ItemId;
        const exclude = current.action === "remove-pending-exclude";
        await requestJson(
          exclude
            ? `/api/pending/${encodeURIComponent(pendingItemId)}/exclude`
            : `/api/pending/${encodeURIComponent(pendingItemId)}`,
          { method: exclude ? "POST" : "DELETE" },
        );
        setNotice({
          state: "success",
          message: exclude
            ? `${item.Title} was removed from pending and added to exclusions.`
            : `${item.Title} was removed from the pending queue.`,
        });
      }
      refreshSearch();
    } catch (requestError) {
      setNotice({ state: "error", message: requestError.message });
    } finally {
      setBusyItem("");
    }
  }

  async function testCleanupDecision(item) {
    setDecisionBusyItem(item.ItemId);
    setNotice({ state: "idle", message: "" });
    try {
      const data = await requestJson(
        `/api/scans/decision/${encodeURIComponent(item.ItemId)}`,
      );
      setDecision({
        ...data,
        item: {
          ...item,
          ...(data.item || {}),
        },
      });
    } catch (requestError) {
      setNotice({ state: "error", message: requestError.message });
    } finally {
      setDecisionBusyItem("");
    }
  }

  const confirmDetails = confirmCopy(confirm);
  const hasDropdown = open && (state.message || notice.message || results.length > 0);

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <ConfirmDialog
        open={Boolean(confirm)}
        icon={confirmDetails.icon}
        title={confirmDetails.title}
        message={confirmDetails.message}
        tone={confirmDetails.tone}
        confirmLabel={confirmDetails.confirmLabel}
        onCancel={() => setConfirm(null)}
        onConfirm={confirmAction}
        detail={<ConfirmMediaDetail item={confirm?.item} />}
      />
      <ConfirmDialog
        open={Boolean(decision)}
        icon={<ClipboardCheck size={22} />}
        title="Cleanup decision"
        message="Scrubarr tested this title against the current cleanup rules."
        tone={decision?.eligible ? "accent" : "danger"}
        cancelLabel="Close"
        showConfirm={false}
        onCancel={() => setDecision(null)}
        detail={<CleanupDecisionDetail decision={decision} />}
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className="relative block">
          <span className="sr-only">Search media server</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            size={17}
          />
          <input
            className="h-10 w-full rounded-full border border-line bg-panel py-2 pl-10 pr-10 text-sm outline-none transition placeholder:text-neutral-400 focus:border-accent disabled:cursor-not-allowed disabled:opacity-70"
            placeholder={placeholder}
            value={term}
            disabled={!searchReady}
            onFocus={() => {
              if (searchReady && (term || results.length > 0 || state.message || notice.message)) {
                setOpen(true);
              }
            }}
            onChange={(event) => setTerm(event.target.value)}
          />
          {state.state === "loading" ? (
            <LoaderCircle
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-neutral-400"
              size={16}
            />
          ) : (
            term && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-neutral-400 hover:bg-white/5 hover:text-white"
                aria-label="Clear media search"
              >
                <X size={16} />
              </button>
            )
          )}
        </label>
      </form>

      {hasDropdown && (
        <div className="fixed left-2 right-2 top-16 z-50 max-h-[75vh] overflow-y-auto rounded-2xl border border-line bg-canvas p-3 shadow-2xl sm:absolute sm:left-1/2 sm:right-auto sm:top-auto sm:mt-2 sm:w-[calc(100vw-2rem)] sm:max-w-xl sm:-translate-x-1/2">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <div className="space-y-1">
              {state.message && (
                <p
                  className={`text-sm ${
                    state.state === "error" ? "text-red-300" : "text-neutral-400"
                  }`}
                >
                  {state.message}
                </p>
              )}
              {notice.message && (
                <p
                  className={`text-sm ${
                    notice.state === "error" ? "text-red-300" : "text-emerald-300"
                  }`}
                >
                  {notice.message}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full p-1 text-neutral-400 hover:bg-white/5 hover:text-white"
              aria-label="Close media search results"
            >
              <X size={16} />
            </button>
          </div>

          {results.length > 0 && (
            <div className="space-y-2">
              {results.map((item) => (
                <MediaCard
                  key={item.ItemId}
                  item={item}
                  className="gap-3 bg-panel p-2.5"
                  contentClassName="flex min-w-0 min-h-24 flex-1 flex-col"
                  metaClassName="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400"
                  posterClassName="grid h-24 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-panel text-neutral-600"
                  showArrId
                  titleAside={<SearchStatePill item={item} />}
                  titleClassName="line-clamp-2 min-w-0 text-sm font-semibold leading-tight text-accent"
                  actionsClassName="mt-auto flex flex-wrap gap-2 pt-3"
                  actions={
                    <>
                      {item.Pending ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirm({ item, action: "remove-pending" })
                            }
                            disabled={busyItem === item.ItemId}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-neutral-100 hover:border-red-700 hover:text-red-200 disabled:opacity-50"
                          >
                            <Trash2 size={13} />
                            Remove
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setConfirm({
                                item,
                                action: "remove-pending-exclude",
                              })
                            }
                            disabled={busyItem === item.ItemId}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-neutral-100 hover:border-yellow-700 hover:text-accent disabled:opacity-50"
                          >
                            <ShieldPlus size={13} />
                            Remove + exclude
                          </button>
                        </>
                      ) : item.Excluded ? (
                        <button
                          type="button"
                          onClick={() =>
                            setConfirm({ item, action: "remove-exclusion" })
                          }
                          disabled={busyItem === item.ItemId}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-800/80 bg-red-950/30 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-950/50 disabled:opacity-50"
                        >
                          <Trash2 size={13} />
                          Remove exclusion
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => testCleanupDecision(item)}
                            disabled={decisionBusyItem === item.ItemId}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-white hover:border-accent hover:text-accent disabled:opacity-50"
                          >
                            {decisionBusyItem === item.ItemId ? (
                              <LoaderCircle className="animate-spin" size={13} />
                            ) : (
                              <ClipboardCheck size={13} />
                            )}
                            Test cleanup
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirm({ item, action: "add-exclusion" })}
                            disabled={busyItem === item.ItemId}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-medium text-white hover:border-accent hover:text-accent disabled:opacity-50"
                          >
                            <Plus size={13} />
                            Add exclusion
                          </button>
                        </>
                      )}
                      {busyItem === item.ItemId && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
                          <LoaderCircle className="animate-spin" size={13} />
                          Updating
                        </span>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
