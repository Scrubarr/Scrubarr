function normalizePaths(paths) {
  return Array.isArray(paths) ? paths : [paths];
}

function matchesPath(message, path) {
  const text = String(message || "");
  return (
    text === path ||
    text.startsWith(`${path} `) ||
    text.startsWith(`${path}.`) ||
    text.startsWith(`${path}[`)
  );
}

export function validationDetails(error) {
  return Array.isArray(error?.details) ? error.details.map(String) : [];
}

export function validationMessageFor(errors, paths) {
  const candidates = normalizePaths(paths).filter(Boolean);
  if (candidates.length === 0) return "";
  return (errors || []).find((error) =>
    candidates.some((path) => matchesPath(error, path)),
  ) || "";
}

export function clearValidationForPath(errors, path) {
  return (errors || []).filter((error) => !matchesPath(error, path));
}
