import {
  test as base,
  expect,
  request,
  type BrowserContext,
  type Page,
} from '@playwright/test';
// The cloud proxy's CA is already trusted by Node's injected CA bundle.
// Chromium's root store is different; do not disable TLS verification or alter
// its persistent trust. Relay only this real, TLS-verified sample image response.
// This verifies URL insertion/decoding, but does not claim direct Chromium egress.
const SAMPLE_IMAGE =
  'https://raw.githubusercontent.com/github/explore/main/topics/markdown/markdown.png';

export const test = base.extend({
  page: async ({ page }, use) => {
    const network = process.env.HTTPS_PROXY
      ? await request.newContext({ proxy: { server: process.env.HTTPS_PROXY } })
      : undefined;
    if (network)
      await page.route(SAMPLE_IMAGE, async (route) => {
        const response = await network.get(SAMPLE_IMAGE);
        if (!response.ok())
          throw new Error(`Sample image HTTP ${response.status()}`);
        await route.fulfill({ response });
      });
    await use(page);
    await network?.dispose();
  },
});

async function resetSharedEditorPage(page: Page) {
  const vp = page.viewportSize();
  if (!vp || vp.width !== 1440 || vp.height !== 1000)
    await page.setViewportSize({ width: 1440, height: 1000 });

  const closePreview = page.locator('button[aria-label="关闭预览"]');
  if (await closePreview.isVisible()) await closePreview.click();

  const readOnly = page.getByRole('switch', { name: '只读模式' });
  if (
    (await readOnly.isVisible()) &&
    (await readOnly.getAttribute('aria-checked')) === 'true'
  )
    await readOnly.click();

  const wysiwyg = page.getByRole('button', { name: '所见即所得', exact: true });
  if (
    (await wysiwyg.isVisible()) &&
    !(await page.locator('.article-editor').isVisible())
  )
    await wysiwyg.click();

  await page.waitForFunction(() => !!(window as any).__mojian?.editor);
  await page.evaluate(() => {
    delete (navigator.clipboard as unknown as Record<string, unknown>).write;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const scroll = document.querySelector('.writing-scroll');
    if (scroll) {
      scroll.scrollTop = 0;
      scroll.scrollLeft = 0;
    }
    window.scrollTo(0, 0);
    window.getSelection()?.removeAllRanges();
  });
}

/**
 * Reuses one loaded editor page per worker across pure-editing specs,
 * eliminating redundant `page.goto('/')` cold boots while resetting editor
 * document, undo history, viewport, routes, and transient UI between tests.
 */
export const editorTest = test.extend<
  object,
  { sharedEditorContext: BrowserContext; sharedEditorPage: Page }
>({
  sharedEditorContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  sharedEditorPage: [
    async ({ sharedEditorContext }, use) => {
      const page = await sharedEditorContext.newPage();
      await page.goto('/');
      await page.waitForFunction(() => !!(window as any).__mojian?.editor);
      await use(page);
      await page.close();
    },
    { scope: 'worker' },
  ],
  context: async ({ sharedEditorContext, browser, hasTouch }, use) => {
    if (hasTouch) {
      const touchContext = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        hasTouch: true,
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      await use(touchContext);
      await touchContext.close();
      return;
    }
    await use(sharedEditorContext);
  },
  page: async ({ sharedEditorPage, context, hasTouch }, use) => {
    if (hasTouch) {
      const touchPage = await context.newPage();
      await touchPage.goto('/');
      await touchPage.waitForFunction(() => !!(window as any).__mojian?.editor);
      await use(touchPage);
      await touchPage.close();
      return;
    }
    await resetSharedEditorPage(sharedEditorPage);
    await use(sharedEditorPage);
    await sharedEditorPage.unrouteAll({ behavior: 'ignoreErrors' });
  },
});

export { expect };
