import { execSync, spawn } from 'node:child_process';
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

const SAP_LOGON_EXE = process.env.SAP_LOGON_EXE ?? 'C:\\Program Files (x86)\\SAP\\FrontEnd\\SapGui\\saplogon.exe';
const SAP_CONNECTION = process.env.SAP_CONNECTION ?? 'A4H';

function isSaplogonRunning(): boolean {
    try {
        const out = execSync(
            'powershell -Command "(Get-Process -Name saplogon -ErrorAction SilentlyContinue).Count"',
            { stdio: ['ignore', 'pipe', 'ignore'] },
        ).toString().trim();
        return out !== '' && out !== '0';
    } catch {
        return false;
    }
}

/**
 * Cold-start support: the only thing this suite requires already running is the SAP
 * backend itself (the ABAP container) — not SAP Logon, not an open connection. This
 * launches `saplogon.exe` if it isn't already up and waits for its process to appear
 * (scripting-engine COM moniker registration lags a couple seconds behind that, which
 * `windows: attachSapGui`'s retry loop in {@link bootstrapSapSession} absorbs).
 */
export async function ensureSaplogonRunning(): Promise<void> {
    if (isSaplogonRunning()) {return;}

    const proc = spawn(SAP_LOGON_EXE, [], { detached: true, stdio: 'ignore' });
    proc.unref();

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (isSaplogonRunning()) {return;}
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`saplogon.exe did not start within 20s (looked for it at '${SAP_LOGON_EXE}'; override with SAP_LOGON_EXE).`);
}

interface AttachResult {
    attached: boolean;
    reason?: string;
    [key: string]: unknown;
}

/**
 * Full cold-start bootstrap: make sure `saplogon.exe` is running, attach to the
 * scripting engine, and — if reachable but nothing is open yet
 * (`reason: "no_open_connection"`) — open `SAP_CONNECTION` (default `"A4H"`, the
 * Local Workspace entry name) and attach again. Throws with a clear message if
 * attach still fails after that, rather than leaving a test to fail on some
 * unrelated later assertion.
 */
export async function bootstrapSapSession(driver: Browser, connectionIndex = 0, sessionIndex = 0): Promise<AttachResult> {
    await ensureSaplogonRunning();

    let status = await driver.executeScript('windows: attachSapGui', [{ connectionIndex, sessionIndex }]) as AttachResult;

    if (!status.attached && status.reason === 'no_open_connection') {
        await driver.executeScript('windows: openSapConnection', [{ connectionName: SAP_CONNECTION }]);
        status = await driver.executeScript('windows: attachSapGui', [{ connectionIndex, sessionIndex }]) as AttachResult;
    }

    if (!status.attached) {
        throw new Error(`sap.attach failed: ${status.reason ?? 'unknown reason'} — is the SAP backend reachable and scripting enabled?`);
    }

    return status;
}
