import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { ENTER_BUTTON, SapDemo, errMsg } from './helpers/sap-demo.js';

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
 *      a GuiLabel whose Id is its position, lbl[column,row]. Find each wanted column by
 *      its header, the row whose MANDT is 001, read those cells and check them.
 *   5. Tick the row's checkbox (windows: select), Display (F7) → the entry's detail screen, an ordinary
 *      form: read the fields by SAP Name (T000-MTEXT, …), check they match the list
 *      and are all read-only.
 *   6. /n back to SAP Easy Access, so the test can be rerun as is.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/gui-label/: SUMMARY.md, plus the page source of the screen a
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

const demo = new SapDemo('gui-label', 'GuiLabel: SE16 classic list of T000');

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
 * Reads one entry of a classic SAP list (SE16 without ALV) by locators only: each
 * wanted column's header label (by its text) gives the column; the label reading
 * `keyValue` in the key column gives the row; the values are the labels at those
 * positions, `lbl[col,row]`. Returns the entry and its list row.
 */
async function readListEntry(driver: Browser, keyColumn: string, keyValue: string, wanted: string[]): Promise<{ entry: Record<string, string>; row: number }> {
    const headerCol = async (name: string) => {
        const pos = listPos(await (await driver.$(`//GuiUserArea/GuiLabel[@Text='${name}']`)).elementId ?? '');
        if (!pos) {throw new Error(`no column header "${name}"`);}
        return pos.col;
    };

    const keyCol = await headerCol(keyColumn);
    const cell = await driver.$(`//GuiUserArea/GuiLabel[@Text='${keyValue}' and contains(@Id, 'lbl[${keyCol},')]`);
    const row = listPos(await cell.elementId ?? '')?.row;
    if (row === undefined) {throw new Error(`no row with ${keyColumn} = ${keyValue}`);}

    const entry: Record<string, string> = { [keyColumn]: keyValue };
    for (const name of wanted.filter((w) => w !== keyColumn)) {
        entry[name] = (await (await driver.$(`~wnd[0]/usr/lbl[${await headerCol(name)},${row}]`)).getText()).trim();
    }
    return { entry, row };
}

describe('GuiLabel: SE16 classic list', () => {
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
                const { entry, row } = await readListEntry(driver, 'MANDT', CLIENT, Object.keys(EXPECTED_CLIENT));
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

        // 5. Tick the row's checkbox and open its detail view. windows: select, not a
        //    mouse click: in a run of all demos, the click once landed as a double-click
        //    on the line, which opens the entry before Display is pressed.
        if (clientRow !== undefined) {
            const checkbox = `~wnd[0]/usr/chk[1,${clientRow}]`;
            let ticked = false;
            try {
                const box = await driver.$(checkbox);
                await driver.executeScript('windows: select', [{ elementId: box.elementId }]);
                ticked = await box.isSelected();
                if (ticked) {
                    demo.record(`Tick row ${CLIENT}`, 'PASS', `${checkbox} selected`);
                } else {
                    await demo.fail(`Tick row ${CLIENT}`, `${checkbox} still not selected after windows: select`);
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
