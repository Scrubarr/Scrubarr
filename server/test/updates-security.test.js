import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { checkForUpdates } from "../src/services/updates.js";
import { manifestSigningPayload } from "../src/services/update-manifest-security.js";

const manifestUrl = "https://scrubarr.github.io/updates/stable.json";

function testKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    keyId: "test-key",
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

function signedManifest(payload, keys = testKeys()) {
  const signature = crypto.sign(
    null,
    Buffer.from(manifestSigningPayload(payload), "utf8"),
    keys.privateKey,
  );

  return {
    ...payload,
    signature: {
      algorithm: "ed25519",
      keyId: keys.keyId,
      value: signature.toString("base64"),
    },
  };
}

function responseFor(manifest) {
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(text) {
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("update checks accept a signed official Scrubarr manifest", async () => {
  const keys = testKeys();
  const manifest = signedManifest(
    {
      version: "1.0.99",
      dockerImage: "ghcr.io/scrubarr/scrubarr:v1.0.99",
      releaseUrl: "https://github.com/Scrubarr/Scrubarr/releases/tag/v1.0.99",
      notes: "Signed test release",
    },
    keys,
  );

  const result = await checkForUpdates(manifestUrl, {
    trustedKeys: { [keys.keyId]: keys.publicKey },
    fetchImpl: async () => responseFor(manifest),
  });

  assert.equal(result.configured, true);
  assert.equal(result.latestVersion, "1.0.99");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.releaseUrl, manifest.releaseUrl);
  assert.equal(result.notes, "Signed test release");
});

test("update checks reject untrusted manifest URLs before fetching", async () => {
  let fetched = false;

  await assert.rejects(
    checkForUpdates("https://evil.example.test/stable.json", {
      fetchImpl: async () => {
        fetched = true;
        return responseFor({});
      },
    }),
    /Update source is not trusted/,
  );

  assert.equal(fetched, false);
});

test("update checks reject unsigned manifests", async () => {
  await assert.rejects(
    checkForUpdates(manifestUrl, {
      fetchImpl: async () =>
        responseFor({
          version: "0.1.99",
          dockerImage: "ghcr.io/scrubarr/scrubarr:v0.1.99",
          releaseUrl: "https://github.com/Scrubarr/Scrubarr/releases/tag/v0.1.99",
          notes: "Unsigned",
        }),
    }),
    /signature is missing/,
  );
});

test("update checks reject tampered signed manifests", async () => {
  const keys = testKeys();
  const manifest = signedManifest(
    {
      version: "0.1.99",
      dockerImage: "ghcr.io/scrubarr/scrubarr:v0.1.99",
      releaseUrl: "https://github.com/Scrubarr/Scrubarr/releases/tag/v0.1.99",
    },
    keys,
  );
  manifest.version = "0.2.99";

  await assert.rejects(
    checkForUpdates(manifestUrl, {
      trustedKeys: { [keys.keyId]: keys.publicKey },
      fetchImpl: async () => responseFor(manifest),
    }),
    /signature is invalid/,
  );
});

test("update checks reject untrusted release links and image names", async () => {
  const keys = testKeys();

  await assert.rejects(
    checkForUpdates(manifestUrl, {
      trustedKeys: { [keys.keyId]: keys.publicKey },
      fetchImpl: async () =>
        responseFor(
          signedManifest(
            {
              version: "0.1.99",
              dockerImage: "ghcr.io/scrubarr/scrubarr:v0.1.99",
              releaseUrl: "https://example.test/scrubarr/v0.1.99",
            },
            keys,
          ),
        ),
    }),
    /release URL is not trusted/,
  );

  await assert.rejects(
    checkForUpdates(manifestUrl, {
      trustedKeys: { [keys.keyId]: keys.publicKey },
      fetchImpl: async () =>
        responseFor(
          signedManifest(
            {
              version: "0.1.99",
              dockerImage: "ghcr.io/example/bad:v0.1.99",
              releaseUrl: "https://github.com/Scrubarr/Scrubarr/releases/tag/v0.1.99",
            },
            keys,
          ),
        ),
    }),
    /Docker image is not trusted/,
  );
});

test("update checks reject oversized and invalid manifests before trust decisions", async () => {
  const keys = testKeys();

  await assert.rejects(
    checkForUpdates(manifestUrl, {
      trustedKeys: { [keys.keyId]: keys.publicKey },
      fetchImpl: async () => textResponse("{"),
    }),
    /invalid JSON/,
  );

  await assert.rejects(
    checkForUpdates(manifestUrl, {
      trustedKeys: { [keys.keyId]: keys.publicKey },
      fetchImpl: async () => textResponse(" ".repeat(70 * 1024)),
    }),
    /too large/,
  );
});

test("update checks reject unsupported manifest fields", async () => {
  const keys = testKeys();
  const manifest = signedManifest(
    {
      version: "0.1.99",
      dockerImage: "ghcr.io/scrubarr/scrubarr:v0.1.99",
      releaseUrl: "https://github.com/Scrubarr/Scrubarr/releases/tag/v0.1.99",
      installCommand: "not allowed",
    },
    keys,
  );

  await assert.rejects(
    checkForUpdates(manifestUrl, {
      trustedKeys: { [keys.keyId]: keys.publicKey },
      fetchImpl: async () => responseFor(manifest),
    }),
    /unsupported field/,
  );
});
