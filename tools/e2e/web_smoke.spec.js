const { test, expect } = require('@playwright/test');

const baseUrl = process.env.BOXMATCH_E2E_BASE_URL || 'http://127.0.0.1:8787';

async function openFlutterRoute(page, route = '') {
  await page.goto(`${baseUrl}/${route}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelector('flutter-view') ||
      document.querySelector('flt-glass-pane') ||
      document.querySelector('[flt-renderer]') ||
      document.body?.innerText?.includes('Enable accessibility'),
    null,
    { timeout: 30_000 }
  );
}

test.describe('Boxmatch Flutter web smoke', () => {
  test('loads core routes without global runtime errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (message) => {
      const text = message.text();
      if (
        message.type() === 'error' ||
        text.includes('BOXMATCH_ERROR') ||
        text.includes('Uncaught')
      ) {
        consoleErrors.push(text);
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await openFlutterRoute(page);
    await expect(page).toHaveTitle(/Boxmatch|展場剩食|Surplus/i);

    for (const route of ['#/map', '#/enterprise/new', '#/my-reservations']) {
      await openFlutterRoute(page, route);
    }

    expect(consoleErrors, [
      'ERROR: Flutter web emitted runtime errors during smoke navigation.',
      'WHY: The web build must boot and route across core pages without global exceptions.',
      'FIX: Search the console error text for BOXMATCH_ERROR/Uncaught and patch the failing route or initialization path.',
      consoleErrors.join('\n')
    ].join('\n')).toEqual([]);
  });
});
