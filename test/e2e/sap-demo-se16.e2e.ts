import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';

/**
 * Demo: a real SAP task driven end to end through standard WebDriver, built up step by
 * step. Goal: from SAP Easy Access, open the Data Browser (SE16), show table T000 (the
 * SAP clients table) and read client 001 from the result grid.
 *
 * Each step captures the screen it lands on (page source + summary), so the next step
 * is written from what SAP actually showed, not guessed.
 *
 *   Step 1 ✅ open SE16 from the command field — same window, one input field
 *             (wnd[0]/usr/ctxtDATABROWSE-TABLENAME), Enter = "Table Contents".
 *   Step 2    enter T000, press Enter → selection screen; press Execute if the
 *             application toolbar has one → result screen.
 *
 * Ends with /n back to SAP Easy Access, so the test can be rerun as is.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo/: SUMMARY.md and one page source per screen
 * (01-home, 02-se16, 03-selection, 04-result, 05-back-home).
 *
 * Env:
 *   SAP_WINDOW_TITLE  partial title of the logged-in window (default: "SAP Easy")
 */
const OUTPUT_DIR = resolve(process.cwd(), 'test-output', 'sap-demo');
const WINDOW_TITLE = process.env.SAP_WINDOW_TITLE ?? 'SAP Easy';

// Standard SAP GUI ids, the same on every screen.
const OKCODE = '~wnd[0]/tbar[0]/okcd'; // command field
const ENTER_BUTTON = '~wnd[0]/tbar[0]/btn[0]'; // green check mark = Enter
const TITLE_BAR = '~wnd[0]/titl';
const STATUS_BAR = '~wnd[0]/sbar';
const TABLE_NAME_FIELD = '~wnd[0]/usr/ctxtDATABROWSE-TABLENAME'; // seen on SE16 in step 1
const TABLE = 'T000'; // SAP clients

