import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { ENTER_BUTTON, SapDemo, errMsg } from './helpers/sap-demo.js';

/**
 * Demo: ALV grid, and a popup on the way, starting from SAP Easy Access. SE16N doesn't
 * exist on this system, and SE16 shows a classic list for this user — its output format
 * is a per-user setting in SE16's "User Parameters" popup.
 *
 *   1. /nSE16 → User Parameters (F6) → popup "User-Specific Settings" (wnd[1], its own
 *      window): pick "ALV Grid Display", Transfer.
 *   2. T000 → selection screen → Execute → ALV grid (GuiShell SubType GridView).
 *   3. Read client 001: the GridRow whose MANDT cell is 001, then its cells by Column
 *      (stable across logon languages, unlike the visible Title).
 *   4. Select the row (windows: select).
 *   5. Always put "Standard SE16 list" back — the SE16 demo expects the classic list —
 *      then /n back to SAP Easy Access.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Demo recording (optional): SAP_DEMO_RECORD=1 records the screen from after attach to
 * back home (driver's windows: start/stopRecordingScreen) into recording.mp4;
 * SAP_DEMO_PACE_MS=1500 waits before each action so the video can be followed.
 *
 * Output in test-output/sap-demo-alv/: SUMMARY.md, plus the page source of the screen
 * a step failed on (failed-<step>.xml).
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

// Output format radio buttons in SE16's User Parameters popup, by their visible text.
const DEMO_SETTINGS = ['ALV Grid Display'];
const ORIGINAL_SETTINGS = ['Standard SE16 list'];

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
            await demo.pause();
            await (await driver.$(`//GuiRadioButton[@Text='${choice}']`)).click();
        }

        await demo.pause();
        await (await driver.$(TRANSFER_BUTTON)).click();
        const closed = await driver.waitUntil(
            async () => !(await driver.getWindowHandles()).includes(popup),
            { timeout: 10_000 }).then(() => true, () => false);
        await driver.switchToWindow(demo.mainWindow);
        if (!closed) {return demo.fail('Transfer', 'popup still open');}
        demo.record(`Transfer (${choices.join(', ')})`, 'PASS', 'popup closed');
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
                        demo.record('Grid after Execute', 'PASS', 'GridView shown');
                    } else {
                        await demo.fail('Grid after Execute', `no ${GRID} within 15s`);
                    }

                    // 3. Read client 001 out of the grid: the row whose MANDT cell is 001,
                    //    then that row's cells by column.
                    const row = `${GRID}//GridRow[GridCell[@Column='MANDT' and @Text='${CLIENT}']]`;
                    const rowEl = await driver.$(row);
                    if (!(await rowEl.elementId)) {
                        await demo.fail(`Find row ${CLIENT}`, `no ${row}`);
                    } else {
                        const values: Record<string, string> = {};
                        for (const col of Object.keys(EXPECTED_CLIENT)) {
                            values[col] = await (await driver.$(`${row}/GridCell[@Column='${col}']`)).getText();
                        }
                        const wrong = Object.entries(EXPECTED_CLIENT).filter(([k, v]) => values[k] !== v);
                        if (wrong.length === 0) {
                            demo.record(`Client ${CLIENT} from grid`, 'PASS', JSON.stringify(values));
                        } else {
                            await demo.fail(`Client ${CLIENT} from grid`,
                                wrong.map(([k, v]) => `${k}: expected "${v}", read "${values[k]}"`).join('; '));
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
            // 5. Always put the setting back — the SE16 demo expects the classic list.
            await demo.closePopups();
            await setUserParameters(ORIGINAL_SETTINGS);
        }

        await demo.backHome();
        await demo.stopRecording();

        expect(demo.failed).toEqual([]);
    }, 300_000);
});
