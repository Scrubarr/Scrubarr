const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const imageName = "ghcr.io/scrubarr/scrubarr";

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function fail(message) {
  throw new Error(message);
}

function imageTagFromCompose(relativePath) {
  const text = readText(relativePath);
  const match = text.match(new RegExp(`image:\\s*${imageName.replaceAll("/", "\\/")}:(\\S+)`));
  return match?.[1] || "";
}

const packageJson = readJson("package.json");
const clientPackage = readJson("client/package.json");
const serverPackage = readJson("server/package.json");
const manifest = readJson("release-manifest.example.json");
const expectedVersion = packageJson.version;
const expectedTag = `v${expectedVersion}`;

if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
  fail(`package.json version must be semver x.y.z, got ${expectedVersion}`);
}

for (const [name, version] of [
  ["client/package.json", clientPackage.version],
  ["server/package.json", serverPackage.version],
  ["release-manifest.example.json", manifest.version],
]) {
  if (version !== expectedVersion) {
    fail(`${name} version ${version} does not match package.json ${expectedVersion}`);
  }
}

for (const composeFile of ["docker-compose.yml", "docker-compose.example.yml"]) {
  const tag = imageTagFromCompose(composeFile);
  if (tag !== expectedTag) {
    fail(`${composeFile} image tag ${tag || "(missing)"} does not match ${expectedTag}`);
  }
}

if (!String(manifest.releaseUrl || "").endsWith(`/tag/${expectedTag}`)) {
  fail(`release-manifest.example.json releaseUrl must end with /tag/${expectedTag}`);
}

if (manifest.dockerImage !== `${imageName}:${expectedTag}`) {
  fail(
    `release-manifest.example.json dockerImage ${manifest.dockerImage || "(missing)"} does not match ${imageName}:${expectedTag}`,
  );
}

console.log(`Release metadata is aligned for Scrubarr ${expectedTag}.`);
