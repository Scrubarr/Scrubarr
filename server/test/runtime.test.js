import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createRuntimeConfig } from "../src/config/runtime.js";

test("uses the host timezone unless explicitly overridden", () => {
  const hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  assert.equal(createRuntimeConfig({}).timezone, hostTimezone);
  assert.equal(
    createRuntimeConfig({ SCRUBARR_TIMEZONE: "Pacific/Auckland" }).timezone,
    "Pacific/Auckland",
  );
});

test("uses data directory defaults for managed app paths", () => {
  const runtime = createRuntimeConfig({
    SCRUBARR_DATA_DIR: "custom-data",
  });

  assert.equal(runtime.backupDirectory.endsWith(path.join("custom-data", "backups")), true);
  assert.equal(
    runtime.updateCheckFile.endsWith(path.join("custom-data", "UpdateCheck.json")),
    true,
  );
  assert.equal(
    runtime.librarySyncManifestDirectory.endsWith(path.join("custom-data", "library-sync")),
    true,
  );
});
