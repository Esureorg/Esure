import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, isAllowedPath } from "./route";

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

  it("preserves pagination query parameters when proxying history", async () => {
    const fetchMock = vi.fn(async () => new Response('{"items":[]}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await GET(
      new NextRequest("http://localhost/api/backend/api/v1/scenarios/xlm-payment/versions?limit=10&cursor=3"),
      { params: Promise.resolve({ path: ["api", "v1", "scenarios", "xlm-payment", "versions"] }) },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: "?limit=10&cursor=3" }),
      expect.any(Object),
    );
  });
});
