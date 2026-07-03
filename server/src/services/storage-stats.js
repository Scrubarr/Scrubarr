import fs from "node:fs/promises";
import {
  mediaRootOf,
  parentPathCandidates,
  runtimeSupportsPathKind,
} from "./path-classifier.js";

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function arrDiskKey(disk) {
  return mediaRootOf(disk.path || disk.label)?.value || null;
}

function normalizeArrDisks(disks) {
  const byRoot = new Map();
  for (const disk of disks || []) {
    const root = arrDiskKey(disk);
    if (!root) continue;

    const totalBytes = numberValue(disk.totalSpace);
    const freeBytes = numberValue(disk.freeSpace ?? disk.availableSpace);
    if (totalBytes <= 0) continue;

    const existing = byRoot.get(root);
    if (existing && existing.totalBytes >= totalBytes) {
      existing.sources = [...new Set([...existing.sources, disk.source].filter(Boolean))];
      continue;
    }

    byRoot.set(root, {
      root,
      label: disk.label || disk.path || root,
      path: disk.path || disk.label || root,
      totalBytes,
      freeBytes,
      sources: [disk.source].filter(Boolean),
    });
  }
  return byRoot;
}

async function statFirstAccessible(paths) {
  for (const candidate of paths) {
    try {
      return {
        path: candidate,
        stats: await fs.statfs(candidate),
      };
    } catch {
      // Try the next parent. Media paths from Emby may refer to host paths that
      // are not mounted inside the Scrubarr container.
    }
  }
  return null;
}

export async function storageByMediaRoot(items, arrDisks = []) {
  const roots = new Map();
  const disksByRoot = normalizeArrDisks(arrDisks);

  for (const item of items) {
    const root = mediaRootOf(item.Path);
    if (!root) continue;
    const existing = roots.get(root.value) || {
      root: root.value,
      rootType: root.type,
      mediaCount: 0,
      samplePath: item.Path,
      paths: [],
    };
    existing.mediaCount += 1;
    if (existing.paths.length < 5) existing.paths.push(item.Path);
    roots.set(root.value, existing);
  }

  return Promise.all(
    [...roots.values()].map(async (entry) => {
      const arrDisk = disksByRoot.get(entry.root);
      if (arrDisk) {
        const usedBytes = Math.max(arrDisk.totalBytes - arrDisk.freeBytes, 0);
        return {
          root: entry.root,
          label: arrDisk.label,
          mediaCount: entry.mediaCount,
          samplePath: entry.samplePath,
          checkedPath: arrDisk.path,
          source: arrDisk.sources.join(", "),
          available: true,
          totalBytes: arrDisk.totalBytes,
          usedBytes,
          freeBytes: arrDisk.freeBytes,
          usedPercent:
            arrDisk.totalBytes > 0
              ? Math.round((usedBytes / arrDisk.totalBytes) * 1000) / 10
              : 0,
        };
      }

      if (!runtimeSupportsPathKind(entry.rootType === "windows" ? "win32" : "posix")) {
        return {
          root: entry.root,
          mediaCount: entry.mediaCount,
          samplePath: entry.samplePath,
          available: false,
          message:
            entry.rootType === "windows"
              ? "This Windows media drive is not mounted inside the Scrubarr container."
              : "This Linux media path is not accessible from this Scrubarr runtime.",
        };
      }

      const accessible = await statFirstAccessible(
        entry.paths.flatMap((mediaPath) => parentPathCandidates(mediaPath)),
      );
      if (!accessible) {
        return {
          root: entry.root,
          mediaCount: entry.mediaCount,
          samplePath: entry.samplePath,
          available: false,
          message: "Storage path is not accessible from the Scrubarr container.",
        };
      }

      const blockSize = Number(accessible.stats.bsize || 0);
      const totalBytes = Number(accessible.stats.blocks || 0) * blockSize;
      const freeBytes = Number(accessible.stats.bavail || 0) * blockSize;
      const usedBytes = Math.max(totalBytes - freeBytes, 0);

      return {
        root: entry.root,
        mediaCount: entry.mediaCount,
        samplePath: entry.samplePath,
        checkedPath: accessible.path,
        available: true,
        totalBytes,
        usedBytes,
        freeBytes,
        usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
      };
    }),
  );
}
