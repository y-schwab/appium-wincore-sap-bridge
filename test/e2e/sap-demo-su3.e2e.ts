import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { STATUS_BAR, SapDemo, delay, errMsg } from './helpers/sap-demo.js';

/**
 * Demo: edit & save round trip in SU3 (Maintain Own User Data — only touches the
 * logged-in user), starting from SAP Easy Access.
 *
 *   1. /nSU3 → "Maintain User Profile", already in change mode, same window.
 *   2. Address tab: set Department to a fresh value, Save (tbar[0]/btn[11]) → status
 *      bar "User DEVELOPER has changed". SU3 stays on the same screen, so the status
 *      bar is what's waited for, not the title.
 *   3. Leave (/n may land on SAP's start screen first — backHome clicks through it),
 *      reopen SU3 and check the value stuck.
 *   4. /n back to SAP Easy Access, so the test can be rerun as is.
 *
 * Fields are found by their visible label, like a user would: a label and its input
 * share the SAP Name (SUID_ST_NODE_WORKPLACE-DEPARTMENT), so the plain `name` locator
 * alone would hit the label first. Their Ids carry the subscreen path
 * (…/ssubMAINAREA:SAPLSUID_MAINTENANCE:1900/…), so they're avoided too.
 *
 * Leaves the new Department value in place — every run writes a new one, so the check
 * never passes on a stale value.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo-su3/: SUMMARY.md, plus the page source of the screen
 * a step failed on (failed-<step>.xml).
 */
// The field next to the "Department" label: SAP gives a label and its input the same
// Name, so find the label by its visible text and take the text field with that Name.
const DEPARTMENT = "//GuiTextField[@Name=//GuiLabel[@Text='Department']/@Name]";
const SAVE_BUTTON = '~wnd[0]/tbar[0]/btn[11]'; // "Save (Ctrl+S)"

const demo = new SapDemo('sap-demo-su3', 'SAP demo: SU3 own user data');

async function department(driver: Browser) {
    return driver.$(DEPARTMENT);
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
                // 1. Change Department (checked after reopening, step 3).
                await (await department(driver)).setValue(newValue);
                demo.record('Change Department', 'PASS', `typed "${newValue}"`);

                // 2. Save. SU3 stays on the same screen, so wait for the status bar
                //    instead of the title.
                await (await driver.$(SAVE_BUTTON)).click();
                let status = '';
                const deadline = Date.now() + 10_000;
                while (Date.now() < deadline && !status) {
                    await delay(500);
                    status = (await demo.textOf(STATUS_BAR)).trim();
                }
                saved = status.length > 0;
                demo.record('Save', saved ? 'PASS' : 'FAIL', `status bar "${status || '(empty after 10s)'}"`);
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
