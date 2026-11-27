import { describe, it, expect, vi } from "vitest";
import { shutdownLogic } from "../src/server.js";

function makeApp() {
  return {
    log: {
      info: vi.fn(),
      error: vi.fn(),
    },
  };
}

describe("shutdownLogic", () => {
  it("returns exit code 0 when cleanup succeeds", async () => {
    const app = makeApp();
    const drain = vi.fn().mockResolvedValue(undefined);
    const code = await shutdownLogic(app, drain, "SIGTERM");
    expect(code).toBe(0);
    expect(drain).toHaveBeenCalledOnce();
  });

  it("returns exit code 1 when cleanup throws", async () => {
    const app = makeApp();
    const drain = vi.fn().mockRejectedValue(new Error("close failed"));
    const code = await shutdownLogic(app, drain, "SIGTERM");
    expect(code).toBe(1);
    expect(app.log.error).toHaveBeenCalled();
  });

  it("logs the signal name", async () => {
    const app = makeApp();
    const drain = vi.fn().mockResolvedValue(undefined);
    await shutdownLogic(app, drain, "SIGINT");
    expect(app.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ signal: "SIGINT" }),
      expect.any(String),
    );
  });
});
