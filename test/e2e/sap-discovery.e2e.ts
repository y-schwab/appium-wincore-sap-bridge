import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';

/**
 * Discovery only — no assertions on SAP structure. Launches SAP Logon through the
 * driver, then dumps what the session can see before and after `windows: attachSapGui`
 * into test-output/ so the real UIA / SAP scripting trees can be inspected and the
 * other suites' locators built from them. Doesn't open a connection itself.
 */
const OUTPUT_DIR = resolve(process.cwd(), 'test-output');

function save(name: string, content: unknown): void {
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    writeFileSync(resolve(OUTPUT_DIR, name), text, 'utf8');
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('sap-bridge discovery', () => {
    let driver: Browser;

    beforeAll(async () => {
        mkdirSync(OUTPUT_DIR, { recursive: true });
        driver = await createSapGuiSession();
    });

    afterAll(async () => {
        await quitSession(driver);
    });

    it('dumps page source before and after attach', async () => {
        const before = await driver.getPageSource();
        save('01-page-source-before-attach.xml', before);
        expect(before.length).toBeGreaterThan(0);

        // The scripting engine's COM moniker registers a few seconds after a fresh SAP
        // Logon start, and attach throws until then — retry only on throw, then record
        // whatever came back (including `attached: false`).
        let attach: unknown;
        const deadline = Date.now() + 20_000;
        while (true) {
            try {
                attach = await driver.executeScript('windows: attachSapGui', [{}]);
                break;
            } catch (err) {
                attach = { error: (err as Error).message };
                if (Date.now() > deadline) {break;}
                await delay(1000);
            }
        }
        save('02-attach-result.json', attach);

        save('03-page-source-after-attach.xml', await driver.getPageSource());

        // Once attached, the plugin's tree provider owns the SAP session's windows: a
        // plain getPageSource rooted at one of them comes from the SAP tree, not UIA.
        const { attached, windowHandles } = attach as { attached?: boolean; windowHandles?: string[] };
        if (attached && windowHandles?.length) {
            await driver.switchToWindow(windowHandles[0]);
            save('04-page-source-sap-window.xml', await driver.getPageSource());
        }
    }, 90_000);
});