/** `sap:/app/con[0]/ses[0]/wnd[0]/…` → `wnd[0]/…`, for readable reports and ~ locators. */
function shortId(id: string): string {
    return id.replace(/^(sap:)?\/app\/con\[\d+\]\/ses\[\d+\]\//, '');
}

type Status = 'PASS' | 'FAIL' | 'INFO';

interface Check {
    step: string;
    status: Status;
    detail: string;
}

const checks: Check[] = [];

function save(name: string, content: unknown): void {
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    writeFileSync(resolve(OUTPUT_DIR, name), text, 'utf8');
}

function record(step: string, status: Status, detail: string): void {
    checks.push({ step, status, detail });
    writeReport();
}

/** Rewritten after every check, so a crash midway still leaves everything seen so far. */
function writeReport(): void {
    const icon: Record<Status, string> = { PASS: '✅', FAIL: '❌', INFO: 'ℹ️' };
    const lines = [
        '# SAP demo: SE16 → T000',
        '',
        `Run: ${new Date().toISOString()}  `,
        `PASS: ${checks.filter((c) => c.status === 'PASS').length} · FAIL: ${checks.filter((c) => c.status === 'FAIL').length}`,
        '',
        '| # | Status | Step | Detail |',
        '| --- | --- | --- | --- |',
        ...checks.map((c, i) =>
            `| ${i + 1} | ${icon[c.status]} ${c.status} | ${c.step} | ${c.detail.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')} |`),
        '',
    ];
    save('SUMMARY.md', lines.join('\n'));
}

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function textOf(driver: Browser, selector: string): Promise<string> {
    try {
        const el = await driver.$(selector);
        return (await el.isExisting()) ? await el.getText() : '(not found)';
    } catch (err) {
        return `(error: ${errMsg(err)})`;
    }
}

/** What a person sees on the current screen: window, title bar, status bar. */
async function describeScreen(driver: Browser): Promise<string> {
    const handles = await driver.getWindowHandles();
    return [
        `window ${await driver.getWindowHandle()} "${await driver.getTitle()}"`,
        `all windows ${JSON.stringify(handles)}`,
        `title bar "${await textOf(driver, TITLE_BAR)}"`,
        `status bar "${await textOf(driver, STATUS_BAR)}"`,
    ].join('\n');
}

/** Every input field on the screen with its id and current text — what the next step will fill in. */
async function listInputFields(driver: Browser): Promise<string> {
    const els = await driver.findElements('xpath', '//GuiCTextField | //GuiTextField');
    const rows: string[] = [];
    for (const e of els) {
        const id = Object.values(e)[0] as string;
        const el = await driver.$(e);
        rows.push(`${shortId(id)} = "${await el.getText()}"`);
    }
    return rows.length ? rows.join('\n') : '(none)';
}

/** Toolbar buttons with their tooltips — how the next step finds Execute & co. */
async function listButtons(driver: Browser): Promise<string> {
    const els = await driver.findElements('xpath', '//GuiToolbar//GuiButton');
    const rows: string[] = [];
    for (const e of els) {
        const id = Object.values(e)[0] as string;
        const el = await driver.$(e);
        rows.push(`${shortId(id)} "${await el.getAttribute('Tooltip')}"`);
    }
    return rows.length ? rows.join('\n') : '(none)';
}

/** Shell controls (grid, tree, toolbar, …) and synthetic grid rows/cells in a page source. */
function describeShells(xml: string): string {
    const shells = [...xml.matchAll(/<GuiShell\b[^>]*\bId="([^"]*)"[^>]*\bSubType="([^"]*)"/g)]
        .map((m) => `${m[2]} ${shortId(m[1])}`);
    const rows = (xml.match(/<GridRow\b/g) ?? []).length;
    const cells = (xml.match(/<GridCell\b/g) ?? []).length;
    return `${shells.length ? shells.join('\n') : '(no GuiShell)'}\nGridRow: ${rows}, GridCell: ${cells}`;
}

/** Page source plus what a person would look at on this screen, under one label. */
async function captureScreen(driver: Browser, label: string, file: string): Promise<void> {
    record(`${label} screen`, 'INFO', await describeScreen(driver));
    let xml = '';
    try {
        xml = await driver.getPageSource();
        save(file, xml);
        record(`Page source on ${label}`, 'PASS', `saved ${file} (${xml.length} chars)`);
    } catch (err) {
        record(`Page source on ${label}`, 'FAIL', errMsg(err));
    }
    const parts: [string, () => Promise<string>][] = [
        ['Input fields', () => listInputFields(driver)],
        ['Toolbar buttons', () => listButtons(driver)],
        ['Shells', async () => describeShells(xml)],
    ];
    for (const [what, fn] of parts) {
        try {
            record(`${what} on ${label}`, 'INFO', await fn());
        } catch (err) {
            record(`${what} on ${label}`, 'FAIL', errMsg(err));
        }
    }
}

/** Waits until the title bar text differs from `before` — i.e. SAP has moved to another screen. */
async function waitForScreenChange(driver: Browser, before: string, timeoutMs = 15_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let now = before;
    while (Date.now() < deadline) {
        now = await textOf(driver, TITLE_BAR);
        if (now !== before && !now.startsWith('(')) {return now;}
        await delay(500);
    }
    return now;
}

/**
 * Types a transaction into the command field and presses the Enter button — what a user
 * does in SAP. Records which way of pressing worked: a real mouse click() first, the
 * scripting Press() through `windows: invoke` as fallback.
 */
async function runTransaction(driver: Browser, tcode: string): Promise<boolean> {
    if (!(await typeInto(driver, OKCODE, 'command field', tcode))) {return false;}
    return pressAndWait(driver, ENTER_BUTTON, `"${tcode}"`);
}

async function typeInto(driver: Browser, selector: string, label: string, value: string): Promise<boolean> {
    try {
        const field = await driver.$(selector);
        await field.setValue(value);
        record(`Type "${value}" in ${label}`, 'PASS', `read back "${await field.getText()}"`);
        return true;
    } catch (err) {
        record(`Type "${value}" in ${label}`, 'FAIL', errMsg(err));
        return false;
    }
}

/** Clicks a toolbar button and waits for SAP to move to another screen. */
async function pressAndWait(driver: Browser, selector: string, after: string): Promise<boolean> {
    const titleBefore = await textOf(driver, TITLE_BAR);
    const button = await driver.$(selector);
    const tooltip = await button.getAttribute('Tooltip').catch(() => '?');
    try {
        await button.click();
        record(`Click "${tooltip}"`, 'PASS', selector);
    } catch (err) {
        record(`Click "${tooltip}"`, 'INFO', `click() failed, trying windows: invoke — ${errMsg(err)}`);
        try {
            await driver.executeScript('windows: invoke', [{ elementId: await button.elementId }]);
            record(`Press "${tooltip}" (windows: invoke)`, 'PASS', 'Press() via scripting');
        } catch (err2) {
            record(`Press "${tooltip}" (windows: invoke)`, 'FAIL', errMsg(err2));
            return false;
        }
    }

    const titleAfter = await waitForScreenChange(driver, titleBefore);
    const moved = titleAfter !== titleBefore;
    const status = moved ? '' : `; status bar "${await textOf(driver, STATUS_BAR)}"`;
    record(`Screen changed after ${after}`, moved ? 'PASS' : 'FAIL', `"${titleBefore}" → "${titleAfter}"${status}`);
    return moved;
}

describe('sap demo: SE16 → T000', () => {
    let driver: Browser;

    beforeAll(async () => {
        rmSync(OUTPUT_DIR, { recursive: true, force: true });
        mkdirSync(OUTPUT_DIR, { recursive: true });
        driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(driver);
    });

    it('shows table T000 in the Data Browser, starting from SAP Easy Access', async () => {
        const failed = () => checks.filter((c) => c.status === 'FAIL');

        // 1. Home: the logged-in SAP Easy Access window, attached.
        try {
            await driver.executeScript('windows: switchToWindowByTitle', [{ title: WINDOW_TITLE }]);
        } catch (err) {
            record(`Switch to "${WINDOW_TITLE}"`, 'FAIL', `${errMsg(err)} — is SAP logged in and on SAP Easy Access?`);
            expect(failed()).toEqual([]);
            return;
        }
        const attach = await driver.executeScript('windows: attachSapGui', [{}]) as Record<string, unknown>;
        if (!attach.attached) {
            record('Attach', 'FAIL', JSON.stringify(attach));
            expect(failed()).toEqual([]);
            return;
        }
        record('Attach', 'PASS', `${attach.system}, windows ${JSON.stringify(attach.windowHandles)}`);
        save('01-page-source-home.xml', await driver.getPageSource());
        record('Home screen', 'INFO', await describeScreen(driver));

        // 2. Open SE16. /n ends whatever runs in this session first, so it works from any screen.
        //    Step 1 showed SE16 opens in the same window — no window switch needed.
        const onSe16 = await runTransaction(driver, '/nSE16');
        if (onSe16) {await captureScreen(driver, 'SE16', '02-page-source-se16.xml');}

        // 3. Table name T000 + Enter ("Table Contents") → the table's selection screen.
        const onSelection = onSe16
            && await typeInto(driver, TABLE_NAME_FIELD, 'Table Name', TABLE)
            && await pressAndWait(driver, ENTER_BUTTON, `Table Name ${TABLE}`);
        if (onSelection) {await captureScreen(driver, 'selection screen', '03-page-source-selection.xml');}

        // 4. Execute (found by tooltip on the application toolbar) → the table contents.
        if (onSelection) {
            const execute = await driver.$("//GuiToolbar[@Name='tbar[1]']//GuiButton[starts-with(@Tooltip,'Execute')]");
            if (!(await execute.isExisting())) {
                record('Find Execute button', 'INFO', 'no tbar[1] button with tooltip "Execute…" — see toolbar buttons above');
            } else {
                const selector = `~${shortId(await execute.elementId)}`;
                record('Find Execute button', 'PASS', selector);
                if (await pressAndWait(driver, selector, 'Execute')) {
                    await captureScreen(driver, 'result', '04-page-source-result.xml');
                }
            }
        }

        // 5. Back home with /n, so the next run starts from SAP Easy Access again.
        if (await runTransaction(driver, '/n')) {
            record('Back home', 'INFO', await describeScreen(driver));
            save('05-page-source-back-home.xml', await driver.getPageSource());
        }

        expect(failed()).toEqual([]);
    }, 120_000);
});
