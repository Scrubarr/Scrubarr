import { APP_VERSION } from "../config/version.js";
import { fetchExternal } from "./external-error.js";
import {
  assertTrustedManifest,
  assertTrustedManifestUrl,
} from "./update-manifest-security.js";

const MAX_UPDATE_MANIFEST_BYTES = 64 * 1024;

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error("Versions must use major.minor.patch format");

  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function getCurrentVersion() {
  return APP_VERSION;
}

export async function checkForUpdates(
  manifestUrl,
  {
    allowedManifestUrls,
    trustedKeys,
    requireSignature = true,
    fetchImpl,
  } = {},
) {
  if (!manifestUrl) {
    return {
      configured: false,
      currentVersion: APP_VERSION,
      message: "No update source is configured yet.",
    };
  }

  const trustedManifestUrl = assertTrustedManifestUrl(
    manifestUrl,
    allowedManifestUrls,
  );

  const response = await fetchExternal({
    service: "Update source",
    operation: "check for updates",
    url: trustedManifestUrl,
    timeoutMs: 8000,
    fetchImpl,
    options: {
      headers: { Accept: "application/json" },
    },
  });

  const manifestText = await response.text();
  if (manifestText.length > MAX_UPDATE_MANIFEST_BYTES) {
    throw new Error("Update manifest is too large.");
  }

  let rawManifest;
  try {
    rawManifest = JSON.parse(manifestText);
  } catch {
    throw new Error("Update manifest is invalid JSON.");
  }

  const manifest = assertTrustedManifest(rawManifest, {
    trustedKeys,
    requireSignature,
  });
  if (!parseVersion(manifest.version)) {
    throw new Error("Update manifest has an invalid version");
  }

  return {
    configured: true,
    currentVersion: APP_VERSION,
    latestVersion: manifest.version,
    updateAvailable: compareVersions(manifest.version, APP_VERSION) > 0,
    releaseUrl: typeof manifest.releaseUrl === "string" ? manifest.releaseUrl : null,
    notes: typeof manifest.notes === "string" ? manifest.notes : null,
  };
}
