import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';

/**
 * Demo: a real SAP task driven end to end through standard WebDriver — from SAP Easy
 * Access, open the Data Browser (SE16), show table T000 (the SAP clients table) and read
 * client 001 out of the result list.
 *
 *   1. /nSE16 in the command field + Enter → "Data Browser: Initial Screen".
 *      Same window throughout: SAP swaps screens, no window switch needed.
 *   2. T000 in the Table Name field + Enter → the table's selection screen.
 *   3. Execute (F8) → the result list.
 *   4. Read client 001: SE16 shows a classic list here, not an ALV grid — every value is
 *      a GuiLabel whose Id is its position, lbl[column,row]. Find the header row, find
 *      the row whose MANDT is 001, read that row into a record and check it.
 *   5. (in progress) tick the row's checkbox, Display (F7) → the entry's detail screen.
 *      Captured as 01-page-source-detail.xml + input fields in the summary, so the
 *      next step can read it from what SAP actually shows.
 *   6. /n back to SAP Easy Access, so the test can be rerun as is.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo/: SUMMARY.md, the screen being explored, plus the
 * page source of the screen a step failed on (failed-<step>.xml).
 *
 * Env:
 *   SAP_WINDOW_TITLE  partial title of the logged-in window (default: "SAP Easy")
 */
const OUTPUT_DIR = resolve(process.cwd(), 'test-output', 'sap-demo');
const WINDOW_TITLE = process.env.SAP_WINDOW_TITLE ?? 'SAP Easy';

// SAP Ids, as seen in the page source of each screen.
const OKCODE = '~wnd[0]/tbar[0]/okcd'; // command field, every screen
const ENTER_BUTTON = '~wnd[0]/tbar[0]/btn[0]'; // green check mark = Enter, every screen
const TITLE_BAR = '~wnd[0]/titl';
const STATUS_BAR = '~wnd[0]/sbar';
const TABLE_NAME_FIELD = '~wnd[0]/usr/ctxtDATABROWSE-TABLENAME'; // SE16 initial screen
const EXECUTE_BUTTON = '~wnd[0]/tbar[1]/btn[8]'; // "Execute (F8)", selection screen
const DISPLAY_BUTTON = '~wnd[0]/tbar[1]/btn[7]'; // "Display (F7)", result list

const TABLE = 'T000'; // SAP clients
const CLIENT = '001';
const EXPECTED_CLIENT = { MANDT: '001', MTEXT: 'SAP SE', ORT01: 'Walldorf', MWAER: 'EUR' };

type Status = 'PASS' | 'FAIL' | 'INFO';

interface Check {
    step: string;
    status: Status;
    detail: string;
}

const checks: Check[] = [];

