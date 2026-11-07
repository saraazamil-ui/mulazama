import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** 05-A production entry: no prototype fixture injection and no Quran text package. */
test("BWEB02 identity, real settings persistence and content gate", async ({
  page,
}) => {
  // The named brand button is in the desktop sidebar. Mobile has its own brand.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#S17");
  await expect(
    page.getByRole("button", { name: "مُلازَمَة، ورد اليوم" }),
  ).toBeVisible();
  await expect(
    page.getByText("أدوات فحص النموذج", { exact: false }),
  ).toHaveCount(0);
  const toggle = page.getByRole("checkbox", { name: "تكبير النص" });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(toggle).toBeChecked();
  await page.goto("/#S07");
  await expect(page.getByText("النص المعتمد ينتظر الإضافة")).toBeVisible();
  await expect(page.getByRole("button", { name: /أنهيت التكرار/ })).toHaveCount(
    0,
  );
});

test("BWEB03 encrypted backup inspection rejects wrong password and cancellation preserves data", async ({
  page,
}, info) => {
  await page.goto("/#S18");
  const password = page.getByLabel("كلمة مرور النسخة", { exact: false });
  await password.fill("Mulazama-test-password-2026");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "صدّر النسخة المشفرة" }).click();
  const download = await downloadPromise;
  const path = info.outputPath("mulazama-encrypted-backup.json");
  await download.saveAs(path);
  await password.fill("wrong-password-long-enough");
  await page
    .getByLabel("اختر النسخة المشفرة", { exact: true })
    .setInputFiles(path);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await password.fill("Mulazama-test-password-2026");
  await page
    .getByLabel("اختر النسخة المشفرة", { exact: true })
    .setInputFiles(path);
  await expect(
    page.getByRole("dialog", { name: "مراجعة الملف قبل الاستبدال" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "إلغاء", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const width of [320, 390, 1440]) {
  test(`BWEB0${width===320?4:width===390?5:6} responsive RTL and automated accessibility ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (let n = 1; n <= 19; n++) {
      const id = "S" + String(n).padStart(2, "0");
      await page.goto("/#" + id);
      await expect(
        page.locator('main[data-screen="' + id + '"]'),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expect(page.locator(width<850?'.mobile-brand strong':'.brand strong')).toHaveText('مُلازَمَة');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect.soft(result.violations, id).toEqual([]);
    }
  });
}
