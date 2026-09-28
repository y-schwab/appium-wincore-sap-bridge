import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { SapDemo, delay, errMsg } from './helpers/sap-demo.js';

/**
 * Demo: tabs (GuiTab) and a table control (GuiTableControl) in the ABAP Dictionary,
 * display only, starting from SAP Easy Access. Built step by step: each step captures
 * what it lands on, the next one is written from what SAP showed.
 *
 *   Step 1 ✅ /nSE11 → "Database table" T000 → Display → "Dictionary: Display Table",
 *             opens on the Fields tab. Tabs in tabsTAB_STRIP: Attributes, Delivery and
 *             Maintenance, Fields, Input Help/Check, Currency/Quantity Fields, Indexes;
 *             a tab's content is only in the tree while it is selected. The field list
 *             is table control tblSAPLSD41TC0: 10 columns, RowCount 31,
 *             VisibleRowCount 15 (T000 has 17 fields — 2 need scrolling), cells
 *             txtDD03D-FIELDNAME[col,row] … — the bridge now groups them into TableRow
 *             elements and gives each cell its column Title.
 *   Step 2    Attributes tab: the package field isn't there before the click, is
 *             after (STRM_T000, original language EN). Fields tab: read the MANDT row
 *             through TableRow (data type CLNT, length 3, "Client", key ticked) and
 *             its column titles; list which fields are on screen.
 *
 * Ends with /n back to SAP Easy Access. Changes nothing.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo-se11/: SUMMARY.md, the Fields tab's page source
 * (se11-fields.xml), plus the page source of the screen a step failed on.
 */
const DATABASE_TABLE_RADIO = "//GuiRadioButton[@Text='Database table']";
const TABLE_NAME_FIELD = '~wnd[0]/usr/ctxtRSRD1-TBMA_VAL';
const DISPLAY_BUTTON = '~wnd[0]/usr/btnPUSHSHOW'; // "Display (F7)"
const TABLE = 'T000';

const ATTRIBUTES_TAB = "//GuiTab[@Text='Attributes']";
const FIELDS_TAB = "//GuiTab[@Text='Fields']";
const PACKAGE = "//GuiCTextField[@Name='RSDXX-DEVCLASS']"; // Attributes tab only
const LANGUAGE = "//GuiCTextField[@Name='RSDXX-MALANGU']";
const FIELD_LIST = '//GuiTableControl';
const MANDT_ROW = `${FIELD_LIST}/TableRow[*[@Name='DD03D-FIELDNAME' and @Text='MANDT']]`;

/** MANDT in T000's field list, by column Name. */
const EXPECTED_MANDT: Record<string, string> = {
    'DD03D-DATATYPE': 'CLNT',
    'DD03P-LENG': '3',
    'DD03P-DDTEXT': 'Client',
};

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

    it('reads table T000 from the ABAP Dictionary tabs', async () => {
        const driver = demo.driver;
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }

        /** Clicks a tab and waits until `content` shows up in it. */
        const openTab = async (tab: string, name: string, content: string) => {
            await demo.pause();
            await (await driver.$(tab)).click();
            const deadline = Date.now() + 10_000;
            while (Date.now() < deadline) {
                if (await demo.exists(content)) {return true;}
                await delay(300);
            }
            return demo.fail(`Open tab "${name}"`, `no ${content} within 10s`);
        };

        try {
            let ready = false;
            if (await demo.runTransaction('/nSE11', 'Open SE11', 'Dictionary')) {
                const radio = await driver.$(DATABASE_TABLE_RADIO);
                if (!(await radio.isSelected())) {await radio.click();}
                ready = await demo.typeInto(TABLE_NAME_FIELD, 'table name', TABLE)
                    && await demo.pressAndWait(DISPLAY_BUTTON, `Display ${TABLE}`, 'Display Table');
            }

            if (ready) {
                // 1. Attributes: its fields only exist once the tab is selected.
                const before = await demo.exists(PACKAGE);
                if (await openTab(ATTRIBUTES_TAB, 'Attributes', PACKAGE)) {
                    const pkg = await (await driver.$(PACKAGE)).getText();
                    const lang = await (await driver.$(LANGUAGE)).getText();
                    const ok = !before && pkg === 'STRM_T000' && lang === 'EN';
                    const detail = `package field before click: ${before ? 'present' : 'absent'}; after: "${pkg}", language "${lang}"`;
                    if (ok) {demo.record('Tab "Attributes"', 'PASS', detail);} else {await demo.fail('Tab "Attributes"', detail);}
                }

                // 2. Fields: the table control, row by row.
                if (await openTab(FIELDS_TAB, 'Fields', FIELD_LIST)) {
                    const table = await driver.$(FIELD_LIST);
                    const xml = await driver.getPageSource();
                    demo.save('se11-fields.xml', xml);

                    // Diagnostics: the rows as the bridge built them, and the first row's cells.
                    const rows = [...xml.matchAll(/<TableRow\b[^>]*>([\s\S]*?)<\/TableRow>/g)];
                    const first = rows[0]?.[1] ?? '';
                    const firstCells = [...first.matchAll(/<(Gui\w+) [^>]*?Name="([^"]*)"[^>]*?Text="([^"]*)"[^>]*?Title="([^"]*)"/g)]
                        .map((m) => `${m[1]} ${m[2]} "${m[3]}" — Title "${m[4]}"`);
                    const names = rows.map((r) => /Name="DD03D-FIELDNAME"[^>]*?Text="([^"]*)"/.exec(r[1])?.[1] ?? '?');
                    demo.record('Field list (info)', 'INFO', [
                        `RowCount ${await table.getAttribute('RowCount')}, VisibleRowCount ${await table.getAttribute('VisibleRowCount')}, `
                        + `${rows.length} TableRow element(s); page source in se11-fields.xml`,
                        `on screen: ${names.join(', ')}`,
                        '— first row —', ...(firstCells.length ? firstCells : ['(no cells with a Title)']),
                    ].join('\n'));

                    // The MANDT row, then its cells by column Name. TableRow has no element
                    // id of its own, so check it through its FIELDNAME cell.
                    if (!(await demo.exists(`${MANDT_ROW}/*[@Name='DD03D-FIELDNAME']`))) {
                        await demo.fail('MANDT row', `no ${MANDT_ROW}`);
                    } else {
                        const values: Record<string, string> = {};
                        const titles: Record<string, string> = {};
                        for (const name of Object.keys(EXPECTED_MANDT)) {
                            const cell = await driver.$(`${MANDT_ROW}/*[@Name='${name}']`);
                            values[name] = (await cell.getText()).trim();
                            titles[name] = String(await cell.getAttribute('Title') ?? '');
                        }
                        const key = await (await driver.$(`${MANDT_ROW}/GuiCheckBox[@Name='DD03P-KEYFLAG']`)).isSelected();
                        const wrong = Object.entries(EXPECTED_MANDT).filter(([k, v]) => values[k] !== v);
                        const detail = `${JSON.stringify(values)}, key ${key}`;
                        if (wrong.length === 0 && key) {demo.record('MANDT row', 'PASS', detail);} else {await demo.fail('MANDT row', detail);}

                        const titleList = Object.entries(titles).map(([k, t]) => `${k} = "${t}"`).join('\n');
                        if (Object.values(titles).every((t) => t.length > 0)) {
                            demo.record('Column titles', 'PASS', titleList);
                        } else {
                            await demo.fail('Column titles', titleList);
                        }
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
