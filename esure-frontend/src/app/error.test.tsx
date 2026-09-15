import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "./error";

class TestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestError";
  }
}

const Throw = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) throw new TestError("render failure");
  return <span>safe content</span>;
};

const Wrapper = ({ shouldThrow }: { shouldThrow: boolean }) => {
  return (
    <ErrorBoundary error={shouldThrow ? new TestError("render failure") : undefined} reset={() => {}}>
      <Throw shouldThrow={shouldThrow} />
    </ErrorBoundary>
  );
};

describe("ErrorBoundary", () => {
  it("renders safe content when there is no error", () => {
    render(<Wrapper shouldThrow={false} />);
    expect(screen.getByText("safe content")).toBeVisible();
  });

  it("renders branded fallback and never exposes the raw error stack", () => {
    render(<Wrapper shouldThrow={true} />);
    const headlines = screen.getAllByText("We hit an unexpected snag.");
    expect(headlines.length).toBeGreaterThan(0);
    expect(screen.queryByText("render failure")).not.toBeInTheDocument();
    expect(screen.queryByText(TestError.prototype.name)).not.toBeInTheDocument();
  });

  it("shows retry and home actions", () => {
    render(<Wrapper shouldThrow={true} />);
    const retryButtons = screen.getAllByRole("button", { name: "Retry" });
    expect(retryButtons.length).toBeGreaterThan(0);
    const homeLinks = screen.getAllByRole("link", { name: "Home" });
    expect(homeLinks.length).toBeGreaterThan(0);
  });
});
