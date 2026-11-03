import { defineConfig } from '@playwright/test';
import chromium from '@sparticuz/chromium';

// Keep tests on their own origin; never silently test another local project.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5175';
const port = new URL(baseURL).port || '5175';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
// GitHub runners install Playwright's matching browser. Keep the packaged
// serverless browser only for Linux environments with restricted downloads.
const launchOptions = executablePath
  ? { executablePath }
  : process.platform === 'linux' && process.env.GITHUB_ACTIONS !== 'true'
    ? {
        executablePath: await chromium.executablePath(),
        args: chromium.args.filter(
          (arg) =>
            ![
              '--single-process',
              '--disable-web-security',
              '--allow-running-insecure-content',
              '--disable-site-isolation-trials',
            ].includes(arg) && !arg.startsWith('--disable-features='),
        ),
        env: { ...process.env, XDG_CACHE_HOME: '/tmp/mojian-cache' },
      }
    : {};

// Balance files using successful CI timings (2026-11-03), rather than test
// counts: the old equal-count shards took 2.3, 2.2 and 5.2 minutes. New files
// automatically join group 3; the groups remain disjoint and cover all tests.
const group1 = [
  'sharing',
  'draft-reorder',
  'editor-code-behavior',
  'read-only',
  'markdown-copy',
  'mermaid-rendering',
  'review-regressions',
  'startup-version',
  'heading-labels',
  'draft-order',
].map((name) => `**/${name}.spec.ts`);
const group2 = [
  'workflows',
  'highlight',
  'markdown-paste',
  'list-indent',
  'drafts',
  'json-format',
  'task-clipboard',
  'source-readability',
  'media-preview',
  'smoke',
  'optimization',
  'json-layout',
].map((name) => `**/${name}.spec.ts`);

export default defineConfig({
  testDir: './tests',
  // Keep one worker per runner so performance tests never compete for CPU.
  workers: 1,
  projects: [
    { name: '1', testMatch: group1 },
    { name: '2', testMatch: group2 },
    { name: '3', testIgnore: [...group1, ...group2] },
  ],
  timeout: 30000,
  retries: 0,
  reporter: 'list',
  outputDir: '/tmp/mojian-test-results',
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    launchOptions,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${Number(port)} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
