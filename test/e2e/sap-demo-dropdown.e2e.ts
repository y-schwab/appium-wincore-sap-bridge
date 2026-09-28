import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { SapDemo, delay, errMsg, shortId } from './helpers/sap-demo.js';

/**
 * Demo: dropdown (GuiComboBox) setValue by visible text, in SU3's Defaults tab (Decimal
 * Notation, Date Format, …), starting from SAP Easy Access. Nothing is saved.
 *
 *   1. /nSU3 → "Maintain User Profile", switch to the Defaults tab.
 *   2. Read every dropdown on it from the page source: selected Key and Text, and its
 *      entries (ComboBoxEntry Key / Value). Pick one with an entry other than the
 *      selected one (or SAP_DROPDOWN_ID, e.g. wnd[0]/usr/…/cmbSUID_ST_NODE_DEFAULTS-DATFM).
 *   3. windows: setValue with the other entry's visible text → Key and Text follow.
 *   4. windows: setValue with the original key (the old way still works).
 *   5. The other entry's text in another case (case-insensitive match).
 *   6. windows: setValue with a text no entry has → error, selection unchanged.
 *   7. Original back, by key.
 *   8. Plain WebDriver setValue with a visible text (INFO only: the driver clears the
 *      field and types keystrokes, it doesn't hand the text to the bridge).
 *   9. /n back to SAP Easy Access, discarding nothing (the original value is back).
 *
 * windows: setValue, not element.setValue: that goes straight to the bridge's setValue
 * (setElementValue), which is what resolves the text to an entry key.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo-dropdown/: SUMMARY.md, the Defaults tab's page source
 * (su3-defaults.xml) and the page source of the screen a step failed on.
 */
const DEFAULTS_TAB = "//GuiTab[@Text='Defaults']";

interface Entry { key: string; value: string }
interface Dropdown { id: string; name: string; key: string; text: string; changeable: boolean; entries: Entry[] }

const demo = new SapDemo('sap-demo-dropdown', 'SAP demo: dropdown setValue by visible text');

