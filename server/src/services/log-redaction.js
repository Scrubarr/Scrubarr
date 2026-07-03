const SECRET_KEY_PATTERN = /(api.?key|token|password|secret|authorization|cookie)/i;
const SECRET_TEXT_PATTERN =
  /(api.?key|token|password|secret|authorization|cookie)(["']?\s*[:=]\s*)["']?[^"',\s}&]+/gi;
const SECRET_QUERY_PATTERN =
  /([?&](?:api.?key|token|password|secret|authorization|cookie)=)[^&\s]+/gi;

export function safeMessage(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function redactText(value) {
  return String(value ?? "")
    .replace(SECRET_TEXT_PATTERN, "$1$2[REDACTED]")
    .replace(SECRET_QUERY_PATTERN, "$1[REDACTED]");
}

export function redactValue(key, value) {
  if (SECRET_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redactValue(key, item));
  if (value instanceof Error) return redactText(safeMessage(value));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childKey, childValue),
      ]),
    );
  }
  if (typeof value === "string") return redactText(value);
  return value;
}

export function redactAppLogEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return redactText(entry);
  }

  const { message = "", ...meta } = entry;
  return {
    ...redactValue("meta", meta),
    message: redactText(safeMessage(message)),
  };
}

export function redactAppLogLine(rawLine) {
  try {
    return JSON.stringify(redactAppLogEntry(JSON.parse(rawLine)));
  } catch {
    return redactText(rawLine);
  }
}
