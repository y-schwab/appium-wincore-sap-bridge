import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { ENTER_BUTTON, SapDemo, errMsg, refId } from './helpers/sap-demo.js';

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
 *   5. Tick the row's checkbox, Display (F7) → the entry's detail screen, an ordinary
 *      form: read the fields by SAP Name (T000-MTEXT, …), check they match the list
 *      and are all read-only.
 *   6. /n back to SAP Easy Access, so the test can be rerun as is.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo/: SUMMARY.md, plus the page source of the screen a
 * step failed on (failed-<step>.xml).
 *
 * Env:
 *   SAP_WINDOW_TITLE  partial title of the logged-in window (default: "SAP Easy")
 */
const TABLE_NAME_FIELD = '~wnd[0]/usr/ctxtDATABROWSE-TABLENAME'; // SE16 initial screen
const EXECUTE_BUTTON = '~wnd[0]/tbar[1]/btn[8]'; // "Execute (F8)", selection screen
const DISPLAY_BUTTON = '~wnd[0]/tbar[1]/btn[7]'; // "Display (F7)", result list

const TABLE = 'T000'; // SAP clients
const CLIENT = '001';
const EXPECTED_CLIENT = { MANDT: '001', MTEXT: 'SAP SE', ORT01: 'Walldorf', MWAER: 'EUR' };

const demo = new SapDemo('sap-demo', 'SAP demo: SE16 → T000');

/** `…/usr/lbl[9,6]` → { col: 9, row: 6 }. */
function listPos(id: string): { col: number; row: number } | undefined {
    const m = id.match(/\/usr\/(?:lbl|chk|txt)\[(\d+),(\d+)\]$/);
    return m ? { col: Number(m[1]), row: Number(m[2]) } : undefined;
}

/**
 * Reads the detail screen of a T000 entry. Unlike the list, it's an ordinary form: every
 * field has a SAP Name (T000-<column>), so the `name` locator finds it directly.
 */
async function readDetail(driver: Browser, columns: string[]): Promise<{ values: Record<string, string>; editable: string[] }> {
    const values: Record<string, string> = {};
    const editable: string[] = [];
    for (const col of columns) {
        const field = await driver.$(await driver.findElement('name', `T000-${col}`));
        values[col] = await field.getText();
        if (String(await field.getAttribute('Changeable')).toLowerCase() === 'true') {editable.push(col);}
    }
    return { values, editable };
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
        const pos = listPos(refId(e));
        if (pos?.row === headerPos.row) {columns.push({ name: await (await driver.$(e)).getText(), col: pos.col });}
    }

    const rows = await driver.findElements('xpath', "//GuiUserArea/GuiCheckBox[contains(@Id, '/usr/chk[')]");
    demo.record('Read list headers', columns.length > 0 ? 'PASS' : 'FAIL',
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
    beforeAll(async () => {
        demo.resetOutput();
        demo.driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('shows table T000 in the Data Browser, starting from SAP Easy Access', async () => {
        const driver = demo.driver;
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }

        // 1–3. SE16 → T000 → Execute. /n ends whatever runs in this session first.
        const onResult = await demo.runTransaction('/nSE16', 'Open SE16')
            && await demo.typeInto(TABLE_NAME_FIELD, 'Table Name', TABLE)
            && await demo.pressAndWait(ENTER_BUTTON, `Table ${TABLE} → selection screen`)
            && await demo.pressAndWait(EXECUTE_BUTTON, 'Execute → result list');

        // 4. Read client 001 out of the list and check it.
        let clientRow: number | undefined;
        if (onResult) {
            try {
                const { entry, row } = await readListEntry(driver, 'MANDT', CLIENT);
                const wrong = Object.entries(EXPECTED_CLIENT).filter(([k, v]) => entry[k] !== v);
                if (wrong.length === 0) {
                    demo.record(`Client ${CLIENT}`, 'PASS', `row ${row}: ${JSON.stringify(entry)}`);
                    clientRow = row;
                } else {
                    await demo.fail(`Client ${CLIENT}`,
                        wrong.map(([k, v]) => `${k}: expected "${v}", read "${entry[k]}"`).join('; '));
                }
            } catch (err) {
                await demo.fail(`Client ${CLIENT}`, errMsg(err));
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
                    demo.record(`Tick row ${CLIENT}`, 'PASS', `${checkbox} selected`);
                } else {
                    await demo.fail(`Tick row ${CLIENT}`, `${checkbox} still not selected after click()`);
                }
            } catch (err) {
                await demo.fail(`Tick row ${CLIENT}`, `${checkbox}: ${errMsg(err)}`);
            }
            if (ticked && await demo.pressAndWait(DISPLAY_BUTTON, `Display → client ${CLIENT} detail`)) {
                try {
                    const { values, editable } = await readDetail(driver, Object.keys(EXPECTED_CLIENT));
                    const wrong = Object.entries(EXPECTED_CLIENT).filter(([k, v]) => values[k] !== v);
                    if (wrong.length === 0) {
                        demo.record(`Client ${CLIENT} detail`, 'PASS', `by name T000-*: ${JSON.stringify(values)}`);
                    } else {
                        await demo.fail(`Client ${CLIENT} detail`,
                            wrong.map(([k, v]) => `${k}: expected "${v}", read "${values[k]}"`).join('; '));
                    }
                    // Display mode: nothing on the detail screen may be editable.
                    if (editable.length === 0) {
                        demo.record('Detail is display-only', 'PASS', 'all fields Changeable=False');
                    } else {
                        await demo.fail('Detail is display-only', `editable: ${editable.join(', ')}`);
                    }
                } catch (err) {
                    await demo.fail(`Client ${CLIENT} detail`, errMsg(err));
                }
            }
        }

        // 6. Back home, so the next run starts from SAP Easy Access again.
        await demo.backHome();

        expect(demo.failed).toEqual([]);
    }, 120_000);
});
