const DEFAULT_TIMEOUT_MS = 10000;

function safeText(value) {
  return String(value || "")
    .replace(/bot[0-9]+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .trim();
}

function messageFor({ service, operation, status, detail }) {
  const action = operation ? ` ${operation}` : "";
  if (status) {
    return `${service}${action} failed: HTTP ${status}${detail ? ` ${detail}` : ""}`;
  }
  return `${service}${action} failed${detail ? `: ${detail}` : ""}`;
}

function httpDetail(status, statusText) {
  if (status === 401 || status === 403) {
    return "authentication failed; check the API key, token, or permissions";
  }
  if (status === 404) {
    return "not found; the item or endpoint may no longer exist";
  }
  if (status === 408 || status === 504) {
    return "request timed out";
  }
  if (status === 429) {
    return "rate limited; try again later";
  }
  if (status >= 500) {
    return "service is unavailable or returned a server error";
  }
  return safeText(statusText);
}

function networkDetail(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return "request timed out";
  }
  if (error?.cause?.code) {
    return `connection failed (${safeText(error.cause.code)})`;
  }
  return safeText(error?.message) || "connection failed";
}

export class ExternalServiceError extends Error {
  constructor({
    service,
    operation,
    status = null,
    detail = "",
    cause,
  } = {}) {
    const safeService = service || "External service";
    const safeOperation = operation || "";
    const safeDetail = safeText(detail);
    super(messageFor({
      service: safeService,
      operation: safeOperation,
      status,
      detail: safeDetail,
    }), { cause });
    this.name = "ExternalServiceError";
    this.service = safeService;
    this.operation = safeOperation;
    this.status = status;
    this.safeDetail = safeDetail;
  }
}

export async function fetchExternal({
  service,
  operation,
  url,
  options = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ExternalServiceError({
      service,
      operation,
      detail: networkDetail(error),
      cause: error,
    });
  }

  if (!response.ok) {
    throw new ExternalServiceError({
      service,
      operation,
      status: response.status,
      detail: httpDetail(response.status, response.statusText),
    });
  }

  return response;
}

export function externalServiceFailure({
  service,
  operation,
  detail,
  status = null,
  cause,
} = {}) {
  return new ExternalServiceError({ service, operation, detail, status, cause });
}
