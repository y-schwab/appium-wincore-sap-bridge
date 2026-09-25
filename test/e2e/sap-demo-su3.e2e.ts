import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { STATUS_BAR, SapDemo, delay, errMsg } from './helpers/sap-demo.js';

/**
 * Demo: edit & save round trip in SU3 (Maintain Own User Data — only touches the
 * logged-in user). Built step by step: each step captures what it lands on, the next
 * one is written from what SAP actually showed.
 *
 *   Step 1 ✅ /nSU3 → "Maintain User Profile", already in change mode, same window.
 *             Tabs Address / Defaults / Parameters; Save = tbar[0]/btn[11].
 *   Step 2    Address tab: set Department to a fresh value, Save, check the status
 *             bar message; leave, reopen SU3 and check the value stuck.
 *
 * Fields are found by SAP Name (the `name` locator): their Ids carry the subscreen
 * path (…/ssubMAINAREA:SAPLSUID_MAINTENANCE:1900/…), which the Name doesn't.
 *
 * Ends with /n back to SAP Easy Access. Leaves the new Department value in place —
 * every run writes a new one, so the check never passes on a stale value.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo-su3/: SUMMARY.md, plus the page source of anything
 * unexpected (a popup after Save) and of the screen a step failed on (failed-<step>.xml).
 */
const DEPARTMENT = 'SUID_ST_NODE_WORKPLACE-DEPARTMENT';
const SAVE_BUTTON = '~wnd[0]/tbar[0]/btn[11]'; // "Save (Ctrl+S)"

const demo = new SapDemo('sap-demo-su3', 'SAP demo: SU3 own user data');

async function department(driver: Browser) {
    return driver.$(await driver.findElement('name', DEPARTMENT));
}

describe('sap demo: SU3', () => {
    beforeAll(async () => {
        demo.resetOutput();
        demo.driver = await createSapGuiSession();
    });

    afterAll(async () => {
        try { await demo.driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(demo.driver);
    });

    it('changes and saves own user data', async () => {
        const driver = demo.driver;
        if (!(await demo.attachHome())) {
            expect(demo.failed).toEqual([]);
            return;
        }

        // A value no earlier run wrote: "E2E 20:01:58".
        const newValue = `E2E ${new Date().toISOString().slice(11, 19)}`;
        let saved = false;

        try {
            if (await demo.runTransaction('/nSU3', 'Open SU3', 'Maintain User Profile')) {
                // 1. Change Department.
                const field = await department(driver);
                const before = await field.getText();
                await field.setValue(newValue);
                const typed = await field.getText();
                demo.record('Change Department', typed === newValue ? 'PASS' : 'FAIL', `"${before}" → "${typed}"`);

                // 2. Save. SU3 stays on the same screen, so watch the status bar (and any
                //    popup SAP might open) instead of the title.
                const handlesBefore = new Set(await driver.getWindowHandles());
                await (await driver.$(SAVE_BUTTON)).click();
                let status = '';
                let popup: string | undefined;
                const deadline = Date.now() + 10_000;
                while (Date.now() < deadline && !status && !popup) {
                    await delay(500);
                    status = (await demo.textOf(STATUS_BAR)).trim();
                    popup = (await driver.getWindowHandles()).find((h) => !handlesBefore.has(h));
                }
                if (popup) {
                    await driver.switchToWindow(popup);
                    await demo.captureScreen('Popup after Save', '01-page-source-popup-after-save.xml');
                    await driver.switchToWindow(demo.mainWindow);
                } else {
                    saved = status.length > 0;
                    demo.record('Save', saved ? 'PASS' : 'FAIL', `status bar "${status || '(empty after 10s)'}"`);
                }
            }
        } catch (err) {
            await demo.fail('Change and save', errMsg(err));
        }

        // 3. Leave, come back, check the value stuck.
        if (saved && await demo.backHome()
            && await demo.runTransaction('/nSU3', 'Reopen SU3', 'Maintain User Profile')) {
            try {
                const now = await (await department(driver)).getText();
                if (now === newValue) {
                    demo.record('Department after reopen', 'PASS', `"${now}"`);
                } else {
                    await demo.fail('Department after reopen', `expected "${newValue}", read "${now}"`);
                }
            } catch (err) {
                await demo.fail('Department after reopen', errMsg(err));
            }
        }

        await demo.backHome();

        expect(demo.failed).toEqual([]);
    }, 120_000);
});
