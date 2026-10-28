import { defineConfig } from '@playwright/test';
import chromium from '@sparticuz/chromium';

// Keep tests on their own origin; never silently test another local project.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5175';
const port = new URL(baseURL).port || '5175';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const launchOptions = executablePath
  ? { executablePath }
  : process.platform === 'linux'
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

export default defineConfig({
  testDir: './tests',
  // CI shards individual tests evenly across runners. Each runner still uses
  // one worker so CPU-throttled measurements never compete with another test.
  fullyParallel: !!process.env.CI,
  workers: 1,
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
