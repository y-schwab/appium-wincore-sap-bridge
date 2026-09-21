import type { Browser } from 'webdriverio';
import { remote } from 'webdriverio';

export const APPIUM_SERVER = {
    hostname: '127.0.0.1',
    port: 4723,
    path: '/',
};

/**
 * SAP GUI attach is keyed by connection/session index inside the running
 * `saplogon.exe` scripting engine, not by window — there is no fixture app to spawn
 * the way the Java / .NET bridges have. A live SAP Logon with an open, logged-in
 * session is a precondition for every e2e test here (the local ABAP backend that
 * provides one lives in the appium-wincore-test-apps sibling repo, `sap/`).
 */
export async function createSapGuiSession(extraCaps?: Record<string, unknown>): Promise<Browser> {
    const driver = await remote({
        ...APPIUM_SERVER,
        capabilities: {
            platformName: 'Windows',
            'appium:automationName': 'Wincore',
            'appium:shouldCloseApp': false,
            ...extraCaps,
        } as WebdriverIO.Capabilities,
    });
    await driver.setTimeout({ implicit: 3000 });
    return driver;
}

export async function quitSession(driver: Browser | null): Promise<void> {
    try {
        await driver?.deleteSession();
    } catch {
        // noop — session may already be terminated
    }
}
