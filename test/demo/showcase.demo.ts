import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from '../e2e/helpers/session.js';
import { ENTER_BUTTON, SapDemo, delay, errMsg } from '../e2e/helpers/sap-demo.js';

/**
 * Showcase for a screen recording — not an e2e test. One WebDriver session drives
 * SAP GUI (through this plugin), a native window switch and a web page (over CDP):
 *
 *   1. SU3 → Defaults tab: open the Date Format dropdown with a click, pick the ISO
 *      entry as an element (windows: select), put the original back
 *      (windows: setValue by text).
 *   2. Menu bar: System → Status... (windows: invoke), show the popup, Continue.
 *   3. SE16: switch output to ALV grid ("User Parameters" popup), T000 → selection
 *      screen → Multiple Selection popup: fill its table with clients 000 and 001,
 *      Copy → Execute → ALV grid; read client 001.
 *   4. Detour to the browser: start Chrome (remote debugging on), switch to its
 *      window by title, enter its page (WEBVIEW_ context), follow the Gmail link;
 *      back to NATIVE_APP and — by title — to the SAP window.
 *   5. Back in SAP: select client 001's grid row, proving the session is SAP again.
 *   6. Put SE16's settings back, /n to SAP Easy Access, close Chrome.
 *
 * Changes nothing permanently: the dropdown is restored unsaved, SE16's user
 * parameters are set back.
 *
 * Run: npm run demo. Record: SAP_DEMO_RECORD=1 SAP_DEMO_PACE_MS=1500 npm run demo
 * → test-output/showcase/recording.mp4. Chrome at CHROME_PATH (default: the standard
 * install path); DevTools port CHROME_DEBUG_PORT (default 9222).
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access; nothing
 * else listening on the DevTools port.
 */
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CHROME_DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9222);
const CHROME_WINDOW = 'Google - Google Chrome'; // window title of google.com in Chrome

// SU3
const DEFAULTS_TAB = "//GuiTab[@Text='Defaults']";
const DATE_FORMAT = "//GuiComboBox[@Name=//GuiLabel[@Text='Date Format']/@Name]";
const ISO_DATE = 'YYYY-MM-DD (Gregorian Date, ISO 8601)';
const US_DATE = 'MM/DD/YYYY (Gregorian Date)';

// SE16
const USER_PARAMETERS_BUTTON = '~wnd[0]/tbar[1]/btn[6]'; // "User Parameters... (F6)"
const SETTINGS_POPUP = 'User-Specific Settings';
const TRANSFER_BUTTON = "//GuiButton[starts-with(@Tooltip,'Transfer')]";
const TABLE_NAME_FIELD = '~wnd[0]/usr/ctxtDATABROWSE-TABLENAME';
const MULTIPLE_SELECTION_BUTTON = '~wnd[0]/usr/btn%_I1_%_APP_%-VALU_PUSH'; // MANDT's "Multiple selection"
const MULTIPLE_SELECTION_POPUP = 'Multiple Selection';
const COPY_BUTTON = '~wnd[1]/tbar[0]/btn[8]'; // "Copy (F8)"
const EXECUTE_BUTTON = '~wnd[0]/tbar[1]/btn[8]'; // "Execute (F8)"
const GRID = "//GuiShell[@SubType='GridView']";
const CLIENTS = ['000', '001'];
const ALV_SETTINGS = ['ALV Grid Display', 'Field Label'];
const ORIGINAL_SETTINGS = ['Standard SE16 list', 'Field Name'];

/** Single-value cell in row `i` of the Multiple Selection popup's table. */
const singleValueCell = (i: number) => `//GuiTableControl/TableRow[@Index='${i}']/*[contains(@Name,'SLOW_I')]`;

const demo = new SapDemo('showcase', 'Showcase: SAP GUI, a browser and back');
let chrome: ChildProcess | undefined;

/** SE16 → User Parameters popup → pick radio buttons by text → Transfer. */
async function setUserParameters(choices: string[]): Promise<boolean> {
    const driver = demo.driver;
    const popup = await demo.runTransaction('/nSE16', 'Open SE16', 'Data Browser')
        && await demo.openPopup(USER_PARAMETERS_BUTTON, 'User Parameters → popup', SETTINGS_POPUP);
    if (!popup) {return false;}
    try {
        for (const choice of choices) {
            await demo.pause();
            await (await driver.$(`//GuiRadioButton[@Text='${choice}']`)).click();
        }
        await demo.pause();
        await (await driver.$(TRANSFER_BUTTON)).click();
        await driver.waitUntil(async () => !(await driver.getWindowHandles()).includes(popup), { timeout: 10_000 });
        await driver.switchToWindow(demo.mainWindow);
        demo.record(`SE16 settings: ${choices.join(', ')}`, 'PASS', 'transferred');
        return true;
    } catch (err) {
        return demo.fail(`SE16 settings: ${choices.join(', ')}`, errMsg(err));
    }
}

