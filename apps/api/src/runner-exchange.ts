import { constants, type Stats } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { pipeline } from "node:stream/promises";

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const LENGTH_BYTES = 4;
const MAX_REQUEST_FRAME_BYTES = 1024 * 1024 + LENGTH_BYTES;

async function* sourceFrame(file: FileHandle, stat: Stats, prefix?: Buffer) {
  if (prefix) yield prefix;
  const header = Buffer.alloc(LENGTH_BYTES);
  header.writeUInt32BE(stat.size);
  yield header;
  let offset = 0;
  while (offset < stat.size) {
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, stat.size - offset));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    if (!bytesRead) throw new Error("Runner source ended early");
    offset += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
  const current = await file.stat();
  if (current.size !== stat.size || current.mtimeMs !== stat.mtimeMs)
    throw new Error("Runner source changed during transmission");
}

/** Exchange one source and reply. The receiver must unwind when the socket closes. */
export async function exchangeRunner<T>(
  socketPath: string,
  source: string,
  signal: AbortSignal,
  deadline: number,
  receive: (socket: Socket) => Promise<T>,
  prefix?: Buffer,
): Promise<T> {
  signal.throwIfAborted();
  if (prefix && prefix.length > MAX_REQUEST_FRAME_BYTES) throw new Error("Runner request is too large");
  // O_NONBLOCK lets fstat reject a FIFO without waiting for a writer.
  const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    signal.throwIfAborted();
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_SOURCE_BYTES || performance.now() >= deadline)
      throw new Error("Invalid runner source");
    signal.throwIfAborted();
    const socket = createConnection({ path: socketPath, allowHalfOpen: true, signal });
    const receiving = (async () => receive(socket))();
    // Finishing the writable pipeline sends EOF while the response side stays open.
    const sending = (async () => pipeline(sourceFrame(file, stat, prefix), socket, { signal }))();
    try {
      const [response] = await Promise.all([receiving, sending]);
      signal.throwIfAborted();
      return response;
    } finally {
      socket.destroy();
      // The caller owns staging and can remove it only after the receiver has unwound.
      await Promise.allSettled([receiving, sending]);
    }
  } finally {
    await file.close();
  }
}
