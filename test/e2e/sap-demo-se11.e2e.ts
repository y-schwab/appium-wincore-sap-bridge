import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { SapDemo, delay, errMsg } from './helpers/sap-demo.js';

/**
 * Demo: tabs (GuiTab) and a table control (GuiTableControl) in the ABAP Dictionary,
 * display only, starting from SAP Easy Access. Built step by step: each step captures
 * what it lands on, the next one is written from what SAP showed.
 *
 *   Step 1    /nSE11 → "Database table" T000 → Display. Capture the initial screen and
 *             the display screen, then click through its tabs (Attributes, Delivery
 *             and Maintenance, Fields, …) and capture each: which tab opens first,
 *             where the table control (field list) lives, its RowCount vs.
 *             VisibleRowCount. Locators on the initial screen are guesses from
 *             standard SAP recordings (RSRD1-TBMA_VAL, btnPUSHSHOW).
 *
 * Ends with /n back to SAP Easy Access. Changes nothing.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo-se11/: SUMMARY.md, page source of each captured
 * screen (se11-*.xml), plus the page source of the screen a step failed on.
 */
const DATABASE_TABLE_RADIO = "//GuiRadioButton[@Text='Database table']";
const TABLE_NAME_FIELD = '~wnd[0]/usr/ctxtRSRD1-TBMA_VAL';
const DISPLAY_BUTTON = '~wnd[0]/usr/btnPUSHSHOW'; // "Display (F7)"
const TABLE = 'T000';

const demo = new SapDemo('sap-demo-se11', 'SAP demo: SE11 tabs and table control');

describe('sap demo: SE11', () => {
    beforeAll(async () => {
        demo.resetOutput();
        demo.driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('shows table T000 in the ABAP Dictionary', async () => {
        const driver = demo.driver;
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }

        try {
            if (await demo.runTransaction('/nSE11', 'Open SE11', 'Dictionary')) {
                await demo.captureScreen('SE11 initial', 'se11-initial.xml');

                // Database table T000 → Display.
                let ready = false;
                try {
                    const radio = await driver.$(DATABASE_TABLE_RADIO);
                    if (!(await radio.isSelected())) {await radio.click();}
                    demo.record('Pick "Database table"', (await radio.isSelected()) ? 'PASS' : 'FAIL', `selected=${await radio.isSelected()}`);
                    ready = await demo.typeInto(TABLE_NAME_FIELD, 'table name', TABLE);
                } catch (err) {
                    await demo.fail('Pick "Database table"', errMsg(err));
                }

                if (ready && await demo.pressAndWait(DISPLAY_BUTTON, `Display ${TABLE}`)) {
                    await demo.captureScreen('Display (first tab)', 'se11-display.xml');

                    // Every tab, in order: click it, give SAP a moment, capture.
                    const tabs: string[] = [];
                    for (const ref of await driver.findElements('xpath', '//GuiTab')) {
                        tabs.push(await (await driver.$(ref)).getText());
                    }
                    demo.record('Tabs', 'INFO', tabs.map((t) => `"${t}"`).join(', ') || '(none)');

                    for (const [i, text] of tabs.entries()) {
                        const step = `Tab "${text}"`;
                        try {
                            await demo.pause();
                            await (await driver.$(`//GuiTab[@Text='${text}']`)).click();
                            await delay(1500);
                            const file = `se11-tab-${i + 1}-${text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.xml`;
                            await demo.captureScreen(step, file);
                        } catch (err) {
                            await demo.fail(step, errMsg(err));
                        }
                    }
                }
            }
        } catch (err) {
            await demo.fail('SE11 flow', errMsg(err));
        }

        await demo.backHome();

        expect(demo.failed).toEqual([]);
    }, 300_000);
});
