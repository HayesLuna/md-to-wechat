import { test as base, expect, request } from '@playwright/test';
// The cloud proxy's CA is already trusted by Node's injected CA bundle.
// Chromium's root store is different; do not disable TLS verification or alter
// its persistent trust. Relay only this real, TLS-verified sample image response.
// This verifies URL insertion/decoding, but does not claim direct Chromium egress.
const SAMPLE_IMAGE='https://raw.githubusercontent.com/github/explore/main/topics/markdown/markdown.png';
export const test=base.extend({page:async({page},use)=>{
 const network=process.env.HTTPS_PROXY?await request.newContext({proxy:{server:process.env.HTTPS_PROXY}}):undefined;
 if(network)await page.route(SAMPLE_IMAGE,async route=>{const response=await network.get(SAMPLE_IMAGE);if(!response.ok())throw new Error(`Sample image HTTP ${response.status()}`);await route.fulfill({response});});
 await use(page);await network?.dispose();
}});
export { expect };
