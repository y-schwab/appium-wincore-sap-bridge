import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';

/**
 * Connection lifecycle only — no element interaction. See sap-interaction.e2e.ts for
 * find/read/write coverage.
 *
 * Needs SAP Logon running with an open SAP session (scripting enabled) — see README.
 * Skipped by default; set RUN_SAP_E2E=1 once a live backend is available
 * (appium-wincore-test-apps sibling repo, sap/).
 */
describe.skipIf(!process.env.RUN_SAP_E2E)('sap-bridge attach', () => {
    let driver: Browser;

    beforeEach(async () => {
        driver = await createSapGuiSession();
    });

    afterEach(async () => {
        await quitSession(driver);
    });

    it('reports not attached before sap.attach is called', async () => {
        const status = await driver.executeScript('windows: sapGuiStatus', []) as { attached: boolean };
        expect(status.attached).toBe(false);
    });

    it('attaches to the running SAP GUI scripting engine', async () => {
        const status = await driver.executeScript('windows: attachSapGui', [{ connectionIndex: 0, sessionIndex: 0 }]) as {
            attached: boolean;
            reason?: string;
            sessionInfo?: { systemName: string; user: string };
        };

        if (!status.attached) {
            // Engine reachable but nobody logged in — a real (if incomplete) result, not a
            // harness failure. Surface it so a misconfigured backend is easy to diagnose.
            expect(status.reason).toBe('no_open_connection');
            return;
        }

        expect(status.sessionInfo).toBeDefined();

        const afterAttach = await driver.executeScript('windows: sapGuiStatus', []) as { attached: boolean };
        expect(afterAttach.attached).toBe(true);
    });

    it('detach drops the session and subsequent sap commands fail', async () => {
        const status = await driver.executeScript('windows: attachSapGui', [{ connectionIndex: 0, sessionIndex: 0 }]) as { attached: boolean };
        if (!status.attached) {
            return; // covered by the attach test above
        }

        await driver.executeScript('windows: detachSapGui', []);
        const afterDetach = await driver.executeScript('windows: sapGuiStatus', []) as { attached: boolean };
        expect(afterDetach.attached).toBe(false);

        await expect(driver.executeScript('windows: sapPageSource', [])).rejects.toThrow();
    });

    it('sap commands fail cleanly with no attach at all', async () => {
        await expect(driver.executeScript('windows: sapPageSource', [])).rejects.toThrow();
    });
});
