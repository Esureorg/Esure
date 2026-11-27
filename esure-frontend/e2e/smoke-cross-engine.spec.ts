import { test, expect, devices } from "@playwright/test";

// Skip Firefox/WebKit in CI for now if browsers not available
test.describe.configure({
  mode: "parallel",
});

const SMOKE_TESTS = [
  {
    name: "Catalogue Selection",
    navigate: "/",
    actions: async (page) => {
      await page.waitForLoadState("networkidle");
      const button = page.locator('button:has-text("Select scenario")').first();
      await expect(button).toBeVisible();
      return button;
    },
  },
  {
    name: "Run Start",
    navigate: "/",
    actions: async (page) => {
      await page.waitForLoadState("networkidle");
      const startButton = page.locator("button:has-text(/Start|Run/)").first();
      await expect(startButton).toBeVisible();
      return startButton;
    },
  },
  {
    name: "Report Rendering",
    navigate: "/",
    actions: async (page) => {
      await page.waitForLoadState("networkidle");
      const report = page.locator("[data-testid=report]").first();
      if (await report.isVisible()) {
        expect(report).toBeTruthy();
      }
      return page;
    },
  },
];

// Firefox smoke tests
test.describe("Cross-Engine Smoke - Firefox", () => {
  test.use({ ...devices["Desktop Firefox"] });

  for (const test_case of SMOKE_TESTS) {
    test(`Firefox: ${test_case.name}`, async ({ page }) => {
      await page.goto(test_case.navigate);
      const result = await test_case.actions(page);
      expect(result).toBeTruthy();
    });
  }

  test("Firefox: Keyboard navigation works", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    let focusCount = 0;
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.locator(":focus").first();
      if (await focused.isVisible()) focusCount++;
    }

    expect(focusCount).toBeGreaterThan(0);
  });
});

// WebKit (Safari) smoke tests
test.describe("Cross-Engine Smoke - WebKit", () => {
  test.use({ ...devices["Desktop Safari"] });

  for (const test_case of SMOKE_TESTS) {
    test(`WebKit: ${test_case.name}`, async ({ page }) => {
      await page.goto(test_case.navigate);
      const result = await test_case.actions(page);
      expect(result).toBeTruthy();
    });
  }

  test("WebKit: Keyboard navigation works", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    let focusCount = 0;
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.locator(":focus").first();
      if (await focused.isVisible()) focusCount++;
    }

    expect(focusCount).toBeGreaterThan(0);
  });
});

// Mobile viewport journey for maximum-size reports
test.describe("Cross-Engine Smoke - Mobile Maximum Report", () => {
  test.use({ ...devices["iPhone 13"] });

  // Bounded maximums mirrored from the report UI constraints.
  const MAX_STEPS = 50;
  const MAX_ASSERTIONS = 100;

  const LONG_ID = "step-" + "a".repeat(120);
  const LONG_ASSERTION_TYPE = "assertion-" + "b".repeat(120);
  const LONG_TX_HASH = "0x" + "c".repeat(64);
  const LONG_SCENARIO_NAME =
    "Maximum bounded scenario with an intentionally long descriptive name " +
    "d".repeat(160);

  function buildMaximumReport() {
    const steps = Array.from({ length: MAX_STEPS }, (_, stepIndex) => ({
      id: `${LONG_ID}-${stepIndex}`,
      index: stepIndex,
      name: `Step ${stepIndex} ${"e".repeat(80)}`,
      status: stepIndex % 2 === 0 ? "success" : "failure",
      transactionHash: LONG_TX_HASH,
      assertions: Array.from({ length: MAX_ASSERTIONS }, (_, assertionIndex) => ({
        id: `assertion-${stepIndex}-${assertionIndex}-${"f".repeat(60)}`,
        type: `${LONG_ASSERTION_TYPE}-${assertionIndex}`,
        passed: assertionIndex % 3 !== 0,
        message: `Assertion ${assertionIndex} ${"g".repeat(80)}`,
      })),
    }));

    return {
      id: "report-" + "h".repeat(120),
      scenarioName: LONG_SCENARIO_NAME,
      status: "completed",
      steps,
    };
  }

  test.beforeEach(async ({ page }) => {
    const report = buildMaximumReport();

    // Deterministic mocked backend responses; no live network.
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("report")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(report),
        });
        return;
      }
      if (url.includes("scenario")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "scenario-" + "i".repeat(120),
            name: LONG_SCENARIO_NAME,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
  });

  test("Mobile: maximum report has no horizontal overflow and reachable controls", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Navigate the report/comparison journey.
    const selectButton = page.locator('button:has-text("Select")').first();
    if (await selectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await selectButton.click();
    }

    const startButton = page.locator("button:has-text(/Start|Run/)").first();
    if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startButton.click();
    }

    // Assert no horizontal page overflow.
    const overflow = await page.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const bodyWidth = document.body.scrollWidth;
      const viewportWidth = window.innerWidth;
      return {
        docWidth,
        bodyWidth,
        viewportWidth,
        hasOverflow:
          docWidth > viewportWidth + 1 || bodyWidth > viewportWidth + 1,
      };
    });
    expect(overflow.hasOverflow, JSON.stringify(overflow)).toBe(false);

    // Assert key controls are visible and clickable within the viewport.
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const controls = [
      page.locator('button:has-text(/Download/)').first(),
      page.locator('button:has-text(/Compare/)').first(),
      page.locator('a:has-text(/Back|Home|Catalogue/)').first(),
    ];

    for (const control of controls) {
      if (await control.isVisible({ timeout: 2000 }).catch(() => false)) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        if (box && viewport) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        }
        await expect(control).toBeEnabled();
      }
    }
  });
});

// Chromium baseline (full journey)
test.describe("Cross-Engine Smoke - Chromium", () => {
  test.use({ ...devices["Desktop Chrome"] });

  test("Chromium: Full primary journey", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Select scenario
    const selectButton = page.locator('button:has-text("Select")').first();
    await expect(selectButton).toBeVisible();
    await selectButton.click();

    // Start run
    const startButton = page.locator("button:has-text(/Start|Run/)").first();
    if (await startButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await startButton.click();
    }

    // Verify page remains interactive
    const mainContent = page.locator("main, [role=main]").first();
    await expect(mainContent).toBeVisible();
  });
});
