import { test as base, expect } from '@playwright/test';
import { SaucedemoComPage } from '../pages/SaucedemoComPage';

type Fixtures = {
  saucedemoComPage: SaucedemoComPage;
};

export const test = base.extend<Fixtures>({
  saucedemoComPage: async ({ page }, use) => {
    await use(new SaucedemoComPage(page));
  },
});

export { expect };
