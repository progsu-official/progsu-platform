import { test as base, type Page } from "@playwright/test";

import {
  deleteEventsBySuffix,
  deleteUser,
  makeAdminUser,
  makeFullyOnboardedUser,
  E2E_PASSWORD,
} from "./helpers/seed";
import { signInAndInjectCookies } from "./helpers/session";

type Fixtures = {
  suffix: string;
  adminUserId: string;
  adminPage: Page;
  memberUserId: string;
  memberPage: Page;
  memberAliceUserId: string;
  memberAlicePage: Page;
};

export const test = base.extend<Fixtures>({
  suffix: async ({}, use, testInfo) => {
    const raw = `${Date.now()}-${testInfo.workerIndex}-${testInfo.testId.slice(0, 6)}`;
    try {
      await use(raw);
    } finally {
      // Event cleanup is idempotent — safe even if a scenario didn't create any.
      await deleteEventsBySuffix(raw);
    }
  },

  adminUserId: async ({ suffix }, use) => {
    const { id } = await makeAdminUser(`admin-${suffix}@example.com`);
    try {
      await use(id);
    } finally {
      await deleteUser(id);
    }
  },

  adminPage: async ({ browser, suffix, adminUserId }, use) => {
    void adminUserId; // force fixture ordering
    const email = `admin-${suffix}@example.com`;
    const context = await browser.newContext();
    await signInAndInjectCookies(context, email, E2E_PASSWORD);
    const page = await context.newPage();
    await page.goto("/admin");
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },

  memberUserId: async ({ suffix }, use) => {
    const { id } = await makeFullyOnboardedUser(
      `member-${suffix}@example.com`,
      { firstName: "Member" }
    );
    try {
      await use(id);
    } finally {
      await deleteUser(id);
    }
  },

  memberPage: async ({ browser, suffix, memberUserId }, use) => {
    void memberUserId;
    const email = `member-${suffix}@example.com`;
    const context = await browser.newContext();
    await signInAndInjectCookies(context, email, E2E_PASSWORD);
    const page = await context.newPage();
    await page.goto("/dashboard");
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },

  memberAliceUserId: async ({ suffix }, use) => {
    const { id } = await makeFullyOnboardedUser(
      `alice-${suffix}@example.com`,
      { firstName: "Alice" }
    );
    try {
      await use(id);
    } finally {
      await deleteUser(id);
    }
  },

  memberAlicePage: async ({ browser, suffix, memberAliceUserId }, use) => {
    void memberAliceUserId;
    const email = `alice-${suffix}@example.com`;
    const context = await browser.newContext();
    await signInAndInjectCookies(context, email, E2E_PASSWORD);
    const page = await context.newPage();
    await page.goto("/dashboard");
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
});

export { expect } from "@playwright/test";
