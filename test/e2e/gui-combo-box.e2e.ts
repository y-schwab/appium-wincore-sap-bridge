import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { SapDemo, errMsg } from './helpers/sap-demo.js';

/**
 * Demo: set a dropdown (GuiComboBox) by its visible text, in SU3's Defaults tab,
 * starting from SAP Easy Access. Nothing is saved.
 *
 *   1. /nSU3 → "Maintain User Profile", switch to the Defaults tab.
 *   2. Date Format: select "MM/DD/YYYY (Gregorian Date)" by its text → Key 2.
 *   3. Back to the original entry by key (how setValue worked before).
 *   4. The same text in upper case → Key 2 again (case-insensitive match).
 *   5. A text no entry has → error, selection unchanged.
 *   6. An entry as an element: find the ISO entry (ComboBoxEntry, by its Value) and
 *      pick it with windows: select → Key 6, and the entry reports itself selected.
 *   7. Original entry back by key; /n back to SAP Easy Access.
 *
 * windows: setValue, not element.setValue: the latter clears the dropdown first
 * (setValue "") and then types keystrokes; Date Format has no blank entry to clear to.
 *
 * Found by its visible label, like a user would: a label and its dropdown share the
 * SAP Name (SUID_ST_NODE_DEFAULTS-DATFM).
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/gui-combo-box/: SUMMARY.md, plus the page source of the
 * screen a step failed on (failed-<step>.xml).
 */
const DEFAULTS_TAB = "//GuiTab[@Text='Defaults']";
const DATE_FORMAT = "//GuiComboBox[@Name=//GuiLabel[@Text='Date Format']/@Name]";

// Two Date Format entries; switch to whichever isn't selected.
const MDY = { key: '2', text: 'MM/DD/YYYY (Gregorian Date)' };
const MDY_DASH = { key: '3', text: 'MM-DD-YYYY (Gregorian Date)' };
const ISO = { key: '6', text: 'YYYY-MM-DD (Gregorian Date, ISO 8601)' };
const ISO_ENTRY = `${DATE_FORMAT}/ComboBoxEntry[@Value='${ISO.text}']`;

interface Entry { key: string; text: string }

const demo = new SapDemo('gui-combo-box', 'GuiComboBox: SU3 dropdown by text or key');

describe('GuiComboBox: SU3 Date Format', () => {
    beforeAll(async () => {
        demo.resetOutput();
        demo.driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('selects a dropdown entry by its visible text', async () => {
        const driver = demo.driver;
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }

        try {
            if (await demo.runTransaction('/nSU3', 'Open SU3', 'Maintain User Profile')) {
                // 1. Defaults tab: Date Format only exists once it is selected (the find's
                //    implicit wait covers the tab switch). Found once, reused throughout.
                await demo.pause();
                await (await driver.$(DEFAULTS_TAB)).click();
                const dropdown = await driver.$(DATE_FORMAT);
                const key = async () => String(await dropdown.getAttribute('Key') ?? '');

                /**
                 * windows: setValue, then check the selected entry: its key, and the text
                 * a user sees (the bridge trims SAP's ~250 blanks of padding off it).
                 */
                const setAndCheck = async (step: string, value: string, expected: Entry) => {
                    try {
                        await demo.pause();
                        await driver.executeScript('windows: setValue', [{ elementId: dropdown.elementId, value }]);
                        const now = { key: await key(), text: await dropdown.getText() };
                        const detail = `"${value}" → Key '${now.key}', "${now.text}"`;
                        if (now.key === expected.key && now.text === expected.text) {
                            demo.record(step, 'PASS', detail);
                        } else {
                            await demo.fail(step, `${detail}; expected Key '${expected.key}', "${expected.text}"`);
                        }
                    } catch (err) {
                        await demo.fail(step, `"${value}": ${errMsg(err)}`);
                    }
                };

                const original: Entry = { key: await key(), text: await dropdown.getText() };
                demo.record('Open Defaults tab', 'PASS', `Date Format: Key '${original.key}', "${original.text}"`);
                const target = original.key === MDY.key ? MDY_DASH : MDY;

                // 2.–4. By text, by key, by text in another case.
                await setAndCheck('setValue by visible text', target.text, target);
                await setAndCheck('setValue by key', original.key, original);
                await setAndCheck('setValue by text, ignoring case', target.text.toUpperCase(), target);

                // 5. Unknown text: an error, selection untouched. (The driver's
                //    windows: setValue retries a failed setValue as a number, so the
                //    error reads "not a valid number for the RangeValue pattern".)
                const bogus = 'E2E no such entry';
                try {
                    await driver.executeScript('windows: setValue', [{ elementId: dropdown.elementId, value: bogus }]);
                    await demo.fail('setValue unknown text', `no error for "${bogus}"`);
                } catch (err) {
                    const now = await key();
                    if (now === target.key) {
                        demo.record('setValue unknown text', 'PASS', `rejected, still Key '${now}'`);
                    } else {
                        await demo.fail('setValue unknown text', `${errMsg(err)}; Key changed to '${now}'`);
                    }
                }

                // 6. An entry as an element: windows: select picks it.
                try {
                    await demo.pause();
                    const entry = await driver.$(ISO_ENTRY);
                    await driver.executeScript('windows: select', [{ elementId: entry.elementId }]);
                    const now = { key: await key(), text: await dropdown.getText() };
                    const entrySelected = await entry.isSelected();
                    const detail = `Key '${now.key}', "${now.text}", entry isSelected ${entrySelected}`;
                    if (now.key === ISO.key && now.text === ISO.text && entrySelected) {
                        demo.record('windows: select on an entry', 'PASS', detail);
                    } else {
                        await demo.fail('windows: select on an entry', `${detail}; expected Key '${ISO.key}'`);
                    }
                } catch (err) {
                    await demo.fail('windows: select on an entry', errMsg(err));
                }

                // 7. Leave it as it was.
                await setAndCheck('Restore by key', original.key, original);
            }
        } catch (err) {
            await demo.fail('Dropdown demo', errMsg(err));
        }

        await demo.backHome();

        expect(demo.failed).toEqual([]);
    }, 120_000);
});
