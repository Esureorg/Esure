import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { Dashboard, filterScenario } from "./dashboard";
import * as api from "@/lib/api";
import { type RunReport } from "@/lib/api";

// --- URL Restoration Mocks ---
const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => "/dashboard",
  useSearchParams: () => mockSearchParams,
}));
// -----------------------------

const mockScenarios: api.ScenarioSummary[] = [
  {
    id: "xlm-payment",
    version: 1,
    name: "XLM payment",
    description: "Fund two Testnet accounts, send XLM, and verify the recipient balance.",
    contentHash: "hash1",
  },
  {
    id: "issued-asset-payment",
    version: 1,
    name: "Issued asset payment",
    description: "Issue TESTUSD and send it to a recipient through a trustline.",
    contentHash: "hash2",
  },
  {
    id: "missing-trustline",
    version: 1,
    name: "Missing trustline",
    description: "Verify that an asset payment fails when the recipient has no trustline.",
    contentHash: "hash3",
  },
];

const mockRun: RunReport = {
  id: "run-123",
  scenarioId: "test-scenario",
  scenarioVersion: 1,
  scenarioSchemaVersion: 1,
  scenarioContentHash: "hash",
  network: "testnet",
  status: "passed",
  createdAt: new Date().toISOString(),
  steps: [],
  assertions: [],
  summary: { stepsPassed: 0, stepsFailed: 0, assertionsPassed: 0, assertionsFailed: 0 },
};

describe("filterScenario helper", () => {
  it("includes all scenarios when filter is 'all'", () => {
    mockScenarios.forEach((scenario) => {
      expect(filterScenario(scenario, "all")).toBe(true);
    });
  });

  it("filters XLM scenarios correctly", () => {
    expect(filterScenario(mockScenarios[0], "xlm")).toBe(true);
    expect(filterScenario(mockScenarios[1], "xlm")).toBe(false);
    expect(filterScenario(mockScenarios[2], "xlm")).toBe(false);
  });

  it("filters Issued Asset scenarios correctly", () => {
    expect(filterScenario(mockScenarios[0], "issued-asset")).toBe(false);
    expect(filterScenario(mockScenarios[1], "issued-asset")).toBe(true);
    expect(filterScenario(mockScenarios[2], "issued-asset")).toBe(false);
  });

  it("filters Expected Failure scenarios correctly", () => {
    expect(filterScenario(mockScenarios[0], "expected-failure")).toBe(false);
    expect(filterScenario(mockScenarios[1], "expected-failure")).toBe(false);
    expect(filterScenario(mockScenarios[2], "expected-failure")).toBe(true);
  });
});

describe("Dashboard component scenario filtering", () => {
  beforeEach(() => {
    vi.spyOn(api, "listScenarios").mockResolvedValue(mockScenarios);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });


  it("renders all scenarios by default with 'All' filter active", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText("03 AVAILABLE")).toBeDefined();
    });

    const allTab = screen.getByRole("tab", { name: "All" });
    expect(allTab.getAttribute("aria-selected")).toBe("true");

    expect(screen.getAllByText("XLM payment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Issued asset payment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missing trustline").length).toBeGreaterThan(0);
  });

  it("filters scenarios when clicking 'XLM'", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText("03 AVAILABLE")).toBeDefined();
    });

    const xlmTab = screen.getByRole("tab", { name: "XLM" });
    fireEvent.click(xlmTab);

    expect(xlmTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("01 AVAILABLE")).toBeDefined();
    expect(screen.getAllByText("XLM payment").length).toBeGreaterThan(0);
    expect(screen.queryByText("Issued asset payment")).toBeNull();
    expect(screen.queryByText("Missing trustline")).toBeNull();
  });

  it("filters scenarios when clicking 'Issued Asset'", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText("03 AVAILABLE")).toBeDefined();
    });

    const issuedTab = screen.getByRole("tab", { name: "Issued Asset" });
    fireEvent.click(issuedTab);

    expect(issuedTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("01 AVAILABLE")).toBeDefined();
    expect(screen.queryByText("XLM payment")).toBeNull();
    expect(screen.getAllByText("Issued asset payment").length).toBeGreaterThan(0);
    expect(screen.queryByText("Missing trustline")).toBeNull();
  });

  it("filters scenarios when clicking 'Expected Failure'", async () => {
    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText("03 AVAILABLE")).toBeDefined();
    });

    const failureTab = screen.getByRole("tab", { name: "Expected Failure" });
    fireEvent.click(failureTab);

    expect(failureTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("01 AVAILABLE")).toBeDefined();
    expect(screen.queryByText("XLM payment")).toBeNull();
    expect(screen.queryByText("Issued asset payment")).toBeNull();
    expect(screen.getAllByText("Missing trustline").length).toBeGreaterThan(0);
  });

  it("displays empty results message when no scenarios match filter", async () => {
    vi.spyOn(api, "listScenarios").mockResolvedValue([mockScenarios[0]]); // Only XLM scenario

    render(<Dashboard />);
    await waitFor(() => {
      expect(screen.getByText("01 AVAILABLE")).toBeDefined();
    });

    const failureTab = screen.getByRole("tab", { name: "Expected Failure" });
    fireEvent.click(failureTab);

    expect(screen.getByText("00 AVAILABLE")).toBeDefined();
    expect(screen.getByText("No scenarios found")).toBeDefined();
    expect(screen.getByRole("status")).toBeDefined();
  });
});

