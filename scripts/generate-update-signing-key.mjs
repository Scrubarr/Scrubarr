import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const outDirectory = path.resolve(argValue("--out", "local-update-signing"));
const publicFile = path.join(outDirectory, "scrubarr-update-public.pem");
const privateFile = path.join(outDirectory, "scrubarr-update-private.pem");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

await fs.mkdir(outDirectory, { recursive: true });
await fs.writeFile(
  publicFile,
  publicKey.export({ type: "spki", format: "pem" }),
  "utf8",
);
await fs.writeFile(
  privateFile,
  privateKey.export({ type: "pkcs8", format: "pem" }),
  { encoding: "utf8", mode: 0o600 },
);

console.log(`Public key:  ${publicFile}`);
console.log(`Private key: ${privateFile}`);
console.log("");
console.log("Keep the private key secret and backed up.");
console.log("Only the public key belongs in Scrubarr source code.");
