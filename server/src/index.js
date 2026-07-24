import "dotenv/config";
import { createApp } from "./app.js";
import { createRuntimeConfig } from "./config/runtime.js";
import { ensurePrivateDirectory } from "./storage/private-paths.js";

const runtime = createRuntimeConfig();

await Promise.all([
  ensurePrivateDirectory(runtime.dataDirectory),
  ensurePrivateDirectory(runtime.deletedDirectory),
  ensurePrivateDirectory(runtime.logDirectory),
]);

const app = createApp(runtime);
await app.locals.migratePersistedData();
await app.locals.scheduler.start();
await app.locals.automaticUpdateChecks.start();
await app.locals.appLog.info("Scrubarr server starting", {
  host: runtime.host,
  port: runtime.port,
  timezone: runtime.timezone,
});
const server = app.listen(runtime.port, runtime.host, () => {
  console.log(
    `Scrubarr server listening at http://${runtime.host}:${runtime.port}`,
  );
  app.locals.appLog.info("Scrubarr server listening", {
    url: `http://${runtime.host}:${runtime.port}`,
  }).catch(console.error);
});

function shutdown(signal) {
  console.log(`${signal} received; closing Scrubarr server`);
  app.locals.appLog.info("Scrubarr server shutting down", { signal }).catch(console.error);
  app.locals.scheduler.stop();
  app.locals.automaticUpdateChecks.stop();
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
