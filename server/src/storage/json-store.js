import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class JsonStoreError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "JsonStoreError";
  }
}

export class JsonStore {
  constructor(filePath, defaultValue) {
    this.filePath = filePath;
    this.defaultValue = defaultValue;
  }

  async read() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const normalized = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      return JSON.parse(normalized);
    } catch (error) {
      if (error.code === "ENOENT") {
        return structuredClone(this.defaultValue);
      }

      if (error instanceof SyntaxError) {
        throw new JsonStoreError(
          `Invalid JSON in ${path.basename(this.filePath)}`,
          { cause: error },
        );
      }

      throw new JsonStoreError(
        `Unable to read ${path.basename(this.filePath)}`,
        { cause: error },
      );
    }
  }

  async write(value) {
    const directory = path.dirname(this.filePath);
    const temporaryFile = path.join(
      directory,
      `.${path.basename(this.filePath)}.${randomUUID()}.tmp`,
    );

    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.writeFile(
        temporaryFile,
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8",
      );
      await fs.rename(temporaryFile, this.filePath);
    } catch (error) {
      await fs.rm(temporaryFile, { force: true }).catch(() => {});
      throw new JsonStoreError(
        `Unable to write ${path.basename(this.filePath)}`,
        { cause: error },
      );
    }
  }
}

