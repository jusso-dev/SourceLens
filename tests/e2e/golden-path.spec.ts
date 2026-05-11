import { expect, test } from "@playwright/test";
import path from "node:path";

const FIXTURE = path.resolve(__dirname, "fixtures/welcome.txt");

/** End-to-end smoke covering: signup → upload → ingest → search → ask. */
test("golden path: signup, upload, search, ask", async ({ page }) => {
  test.setTimeout(120_000);

  const id = Date.now();
  const email = `e2e-${id}@example.com`;
  const password = "playwright-e2e-pass";
  const name = `E2E ${id}`;

  // -- Sign up --
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /create account/i }).click();

  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole("heading", { name: /workspace/i })).toBeVisible();

  // -- Upload a document --
  await page.goto("/app/documents");
  await page.locator('input[type="file"]').setInputFiles(FIXTURE);

  // The document row should appear with a status that eventually becomes "indexed".
  const row = page.getByRole("row").filter({ hasText: "welcome.txt" }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("indexed", { timeout: 30_000 });

  // -- Search --
  await page.goto("/app/search");
  await page.getByPlaceholder(/search across your documents/i).fill("banana");
  await page.getByRole("button", { name: /^search$/i }).click();
  await expect(page.getByText(/welcome\.txt/).first()).toBeVisible({ timeout: 15_000 });

  // -- Ask --
  await page.goto("/app/ask");
  await page.getByPlaceholder(/ask anything/i).fill("What is SourceLens?");
  await page.getByRole("button", { name: /^ask$/i }).click();

  // Either a streamed delta or the final answer must appear.
  await expect(page.getByText(/DEMO MODE/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /sources/i })).toBeVisible({ timeout: 15_000 });
});