function decode(s: string): string {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function attr(attrs: string, name: string): string {
    const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
    return m ? decode(m[1]) : '';
}

/** Every GuiComboBox in a page source, with its entries. */
function dropdowns(xml: string): Dropdown[] {
    const result: Dropdown[] = [];
    for (const m of xml.matchAll(/<GuiComboBox\b([^>]*?)(\/>|>([\s\S]*?)<\/GuiComboBox>)/g)) {
        const attrs = m[1];
        const entries = [...(m[3] ?? '').matchAll(/<ComboBoxEntry\b([^>]*?)\/?>/g)]
            .map((e) => ({ key: attr(e[1], 'Key'), value: attr(e[1], 'Value') }));
        result.push({
            id: attr(attrs, 'Id'),
            name: attr(attrs, 'Name'),
            key: attr(attrs, 'Key'),
            text: attr(attrs, 'Text'),
            changeable: attr(attrs, 'Changeable').toLowerCase() === 'true',
            entries,
        });
    }
    return result;
}

function describeEntries(entries: Entry[]): string {
    return entries.map((e) => `'${e.key}'=${JSON.stringify(e.value)}`).join(', ') || '(no entries in page source)';
}

/** An entry to switch to: not the selected one, with a non-blank text no other entry shares. */
function otherEntry(d: Dropdown): Entry | undefined {
    const counts = new Map<string, number>();
    for (const e of d.entries) {counts.set(e.value.trim().toLowerCase(), (counts.get(e.value.trim().toLowerCase()) ?? 0) + 1);}
    return d.entries.find((e) => e.key !== d.key && e.value.trim() !== ''
        && counts.get(e.value.trim().toLowerCase()) === 1);
}

describe('sap demo: dropdown', () => {
    beforeAll(async () => {
        demo.resetOutput();
        demo.driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('selects dropdown entries by visible text', async () => {
        const driver = demo.driver;
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }

        /** The dropdown's selected key and text, read back through the bridge. */
        const readBack = async (selector: string) => {
            const el = await driver.$(selector);
            return { key: String(await el.getAttribute('Key') ?? ''), text: await el.getText() };
        };

        /** windows: setValue, then compare what SAP shows with the expected entry. */
        const setAndCheck = async (step: string, selector: string, value: string, expected: Entry) => {
            try {
                await demo.pause();
                const el = await driver.$(selector);
                await driver.executeScript('windows: setValue', [{ elementId: el.elementId, value }]);
                const now = await readBack(selector);
                const ok = now.key.trim() === expected.key.trim() && now.text.trim() === expected.value.trim();
                const detail = `setValue ${JSON.stringify(value)} → Key '${now.key}', Text ${JSON.stringify(now.text)}`
                    + (ok ? '' : `; expected Key '${expected.key}', Text ${JSON.stringify(expected.value)}`);
                if (ok) {demo.record(step, 'PASS', detail);} else {await demo.fail(step, detail);}
                return ok;
            } catch (err) {
                return demo.fail(step, `setValue ${JSON.stringify(value)}: ${errMsg(err)}`);
            }
        };

        try {
            if (await demo.runTransaction('/nSU3', 'Open SU3', 'Maintain User Profile')) {
                // 1. Defaults tab — its dropdowns only exist once it is selected.
                let found: Dropdown[] = [];
                let xml = '';
                try {
                    await demo.pause();
                    await (await driver.$(DEFAULTS_TAB)).click();
                    const deadline = Date.now() + 10_000;
                    while (Date.now() < deadline) {
                        xml = await driver.getPageSource();
                        found = dropdowns(xml);
                        if (found.length > 0) {break;}
                        await delay(500);
                    }
                    demo.save('su3-defaults.xml', xml);
                    demo.record('Open Defaults tab', found.length > 0 ? 'PASS' : 'FAIL',
                        `${found.length} dropdown(s); page source in su3-defaults.xml (${xml.length} chars)`);
                } catch (err) {
                    await demo.fail('Open Defaults tab', errMsg(err));
                }

                // 2. What the bridge reports for each dropdown (diagnostics).
                for (const d of found) {
                    const label = await demo.textOf(`//GuiLabel[@Name='${d.name}']`);
                    demo.record(`Dropdown ${shortId(d.id)}`, 'INFO', [
                        `label "${label}", Name ${d.name}${d.changeable ? '' : ' (read-only)'}`,
                        `selected Key '${d.key}', Text ${JSON.stringify(d.text)}`,
                        `${d.entries.length} entries: ${describeEntries(d.entries)}`,
                    ].join('\n'));
                }

                const wanted = process.env.SAP_DROPDOWN_ID;
                const pick = wanted
                    ? found.find((d) => shortId(d.id) === shortId(wanted) || d.id.endsWith(wanted))
                    : found.find((d) => d.changeable && otherEntry(d));
                const target = pick && otherEntry(pick);
                if (found.length > 0 && (!pick || !target)) {
                    await demo.fail('Pick a dropdown', wanted
                        ? `SAP_DROPDOWN_ID "${wanted}" not found, or it has no other entry with a unique text`
                        : 'no changeable dropdown with a second entry that has a unique text');
                }

                if (pick && target) {
                    const selector = `~${shortId(pick.id)}`;
                    const original: Entry = { key: pick.key, value: pick.text };
                    demo.record('Pick a dropdown', 'INFO',
                        `${shortId(pick.id)}: '${original.key}' ${JSON.stringify(original.value)} → '${target.key}' ${JSON.stringify(target.value)}`);

                    // 3. By visible text.
                    await setAndCheck('setValue by visible text', selector, target.value.trim(), target);

                    // 4. By key — how it worked before this change.
                    await setAndCheck('setValue by key', selector, original.key, original);

                    // 5. By visible text in another case.
                    const other = target.value.trim().toUpperCase() !== target.value.trim()
                        ? target.value.trim().toUpperCase()
                        : target.value.trim().toLowerCase();
                    if (other !== target.value.trim()) {
                        await setAndCheck('setValue by text, ignoring case', selector, other, target);
                    } else {
                        // Nothing to change the case of: select it by its text again, so
                        // step 6 still starts on the target entry.
                        await setAndCheck('setValue by visible text (again)', selector, target.value.trim(), target);
                        demo.record('setValue by text, ignoring case', 'INFO', `skipped: ${JSON.stringify(target.value)} has no letters`);
                    }

                    // 6. Unknown text: an error, selection untouched. (The driver's
                    //    windows: setValue retries a failed setValue as a number, so the
                    //    bridge's message may be replaced by a RangeValue one.)
                    const bogus = 'E2E no such entry';
                    try {
                        const el = await driver.$(selector);
                        await driver.executeScript('windows: setValue', [{ elementId: el.elementId, value: bogus }]);
                        await demo.fail('setValue unknown text', `no error for ${JSON.stringify(bogus)}; now ${JSON.stringify(await readBack(selector))}`);
                    } catch (err) {
                        const now = await readBack(selector);
                        const unchanged = now.key.trim() === target.key.trim();
                        const detail = `error: ${errMsg(err)}\nafter: Key '${now.key}', Text ${JSON.stringify(now.text)}`;
                        if (unchanged) {demo.record('setValue unknown text', 'PASS', detail);} else {await demo.fail('setValue unknown text', detail);}
                    }

                    // 7. Put the original back, by key.
                    await setAndCheck('Restore by key', selector, original.key, original);

                    // 8. Plain WebDriver setValue: diagnostics only.
                    try {
                        const el = await driver.$(selector);
                        await el.setValue(target.value.trim());
                        const now = await readBack(selector);
                        demo.record('element.setValue by text (info)', 'INFO',
                            `→ Key '${now.key}', Text ${JSON.stringify(now.text)}`);
                    } catch (err) {
                        demo.record('element.setValue by text (info)', 'INFO', `error: ${errMsg(err)}`);
                    }
                    // Whatever step 8 did, restore by key.
                    const now = await readBack(selector).catch(() => undefined);
                    if (now && now.key.trim() !== original.key.trim()) {
                        await setAndCheck('Restore after element.setValue', selector, original.key, original);
                    }
                }
            }
        } catch (err) {
            await demo.fail('Dropdown demo', errMsg(err));
        }

        await demo.backHome();

        expect(demo.failed).toEqual([]);
    }, 180_000);
});
