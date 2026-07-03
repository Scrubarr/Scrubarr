import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  applyArrPendingTags,
  removeArrPendingTags,
} from "../src/services/arr-pending-tags.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function tagSettings(url) {
  return {
    Arrs: {
      PendingTag: {
        Enabled: true,
        Name: "Scrubarr Pending",
      },
      Radarr: {
        Enabled: true,
        Url: url,
        ApiKey: "radarr-key",
      },
      Sonarr: {
        Enabled: true,
        Url: url,
        ApiKey: "sonarr-key",
      },
    },
  };
}

test("applyArrPendingTags creates and applies the configured Radarr tag", async () => {
  let createdTag = false;
  let savedEditorPayload = null;
  const fixtureServer = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    assert.equal(request.headers["x-api-key"], "radarr-key");

    if (request.method === "GET" && request.url === "/api/v3/tag") {
      response.end(JSON.stringify(createdTag ? [{ id: 42, label: "Scrubarr Pending" }] : []));
      return;
    }

    if (request.method === "POST" && request.url === "/api/v3/tag") {
      const body = await readJson(request);
      assert.equal(body.label, "Scrubarr Pending");
      createdTag = true;
      response.end(JSON.stringify({ id: 42, label: body.label }));
      return;
    }

    if (request.method === "GET" && request.url === "/api/v3/movie/7") {
      response.end(JSON.stringify({ id: 7, title: "Tagged Movie", tags: [3] }));
      return;
    }

    if (request.method === "PUT" && request.url === "/api/v3/movie/editor") {
      savedEditorPayload = await readJson(request);
      response.end(JSON.stringify(savedEditorPayload));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  const port = await listen(fixtureServer);

  try {
    const result = await applyArrPendingTags({
      settings: tagSettings(`http://127.0.0.1:${port}`),
      items: [{ Type: "Movie", Arr: "Radarr", ArrId: 7, ItemId: "movie-1", Title: "Tagged Movie" }],
    });

    assert.deepEqual(
      {
        enabled: result.enabled,
        updated: result.updated,
        failed: result.failed,
        skipped: result.skipped,
      },
      { enabled: true, updated: 1, failed: 0, skipped: 0 },
    );
    assert.deepEqual(savedEditorPayload, {
      movieIds: [7],
      tags: [42],
      applyTags: "add",
    });
  } finally {
    await close(fixtureServer);
  }
});

test("removeArrPendingTags removes only the configured Sonarr tag", async () => {
  let savedEditorPayload = null;
  const fixtureServer = http.createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    assert.equal(request.headers["x-api-key"], "sonarr-key");

    if (request.method === "GET" && request.url === "/api/v3/tag") {
      response.end(JSON.stringify([{ id: 42, label: "Scrubarr Pending" }]));
      return;
    }

    if (request.method === "GET" && request.url === "/api/v3/series/9") {
      response.end(JSON.stringify({ id: 9, title: "Tagged Series", tags: [3, 42] }));
      return;
    }

    if (request.method === "PUT" && request.url === "/api/v3/series/editor") {
      savedEditorPayload = await readJson(request);
      response.end(JSON.stringify(savedEditorPayload));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  const port = await listen(fixtureServer);

  try {
    const result = await removeArrPendingTags({
      settings: tagSettings(`http://127.0.0.1:${port}`),
      items: [{ Type: "Series", Arr: "Sonarr", ArrId: 9, ItemId: "series-1", Title: "Tagged Series" }],
    });

    assert.deepEqual(
      {
        enabled: result.enabled,
        updated: result.updated,
        failed: result.failed,
        skipped: result.skipped,
      },
      { enabled: true, updated: 1, failed: 0, skipped: 0 },
    );
    assert.deepEqual(savedEditorPayload, {
      seriesIds: [9],
      tags: [42],
      applyTags: "remove",
    });
  } finally {
    await close(fixtureServer);
  }
});
