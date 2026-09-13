import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Dashboard, filterScenario } from "./dashboard";
import * as api from "@/lib/api";

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

