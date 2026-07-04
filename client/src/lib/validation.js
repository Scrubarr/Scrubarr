function normalizePaths(paths) {
  return Array.isArray(paths) ? paths : [paths];
}

function matchesPath(message, path) {
  const text = String(message || "");
  return (
    text === path ||
    text.startsWith(`${path}:`) ||
    text.startsWith(`${path} `) ||
    text.startsWith(`${path}.`) ||
    text.startsWith(`${path}[`)
  );
}

function displayMessageForPath(message, path) {
  const text = String(message || "");
  const prefix = `${path}:`;
  return text.startsWith(prefix) ? text.slice(prefix.length).trim() : text;
}

export function displayValidationMessage(message) {
  return String(message || "").replace(
    /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*:\s*/,
    "",
  );
}

export function validationDetails(error) {
  return Array.isArray(error?.details) ? error.details.map(String) : [];
}

export function validationSummaryFor(error) {
  const details = validationDetails(error);
  if (details.length > 0) {
    return details.map(displayValidationMessage).join(". ");
  }
  return error?.message || "Validation failed";
}

export function validationMessageFor(errors, paths) {
  const candidates = normalizePaths(paths).filter(Boolean);
  if (candidates.length === 0) return "";
  for (const error of errors || []) {
    const matchedPath = candidates.find((path) => matchesPath(error, path));
    if (matchedPath) return displayMessageForPath(error, matchedPath);
  }
  return "";
}

export function clearValidationForPath(errors, path) {
  return (errors || []).filter((error) => !matchesPath(error, path));
}
