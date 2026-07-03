import { useEffect, useMemo, useState } from "react";
import {
  LoaderCircle,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import ConfirmMediaDetail from "../components/ConfirmMediaDetail.jsx";
import MediaCard from "../components/MediaCard.jsx";
import StatePanel from "../components/StatePanel.jsx";
import { requestJson } from "../lib/api.js";

export default function Exclusions() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [term, setTerm] = useState("");
  const [busyItem, setBusyItem] = useState("");
  const [notice, setNotice] = useState("");
  const [removeConfirm, setRemoveConfirm] = useState(null);

  async function loadExclusions() {
    try {
      setError("");
      setItems(await requestJson("/api/exclusions"));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadExclusions();
    window.addEventListener("scrubarr:data-changed", loadExclusions);
    return () =>
      window.removeEventListener("scrubarr:data-changed", loadExclusions);
  }, []);

  const filteredItems = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => {
      const searchable = [
        item.Title,
        item.Type,
        item.Year,
        item.Arr,
        item.ArrId,
        item.Path,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [items, term]);

  function clearSearch() {
    setTerm("");
    setNotice("");
  }

  async function removeExclusion(item) {
    setRemoveConfirm(null);
    setBusyItem(item.ItemId);
    setNotice("");
    try {
      const exclusionItemId = item.ExclusionItemId || item.ItemId;
      await requestJson(
        `/api/exclusions/${encodeURIComponent(exclusionItemId)}`,
        {
          method: "DELETE",
        },
      );
      setItems((current) =>
        current.filter((candidate) => candidate.ItemId !== exclusionItemId),
      );
      setNotice(`${item.Title} was removed from exclusions.`);
    } catch (requestError) {
      setNotice(requestError.message);
    } finally {
      setBusyItem("");
    }
  }

  return (
    <div className="space-y-8">
      <ConfirmDialog
        open={Boolean(removeConfirm)}
        icon={<Trash2 size={22} />}
        title="Remove exclusion?"
        message="Scrubarr will stop protecting this item. It may appear in cleanup results again if it matches the saved rules."
        tone="danger"
        confirmLabel="Remove exclusion"
        onCancel={() => setRemoveConfirm(null)}
        onConfirm={() => removeExclusion(removeConfirm)}
        detail={<ConfirmMediaDetail item={removeConfirm} />}
      />

      <section>
        <p className="text-sm font-medium text-accent">Protected media</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Exclusions</h1>
        <p className="mt-2 max-w-3xl text-neutral-400">
          Keep selected movies and shows out of Scrubarr cleanup results.
        </p>
      </section>

      <section className="rounded-xl border border-line bg-panel p-5">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="relative flex-1">
            <span className="sr-only">Search exclusions</span>
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
              size={18}
            />
            <input
              className="w-full rounded-lg border border-line bg-canvas py-3 pl-10 pr-3 text-sm outline-none focus:border-accent"
              placeholder="Search current exclusions"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </label>
          {term && (
            <button
              type="button"
              onClick={clearSearch}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-5 py-3 text-sm font-semibold text-neutral-300 hover:border-neutral-500 hover:text-white"
            >
              Clear
            </button>
          )}
        </form>
        {term && (
          <p className="mt-3 text-sm text-neutral-400">
            Showing {filteredItems.length} of {items.length} protected item
            {items.length === 1 ? "" : "s"}.
          </p>
        )}
      </section>

      {notice && (
        <StatePanel tone={notice.includes("failed") ? "error" : "neutral"}>
          {notice}
        </StatePanel>
      )}

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-accent" size={21} />
              <h2 className="text-xl font-semibold">Current exclusions</h2>
            </div>
            <p className="text-sm text-neutral-400">
              {items.length} protected item{items.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {error ? (
          <StatePanel tone="error">{error}</StatePanel>
        ) : loading ? (
          <StatePanel>Loading exclusions...</StatePanel>
        ) : items.length === 0 ? (
          <StatePanel>No exclusions have been added.</StatePanel>
        ) : filteredItems.length === 0 ? (
          <StatePanel>No current exclusions match that search.</StatePanel>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <MediaCard
                key={item.ItemId || `${item.Type}-${item.Title}`}
                item={item}
                posterClassName="grid h-36 w-24 shrink-0 place-items-center overflow-hidden rounded-xl bg-canvas text-neutral-600 sm:h-40 sm:w-28"
                showArrId
                showQualification
                actionsClassName="mt-5"
                actions={
                  <button
                    type="button"
                    onClick={() => setRemoveConfirm(item)}
                    disabled={busyItem === item.ItemId}
                    aria-label={`Remove ${item.Title}`}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-neutral-300 hover:border-red-900 hover:text-red-300 disabled:opacity-50"
                  >
                    {busyItem === item.ItemId ? (
                      <LoaderCircle className="animate-spin" size={18} />
                    ) : (
                      <Trash2 size={18} />
                    )}
                    Remove
                  </button>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
