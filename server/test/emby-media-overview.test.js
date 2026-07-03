import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import { getEmbyMediaOverview } from "../src/services/emby.js";

test("Emby media overview includes episode totals without counting episodes as titles", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    calls.push(parsed);

    if (parsed.pathname === "/Library/VirtualFolders") {
      return Response.json([
        {
          Name: "Movies",
          ItemId: "movies-library",
          CollectionType: "movies",
        },
        {
          Name: "TV Shows",
          ItemId: "series-library",
          CollectionType: "tvshows",
        },
      ]);
    }

    if (parsed.pathname === "/Items") {
      const parentId = parsed.searchParams.get("ParentId");
      const itemTypes = parsed.searchParams.get("IncludeItemTypes");
      if (parentId === "movies-library" && itemTypes === "Movie") {
        return Response.json({
          TotalRecordCount: 1013,
          Items: [
            {
              Id: "movie-1",
              Name: "Example Movie",
              Type: "Movie",
              Path: "H:\\Movies\\Example Movie\\Example Movie.mkv",
            },
          ],
        });
      }
      if (parentId === "series-library" && itemTypes === "Series") {
        return Response.json({
          TotalRecordCount: 119,
          Items: [
            {
              Id: "series-1",
              Name: "Example Series",
              Type: "Series",
              Path: "N:\\Shows\\Example Series",
            },
          ],
        });
      }
      if (parentId === "series-library" && itemTypes === "Episode") {
        return Response.json({
          TotalRecordCount: 4567,
          Items: [],
        });
      }
    }

    return new Response(null, { status: 404 });
  };

  try {
    const config = {
      ...createDefaultSettings({}).Emby,
      ServerUrl: "http://emby.local:8096",
      ApiKey: "emby-key",
      SearchLibraries: ["Movies", "TV Shows"],
    };

    const overview = await getEmbyMediaOverview(config);

    assert.deepEqual(overview.media, {
      movies: 1013,
      series: 119,
      episodes: 4567,
      total: 1132,
    });
    assert.equal(overview.items.length, 2);
    assert.ok(
      calls.some(
        (call) =>
          call.pathname === "/Items" &&
          call.searchParams.get("IncludeItemTypes") === "Episode" &&
          call.searchParams.get("Limit") === "1",
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
