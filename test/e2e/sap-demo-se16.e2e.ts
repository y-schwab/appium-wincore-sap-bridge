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
 * Step 1 (this version): open SE16 from the command field and capture the screen we
 * land on — no guessing about field ids or new windows before we've seen it. Then go
 * back to SAP Easy Access with /n, so the test can be rerun as is.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo/: SUMMARY.md, 01-page-source-home.xml,
 * 02-page-source-se16.xml, 03-page-source-back-home.xml.
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
        rows.push(`${id.replace(/^sap:\/app\/con\[\d+\]\/ses\[\d+\]\//, '')} = "${await el.getText()}"`);
    }
    return rows.length ? rows.join('\n') : '(none)';
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
    const titleBefore = await textOf(driver, TITLE_BAR);
    try {
        const okcd = await driver.$(OKCODE);
        await okcd.setValue(tcode);
        record(`Type "${tcode}" in command field`, 'PASS', `read back "${await okcd.getText()}"`);
    } catch (err) {
        record(`Type "${tcode}" in command field`, 'FAIL', errMsg(err));
        return false;
    }

    const enter = await driver.$(ENTER_BUTTON);
    try {
        await enter.click();
        record('Press Enter button (click)', 'PASS', `tooltip "${await enter.getAttribute('Tooltip').catch(() => '?')}"`);
    } catch (err) {
        record('Press Enter button (click)', 'INFO', `click() failed, trying windows: invoke — ${errMsg(err)}`);
        try {
            await driver.executeScript('windows: invoke', [{ elementId: await enter.elementId }]);
            record('Press Enter button (windows: invoke)', 'PASS', 'Press() via scripting');
        } catch (err2) {
            record('Press Enter button (windows: invoke)', 'FAIL', errMsg(err2));
            return false;
        }
    }

    const titleAfter = await waitForScreenChange(driver, titleBefore);
    const moved = titleAfter !== titleBefore;
    record(`Screen changed after "${tcode}"`, moved ? 'PASS' : 'FAIL', `"${titleBefore}" → "${titleAfter}"`);
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

    it('opens the Data Browser from SAP Easy Access', async () => {
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
        if (await runTransaction(driver, '/nSE16')) {
            record('SE16 screen', 'INFO', await describeScreen(driver));
            try {
                save('02-page-source-se16.xml', await driver.getPageSource());
                record('Page source on SE16', 'PASS', 'saved 02-page-source-se16.xml');
            } catch (err) {
                record('Page source on SE16', 'FAIL', errMsg(err));
            }
            try {
                record('Input fields on SE16', 'INFO', await listInputFields(driver));
            } catch (err) {
                record('Input fields on SE16', 'FAIL', errMsg(err));
            }
        }

        // 3. Back home with /n, so the next run starts from SAP Easy Access again.
        if (await runTransaction(driver, '/n')) {
            record('Back home', 'INFO', await describeScreen(driver));
            save('03-page-source-back-home.xml', await driver.getPageSource());
        }

        expect(failed()).toEqual([]);
    }, 120_000);
});
