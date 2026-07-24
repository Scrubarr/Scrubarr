import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_UPDATE_KEY_ID,
  SCRUBARR_DOCKER_IMAGE,
  assertTrustedManifest,
  manifestSigningPayload,
} from "../server/src/services/update-manifest-security.js";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function requireArg(name, fallback = "") {
  const value = argValue(name, fallback).trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

const manifestPath = path.resolve(
  argValue("--manifest", "release-manifest.example.json"),
);
const privateKeyPath = path.resolve(
  requireArg("--key", process.env.SCRUBARR_UPDATE_PRIVATE_KEY_FILE || ""),
);
const outputPath = path.resolve(argValue("--out", manifestPath));
const keyId = argValue("--key-id", DEFAULT_UPDATE_KEY_ID);
const imageDigest = argValue("--digest", "").trim();

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (imageDigest) {
  const digest = imageDigest.startsWith("sha256:")
    ? imageDigest
    : `sha256:${imageDigest}`;
  manifest.dockerImageDigest = `${SCRUBARR_DOCKER_IMAGE}@${digest}`;
}
if (!manifest.dockerImageDigest) {
  throw new Error(
    "Missing Docker image digest. Pass --digest sha256:<64-hex-digest> after the image has been published.",
  );
}
assertTrustedManifest(manifest, { requireSignature: false });
const privateKey = await fs.readFile(privateKeyPath, "utf8");

const payload = manifestSigningPayload(manifest);
const signature = crypto.sign(null, Buffer.from(payload, "utf8"), privateKey);

const signedManifest = {
  ...manifest,
  signature: {
    algorithm: "ed25519",
    keyId,
    value: signature.toString("base64"),
  },
};

await fs.writeFile(outputPath, `${JSON.stringify(signedManifest, null, 2)}\n`, "utf8");

console.log(`Signed manifest: ${outputPath}`);
console.log(`Key ID: ${keyId}`);
console.log(`Docker image digest: ${manifest.dockerImageDigest}`);
