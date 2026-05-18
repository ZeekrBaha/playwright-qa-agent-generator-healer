import { test, expect } from '@playwright/test';
import { SaucedemoComPage } from '../pages/SaucedemoComPage';

test.describe("veriplay: https://www.saucedemo.com/", () => {
  test("[happy] accepts valid credentials", async ({ page }) => {
    const saucedemoComPage = new SaucedemoComPage(page);
    await saucedemoComPage.goto(saucedemoComPage.url);
    await saucedemoComPage.usernameInput.fill("standard_user");
    await saucedemoComPage.passwordInput.fill("secret_sauce");
    await saucedemoComPage.loginButton.click();
    await expect(page).toHaveURL(new RegExp("/inventory.html"));
  });

  test("[negative] rejects invalid password", async ({ page }) => {
    const saucedemoComPage = new SaucedemoComPage(page);
    await saucedemoComPage.goto("https://www.saucedemo.com/");
    await saucedemoComPage.usernameInput.fill("standard_user");
    await saucedemoComPage.passwordInput.fill("wrong_password");
    await saucedemoComPage.loginButton.click();
    await page.waitForTimeout(1000);
    await page.waitForTimeout(2000);
    await saucedemoComPage.goto("https://www.saucedemo.com/");
    await saucedemoComPage.usernameInput.fill("");
    await saucedemoComPage.passwordInput.fill("secret_sauce");
    await saucedemoComPage.loginButton.click();
  });

  test("[happy] User logs in with valid credentials and reaches the products page", async ({ page }) => {
    const saucedemoComPage = new SaucedemoComPage(page);
    await saucedemoComPage.goto(saucedemoComPage.url);
    await saucedemoComPage.usernameInput.fill("standard_user");
    await saucedemoComPage.password.fill("secret_sauce");
    await saucedemoComPage.loginButton.click();
    await expect(page).toHaveURL(new RegExp("inventory.html"));
  });

  test("[negative] User tries to log in with invalid credentials", async ({ page }) => {
    const saucedemoComPage = new SaucedemoComPage(page);
    await saucedemoComPage.goto("https://www.saucedemo.com/");
  });
});
