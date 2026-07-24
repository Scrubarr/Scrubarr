import fs from "node:fs/promises";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

function ignoreUnsupportedPermissionError(error) {
  return ["EPERM", "ENOSYS", "EINVAL"].includes(error?.code);
}

export async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await fs.chmod(directory, PRIVATE_DIRECTORY_MODE).catch((error) => {
    if (!ignoreUnsupportedPermissionError(error)) throw error;
  });
}

export async function protectPrivateFile(filePath) {
  await fs.chmod(filePath, PRIVATE_FILE_MODE).catch((error) => {
    if (!ignoreUnsupportedPermissionError(error)) throw error;
  });
}
