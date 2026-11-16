import { relaySources } from "../../../lib/server/source-relay";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return relaySources(request);
}

export async function POST(request: Request) {
  return relaySources(request);
}
