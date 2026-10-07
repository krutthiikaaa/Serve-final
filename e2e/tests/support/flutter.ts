import type { Page } from '@playwright/test';

/**
 * Flutter web draws on a canvas; its semantics tree (the same one screen
 * readers use) exposes the controls as real DOM nodes with roles and labels.
 */
export async function enableFlutterSemantics(page: Page) {
  await page.waitForSelector('flt-semantics-placeholder', { state: 'attached', timeout: 30_000 });
  await page.evaluate(() =>
    document
      .querySelector('flt-semantics-placeholder')
      ?.dispatchEvent(new Event('click', { bubbles: true })),
  );
  await page.waitForTimeout(300);
}

/** Text fields receive keystrokes reliably when focused first. */
export async function typeInto(page: Page, label: string, value: string) {
  await page.getByRole('textbox', { name: label }).click();
  await page.waitForTimeout(200);
  await page.keyboard.type(value, { delay: 10 });
  await page.waitForTimeout(200);
}
