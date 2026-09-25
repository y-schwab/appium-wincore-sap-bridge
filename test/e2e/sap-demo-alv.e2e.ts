import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { ENTER_BUTTON, SapDemo, errMsg, shortId } from './helpers/sap-demo.js';

/**
 * Demo: ALV grid, and a popup on the way. SE16N doesn't exist on this system, and SE16
 * shows a classic list for this user — its output format is a per-user setting in
 * SE16's "User Parameters" popup. So this test switches it to ALV grid through that
 * popup, shows T000 in the grid, and switches it back at the end. Built step by step:
 * each step captures what it lands on, the next one is written from what SAP showed.
 *
 *   Step 1 ✅ /nSE16 → User Parameters (F6) → popup "User-Specific Settings" (wnd[1],
 *             its own window, served by the same attach). Data Browser tab: radio
 *             buttons "ALV Grid Display" / "ALV List" / "Standard SE16 list";
 *             buttons "Transfer (Enter)" / "Cancel (F12)".
 *   Step 2 ✅ pick "ALV Grid Display", Transfer; T000 → Execute → grid
 *             (GuiShell SubType GridView, 2 GridRow, 17 GridCell each); restore
 *             "Standard SE16 list". XPath found no GridRow/GridCell yet: they had no
 *             element ids — the bridge now maps them (like tree nodes).
 *   Step 3 ✅ read client 001 from the grid: the GridRow whose MANDT cell is 001, then
 *             its cells by Column; select the row with windows: select. Column Title
 *             came back as the field name (MANDT) — SE16's "Field Name" setting.
 *   Step 4    also pick "Field Label" in the popup, so column headers are what a user
 *             reads; check the titles are labels; restore "Field Name" at the end.
 *
 * Ends with /n back to SAP Easy Access.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Demo recording (optional): SAP_DEMO_RECORD=1 records the screen from after attach to
 * back home (driver's windows: start/stopRecordingScreen) into recording.mp4;
 * SAP_DEMO_PACE_MS=1500 waits before each action so the video can be followed.
 *
 * Output in test-output/sap-demo-alv/: SUMMARY.md, page source of each explored
 * screen, plus the page source of the screen a step failed on (failed-<step>.xml).
 */
const USER_PARAMETERS_BUTTON = '~wnd[0]/tbar[1]/btn[6]'; // "User Parameters... (F6)", SE16 initial screen
const TABLE_NAME_FIELD = '~wnd[0]/usr/ctxtDATABROWSE-TABLENAME'; // SE16 initial screen
const EXECUTE_BUTTON = '~wnd[0]/tbar[1]/btn[8]'; // "Execute (F8)", selection screen
const POPUP_TITLE = 'User-Specific Settings'; // the User Parameters popup's window title
const TRANSFER_BUTTON = "//GuiButton[starts-with(@Tooltip,'Transfer')]"; // in the popup
const GRID = "//GuiShell[@SubType='GridView']";
const TABLE = 'T000';
const CLIENT = '001';
const EXPECTED_CLIENT = { MANDT: '001', MTEXT: 'SAP SE', ORT01: 'Walldorf', MWAER: 'EUR' };

// Radio buttons in SE16's User Parameters popup, by their visible text: output format,
// and whether column headers show the technical field name (MANDT) or its label.
const DEMO_SETTINGS = ['ALV Grid Display', 'Field Label'];
const ORIGINAL_SETTINGS = ['Standard SE16 list', 'Field Name'];

const demo = new SapDemo('sap-demo-alv', 'SAP demo: SE16 ALV grid');

/**
 * Sets SE16's user parameters the way a user does: SE16 → User Parameters → pick each
 * radio button by its visible text → Transfer. Returns to the main window.
 */
async function setUserParameters(choices: string[]): Promise<boolean> {
    const driver = demo.driver;
    const popup = await demo.runTransaction('/nSE16', 'Open SE16', 'Data Browser')
        && await demo.openPopup(USER_PARAMETERS_BUTTON, 'User Parameters → popup', POPUP_TITLE);
    if (!popup) {return false;}
    try {
        for (const choice of choices) {
            const radio = await driver.$(`//GuiRadioButton[@Text='${choice}']`);
            await demo.pause();
            await radio.click();
            if (!(await radio.isSelected())) {
                return demo.fail(`Pick "${choice}"`, 'radio button not selected after click()');
            }
            demo.record(`Pick "${choice}"`, 'PASS', shortId(await radio.elementId));
        }

        await demo.pause();
        await (await driver.$(TRANSFER_BUTTON)).click();
        const closed = await driver.waitUntil(
            async () => !(await driver.getWindowHandles()).includes(popup),
            { timeout: 10_000 }).then(() => true, () => false);
        await driver.switchToWindow(demo.mainWindow);
        if (!closed) {return demo.fail('Transfer', 'popup still open');}
        demo.record('Transfer', 'PASS', `popup closed; status bar "${await demo.textOf('~wnd[0]/sbar')}"`);
        return true;
    } catch (err) {
        return demo.fail(`Set user parameters ${choices.join(' + ')}`, errMsg(err));
    }
}

