import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const backendUrl = process.env.ESURE_BACKEND_URL ?? "http://127.0.0.1:3001";

const FORWARDED_REQUEST_HEADERS = ["idempotency-key", "x-request-id"] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "content-disposition",
  "retry-after",
  "idempotency-key",
  "x-request-id",
] as const;

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return forward(request, context, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
  return forward(request, context, "POST");
}

async function forward(request: NextRequest, context: RouteContext, method: "GET" | "POST") {
  const { path } = await context.params;
  if (!isAllowedPath(path, method)) {
    return NextResponse.json({ error: { code: "PROXY_ROUTE_DENIED", message: "Route is not available." } }, { status: 404 });
  }

  const target = new URL(path.map(encodeURIComponent).join("/"), `${backendUrl.replace(/\/$/, "")}/`);
  const forwardedHeaders: Record<string, string> = { accept: "application/json" };
  if (method === "POST") forwardedHeaders["content-type"] = "application/json";
  for (const headerName of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(headerName);
    if (value) forwardedHeaders[headerName] = value;
  }

  const response = await fetch(target, {
    method,
    headers: forwardedHeaders,
    body: method === "POST" ? await request.text() : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);

  if (!response) {
    return NextResponse.json(
      { error: { code: "BACKEND_UNAVAILABLE", message: "Esure Backend is unavailable. Start it and try again." } },
      { status: 503 },
    );
  }

  const body = await response.text();
  const responseHeaders: Record<string, string> = {
    "content-type": response.headers.get("content-type") ?? "application/json",
  };
  for (const headerName of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(headerName);
    if (value) responseHeaders[headerName] = value;
  }

  return new NextResponse(body, { status: response.status, headers: responseHeaders });
}

export function isAllowedPath(path: string[], method: "GET" | "POST"): boolean {
  if (path.some((part) => !/^[a-zA-Z0-9-]+$/.test(part))) return false;
  if (method === "POST") return path.length === 3 && path.join("/") === "api/v1/runs";
  if (path.join("/") === "health" || path.join("/") === "api/v1/scenarios") return true;
  if (method === "GET" && path.length === 4 && path.slice(0, 3).join("/") === "api/v1/scenarios") return true;
  const isScenarioRoute = path.slice(0, 3).join("/") === "api/v1/scenarios";
  if (method === "GET" && isScenarioRoute && path.length === 5 && path[4] === "versions") return true;
  if (method === "GET" && isScenarioRoute && path.length === 6 && path[4] === "versions" && /^[1-9]\d*$/.test(path[5])) return true;
  const isRunPath = path.slice(0, 3).join("/") === "api/v1/runs";
  return isRunPath && (path.length === 4 || (path.length === 5 && path[4] === "report"));
}
