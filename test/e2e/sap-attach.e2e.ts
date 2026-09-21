import { describe, it, expect, afterEach } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';

/**
 * Needs SAP Logon running with an open, logged-in session (scripting enabled) — see
 * README. Skipped by default; set RUN_SAP_E2E=1 once a live backend is available.
 */
describe.skipIf(!process.env.RUN_SAP_E2E)('sap-bridge attach', () => {
    let driver: Browser | null = null;

    afterEach(async () => {
        await quitSession(driver);
        driver = null;
    });

    it('attaches to the running SAP GUI scripting engine', async () => {
        driver = await createSapGuiSession();
        const status = await driver.executeScript('windows: attachSapGui', [{ connectionIndex: 0, sessionIndex: 0 }]) as { attached: boolean };
        expect(status.attached).toBe(true);

        const source = await driver.executeScript('windows: sapPageSource', []);
        expect(typeof source).toBe('string');
        expect(source as string).toContain('<');
    });
});
