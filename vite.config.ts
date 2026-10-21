import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function git(...args: string[]) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export default defineConfig(({ command }) => {
  const buildInfo = {
    version: JSON.parse(
      readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
    ).version as string,
    revision:
      process.env.GITHUB_SHA?.slice(0, 7) ||
      git('rev-parse', '--short=7', 'HEAD') ||
      'unknown',
    builtAt: new Date().toISOString(),
    development: command === 'serve',
    localChanges: !process.env.GITHUB_SHA && !!git('status', '--porcelain'),
  };
  return {
    base: './',
    define: { __BUILD_INFO__: JSON.stringify(buildInfo) },
    plugins: [
      react(),
      {
        name: 'mojian-build-info',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'build-info.json',
            source: JSON.stringify(buildInfo),
          });
        },
      },
    ],
    server: { host: '0.0.0.0', port: 5173 },
    build: { chunkSizeWarningLimit: 1800 },
  };
});
