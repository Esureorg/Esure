import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST, isAllowedPath } from "./route";

afterEach(() => vi.unstubAllGlobals());

describe("backend proxy report downloads", () => {
  it("allows only the exact report route", () => {
    expect(isAllowedPath(["api", "v1", "runs", "run-123", "report"], "GET")).toBe(true);
    expect(isAllowedPath(["api", "v1", "runs", "run-123", "report", "extra"], "GET")).toBe(false);
    expect(isAllowedPath(["api", "v1", "runs", "run-123", "delete"], "GET")).toBe(false);
  });

  it("allows only history and exact-version scenario reads", () => {
    expect(isAllowedPath(["api", "v1", "scenarios", "xlm-payment", "versions"], "GET")).toBe(true);
    expect(isAllowedPath(["api", "v1", "scenarios", "xlm-payment", "versions", "2"], "GET")).toBe(true);
    expect(isAllowedPath(["api", "v1", "scenarios", "xlm-payment", "versions", "2", "export"], "GET")).toBe(false);
    expect(isAllowedPath(["api", "v1", "scenarios", "xlm-payment", "versions", "2"], "POST")).toBe(false);
  });

  it("forwards the attachment filename from the backend", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"status":"passed"}', {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": "attachment; filename=esure-run-run-123.json",
      },
    })));

    const response = await GET(
      new NextRequest("http://localhost/api/backend/api/v1/runs/run-123/report"),
      { params: Promise.resolve({ path: ["api", "v1", "runs", "run-123", "report"] }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe("attachment; filename=esure-run-run-123.json");
  });

  it("forwards retry headers from the backend on report download", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"status":"passed"}', {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": "attachment; filename=esure-run-run-123.json",
        "retry-after": "30",
        "x-retry-count": "2",
      },
    })));

    const response = await GET(
      new NextRequest("http://localhost/api/backend/api/v1/runs/run-123/report"),
      { params: Promise.resolve({ path: ["api", "v1", "runs", "run-123", "report"] }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("x-retry-count")).toBe("2");
  });
});

describe("backend proxy run creation", () => {
  it("forwards idempotency and retry headers to the backend on POST", async () => {
    const fetchMock = vi.fn(async () => new Response('{"runId":"run-123"}', {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new NextRequest("http://localhost/api/backend/api/v1/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem-abc-123",
          "x-retry-count": "1",
          "retry-after": "15",
        },
        body: JSON.stringify({ scenario: "primary" }),
      }),
      { params: Promise.resolve({ path: ["api", "v1", "runs"] }) },
    );

    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("idempotency-key")).toBe("idem-abc-123");
    expect(headers.get("x-retry-count")).toBe("1");
    expect(headers.get("retry-after")).toBe("15");
  });

  it("forwards retry headers from the backend on POST run creation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"runId":"run-123"}', {
      status: 201,
      headers: {
        "content-type": "application/json",
        "retry-after": "20",
        "x-retry-count": "3",
      },
    })));

    const response = await POST(
      new NextRequest("http://localhost/api/backend/api/v1/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "idem-abc-123",
        },
        body: JSON.stringify({ scenario: "primary" }),
      }),
      { params: Promise.resolve({ path: ["api", "v1", "runs"] }) },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("retry-after")).toBe("20");
    expect(response.headers.get("x-retry-count")).toBe("3");
  });
});