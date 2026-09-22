import type { Browser } from 'webdriverio';
import { remote } from 'webdriverio';

export const APPIUM_SERVER = {
    hostname: '127.0.0.1',
    port: 4723,
    path: '/',
};

const SAP_LOGON_EXE = process.env.SAP_LOGON_EXE ?? 'C:\\Program Files (x86)\\SAP\\FrontEnd\\SapGui\\saplogon.exe';
const SAP_CONNECTION = process.env.SAP_CONNECTION ?? 'A4H';

/**
 * Session rooted at the SAP Logon window. The driver launches `saplogon.exe` itself
 * (`appium:app`), or — via `appium:noReset` — attaches to an instance that's already
 * running, so SAP Logon never has to be opened by hand. `shouldCloseApp: false` keeps
 * it (and any open SAP connection) alive between suites.
 *
 * SAP attach itself is keyed by connection/session index inside the scripting engine,
 * not by window, so which saplogon.exe window ends up as the session root doesn't
 * matter to the `sap*` commands — only to {@link openConnectionFromSapLogon}, which
 * only runs when nothing is open yet (i.e. the SAP Logon window is the only one).
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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Opens `SAP_CONNECTION` (default `"A4H"`) the way a user would: double-click its
 * entry in the SAP Logon connection list. SAP Logon exposes each entry through UIA as
 * a ListItem (list view) or DataItem (details view) named after the entry.
 */
export async function openConnectionFromSapLogon(driver: Browser): Promise<void> {
    const entry = await driver.$(`//ListItem[@Name='${SAP_CONNECTION}'] | //DataItem[@Name='${SAP_CONNECTION}']`);
    await entry.waitForExist({
        timeout: 15_000,
        timeoutMsg: `Connection '${SAP_CONNECTION}' not found in the SAP Logon window (override with SAP_CONNECTION).`,
    });
    await driver.executeScript('windows: click', [{ elementId: entry.elementId, times: 2, interClickDelayMs: 100 }]);
}

interface AttachResult {
    attached: boolean;
    reason?: string;
    [key: string]: unknown;
}

/**
 * Attach to the SAP GUI scripting engine, opening `SAP_CONNECTION` from the SAP Logon
 * UI first if nothing is open yet (`reason: "no_open_connection"`). Retries for a while
 * because both halves lag: the scripting engine's COM moniker registers a few seconds
 * after SAP Logon starts (attach throws until then), and a freshly opened connection's
 * session appears a moment after its window does. Throws with the last reason seen if
 * attach never succeeds, rather than leaving a test to fail on some unrelated later
 * assertion.
 */
export async function bootstrapSapSession(driver: Browser, connectionIndex = 0, sessionIndex = 0): Promise<AttachResult> {
    const deadline = Date.now() + 45_000;
    let opened = false;
    let lastReason = 'unknown reason';

    while (Date.now() < deadline) {
        try {
            const status = await driver.executeScript('windows: attachSapGui', [{ connectionIndex, sessionIndex }]) as AttachResult;
            if (status.attached) {return status;}

            lastReason = status.reason ?? lastReason;
            if (status.reason === 'no_open_connection' && !opened) {
                await openConnectionFromSapLogon(driver);
                opened = true;
            }
        } catch (err) {
            lastReason = (err as Error).message;
        }
        await delay(1000);
    }

    throw new Error(`sap.attach failed after 45s: ${lastReason} — is the SAP backend reachable and scripting enabled?`);
}
