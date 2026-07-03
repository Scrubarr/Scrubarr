import fs from "node:fs/promises";
import {
  classifyPath,
  isBlankPath,
  isFilesystemRoot,
  isInsideClassifiedRoot,
  runtimeSupportsPathKind,
} from "./path-classifier.js";

function safeRoots(allowedRoots, platform) {
  return (Array.isArray(allowedRoots) ? allowedRoots : [])
    .filter((root) => !isBlankPath(root))
    .map((root) => classifyPath(root))
    .filter((root) =>
      root.ok &&
      runtimeSupportsPathKind(root.kind, platform) &&
      !isFilesystemRoot(root),
    );
}

export function validateDirectDeletionPath({
  targetPath,
  allowedRoots,
  platform = process.platform,
} = {}) {
  const target = classifyPath(targetPath);
  if (!target.ok) return { ok: false, message: target.message };

  if (!runtimeSupportsPathKind(target.kind, platform)) {
    return {
      ok: false,
      message: "Direct deletion target path is not accessible from this Scrubarr runtime.",
    };
  }

  if (isFilesystemRoot(target)) {
    return {
      ok: false,
      message: "Direct deletion target cannot be a filesystem root.",
    };
  }

  const roots = safeRoots(allowedRoots, platform);
  if (roots.length === 0) {
    return {
      ok: false,
      message: "No approved direct deletion roots are configured.",
    };
  }

  const matchedRoot = roots.find((root) => isInsideClassifiedRoot(target, root));
  if (!matchedRoot) {
    return {
      ok: false,
      message: "Direct deletion target is outside approved media roots.",
    };
  }

  return {
    ok: true,
    path: target.normalized,
    root: matchedRoot.normalized,
  };
}

export async function assertSafeDirectDeletionPath({
  targetPath,
  allowedRoots,
  platform = process.platform,
} = {}) {
  const validation = validateDirectDeletionPath({ targetPath, allowedRoots, platform });
  if (!validation.ok) throw new Error(validation.message);

  try {
    await fs.lstat(validation.path);
  } catch {
    throw new Error("Direct deletion target does not exist.");
  }

  let realRoot;
  let realTarget;
  try {
    realRoot = await fs.realpath(validation.root);
    realTarget = await fs.realpath(validation.path);
  } catch (error) {
    throw new Error(`Direct deletion path could not be verified: ${error.message}`);
  }

  const realValidation = validateDirectDeletionPath({
    targetPath: realTarget,
    allowedRoots: [realRoot],
    platform,
  });
  if (!realValidation.ok) {
    throw new Error("Direct deletion target resolves outside approved media roots.");
  }

  return {
    path: realValidation.path,
    root: realValidation.root,
  };
}
