import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDirectory, "..", "..", "..");
const packageJsonPath = path.join(projectRoot, "package.json");

function readPackageMetadata() {
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return {};
  }
}

const metadata = readPackageMetadata();

export const APP_VERSION = metadata.version || "0.0.0";
