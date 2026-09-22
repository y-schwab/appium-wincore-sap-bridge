import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession, bootstrapSapSession } from './helpers/session.js';

/**
 * Connection lifecycle only — no element interaction. See sap-interaction.e2e.ts for
 * find/read/write coverage.
 *
 * Cold-start friendly: the only precondition is the SAP backend itself already being
 * up (the ABAP container — see README, appium-wincore-test-apps sibling repo, sap/).
 * The session launches SAP Logon itself, and `bootstrapSapSession` opens the
 * connection from the SAP Logon window if nothing is open yet.
 */
describe('sap-bridge attach', () => {
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
        const status = await bootstrapSapSession(driver);
        expect(status.attached).toBe(true);
        expect(status.sessionInfo).toBeDefined();

        const afterAttach = await driver.executeScript('windows: sapGuiStatus', []) as { attached: boolean };
        expect(afterAttach.attached).toBe(true);
    });

    it('detach drops the session and subsequent sap commands fail', async () => {
        await bootstrapSapSession(driver);

        await driver.executeScript('windows: detachSapGui', []);
        const afterDetach = await driver.executeScript('windows: sapGuiStatus', []) as { attached: boolean };
        expect(afterDetach.attached).toBe(false);

        await expect(driver.executeScript('windows: sapPageSource', [])).rejects.toThrow();
    });

    it('sap commands fail cleanly with no attach at all', async () => {
        await expect(driver.executeScript('windows: sapPageSource', [])).rejects.toThrow();
    });
});
