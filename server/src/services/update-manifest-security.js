import crypto from "node:crypto";

export const DEFAULT_UPDATE_MANIFEST_URL =
  "https://scrubarr.github.io/updates/stable.json";
export const SCRUBARR_DOCKER_IMAGE = "ghcr.io/scrubarr/scrubarr";
export const SCRUBARR_RELEASE_URL_PREFIX =
  "https://github.com/Scrubarr/Scrubarr/releases/tag/";
export const DEFAULT_UPDATE_KEY_ID = "scrubarr-update-ed25519-2026-06";

const DEFAULT_UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADy0my4RXccP0u6INwspSEz9OZ1LAZZu7zYk+7PH16a8=
-----END PUBLIC KEY-----`;

export const DEFAULT_TRUSTED_UPDATE_KEYS = Object.freeze({
  [DEFAULT_UPDATE_KEY_ID]: DEFAULT_UPDATE_PUBLIC_KEY,
});

const ALLOWED_MANIFEST_KEYS = new Set([
  "version",
  "dockerImage",
  "releaseUrl",
  "notes",
  "signature",
]);
const ALLOWED_SIGNATURE_KEYS = new Set(["algorithm", "keyId", "value"]);
const MAX_VERSION_LENGTH = 32;
const MAX_RELEASE_URL_LENGTH = 500;
const MAX_DOCKER_IMAGE_LENGTH = 200;
const MAX_NOTES_LENGTH = 5000;
const MAX_SIGNATURE_KEY_ID_LENGTH = 128;
const MAX_SIGNATURE_VALUE_LENGTH = 1024;
const VERSION_PATTERN = /^v?\d+\.\d+\.\d+$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNoUnsupportedKeys(value, allowedKeys, context) {
  for (const key of Object.keys(value || {})) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${context} contains an unsupported field.`);
    }
  }
}

function assertString(value, { name, maxLength, required = false, pattern = null } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${name} is required.`);
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed !== value) {
    throw new Error(`${name} must not include leading or trailing spaces.`);
  }
  if (value.length > maxLength) {
    throw new Error(`${name} is too long.`);
  }
  if (pattern && !pattern.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function assertManifestShape(manifest, { requireSignature = true } = {}) {
  if (!isPlainObject(manifest)) {
    throw new Error("Update manifest is invalid.");
  }

  assertNoUnsupportedKeys(manifest, ALLOWED_MANIFEST_KEYS, "Update manifest");
  const version = assertString(manifest.version, {
    name: "Update manifest version",
    maxLength: MAX_VERSION_LENGTH,
    required: true,
    pattern: VERSION_PATTERN,
  });
  assertString(manifest.releaseUrl, {
    name: "Update manifest release URL",
    maxLength: MAX_RELEASE_URL_LENGTH,
  });
  assertString(manifest.dockerImage, {
    name: "Update manifest Docker image",
    maxLength: MAX_DOCKER_IMAGE_LENGTH,
  });
  assertString(manifest.notes, {
    name: "Update manifest notes",
    maxLength: MAX_NOTES_LENGTH,
  });

  if (manifest.signature === undefined || manifest.signature === null) {
    if (requireSignature) {
      throw new Error("Update manifest signature is missing or not trusted.");
    }
    return version;
  }

  if (!isPlainObject(manifest.signature)) {
    throw new Error("Update manifest signature is invalid.");
  }
  assertNoUnsupportedKeys(
    manifest.signature,
    ALLOWED_SIGNATURE_KEYS,
    "Update manifest signature",
  );
  if (manifest.signature.algorithm !== "ed25519") {
    throw new Error("Update manifest signature is invalid.");
  }
  assertString(manifest.signature.keyId, {
    name: "Update manifest signature key",
    maxLength: MAX_SIGNATURE_KEY_ID_LENGTH,
    required: true,
  });
  assertString(manifest.signature.value, {
    name: "Update manifest signature value",
    maxLength: MAX_SIGNATURE_VALUE_LENGTH,
    required: true,
    pattern: /^[A-Za-z0-9+/=]+$/,
  });

  return version;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Manifest contains an invalid number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  throw new Error("Manifest contains an unsupported value");
}

export function manifestSigningPayload(manifest) {
  const { signature: _signature, ...payload } = manifest || {};
  return canonicalJson(payload);
}

function normalizedUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.toString();
  } catch {
    throw new Error("Update source URL is invalid.");
  }
}

export function assertTrustedManifestUrl(
  manifestUrl,
  allowedManifestUrls = [DEFAULT_UPDATE_MANIFEST_URL],
) {
  const normalized = normalizedUrl(manifestUrl);
  const allowed = new Set(allowedManifestUrls.map((url) => normalizedUrl(url)));

  if (!normalized.startsWith("https://")) {
    throw new Error("Update source must use HTTPS.");
  }
  if (!allowed.has(normalized)) {
    throw new Error("Update source is not trusted.");
  }
  return normalized;
}

function assertTrustedReleaseUrl(releaseUrl, version) {
  if (!releaseUrl) return null;

  const normalized = normalizedUrl(releaseUrl);
  const expected = `${SCRUBARR_RELEASE_URL_PREFIX}v${String(version).replace(/^v/, "")}`;
  if (normalized !== expected) {
    throw new Error("Update release URL is not trusted.");
  }
  return normalized;
}

function assertTrustedDockerImage(dockerImage, version) {
  if (!dockerImage) return null;

  const expected = `${SCRUBARR_DOCKER_IMAGE}:v${String(version).replace(/^v/, "")}`;
  if (dockerImage !== expected) {
    throw new Error("Update Docker image is not trusted.");
  }
  return dockerImage;
}

function signatureValue(signature) {
  if (!isPlainObject(signature)) return "";
  if (signature.algorithm !== "ed25519") return "";
  if (typeof signature.value !== "string") return "";
  return signature.value.trim();
}

export function verifyManifestSignature(
  manifest,
  trustedKeys = DEFAULT_TRUSTED_UPDATE_KEYS,
) {
  const signature = manifest?.signature;
  const keyId = isPlainObject(signature) ? signature.keyId : "";
  const publicKey = keyId ? trustedKeys[keyId] : null;
  const value = signatureValue(signature);

  if (!publicKey || !value) {
    throw new Error("Update manifest signature is missing or not trusted.");
  }

  let signatureBuffer;
  try {
    signatureBuffer = Buffer.from(value, "base64");
  } catch {
    throw new Error("Update manifest signature is invalid.");
  }

  const verified = crypto.verify(
    null,
    Buffer.from(manifestSigningPayload(manifest), "utf8"),
    publicKey,
    signatureBuffer,
  );

  if (!verified) {
    throw new Error("Update manifest signature is invalid.");
  }

  return true;
}

export function assertTrustedManifest(
  manifest,
  {
    trustedKeys = DEFAULT_TRUSTED_UPDATE_KEYS,
    requireSignature = true,
  } = {},
) {
  const version = assertManifestShape(manifest, { requireSignature });
  if (requireSignature) {
    verifyManifestSignature(manifest, trustedKeys);
  }

  const releaseUrl = assertTrustedReleaseUrl(manifest.releaseUrl, version);
  const dockerImage = assertTrustedDockerImage(manifest.dockerImage, version);

  return {
    ...manifest,
    version,
    releaseUrl,
    dockerImage,
  };
}
