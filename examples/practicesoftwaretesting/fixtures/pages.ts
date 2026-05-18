import { test as base, expect } from '@playwright/test';
import { PracticesoftwaretestingComPage } from '../pages/PracticesoftwaretestingComPage';

type Fixtures = {
  practicesoftwaretestingComPage: PracticesoftwaretestingComPage;
};

export const test = base.extend<Fixtures>({
  practicesoftwaretestingComPage: async ({ page }, use) => {
    await use(new PracticesoftwaretestingComPage(page));
  },
});

export { expect };
