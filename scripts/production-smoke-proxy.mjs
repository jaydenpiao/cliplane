import { readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";

const [cert, key] = process.argv.slice(2);
createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (incoming, outgoing) => {
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: 3101,
      method: incoming.method,
      path: incoming.url,
      headers: { ...incoming.headers, "x-forwarded-proto": "https" },
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.on("error", () => outgoing.destroy());
      response.pipe(outgoing);
    },
  );
  upstream.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  outgoing.on("close", () => {
    if (!outgoing.writableEnded) upstream.destroy();
  });
  incoming.on("aborted", () => upstream.destroy());
  incoming.pipe(upstream);
}).listen(3443, "127.0.0.1");
