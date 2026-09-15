import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Dashboard } from "./dashboard";
import { getRun, listScenarios, startRun, type RunReport } from "../lib/api";

// Mock next/navigation
const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => "/dashboard",
  useSearchParams: () => mockSearchParams,
}));

// Mock API
vi.mock("../lib/api", () => ({
  getRun: vi.fn(),
  listScenarios: vi.fn(),
  startRun: vi.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

const mockScenario = {
  id: "test-scenario",
  name: "Test Scenario",
  description: "A test scenario",
  version: 1,
  schemaVersion: 1,
  contentHash: "hash",
  network: "testnet",
  accounts: [],
  assets: [],
  steps: [],
  assertions: [],
};

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

describe("Dashboard URL Restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    vi.mocked(listScenarios).mockResolvedValue([mockScenario]);
  });

  it("updates URL with runId without reloading when startRun is called", async () => {
    vi.mocked(startRun).mockResolvedValue(mockRun);
    
    render(<Dashboard />);
    
    // Wait for scenarios to load
    const elements = await screen.findAllByText("Test Scenario");
    
    // Click scenario to select it
    fireEvent.click(elements[0]);
    
    // Click run
    const runButton = screen.getByRole("button", { name: /Run on Testnet/i });
    fireEvent.click(runButton);
    
    await waitFor(() => {
      expect(startRun).toHaveBeenCalledWith("test-scenario");
    });
    
    expect(mockReplace).toHaveBeenCalledWith("/dashboard?runId=run-123", { scroll: false });
  });

  it("restores run when runId is in URL", async () => {
    mockSearchParams = new URLSearchParams("?runId=run-456");
    vi.mocked(getRun).mockResolvedValue({ ...mockRun, id: "run-456" });
    
    render(<Dashboard />);
    
    // Should show restoring state immediately
    expect(screen.getByText("Restoring run...")).toBeDefined();
    
    // Should call getRun
    expect(getRun).toHaveBeenCalledWith("run-456", expect.any(AbortSignal));
    
    // Should display the run ID eventually
    await screen.findByText("run-456");
    expect(startRun).not.toHaveBeenCalled(); // Absense of POST request on restore
  });

  it("shows unavailable state for missing run", async () => {
    mockSearchParams = new URLSearchParams("?runId=invalid-run");
    vi.mocked(getRun).mockRejectedValue(new Error("Not found"));
    
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