function save(name: string, content: string): void {
    writeFileSync(resolve(OUTPUT_DIR, name), content, 'utf8');
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

/** Records a failure along with the page source of the screen it happened on. */
async function fail(driver: Browser, step: string, detail: string): Promise<false> {
    const file = `failed-${step.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.xml`;
    try {
        save(file, await driver.getPageSource());
        detail += ` — page source in ${file}`;
    } catch { /* noop */ }
    record(step, 'FAIL', detail);
    return false;
}

async function textOf(driver: Browser, selector: string): Promise<string> {
    try {
        const el = await driver.$(selector);
        return (await el.isExisting()) ? await el.getText() : '(not found)';
    } catch (err) {
        return `(error: ${errMsg(err)})`;
    }
}

async function typeInto(driver: Browser, selector: string, label: string, value: string): Promise<boolean> {
    try {
        await (await driver.$(selector)).setValue(value);
        return true;
    } catch (err) {
        return fail(driver, `Type "${value}" in ${label}`, errMsg(err));
    }
}

/**
 * Clicks a toolbar button and waits for SAP to move to the next screen (title bar
 * changes). Passes with the title SAP landed on.
 */
async function pressAndWait(driver: Browser, selector: string, step: string, timeoutMs = 15_000): Promise<boolean> {
    const before = await textOf(driver, TITLE_BAR);
    try {
        await (await driver.$(selector)).click();
    } catch (err) {
        return fail(driver, step, `click ${selector}: ${errMsg(err)}`);
    }
    const deadline = Date.now() + timeoutMs;
    let now = before;
    while (Date.now() < deadline) {
        now = await textOf(driver, TITLE_BAR);
        if (now !== before && !now.startsWith('(')) {
            record(step, 'PASS', `→ "${now.replace(/\s{2,}/g, ' ')}"`);
            return true;
        }
        await delay(500);
    }
    return fail(driver, step, `screen stayed "${now}"; status bar "${await textOf(driver, STATUS_BAR)}"`);
}

async function runTransaction(driver: Browser, tcode: string, step: string): Promise<boolean> {
    return await typeInto(driver, OKCODE, 'command field', tcode)
        && pressAndWait(driver, ENTER_BUTTON, step);
}

/** `…/usr/lbl[9,6]` → { col: 9, row: 6 }. */
function listPos(id: string): { col: number; row: number } | undefined {
    const m = id.match(/\/usr\/(?:lbl|chk|txt)\[(\d+),(\d+)\]$/);
    return m ? { col: Number(m[1]), row: Number(m[2]) } : undefined;
}

/** Discovery: page source of a screen not scripted yet, plus its fields and buttons in the summary. */
async function captureScreen(driver: Browser, label: string, file: string): Promise<void> {
    save(file, await driver.getPageSource());
    const strip = (id: string) => id.replace(/^sap:\/app\/con\[\d+\]\/ses\[\d+\]\//, '');
    const rows: string[] = [];
    for (const e of await driver.findElements('xpath',
        '//GuiUserArea//*[self::GuiTextField or self::GuiCTextField or self::GuiCheckBox or self::GuiComboBox]')) {
        const el = await driver.$(e);
        const id = strip(Object.values(e)[0] as string);
        const value = id.includes('/chk') ? `selected=${await el.isSelected()}` : `"${await el.getText()}"`;
        rows.push(`${id} = ${value}`);
    }
    const buttons: string[] = [];
    for (const e of await driver.findElements('xpath', "//GuiToolbar[@Name='tbar[1]']//GuiButton")) {
        buttons.push(`${strip(Object.values(e)[0] as string)} "${await (await driver.$(e)).getAttribute('Tooltip')}"`);
    }
    record(`${label} screen`, 'INFO', [
        `title "${await textOf(driver, TITLE_BAR)}", status bar "${await textOf(driver, STATUS_BAR)}"`,
        `window ${await driver.getWindowHandle()}, all windows ${JSON.stringify(await driver.getWindowHandles())}`,
        `page source in ${file}`,
        '— fields —', ...(rows.length ? rows : ['(none)']),
        '— tbar[1] —', ...(buttons.length ? buttons : ['(none)']),
    ].join('\n'));
}

/**
 * Reads one entry of a classic SAP list (SE16 without ALV) by locators only:
 * header row = the row of the label reading `keyColumn`; entry row = the row whose
 * label in that column reads `keyValue`; then each header's column in the entry row.
 * Returns the entry and its list row.
 */
async function readListEntry(driver: Browser, keyColumn: string, keyValue: string): Promise<{ entry: Record<string, string>; row: number }> {
    const header = await driver.$(`//GuiUserArea/GuiLabel[@Text='${keyColumn}']`);
    if (!(await header.isExisting())) {throw new Error(`no column header "${keyColumn}"`);}
    const headerPos = listPos(await header.elementId);
    if (!headerPos) {throw new Error(`unexpected header id ${await header.elementId}`);}

    // Every non-empty label on the header row is a column name.
    const columns: { name: string; col: number }[] = [];
    for (const e of await driver.findElements('xpath', `//GuiUserArea/GuiLabel[contains(@Id, ',${headerPos.row}]') and @Text!='']`)) {
        const pos = listPos(Object.values(e)[0] as string);
        if (pos?.row === headerPos.row) {columns.push({ name: await (await driver.$(e)).getText(), col: pos.col });}
    }

    const rows = await driver.findElements('xpath', "//GuiUserArea/GuiCheckBox[contains(@Id, '/usr/chk[')]");
    record('Read list headers', columns.length > 0 ? 'PASS' : 'FAIL',
        `${rows.length} row(s); columns ${columns.map((c) => c.name).join(', ')}`);

    const cell = await driver.$(`//GuiUserArea/GuiLabel[@Text='${keyValue}' and contains(@Id, 'lbl[${headerPos.col},')]`);
    if (!(await cell.isExisting())) {throw new Error(`no row with ${keyColumn} = ${keyValue}`);}
    const row = listPos(await cell.elementId)!.row;

    const entry: Record<string, string> = {};
    for (const c of columns) {
        const el = await driver.$(`~wnd[0]/usr/lbl[${c.col},${row}]`);
        entry[c.name] = (await el.isExisting()) ? (await el.getText()).trim() : '';
    }
    return { entry, row };
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

        // Home: the logged-in SAP Easy Access window, attached.
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
        record('Attach', 'PASS', `${attach.system}, "${await textOf(driver, TITLE_BAR)}"`);

        // 1–3. SE16 → T000 → Execute. /n ends whatever runs in this session first.
        const onResult = await runTransaction(driver, '/nSE16', 'Open SE16')
            && await typeInto(driver, TABLE_NAME_FIELD, 'Table Name', TABLE)
            && await pressAndWait(driver, ENTER_BUTTON, `Table ${TABLE} → selection screen`)
            && await pressAndWait(driver, EXECUTE_BUTTON, 'Execute → result list');

        // 4. Read client 001 out of the list and check it.
        let clientRow: number | undefined;
        if (onResult) {
            try {
                const { entry, row } = await readListEntry(driver, 'MANDT', CLIENT);
                const wrong = Object.entries(EXPECTED_CLIENT).filter(([k, v]) => entry[k] !== v);
                if (wrong.length === 0) {
                    record(`Client ${CLIENT}`, 'PASS', `row ${row}: ${JSON.stringify(entry)}`);
                    clientRow = row;
                } else {
                    await fail(driver, `Client ${CLIENT}`,
                        wrong.map(([k, v]) => `${k}: expected "${v}", read "${entry[k]}"`).join('; '));
                }
            } catch (err) {
                await fail(driver, `Client ${CLIENT}`, errMsg(err));
            }
        }

        // 5. Tick the row's checkbox (a plain click, like a user) and open its detail view.
        if (clientRow !== undefined) {
            const checkbox = `~wnd[0]/usr/chk[1,${clientRow}]`;
            let ticked = false;
            try {
                const box = await driver.$(checkbox);
                await box.click();
                ticked = await box.isSelected();
                if (ticked) {
                    record(`Tick row ${CLIENT}`, 'PASS', `${checkbox} selected`);
                } else {
                    await fail(driver, `Tick row ${CLIENT}`, `${checkbox} still not selected after click()`);
                }
            } catch (err) {
                await fail(driver, `Tick row ${CLIENT}`, `${checkbox}: ${errMsg(err)}`);
            }
            if (ticked && await pressAndWait(driver, DISPLAY_BUTTON, `Display → client ${CLIENT} detail`)) {
                try {
                    await captureScreen(driver, 'Detail', '01-page-source-detail.xml');
                } catch (err) {
                    record('Detail screen', 'FAIL', errMsg(err));
                }
            }
        }

        // 6. Back home, so the next run starts from SAP Easy Access again.
        await runTransaction(driver, '/n', 'Back to SAP Easy Access');

        expect(failed()).toEqual([]);
    }, 120_000);
});
