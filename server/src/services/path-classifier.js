import path from "node:path";

export function isBlankPath(value) {
  return String(value || "").trim().length === 0;
}

export function classifyPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false, kind: "blank", message: "Path is blank." };

  if (/^[A-Za-z]:[\\/]/.test(raw) || /^\\\\[^\\]+\\[^\\]+/.test(raw)) {
    const normalized = path.win32.normalize(raw);
    return {
      ok: true,
      kind: "win32",
      family: "windows",
      api: path.win32,
      normalized,
      comparable: normalized.toLowerCase(),
    };
  }

  if (raw.startsWith("/")) {
    const normalized = path.posix.normalize(raw);
    return {
      ok: true,
      kind: "posix",
      family: "posix",
      api: path.posix,
      normalized,
      comparable: normalized,
    };
  }

  return { ok: false, kind: "relative", message: "Path must be absolute." };
}

export function runtimeSupportsPathKind(kind, platform = process.platform) {
  if (kind === "win32") return platform === "win32";
  if (kind === "posix") return platform !== "win32";
  return false;
}

export function filesystemRootOf(classified) {
  if (!classified?.ok) return "";
  return classified.api.parse(classified.normalized).root;
}

export function isFilesystemRoot(classified) {
  if (!classified?.ok) return false;
  return classified.comparable === filesystemRootOf(classified).toLowerCase();
}

export function isInsideClassifiedRoot(target, root) {
  if (!target?.ok || !root?.ok || target.kind !== root.kind) return false;
  if (target.comparable === root.comparable) return false;
  const relative = target.api.relative(root.comparable, target.comparable);
  return Boolean(relative) && !relative.startsWith("..") && !target.api.isAbsolute(relative);
}

export function mediaRootOf(value) {
  const classified = classifyPath(value);
  if (!classified.ok) return null;

  if (classified.kind === "win32") {
    const parsed = path.win32.parse(classified.normalized);
    const root = parsed.root.replace(/[\\/]$/, "");
    return { value: root, type: "windows", kind: classified.kind };
  }

  const parts = classified.normalized.split("/").filter(Boolean);
  return {
    value: parts.length > 0 ? `/${parts[0]}` : "/",
    type: "posix",
    kind: classified.kind,
  };
}

export function parentPathCandidates(value, maxDepth = 8) {
  const classified = classifyPath(value);
  if (!classified.ok) return [];

  const candidates = [];
  let current = classified.normalized;
  for (
    let index = 0;
    index < maxDepth && current && current !== classified.api.dirname(current);
    index += 1
  ) {
    candidates.push(current);
    current = classified.api.dirname(current);
  }
  candidates.push(current);
  return [...new Set(candidates.filter(Boolean))];
}
