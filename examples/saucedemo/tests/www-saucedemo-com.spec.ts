import { test, expect } from '../fixtures/pages';

test.describe("veriplay: https://www.saucedemo.com", () => {
  test("[happy] logs in with valid credentials", async ({ page, saucedemoComPage }) => {
    await saucedemoComPage.goto(saucedemoComPage.url);
    await saucedemoComPage.usernameInput.fill("standard_user");
    await saucedemoComPage.passwordInput.fill("secret_sauce");
    await saucedemoComPage.loginButton.click();
    await expect(page).toHaveURL(new RegExp("inventory.html"));
  });

  test("[negative] rejects invalid password", async ({ page, saucedemoComPage }) => {
    await saucedemoComPage.goto("https://www.saucedemo.com");
    await saucedemoComPage.usernameInput.fill("");
    await saucedemoComPage.passwordInput.fill("");
    await saucedemoComPage.loginButton.click();
  });

  test("[happy] User can successfully login", async ({ page, saucedemoComPage }) => {
    await saucedemoComPage.goto(saucedemoComPage.url);
    await saucedemoComPage.usernameInput.fill("standard_user");
    await saucedemoComPage.passwordInput.fill("secret_sauce");
    await saucedemoComPage.usernameInput.fill("standard_user");
    await saucedemoComPage.passwordInput.fill("secret_sauce");
    await saucedemoComPage.usernameInput.fill("wrong_user");
    await saucedemoComPage.passwordInput.fill("wrong_password");
  });
});
