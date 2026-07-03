import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";
import { createExclusionsRouter } from "../src/routes/exclusions.js";

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

test("exclusions search only returns existing exclusions", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/exclusions",
    createExclusionsRouter({
      exclusionsStore: {
        read: async () => [
          {
            ItemId: "excluded-1",
            Title: "Batman Begins",
            Type: "Movie",
            Year: 2005,
            HasPrimaryImage: true,
          },
          {
            ItemId: "excluded-2",
            Title: "Mr Inbetween",
            Type: "Series",
            Year: 2018,
            HasPrimaryImage: true,
          },
        ],
        write: async () => {},
      },
      pendingStore: {
        read: async () => [],
        write: async () => {},
      },
      settingsStore: {
        read: async () => ({}),
      },
      defaults: { Emby: {} },
    }),
  );
  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/exclusions/search?q=batman`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].Title, "Batman Begins");
    assert.equal(body.items[0].Excluded, true);
  } finally {
    await close(server);
  }
});