/** Step 1: open the dropdown with the mouse, pick an entry element with windows: select, restore. */
async function dropdown(): Promise<void> {
    const driver = demo.driver;
    await demo.pause();
    await (await driver.$(DEFAULTS_TAB)).click();
    const date = await driver.$(DATE_FORMAT);
    const original = { key: String(await date.getAttribute('Key')), text: await date.getText() };

    await demo.pause();
    await date.click(); // opens the list
    demo.record('Date Format: open the list', 'PASS', `selected "${original.text}"`);
    // The entry is an element of its own (ComboBoxEntry); windows: select picks it.
    const wanted = original.text === ISO_DATE ? US_DATE : ISO_DATE;
    const entry = await driver.$(`${DATE_FORMAT}/ComboBoxEntry[@Value='${wanted}']`);
    await demo.pause();
    await driver.executeScript('windows: select', [{ elementId: entry.elementId }]);
    const picked = await date.getText();
    if (picked === wanted && await entry.isSelected()) {
        demo.record('Date Format: pick an entry (windows: select)', 'PASS', `"${picked}" (key ${await date.getAttribute('Key')})`);
    } else {
        await demo.fail('Date Format: pick an entry (windows: select)', `dropdown shows "${picked}", wanted "${wanted}"`);
    }

    await demo.pause();
    await driver.executeScript('windows: setValue', [{ elementId: date.elementId, value: original.text }]);
    const back = String(await date.getAttribute('Key'));
    if (back === original.key) {
        demo.record('Date Format: restore by text', 'PASS', `"${original.text}" (windows: setValue)`);
    } else {
        await demo.fail('Date Format: restore by text', `key ${back}, expected ${original.key}`);
    }
}

/** Step 2: System → Status... from the menu bar, show the popup, Continue. */
async function menu(): Promise<void> {
    const driver = demo.driver;
    const item = "//GuiMenubar/GuiMenu[@Text='System']/GuiMenu[@Text='Status...']";
    const popup = await demo.openPopup(item, 'Menu: System → Status...', 'Status', 10_000, 'invoke');
    if (!popup) {return;}
    const user = await (await driver.$("//GuiTextField[@Name='SYST-UNAME']")).getText();
    demo.record('Status popup', 'PASS', `user "${user}"`);
    await demo.pause();
    await demo.pause(); // let the popup show in a recording
    await (await driver.$('~wnd[1]/tbar[0]/btn[0]')).click(); // Continue
    await driver.waitUntil(async () => !(await driver.getWindowHandles()).includes(popup), { timeout: 10_000 });
    await driver.switchToWindow(demo.mainWindow);
}

/** Step 3: fill the Multiple Selection table with clients, run SE16 → ALV grid. */
async function tableToGrid(): Promise<boolean> {
    const driver = demo.driver;
    const onSelection = await demo.typeInto(TABLE_NAME_FIELD, 'Table Name', 'T000')
        && await demo.pressAndWait(ENTER_BUTTON, 'T000 → selection screen', 'Selection Screen');
    if (!onSelection) {return false;}

    const popup = await demo.openPopup(MULTIPLE_SELECTION_BUTTON, 'Multiple selection → popup', MULTIPLE_SELECTION_POPUP);
    if (!popup) {return false;}
    try {
        for (const [i, client] of CLIENTS.entries()) {
            await demo.pause();
            await (await driver.$(singleValueCell(i))).setValue(client); // typed, like a user
        }
        demo.record('Fill the table', 'PASS', `clients ${CLIENTS.join(', ')}`);
        await demo.pause();
        await (await driver.$(COPY_BUTTON)).click();
        await driver.waitUntil(async () => !(await driver.getWindowHandles()).includes(popup), { timeout: 10_000 });
        await driver.switchToWindow(demo.mainWindow);
    } catch (err) {
        return demo.fail('Fill the table', errMsg(err));
    }

    await demo.pause();
    await (await driver.$(EXECUTE_BUTTON)).click();
    const grid = await driver.$(GRID);
    if (!(await grid.waitForExist({ timeout: 15_000 }).then(() => true, () => false))) {
        return demo.fail('ALV grid', `no ${GRID} within 15s`);
    }
    const rows: string[] = [];
    for (const client of CLIENTS) {
        const cell = `${GRID}//GridRow/GridCell[@Column='MTEXT' and ../GridCell[@Column='MANDT' and @Text='${client}']]`;
        rows.push(`${client} ${await (await driver.$(cell)).getText()}`);
    }
    demo.record('ALV grid', 'PASS', rows.join('; '));
    return true;
}

