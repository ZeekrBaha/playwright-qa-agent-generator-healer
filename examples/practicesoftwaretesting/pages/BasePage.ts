import type { Page } from '@playwright/test';

export class BasePage {
  constructor(protected page: Page) {}
  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }
}
