export async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data.details?.join?.(". ") ||
      data.message ||
      data.error ||
      `Request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = Array.isArray(data.details) ? data.details : [];
    error.payload = data;
    throw error;
  }
  return data;
}
