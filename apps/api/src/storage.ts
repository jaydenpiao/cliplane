import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface ObjectStore {
  resolve(key: string): string;
  remove(key: string): Promise<void>;
}
export class LocalObjectStore implements ObjectStore {
  constructor(readonly root: string) {}
  resolve(key: string): string {
    if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.split("/").includes("..") || path.isAbsolute(key))
      throw new Error("Invalid object key");
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(`${path.resolve(this.root)}${path.sep}`))
      throw new Error("Object key escapes storage");
    return resolved;
  }
  async prepare(key: string): Promise<string> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    return target;
  }
  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true, recursive: true });
  }
  async info(key: string) {
    return stat(this.resolve(key));
  }
  stream(key: string, range?: { start: number; end: number }) {
    return createReadStream(this.resolve(key), range);
  }
}

export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size)
    return null;
  return { start, end };
}
