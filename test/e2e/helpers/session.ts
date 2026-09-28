import type { Browser } from 'webdriverio';
import { remote } from 'webdriverio';

export const APPIUM_SERVER = {
    hostname: '127.0.0.1',
    port: 4723,
    path: '/',
};

/** Implicit wait for element finds; SapDemo.exists turns it off for polling checks. */
export const IMPLICIT_WAIT_MS = 3000;

const SAP_LOGON_EXE = process.env.SAP_LOGON_EXE ?? 'C:\\Program Files (x86)\\SAP\\FrontEnd\\SapGui\\saplogon.exe';

/**
 * Session rooted at the SAP Logon window. The driver launches `saplogon.exe` itself
 * (`appium:app`), or — via `appium:noReset` — attaches to an instance that's already
 * running, so SAP Logon never has to be opened by hand. `shouldCloseApp: false` keeps
 * it (and any open SAP connection) alive between suites.
 */
export async function createSapGuiSession(extraCaps?: Record<string, unknown>): Promise<Browser> {
    const driver = await remote({
        ...APPIUM_SERVER,
        capabilities: {
            platformName: 'Windows',
            'appium:automationName': 'Wincore',
            'appium:app': SAP_LOGON_EXE,
            'appium:noReset': true,
            'appium:shouldCloseApp': false,
            'appium:ms:waitForAppLaunch': 30,
            ...extraCaps,
        } as WebdriverIO.Capabilities,
    });
    await driver.setTimeout({ implicit: IMPLICIT_WAIT_MS });
    return driver;
}

export async function quitSession(driver: Browser | null): Promise<void> {
    try {
        await driver?.deleteSession();
    } catch {
        // noop — session may already be terminated
    }
}
