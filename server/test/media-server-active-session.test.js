import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSettings } from "../src/config/settings.js";
import {
  activeMediaSessionForItem,
  pathsReferToSameMedia,
} from "../src/services/media-server.js";

function settingsForProvider(provider) {
  const settings = createDefaultSettings({});
  settings.MediaServer = {
    Provider: provider,
    Locked: true,
  };
  settings[provider === "jellyfin" ? "Jellyfin" : "Emby"] = {
    ...settings[provider === "jellyfin" ? "Jellyfin" : "Emby"],
    ServerUrl: `http://${provider}.local:8096`,
    ApiKey: `${provider}-key`,
    SearchLibraries: ["Movies", "TV Shows"],
  };
  return settings;
}

test("active playback path matching respects Linux path case", () => {
  assert.equal(
    pathsReferToSameMedia("/media/Movies/Example.mkv", "/media/movies/Example.mkv"),
    false,
  );
});

test("active playback path matching accepts Windows path case changes", () => {
  assert.equal(
    pathsReferToSameMedia("D:\\Media\\Movies\\Example.mkv", "d:/media/movies/example.mkv"),
    true,
  );
});

for (const provider of ["emby", "jellyfin"]) {
  test(`${provider} active session matching treats paused movies as in use`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/Sessions") {
        return Response.json([
          {
            Id: "session-1",
            UserName: "Viewer",
            Client: "Browser",
            DeviceName: "Laptop",
            NowPlayingItem: {
              Id: "movie-1",
              Name: "Paused Movie",
              Type: "Movie",
            },
            PlayState: { IsPaused: true },
          },
        ]);
      }
      return new Response(null, { status: 404 });
    };

    try {
      const match = await activeMediaSessionForItem(settingsForProvider(provider), {
        ItemId: "movie-1",
        Type: "Movie",
      });

      assert.equal(match?.itemId, "movie-1");
      assert.equal(match?.paused, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test(`${provider} active session matching blocks series by now-playing series id`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/Sessions") {
        return Response.json([
          {
            Id: "session-1",
            UserName: "Viewer",
            Client: "Browser",
            DeviceName: "Laptop",
            NowPlayingItem: {
              Id: "episode-1",
              SeriesId: "series-1",
              Name: "Episode One",
              Type: "Episode",
            },
            PlayState: { IsPaused: false },
          },
        ]);
      }
      return new Response(null, { status: 404 });
    };

    try {
      const match = await activeMediaSessionForItem(settingsForProvider(provider), {
        ItemId: "series-1",
        Type: "Series",
      });

      assert.equal(match?.seriesId, "series-1");
      assert.equal(match?.itemId, "episode-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test(`${provider} active session matching recognizes a Leaving Soon movie copy by source path`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/Sessions") {
        return Response.json([
          {
            Id: "session-1",
            UserName: "Viewer",
            NowPlayingItem: {
              Id: "leaving-soon-movie-1",
              Name: "Queued Movie",
              Type: "Movie",
              ProductionYear: 2020,
              Path: "/queue/movies/Queued Movie (2020).strm",
              MediaSources: [{ Path: "/media/movies/Queued Movie (2020).mkv" }],
            },
            PlayState: { IsPaused: false },
          },
        ]);
      }
      return new Response(null, { status: 404 });
    };

    try {
      const match = await activeMediaSessionForItem(settingsForProvider(provider), {
        ItemId: "original-movie-1",
        Title: "Queued Movie",
        Type: "Movie",
        Year: 2020,
        Path: "/media/movies/Queued Movie (2020).mkv",
      });

      assert.equal(match?.itemId, "leaving-soon-movie-1");
      assert.equal(match?.mediaPath, "/media/movies/Queued Movie (2020).mkv");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test(`${provider} active session matching recognizes a Leaving Soon series copy by title`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/Sessions") {
        return Response.json([
          {
            Id: "session-1",
            UserName: "Viewer",
            NowPlayingItem: {
              Id: "leaving-soon-episode-1",
              SeriesId: "leaving-soon-series-1",
              SeriesName: "Queued Series",
              Name: "Episode One",
              Type: "Episode",
            },
            PlayState: { IsPaused: false },
          },
        ]);
      }
      return new Response(null, { status: 404 });
    };

    try {
      const match = await activeMediaSessionForItem(settingsForProvider(provider), {
        ItemId: "original-series-1",
        Title: "Queued Series",
        Type: "Series",
      });

      assert.equal(match?.seriesId, "leaving-soon-series-1");
      assert.equal(match?.seriesTitle, "Queued Series");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