describe("Dashboard component catalogue loading and retry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("handles initial failure and repeated failure", async () => {
    const listScenariosMock = vi.spyOn(api, "listScenarios").mockRejectedValue(new Error("Network Error"));

    render(<Dashboard />);
    
    // Wait for the failure to render
    await waitFor(() => {
      expect(screen.getByText("Couldn't load scenarios")).toBeDefined();
    });
    expect(screen.getByText("Network Error")).toBeDefined();
    
    const retryButton = screen.getByRole("button", { name: "Retry" });
    
    // Repeated failure
    listScenariosMock.mockRejectedValueOnce(new Error("Still Failed"));
    fireEvent.click(retryButton);
    
    await waitFor(() => {
      expect(screen.getByText("Still Failed")).toBeDefined();
    });
  });

  it("handles successful retry after failure", async () => {
    const listScenariosMock = vi.spyOn(api, "listScenarios").mockRejectedValueOnce(new Error("Network Error"));
    
    render(<Dashboard />);
    
    await waitFor(() => {
      expect(screen.getByText("Couldn't load scenarios")).toBeDefined();
    });
    
    // Setup for success
    listScenariosMock.mockResolvedValueOnce(mockScenarios);
    
    const retryButton = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryButton);
    
    // Should clear error and show scenarios
    await waitFor(() => {
      expect(screen.queryByText("Couldn't load scenarios")).toBeNull();
      expect(screen.getAllByText("XLM payment").length).toBeGreaterThan(0);
    });
  });

  it("displays distinct empty success state", async () => {
    vi.spyOn(api, "listScenarios").mockResolvedValue([]);
    
    render(<Dashboard />);
    
    await waitFor(() => {
      expect(screen.getByText("No scenarios found")).toBeDefined();
      expect(screen.getByText("No scenarios match the selected filter (\"All\").")).toBeDefined();
      expect(screen.queryByText("Couldn't load scenarios")).toBeNull();
    });
  });

  it("aborts requests on unmount", () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const { unmount } = render(<Dashboard />);
    unmount();
    expect(abortSpy).toHaveBeenCalled();
  });
});

describe("Dashboard URL Restoration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearchParams = new URLSearchParams();
    vi.spyOn(api, "listScenarios").mockResolvedValue([mockScenarios[0]]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("updates URL with runId without reloading when startRun is called", async () => {
    const startRunMock = vi.spyOn(api, "startRun").mockResolvedValue(mockRun);
    
    render(<Dashboard />);
    
    // Wait for scenarios to load
    const elements = await screen.findAllByText("XLM payment");
    
    // Click scenario to select it
    fireEvent.click(elements[0]);
    
    // Click run
    const runButton = screen.getByRole("button", { name: /Run on Testnet/i });
    fireEvent.click(runButton);
    
    await waitFor(() => {
      expect(startRunMock).toHaveBeenCalledWith("xlm-payment");
    });
    
    expect(mockReplace).toHaveBeenCalledWith("/dashboard?runId=run-123", { scroll: false });
  });

  it("restores run when runId is in URL", async () => {
    mockSearchParams = new URLSearchParams("?runId=run-456");
    const getRunMock = vi.spyOn(api, "getRun").mockResolvedValue({ ...mockRun, id: "run-456" });
    const startRunMock = vi.spyOn(api, "startRun");
    
    render(<Dashboard />);
    
    // Should show restoring state immediately
    expect(screen.getByText("Restoring run...")).toBeDefined();
    
    // Should call getRun
    expect(getRunMock).toHaveBeenCalledWith("run-456", expect.any(AbortSignal));
    
    // Should display the run ID eventually
    await screen.findByText("run-456");
    expect(startRunMock).not.toHaveBeenCalled(); // Absense of POST request on restore
  });

  it("shows unavailable state for missing run", async () => {
    mockSearchParams = new URLSearchParams("?runId=invalid-run");
    const getRunMock = vi.spyOn(api, "getRun").mockRejectedValue(new Error("Not found"));
    
    render(<Dashboard />);
    
    // Should show error state
    await screen.findByText("Run unavailable");
    expect(screen.getByText("Not found")).toBeDefined();
    
    // Clicking dismiss clears URL
    const dismissButton = screen.getByRole("button", { name: /Dismiss/i });
    fireEvent.click(dismissButton);
    
    expect(mockReplace).toHaveBeenCalledWith("/dashboard", { scroll: false });
  });
});

