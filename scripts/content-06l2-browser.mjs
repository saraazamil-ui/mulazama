/** Isolated loopback review fixture. Does not start the product or Quran sessions. */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { chromiumLaunchOptions } from "./playwright-browser.mjs";
const launchOptions = chromiumLaunchOptions();
const root = resolve("content/06l2"),
  out = resolve("docs/06l2/evidence/content-display");
await mkdir(out, { recursive: true });
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".txt": "text/plain; charset=utf-8",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const name = decodeURIComponent(url.pathname).slice(1) || "review.html";
    if (
      ![
        "review.html",
        "review.css",
        "review.js",
        "tanzil-uthmani-1.1.txt",
      ].includes(name)
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    const bytes = await readFile(resolve(root, name));
    res.writeHead(200, {
      "content-type": mime[extname(name)],
      "cache-control": "no-store",
    });
    res.end(bytes);
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address(),
  base = `http://127.0.0.1:${address.port}`;
let browser;
const report = {
  startedAt: new Date().toISOString(),
  reviewOnly: true,
  productSessionStarted: false,
  source: "Tanzil1.1 supplemental unapproved",
  tests: [],
  humanScientificApproval: false,
  officialFontApproved: false,
};
try {
  browser = await chromium.launch(launchOptions);
  report.browserVersion = browser.version();
  const context = await browser.newContext({
      locale: "ar-SA",
      viewport: { width: 320, height: 760 },
    }),
    page = await context.newPage();
  const documentResponse = await page.goto(base + "/review.html");
  await expect(page.locator("select")).toBeEnabled();
  expect(documentResponse.headers()["content-type"]).toBe(
    "text/html; charset=utf-8",
  );
  expect(
    await page.evaluate(() => [
      document.characterSet,
      document.documentElement.dir,
      document.documentElement.lang,
    ]),
  ).toEqual(["UTF-8", "rtl", "ar"]);
  const source = await readFile(
    resolve(root, "tanzil-uthmani-1.1.txt"),
    "utf8",
  );
  const rows = source
    .split(/\r?\n/)
    .filter((line) => /^\d+\|/.test(line))
    .map((line) => {
      const [surah, ayah, ...text] = line.split("|");
      return { key: surah + ":" + ayah, surah, text: text.join("|") };
    });
  let compared = 0;
  for (let n = 1; n <= 114; n++) {
    await page.locator("select").selectOption(String(n));
    const actual = await page
      .locator("#ayahs li")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          key: node.dataset.key,
          text: node.querySelector(".ayah").textContent,
        })),
      );
    const expected = rows
      .filter((r) => r.surah === String(n))
      .map(({ key, text }) => ({ key, text }));
    expect(actual).toEqual(expected);
    compared += actual.length;
  }
  expect(compared).toBe(6236);
  report.tests.push({
    id: "L2CONTENTWEB01",
    status: "passed",
    scope:
      "6236 exact DOM text and identifiers across all114surahs; byte-to-DOM fidelity only",
  });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const surah of [1, 57, 114]) {
      await page.locator("select").selectOption(String(surah));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await page.locator(".ayah").allTextContents()).toEqual(
        rows.filter((r) => r.surah === String(surah)).map((r) => r.text),
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: resolve(out, `review-${width}-surah-${surah}.png`),
        fullPage: false,
      });
    }
    report.tests.push({
      id: `L2CONTENTWEB-${width}`,
      status: "passed",
      scope:
        "Surahs 1/57/114: exact DOM, RTL, no viewport overflow, automated axe; no human glyph/rasm judgment",
    });
  }
  report.fontFamily = await page
    .locator(".ayah")
    .first()
    .evaluate((node) => getComputedStyle(node).fontFamily);
  await page.locator("select").selectOption("2");
  await page.locator("select").focus();
  await expect(page.locator("select")).toBeFocused();
  await page.keyboard.press("3");
  await page.keyboard.press("Tab");
  await expect(page.locator("select")).toHaveValue("3");
  await expect(page.locator("#ayahs li").first()).toHaveAttribute(
    "data-key",
    "3:1",
  );
  report.tests.push({
    id: "L2CONTENTWEB-keyboard",
    status: "passed",
    scope:
      "native select type-ahead and Tab changes displayed surah using keyboard only",
  });
  // A separate context with corrupted source response must render zero ayahs.
  const badContext = await browser.newContext(),
    bad = await badContext.newPage();
  await bad.route("**/tanzil-uthmani-1.1.txt", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "1|1|SYNTHETIC_INVALID_CONTENT\n",
    }),
  );
  await bad.goto(base + "/review.html");
  await expect(bad.getByRole("alert")).toHaveText(
    "اختلفت بصمة المصدر؛ لم يعرض النص.",
  );
  await expect(bad.locator(".ayah")).toHaveCount(0);
  report.tests.push({
    id: "L2CONTENTWEB-corruption",
    status: "passed",
    scope: "wrong pinned bytes never rendered",
  });
} catch (error) {
  report.tests.push({
    id: "execution",
    status: "failed",
    error: String(error),
  });
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  report.finishedAt = new Date().toISOString();
  report.counts = {
    executed: report.tests.length,
    passed: report.tests.filter((test) => test.status === "passed").length,
    failed: report.tests.filter((test) => test.status === "failed").length,
    skipped: 0,
  };
  await writeFile(
    resolve(out, "results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
