import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import examples from "../../scripts/check-doc-examples.cjs";

test("copy/paste documentation examples parse and use the current image", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const version = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url))).version;
  assert.ok(examples.checkDocumentation(root, version) >= 7);
});

test("documentation checks reject misindented image properties", () => {
  assert.throws(() => examples.parseYamlExamples("```yaml\nservices:\n  scrubarr:\n   image: test\n    restart: unless-stopped\n```", "INSTALL.md"), /INSTALL.md YAML block 1/);
});
