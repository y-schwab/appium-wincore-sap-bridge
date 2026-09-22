import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';

/**
 * Exercises a real login: fill client/user/password on the SAP Logon screen,
 * sendVKey(Enter), confirm the login fields are gone (i.e. the screen navigated
 * away — SAP Easy Access or straight into a start transaction).
 *
 * Idempotent by design: if the session is already logged in when this test starts
 * (RSYST fields absent), it treats that as success rather than failing — safe to run
 * against a session left logged in from a previous run. It does NOT log off
 * afterward, so sap-interaction.e2e.ts (which assumes the login screen) must run
 * against a fresh, logged-out session.
 *
 * Requires SAP_USER / SAP_PASSWORD env vars (no default — these are real
 * credentials, even if only for a disposable dev-trial system, and don't belong
 * hardcoded in the repo). SAP_CLIENT is optional; omit it to use the login screen's
 * default client.
 */
const LOGIN_CLIENT_FIELD = 'wnd[0]/usr/txtRSYST-MANDT';
const LOGIN_USER_FIELD = 'wnd[0]/usr/txtRSYST-BNAME';
const LOGIN_PASSWORD_FIELD = 'wnd[0]/usr/pwdRSYST-BCODE';

const SAP_USER = process.env.SAP_USER;
const SAP_PASSWORD = process.env.SAP_PASSWORD;
const SAP_CLIENT = process.env.SAP_CLIENT;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('sap-bridge login', () => {
    let driver: Browser;

    beforeAll(async () => {
        if (!SAP_USER || !SAP_PASSWORD) {
            throw new Error('sap-login.e2e.ts requires SAP_USER and SAP_PASSWORD env vars (SAP_CLIENT optional).');
        }

        driver = await createSapGuiSession();
        const status = await driver.executeScript('windows: attachSapGui', [{ connectionIndex: 0, sessionIndex: 0 }]) as {
            attached: boolean;
            reason?: string;
        };
        if (!status.attached) {
            throw new Error(`sap.attach failed: ${status.reason ?? 'unknown reason'} — is SAP Logon open?`);
        }
    });

    afterAll(async () => {
        await quitSession(driver);
    });

    it('logs in with the provided credentials (or is already logged in)', async () => {
        const before = await driver.executeScript('windows: sapPageSource', []) as string;
        const atLoginScreen = before.includes('RSYST');

        if (!atLoginScreen) {
            // Already past the login screen from a prior run — this IS the success state
            // this test checks for, just reached a different way.
            return;
        }

        if (SAP_CLIENT) {
            const clientId = await driver.executeScript('windows: sapFindElement', [LOGIN_CLIENT_FIELD]) as string;
            await driver.executeScript('windows: sapSetValue', [clientId, SAP_CLIENT]);
        }

        const userId = await driver.executeScript('windows: sapFindElement', [LOGIN_USER_FIELD]) as string;
        await driver.executeScript('windows: sapSetValue', [userId, SAP_USER]);

        const passwordId = await driver.executeScript('windows: sapFindElement', [LOGIN_PASSWORD_FIELD]) as string;
        await driver.executeScript('windows: sapSetValue', [passwordId, SAP_PASSWORD]);

        await driver.executeScript('windows: sapSendVKey', [0]); // Enter
        await delay(1500); // screen transition is not instantaneous

        const after = await driver.executeScript('windows: sapPageSource', []) as string;
        expect(after).not.toContain('RSYST');
    });
});
