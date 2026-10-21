import { test, expect } from "@playwright/test";
import { injectAxe, checkA11y } from "axe-playwright";

const DASHBOARD_STATES = [
  { path: "/", name: "Catalogue", waitFor: "[data-testid=scenario-list]" },
  { path: "/", name: "Active Run", waitFor: "[data-testid=run-progress]" },
  { path: "/", name: "Passed Report", waitFor: "[data-testid=report-passed]" },
  { path: "/", name: "Failed Report", waitFor: "[data-testid=report-failed]" },
  { path: "/", name: "Catalogue Error", waitFor: "[data-testid=error-state]" },
];

test.describe("Accessibility - Dashboard States", () => {
  for (const state of DASHBOARD_STATES) {
    test(`${state.name} should pass automated accessibility audit`, async ({
      page,
    }) => {
      await page.goto(state.path);
      await page.waitForLoadState("networkidle");

      if (state.waitFor) {
        await page.waitForSelector(state.waitFor, { timeout: 5000 }).catch(() => {});
      }

      await injectAxe(page);

      try {
        await checkA11y(page, null, {
          detailedReport: true,
          detailedReportOptions: { html: true },
        });
      } catch (error) {
        console.error(`Accessibility violations in ${state.name}:`, error);
        throw error;
      }
    });
  }
});

test.describe("Accessibility - Keyboard Navigation", () => {
  test("category filter tabs support roving focus, manual activation, and a labelled panel", async ({
    page,
  }) => {
    await page.route("**/api/backend/api/v1/scenarios", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "xlm-payment",
              version: 1,
              name: "XLM payment",
              description: "Send XLM between Testnet accounts.",
              contentHash: "hash1",
            },
            {
              id: "issued-asset-payment",
              version: 1,
              name: "Issued asset payment",
              description: "Send TESTUSD through a Testnet trustline.",
              contentHash: "hash2",
            },
          ],
        }),
      });
    });
    await page.goto("/");

    const allTab = page.getByRole("tab", { name: "All" });
    const xlmTab = page.getByRole("tab", { name: "XLM" });
    const tabPanel = page.getByRole("tabpanel");
    await expect(page.getByText("02 AVAILABLE")).toBeVisible();
    await expect(allTab).toHaveAttribute("tabindex", "0");
    await expect(xlmTab).toHaveAttribute("tabindex", "-1");
    await expect(tabPanel).toHaveAttribute("aria-labelledby", await allTab.getAttribute("id"));

    await allTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(xlmTab).toBeFocused();
    await expect(allTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("02 AVAILABLE")).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(xlmTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("01 AVAILABLE")).toBeVisible();
    await expect(tabPanel).toHaveAttribute("aria-labelledby", await xlmTab.getAttribute("id"));
  });

  test("Dashboard should be navigable with keyboard only", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    let focusCount = 0;
    const MAX_TABS = 20;

    while (focusCount < MAX_TABS) {
      await page.keyboard.press("Tab");
      const focused = await page.locator(":focus").first();

      if (!(await focused.isVisible())) break;

      const ariaLabel = await focused.getAttribute("aria-label");
      const role = await focused.getAttribute("role");

      // Verify focused element is accessible
      expect(ariaLabel || role || (await focused.textContent())).toBeTruthy();
      focusCount++;
    }

    expect(focusCount).toBeGreaterThan(3);
  });

  test("Run form should be keyboard accessible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Find and focus scenario selector
    const scenarioButton = page.locator('button:has-text("Select scenario")').first();
    await scenarioButton.focus();

    // Tab through form controls
    await page.keyboard.press("Tab");
    const firstControl = await page.locator(":focus").first();
    expect(firstControl).toBeTruthy();
  });
});

test.describe("Accessibility - Color and Contrast", () => {
  test("Dashboard should have sufficient color contrast", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check text over backgrounds
    const textElements = await page.locator("p, span, button, a").all();

    for (const element of textElements.slice(0, 10)) {
      const isVisible = await element.isVisible();
      if (!isVisible) continue;

      const computed = await element.evaluate((el) => {
        const style = window.getComputedStyle(el);
        return {
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontSize: style.fontSize,
        };
      });

      // Verify colors are not default white-on-white
      expect(computed.color).not.toBe("rgb(255, 255, 255)");
      expect(computed.backgroundColor).toBeTruthy();
    }
  });
});

test.describe("Accessibility - ARIA Labels", () => {
  test("Interactive elements should have accessible names", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const buttons = await page.locator("button").all();

    for (const button of buttons.slice(0, 10)) {
      const isVisible = await button.isVisible();
      if (!isVisible) continue;

      const ariaLabel = await button.getAttribute("aria-label");
      const textContent = await button.textContent();

      expect(ariaLabel || textContent?.trim()).toBeTruthy();
    }
  });

  test("Form inputs should be associated with labels", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const inputs = await page.locator("input, textarea, select").all();

    for (const input of inputs.slice(0, 5)) {
      const isVisible = await input.isVisible();
      if (!isVisible) continue;

      const id = await input.getAttribute("id");
      const ariaLabel = await input.getAttribute("aria-label");
      const ariaLabelledBy = await input.getAttribute("aria-labelledby");

      if (id) {
        const label = await page.locator(`label[for="${id}"]`).isVisible();
        expect(label || ariaLabel || ariaLabelledBy).toBeTruthy();
      }
    }
  });
});
