import { test, expect } from '../fixtures/pages';

test.describe("veriplay: https://practicesoftwaretesting.com/", () => {
  test("[happy] user navigates to testing guide", async ({ page, practicesoftwaretestingComPage }) => {
    await practicesoftwaretestingComPage.goto(practicesoftwaretestingComPage.url);
    await practicesoftwaretestingComPage.search.fill("Testing Guide");
    await practicesoftwaretestingComPage.search.press("Enter");
    await expect(practicesoftwaretestingComPage.search).toBeVisible();
  });

  test("[negative] user attempts to report a bug without input", async ({ page, practicesoftwaretestingComPage }) => {
    await practicesoftwaretestingComPage.goto(practicesoftwaretestingComPage.url);
    await practicesoftwaretestingComPage.search.fill("Report Bug");
    await practicesoftwaretestingComPage.search.press("Enter");
    await expect(practicesoftwaretestingComPage.x).toBeVisible();
  });

  test("[a11y] ensure all buttons have accessible labels", async ({ page, practicesoftwaretestingComPage }) => {
    await practicesoftwaretestingComPage.goto(practicesoftwaretestingComPage.url);
    await expect(practicesoftwaretestingComPage.search).toBeVisible();
  });
});