describe("Dashboard Sequential Polling and Recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSearchParams = new URLSearchParams("?runId=run-123");
    vi.spyOn(api, "listScenarios").mockResolvedValue([mockScenarios[0]]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it("polls sequentially with exponential backoff on transient failures", async () => {
    const getRunMock = vi.spyOn(api, "getRun")
      .mockResolvedValueOnce({ ...mockRun, status: "pending" })
      .mockRejectedValueOnce(new Error("Network glitch 1"))
      .mockRejectedValueOnce(new Error("Network glitch 2"))
      .mockResolvedValueOnce({ ...mockRun, status: "passed" });

    render(<Dashboard />);

    await act(async () => { await Promise.resolve(); });
    expect(getRunMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("run-123")).toBeDefined(); 

    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    expect(getRunMock).toHaveBeenCalledTimes(2); 

    expect(screen.getByText("Monitoring paused")).toBeDefined();
    expect(screen.getByText("Network glitch 1")).toBeDefined();

    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    expect(getRunMock).toHaveBeenCalledTimes(3); 

    expect(screen.getByText("Network glitch 2")).toBeDefined();

    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve(); });
    expect(getRunMock).toHaveBeenCalledTimes(4); 

    expect(screen.queryByText("Monitoring paused")).toBeNull();
  });

  it("stops polling and clears run when RUN_NOT_FOUND occurs", async () => {
    const notFoundError = new api.ApiError("Not Found", "RUN_NOT_FOUND");
    const getRunMock = vi.spyOn(api, "getRun")
      .mockResolvedValueOnce({ ...mockRun, status: "pending" })
      .mockRejectedValueOnce(notFoundError);

    render(<Dashboard />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("run-123")).toBeDefined();

    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });

    expect(screen.getByText("Couldn't complete the request")).toBeDefined();
    expect(screen.getByText("The requested run could not be found. It may have expired.")).toBeDefined();

    expect(mockReplace).toHaveBeenCalledWith("/dashboard", { scroll: false });

    const callCount = getRunMock.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(10000); await Promise.resolve(); });
    expect(getRunMock).toHaveBeenCalledTimes(callCount);
  });

  it("exposes Resume Monitoring button when retries are exhausted", async () => {
    const getRunMock = vi.spyOn(api, "getRun")
      .mockResolvedValueOnce({ ...mockRun, status: "pending" });

    for (let i = 0; i < 5; i++) {
      getRunMock.mockRejectedValueOnce(new Error(`Fail ${i}`));
    }

    render(<Dashboard />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("run-123")).toBeDefined();

    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(4000); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(8000); await Promise.resolve(); });

    const resumeBtn = screen.getByRole("button", { name: "Resume Monitoring" });
    expect(resumeBtn).toBeDefined();
    
    const callCount = getRunMock.mock.calls.length;
    expect(callCount).toBe(6); 
    await act(async () => { vi.advanceTimersByTime(20000); await Promise.resolve(); });
    expect(getRunMock).toHaveBeenCalledTimes(6); 

    getRunMock.mockResolvedValueOnce({ ...mockRun, status: "pending" });
    act(() => { fireEvent.click(resumeBtn); });

    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); });
    expect(getRunMock).toHaveBeenCalledTimes(7);
  });
});
