import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { ENTER_BUTTON, SapDemo, delay, errMsg, shortId } from './helpers/sap-demo.js';

/**
 * Demo: ALV grid. SE16N (General Table Display) shows table contents in an ALV grid
 * (a GuiShell with SubType "GridView") without changing any user setting — unlike
 * SE16, which shows a classic list for this user. Built step by step: each step
 * captures the screen it lands on, the next one is written from what SAP showed.
 *
 *   Step 1 (this version): /nSE16N → capture. If the table field is there (GD-TAB,
 *   SE16N's usual one), enter T000, Enter, press the tbar[1] button whose tooltip
 *   starts with "Execute" and capture the result: grid shell, GridRow / GridCell.
 *   Next: read client 001 out of the grid by column (GridCell @Column).
 *
 * Ends with /n back to SAP Easy Access.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo-alv/: SUMMARY.md, page source of each explored
 * screen, plus the page source of the screen a step failed on (failed-<step>.xml).
 */
const TABLE_FIELD = "//GuiCTextField[@Name='GD-TAB']"; // guess from SE16N — verified by step 1
const GRID = "//GuiShell[@SubType='GridView']";
const TABLE = 'T000';

const demo = new SapDemo('sap-demo-alv', 'SAP demo: SE16N ALV grid');

describe('sap demo: SE16N ALV grid', () => {
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

        try {
            if (await demo.runTransaction('/nSE16N', 'Open SE16N')) {
                await demo.captureScreen('SE16N', '01-page-source-se16n.xml');

                const tableField = await driver.$(TABLE_FIELD);
                if (!(await tableField.isExisting())) {
                    demo.record('Find table field', 'INFO', `no ${TABLE_FIELD} — see fields above`);
                } else {
                    await tableField.setValue(TABLE);
                    // SE16N stays on the same screen after Enter (it loads the table's
                    // selection fields), so no title change to wait for.
                    await (await driver.$(ENTER_BUTTON)).click();
                    await delay(1500);
                    demo.record(`Table ${TABLE} + Enter`, 'PASS', `status bar "${await demo.textOf('~wnd[0]/sbar')}"`);

                    const execute = await driver.$("//GuiToolbar[@Name='tbar[1]']//GuiButton[starts-with(@Tooltip,'Execute')]");
                    if (!(await execute.isExisting())) {
                        await demo.captureScreen('SE16N after Enter', '02-page-source-se16n-table.xml');
                        demo.record('Find Execute button', 'INFO', 'no tbar[1] button with tooltip "Execute…"');
                    } else {
                        demo.record('Find Execute button', 'PASS', shortId(await execute.elementId));
                        await execute.click();
                        // Wait for the grid rather than a title change — it's what we're after.
                        const grid = await driver.$(GRID);
                        const found = await grid.waitForExist({ timeout: 15_000 }).then(() => true, () => false);
                        demo.record('Grid appears after Execute', found ? 'PASS' : 'FAIL',
                            found ? shortId(await grid.elementId) : `no ${GRID} within 15s`);
                        await demo.captureScreen('Result', '03-page-source-result.xml');
                    }
                }
            }
        } catch (err) {
            await demo.fail('SE16N flow', errMsg(err));
        }

        await demo.runTransaction('/n', 'Back to SAP Easy Access');

        expect(demo.failed).toEqual([]);
    }, 120_000);
});
