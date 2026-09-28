import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { SapDemo, errMsg } from './helpers/sap-demo.js';

/**
 * Demo: tabs (GuiTab) and a table control (GuiTableControl) in the ABAP Dictionary,
 * display only, starting from SAP Easy Access.
 *
 *   1. /nSE11 → "Database table" T000 → Display → "Dictionary: Display Table" (opens
 *      on the Fields tab).
 *   2. Attributes tab: its fields only exist once it is selected — read the package
 *      (STRM_T000) and original language (EN).
 *   3. Fields tab: the field list is table control tblSAPLSD41TC0, whose cells the
 *      bridge groups into TableRow elements with column Titles. Read the MANDT row by
 *      column Name: data type CLNT, length 3, "Client", key ticked; and each cell's
 *      column Title ("Data Type", "Length", "Short Description").
 *   4. Scroll: only the rows on screen are in the tree (15 of T000's 17 fields) —
 *      the rest don't exist on the client until the table scrolls. LOGSYS, the last
 *      field, isn't there; turn the mouse wheel over the table (windows: scroll, one
 *      notch at a time) until it is, then read its data type (CHAR).
 *   5. /n back to SAP Easy Access. Changes nothing.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/gui-table-control/: SUMMARY.md, plus the page source of the screen
 * a step failed on (failed-<step>.xml).
 */
const DATABASE_TABLE_RADIO = "//GuiRadioButton[@Text='Database table']";
const TABLE_NAME_FIELD = '~wnd[0]/usr/ctxtRSRD1-TBMA_VAL';
const DISPLAY_BUTTON = '~wnd[0]/usr/btnPUSHSHOW'; // "Display (F7)"
const TABLE = 'T000';

const ATTRIBUTES_TAB = "//GuiTab[@Text='Attributes']";
const FIELDS_TAB = "//GuiTab[@Text='Fields']";
const PACKAGE = "//GuiCTextField[@Name='RSDXX-DEVCLASS']"; // Attributes tab only
const LANGUAGE = "//GuiCTextField[@Name='RSDXX-MALANGU']";
const MANDT_ROW = `//GuiTableControl/TableRow[*[@Name='DD03D-FIELDNAME' and @Text='MANDT']]`;
const FIELD_LIST = '//GuiTableControl';
// T000's last field — below the 15 rows on screen.
const LOGSYS_FIELD = "//GuiTableControl/TableRow/*[@Name='DD03D-FIELDNAME' and @Text='LOGSYS']";
const LOGSYS_TYPE = "//GuiTableControl/TableRow[*[@Name='DD03D-FIELDNAME' and @Text='LOGSYS']]/*[@Name='DD03D-DATATYPE']";
const WHEEL_NOTCH = 120; // Win32 WHEEL_DELTA; windows: scroll deltaY > 0 scrolls down
const MAX_NOTCHES = 10;

/** MANDT in T000's field list, by column Name: value and column title. */
const EXPECTED_MANDT: Record<string, { text: string; title: string }> = {
    'DD03D-DATATYPE': { text: 'CLNT', title: 'Data Type' },
    'DD03P-LENG': { text: '3', title: 'Length' },
    'DD03P-DDTEXT': { text: 'Client', title: 'Short Description' },
};

const demo = new SapDemo('gui-table-control', 'GuiTableControl: SE11 tabs and field list');

describe('GuiTableControl: SE11 tabs and field list', () => {
    beforeAll(async () => {
        demo.resetOutput();
        demo.driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('reads table T000 from the ABAP Dictionary tabs', async () => {
        const driver = demo.driver;
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }

        const clickOn = async (selector: string) => {
            await demo.pause();
            await (await driver.$(selector)).click();
            return true;
        };

        try {
            const ready = await demo.runTransaction('/nSE11', 'Open SE11', 'Dictionary')
                && await clickOn(DATABASE_TABLE_RADIO)
                && await demo.typeInto(TABLE_NAME_FIELD, 'table name', TABLE)
                && await demo.pressAndWait(DISPLAY_BUTTON, `Display ${TABLE}`, 'Display Table');

            if (ready) {
                // 1. Attributes: its fields only exist once the tab is selected; the
                //    implicit wait of the next find covers SAP switching the tab.
                await clickOn(ATTRIBUTES_TAB);
                const pkg = await (await driver.$(PACKAGE)).getText();
                const lang = await (await driver.$(LANGUAGE)).getText();
                const detail = `package "${pkg}", language "${lang}"`;
                if (pkg === 'STRM_T000' && lang === 'EN') {demo.record('Tab "Attributes"', 'PASS', detail);} else {await demo.fail('Tab "Attributes"', detail);}

                // 2. Fields: the MANDT row of the field list, its cells by column Name.
                await clickOn(FIELDS_TAB);
                const values: Record<string, string> = {};
                const titles: Record<string, string> = {};
                for (const name of Object.keys(EXPECTED_MANDT)) {
                    const cell = await driver.$(`${MANDT_ROW}/*[@Name='${name}']`);
                    values[name] = (await cell.getText()).trim();
                    titles[name] = String(await cell.getAttribute('Title') ?? '');
                }
                const key = await (await driver.$(`${MANDT_ROW}/GuiCheckBox[@Name='DD03P-KEYFLAG']`)).isSelected();
                const rowOk = Object.entries(EXPECTED_MANDT).every(([k, v]) => values[k] === v.text);
                const rowDetail = `${JSON.stringify(values)}, key ${key}`;
                if (rowOk && key) {demo.record('MANDT row', 'PASS', rowDetail);} else {await demo.fail('MANDT row', rowDetail);}

                const titlesOk = Object.entries(EXPECTED_MANDT).every(([k, v]) => titles[k] === v.title);
                const titleDetail = Object.entries(titles).map(([k, t]) => `${k} = "${t}"`).join('\n');
                if (titlesOk) {demo.record('Column titles', 'PASS', titleDetail);} else {await demo.fail('Column titles', titleDetail);}

                // 3. Scroll: LOGSYS is off screen, so it isn't in the tree until the table
                //    scrolls. Mouse wheel over the table, one notch at a time.
                if (await demo.exists(LOGSYS_FIELD)) {
                    await demo.fail('LOGSYS off screen', 'LOGSYS already listed before scrolling');
                } else {
                    demo.record('LOGSYS off screen', 'PASS', 'not in the tree before scrolling');
                    const table = await driver.$(FIELD_LIST);
                    let notches = 0;
                    let found = false;
                    while (!found && notches < MAX_NOTCHES) {
                        await demo.pause();
                        await driver.executeScript('windows: scroll', [{ elementId: table.elementId, deltaY: WHEEL_NOTCH }]);
                        notches++;
                        found = await demo.exists(LOGSYS_FIELD);
                    }
                    if (!found) {
                        await demo.fail('Scroll to LOGSYS', `not listed after ${notches} wheel notch(es)`);
                    } else {
                        const type = (await (await driver.$(LOGSYS_TYPE)).getText()).trim();
                        const detail = `after ${notches} wheel notch(es): data type "${type}"`;
                        if (type === 'CHAR') {demo.record('Scroll to LOGSYS', 'PASS', detail);} else {await demo.fail('Scroll to LOGSYS', detail);}
                    }
                }
            }
        } catch (err) {
            await demo.fail('SE11 flow', errMsg(err));
        }

        await demo.backHome();

        expect(demo.failed).toEqual([]);
    }, 180_000);
});
