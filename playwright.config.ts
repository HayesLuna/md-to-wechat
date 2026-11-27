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

const perfFiles = ['performance', 'text-selection-performance'].map(
  (name) => `**/${name}.spec.ts`,
);
const perfOnly = process.argv.some(
  (arg) =>
    arg === 'perf' ||
    arg === '--project=perf' ||
    /performance\.spec\.ts/.test(arg),
);

// Balance functional files across parallel CI shards while isolating CPU-bound
// performance tests into their own single-worker `perf` project.
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
].map((name) => `**/${name}.spec.ts`);

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/unit/**'],
  // Functional files run in parallel across workers; performance specs always
  // stay on a single worker so timing assertions never compete for CPU.
  workers: perfOnly ? 1 : process.env.CI ? 2 : 4,
  projects: [
    { name: '1', testMatch: group1 },
    { name: '2', testMatch: group2 },
    {
      name: '3',
      testIgnore: [...group1, ...group2, ...perfFiles, '**/unit/**'],
    },
    { name: 'perf', testMatch: perfFiles },
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
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