describe('sap demo: SE16 ALV grid', () => {
    beforeAll(async () => {
        demo.resetOutput();
        demo.driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('shows table T000 in an ALV grid', async () => {
        const driver = demo.driver;
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }
        await demo.startRecording();

        try {
            // 1. Switch SE16 to ALV grid output (lands back on SE16's initial screen).
            if (await setUserParameters(DEMO_SETTINGS)) {
                // 2. T000 → selection screen → Execute → grid.
                const executed = await demo.typeInto(TABLE_NAME_FIELD, 'Table Name', TABLE)
                    && await demo.pressAndWait(ENTER_BUTTON, `Table ${TABLE} → selection screen`, 'Selection Screen');
                if (executed) {
                    await demo.pause();
                    await (await driver.$(EXECUTE_BUTTON)).click();
                    const grid = await driver.$(GRID);
                    const found = await grid.waitForExist({ timeout: 15_000 }).then(() => true, () => false);
                    if (found) {
                        demo.record('Grid after Execute', 'PASS',
                            `${shortId(await grid.elementId)}, title "${await demo.textOf('~wnd[0]/titl')}"`);
                    } else {
                        await demo.fail('Grid after Execute', `no ${GRID} within 15s`);
                    }

                    // 3. Read client 001 out of the grid: the row whose MANDT cell is 001,
                    //    then that row's cells by column.
                    const row = `${GRID}//GridRow[GridCell[@Column='MANDT' and @Text='${CLIENT}']]`;
                    const rowEl = await driver.$(row);
                    if (!(await rowEl.isExisting())) {
                        await demo.fail(`Find row ${CLIENT}`, `no ${row}`);
                    } else {
                        demo.record(`Find row ${CLIENT}`, 'PASS', await rowEl.elementId);
                        const values: Record<string, string> = {};
                        const titles: Record<string, string> = {};
                        for (const col of Object.keys(EXPECTED_CLIENT)) {
                            const cell = await driver.$(`${row}/GridCell[@Column='${col}']`);
                            values[col] = await cell.getText();
                            titles[col] = (await cell.getAttribute('Title')) ?? '';
                        }
                        const wrong = Object.entries(EXPECTED_CLIENT).filter(([k, v]) => values[k] !== v);
                        if (wrong.length === 0) {
                            demo.record(`Client ${CLIENT} from grid`, 'PASS', JSON.stringify(values));
                        } else {
                            await demo.fail(`Client ${CLIENT} from grid`,
                                wrong.map(([k, v]) => `${k}: expected "${v}", read "${values[k]}"`).join('; '));
                        }
                        // With "Field Label" the headers are what a user reads, not field names.
                        const labelled = Object.entries(titles).every(([col, title]) => title && title !== col);
                        const titleList = Object.entries(titles).map(([col, title]) => `${col} = "${title}"`).join('\n');
                        if (labelled) {
                            demo.record('Column titles are labels', 'PASS', titleList);
                        } else {
                            await demo.fail('Column titles are labels', titleList);
                        }

                        // 4. Select the row, like clicking its row marker.
                        await demo.pause();
                        await driver.executeScript('windows: select', [{ elementId: await rowEl.elementId }]);
                        const selected = String(await rowEl.getAttribute('IsSelected')).toLowerCase() === 'true';
                        await demo.pause(); // let the selected row show in a recording
                        if (selected) {
                            demo.record(`Select row ${CLIENT}`, 'PASS', 'IsSelected=true');
                        } else {
                            await demo.fail(`Select row ${CLIENT}`, 'IsSelected not true after windows: select');
                        }
                    }
                }
            }
        } catch (err) {
            await demo.fail('ALV flow', errMsg(err));
        } finally {
            // 3. Always put the setting back — the SE16 demo expects the classic list.
            await demo.closePopups();
            await setUserParameters(ORIGINAL_SETTINGS);
        }

        await demo.backHome();
        await demo.stopRecording();

        expect(demo.failed).toEqual([]);
    }, 300_000);
});
