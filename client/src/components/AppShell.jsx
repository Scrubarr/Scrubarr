import { createElement, useEffect, useState } from "react";
import {
  CalendarClock,
  FileText,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import GlobalSearch from "./GlobalSearch.jsx";
import spongeGoogle from "../assets/sponge-google.png";
import { requestJson } from "../lib/api.js";
import { mediaServerFromStatus } from "../lib/mediaServerState.js";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/safety", label: "Safety", icon: ShieldAlert },
  { to: "/cleanup", label: "Cleanup Rules", icon: SlidersHorizontal },
  { to: "/exclusions", label: "Exclusions", icon: ShieldCheck },
  { to: "/scheduler", label: "Scheduler", icon: CalendarClock },
  { to: "/logs", label: "Logs", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Navigation({ onNavigate }) {
  return (
    <nav className="mt-3 space-y-1 px-3">
      {links.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            [
              "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
              isActive
                ? "bg-accent text-neutral-950"
                : "text-neutral-300 hover:bg-white/5 hover:text-white",
            ].join(" ")
          }
        >
          {createElement(icon, { size: 19 })}
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function scrollToUpdatesSection() {
  const scroll = () => {
    document.getElementById("updates")?.scrollIntoView({ block: "start" });
  };

  window.requestAnimationFrame(() => window.requestAnimationFrame(scroll));
  window.setTimeout(scroll, 150);
}

export default function AppShell({ children }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState({
    scheduled: false,
    debug: false,
    updateAvailable: false,
    latestVersion: null,
    mediaServer: {
      selected: false,
      configured: false,
      label: "Media server",
    },
  });

  useEffect(() => {
    let active = true;

    function loadSchedulerStatus() {
      requestJson("/api/health/status")
        .then((status) => {
          if (active) {
            const mediaServer = mediaServerFromStatus(status);
            setStatus({
              scheduled: status.capabilities?.scheduling === true,
              debug: status.capabilities?.debugLogging === true,
              updateAvailable: status.updates?.updateAvailable === true,
              latestVersion: status.updates?.latestVersion || null,
              mediaServer,
            });
          }
        })
        .catch(() => {
          if (active) {
            setStatus({
              scheduled: false,
              debug: false,
              updateAvailable: false,
              latestVersion: null,
              mediaServer: {
                selected: false,
                configured: false,
                label: "Media server",
              },
            });
          }
        });
    }

    loadSchedulerStatus();
    const interval = window.setInterval(loadSchedulerStatus, 30_000);
    window.addEventListener("scrubarr:schedule-changed", loadSchedulerStatus);
    window.addEventListener("scrubarr:settings-changed", loadSchedulerStatus);
    window.addEventListener("scrubarr:update-checked", loadSchedulerStatus);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener(
        "scrubarr:schedule-changed",
        loadSchedulerStatus,
      );
      window.removeEventListener(
        "scrubarr:settings-changed",
        loadSchedulerStatus,
      );
      window.removeEventListener(
        "scrubarr:update-checked",
        loadSchedulerStatus,
      );
    };
  }, []);

  useEffect(() => {
    if (location.pathname === "/settings" && location.hash === "#updates") {
      scrollToUpdatesSection();
    }
  }, [location.pathname, location.hash]);

  function openUpdates() {
    navigate("/settings#updates");
    if (location.pathname === "/settings") {
      scrollToUpdatesSection();
    }
  }

  return (
    <div className="min-h-screen bg-canvas text-neutral-100">
      <aside className="desktop-sidebar fixed inset-y-0 left-0 z-30 w-72 border-r border-line bg-panel">
        <Brand providerLabel={status.mediaServer.selected ? status.mediaServer.label : null} />
        <Navigation />
      </aside>

      {open && (
        <div className="mobile-navigation fixed inset-0 z-40">
          <button
            className="absolute inset-0 bg-black/70"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          />
          <aside className="relative h-full w-80 max-w-[90vw] border-r border-line bg-panel shadow-2xl">
            <button
              className="absolute right-3 top-3 rounded-md p-2 text-neutral-400 hover:text-white"
              aria-label="Close navigation"
              onClick={() => setOpen(false)}
            >
              <X size={22} />
            </button>
            <Brand providerLabel={status.mediaServer.selected ? status.mediaServer.label : null} />
            <Navigation onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="desktop-content">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/95 px-3 backdrop-blur sm:px-6">
          <button
            className="mobile-menu-button shrink-0 rounded-md p-2 text-neutral-300 hover:bg-white/5"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            <Menu size={23} />
          </button>
          <div className="flex min-w-0 flex-1 justify-center">
            <GlobalSearch mediaServer={status.mediaServer} />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-neutral-400">
            <div className="flex items-center justify-end gap-2">
              <div
                className="flex items-center gap-2 whitespace-nowrap"
                role="status"
                aria-label={
                  status.scheduled
                    ? "Scrubarr scheduled runs are enabled"
                    : "Scrubarr scheduled runs are disabled"
                }
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    status.scheduled ? "bg-emerald-400" : "bg-red-400"
                  }`}
                />
                <span className="hidden sm:inline">
                  {status.scheduled ? "Scheduled" : "Not scheduled"}
                </span>
              </div>
              {status.updateAvailable && (
                <button
                  type="button"
                  onClick={openUpdates}
                  className="hidden items-center gap-2 whitespace-nowrap rounded-full border border-accent/60 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/20 focus:outline-none sm:inline-flex"
                  aria-label={
                    status.latestVersion
                      ? `Scrubarr update ${status.latestVersion} is available`
                      : "A Scrubarr update is available"
                  }
                >
                  <span className="update-status-dot h-2 w-2 rounded-full bg-emerald-400" />
                  <span>New Update!</span>
                </button>
              )}
            </div>
            {status.debug && (
              <div
                className="hidden items-center gap-2 text-emerald-300 sm:flex"
                role="status"
                aria-label="Debug logging is enabled"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="hidden sm:inline">Debug: On</span>
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function Brand({ providerLabel }) {
  const subtitle = providerLabel
    ? `Scrub Your ${providerLabel} Libraries Clean`
    : "Scrub Your Media Libraries Clean";

  return (
    <div className="flex h-32 flex-col justify-center px-6">
      <div className="flex items-center gap-4">
        <div
          className="grid h-14 w-16 shrink-0 place-items-center"
          role="img"
          aria-label="Sponge"
        >
          <img
            src={spongeGoogle}
            alt=""
            className="h-full w-full object-contain"
          />
        </div>
        <div className="brand-title-outline whitespace-nowrap text-4xl font-extrabold tracking-tight">
          Scrubarr
        </div>
      </div>
      <div className="mt-2 text-center text-sm leading-5 text-neutral-300">
        {subtitle}
      </div>
    </div>
  );
}