/** Step 4: Chrome, its page over CDP, the Gmail link, back to SAP by title. */
async function browserDetour(sapTitle: string): Promise<boolean> {
    const driver = demo.driver;
    const profile = join(tmpdir(), `sap-showcase-chrome-${CHROME_DEBUG_PORT}`);
    chrome = spawn(CHROME_PATH, [
        `--remote-debugging-port=${CHROME_DEBUG_PORT}`, `--user-data-dir=${profile}`,
        '--no-first-run', '--no-default-browser-check', 'https://www.google.com',
    ], { detached: true, stdio: 'ignore' });
    chrome.unref();

    try {
        // Native: the Chrome window, by title.
        await driver.waitUntil(async () => {
            try {
                await driver.executeScript('windows: switchToWindowByTitle', [{ title: CHROME_WINDOW }]);
                return true;
            } catch { return false; }
        }, { timeout: 20_000, interval: 1000 });
        demo.record('Switch to Chrome (by title)', 'PASS', `"${await driver.getTitle()}"`);

        // Web: the page, as a WEBVIEW_ context.
        let contexts: { id: string; url?: string }[] = [];
        await driver.waitUntil(async () => {
            contexts = await driver.execute('mobile: getContexts', [{}]) as { id: string; url?: string }[];
            return contexts.some((c) => c.id.startsWith('WEBVIEW_') && (c.url ?? '').includes('google'));
        }, { timeout: 20_000, interval: 1000 });
        const page = contexts.find((c) => c.id.startsWith('WEBVIEW_') && (c.url ?? '').includes('google'))!;
        await driver.switchContext(page.id);
        demo.record('Enter the page (webview)', 'PASS', `${page.id} ${page.url}`);

        // Google's cookie consent, if shown: the privacy-preserving answer.
        const reject = await driver.$('button*=Reject all');
        if (await reject.isExisting()) {
            await demo.pause();
            await reject.click();
        }

        const gmail = await driver.$('=Gmail');
        await gmail.waitForExist({ timeout: 10_000 });
        await demo.pause();
        await gmail.click();
        await driver.waitUntil(async () => /gmail|mail\.google/.test(await driver.getUrl()), { timeout: 15_000 });
        await demo.pause();
        demo.record('Gmail link', 'PASS', `"${await driver.getTitle()}" ${await driver.getUrl()}`);
    } catch (err) {
        await demo.fail('Browser detour', errMsg(err));
    }

    // Back: leave the page, then re-root the session at the SAP window by its title.
    try {
        await driver.switchContext('NATIVE_APP');
        await demo.pause();
        await driver.executeScript('windows: switchToWindowByTitle', [{ title: sapTitle }]);
        const back = await driver.getWindowHandle();
        if (back === demo.mainWindow) {
            demo.record('Back to SAP (by title)', 'PASS', `"${await driver.getTitle()}"`);
            return true;
        }
        return demo.fail('Back to SAP (by title)', `window ${back}, SAP is ${demo.mainWindow}`);
    } catch (err) {
        return demo.fail('Back to SAP (by title)', errMsg(err));
    }
}

/** Step 5: act on a sap: element again — select client 001's grid row. */
async function selectClient(): Promise<void> {
    const driver = demo.driver;
    const row = await driver.$(`${GRID}//GridRow[GridCell[@Column='MANDT' and @Text='001']]`);
    await demo.pause();
    await driver.executeScript('windows: select', [{ elementId: await row.elementId }]);
    const selected = String(await row.getAttribute('IsSelected')).toLowerCase() === 'true';
    await demo.pause();
    if (selected) {demo.record('Select client 001 in the grid', 'PASS', 'IsSelected=true');} else {await demo.fail('Select client 001 in the grid', 'not selected');}
}

function closeChrome(): void {
    if (!chrome?.pid) {return;}
    try { execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* already gone */ }
    chrome = undefined;
}

describe('Showcase: SAP GUI, a browser and back', () => {
    beforeAll(async () => {
        demo.resetOutput();
        // Webview capabilities: which DevTools port to look at for WEBVIEW_ contexts.
        // They change nothing about SAP.
        demo.driver = await createSapGuiSession({
            'appium:webviewEnabled': true,
            'appium:webviewDevtoolsPort': CHROME_DEBUG_PORT,
        });
    });

    afterAll(async () => {
        closeChrome();
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('drives SAP, a browser and SAP again in one session', async () => {
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }
        await demo.startRecording();

        try {
            // 1–2. SU3: dropdown, then the menu bar.
            if (await demo.runTransaction('/nSU3', 'Open SU3', 'Maintain User Profile')) {
                await dropdown().catch((err) => demo.fail('Dropdown', errMsg(err)));
                await menu().catch((err) => demo.fail('Menu', errMsg(err)));
            }

            // 3–5. SE16 as ALV grid, the browser detour, back to the grid.
            if (await setUserParameters(ALV_SETTINGS)) {
                try {
                    if (await tableToGrid() && await browserDetour('Data Browser')) {
                        await selectClient();
                    }
                } catch (err) {
                    await demo.fail('SE16 flow', errMsg(err));
                } finally {
                    // 6. SE16 settings back, whatever happened.
                    await demo.closePopups();
                    await setUserParameters(ORIGINAL_SETTINGS);
                }
            }
        } catch (err) {
            await demo.fail('Showcase', errMsg(err));
        }

        await demo.backHome();
        await delay(1000);
        await demo.stopRecording();
        closeChrome();

        expect(demo.failed).toEqual([]);
    }, 600_000);
});
