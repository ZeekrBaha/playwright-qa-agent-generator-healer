import type { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class PracticesoftwaretestingComPage extends BasePage {
  readonly url = "https://practicesoftwaretesting.com/";
  readonly search: Locator;
  readonly x: Locator;

  constructor(page: Page) {
    super(page);
    this.search = page.getByLabel("Search");
    this.x = page.getByLabel("X");
  }
}
