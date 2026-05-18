import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class SaucedemoComPage extends BasePage {
  readonly url = "https://www.saucedemo.com";
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.getByRole("textbox", { name: "username" });
    this.passwordInput = page.getByRole("textbox", { name: "password" });
    this.loginButton = page.getByRole("button", { name: "login" });
  }
}
