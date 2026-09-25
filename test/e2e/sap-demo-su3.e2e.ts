import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';
import { STATUS_BAR, SapDemo, TITLE_BAR, delay, errMsg } from './helpers/sap-demo.js';

/**
 * Demo: edit & save round trip in SU3 (Maintain Own User Data — only touches the
 * logged-in user). Built step by step: each step captures what it lands on, the next
 * one is written from what SAP actually showed.
 *
 *   Step 1 ✅ /nSU3 → "Maintain User Profile", already in change mode, same window.
 *             Tabs Address / Defaults / Parameters; Save = tbar[0]/btn[11].
 *   Step 2 ✅ Address tab: set Department to a fresh value, Save ("User DEVELOPER has
 *             changed"); leave (/n may land on SAP's start screen first), reopen SU3,
 *             check the value stuck.
 *   Step 3    the popup: change again, Back without saving → "save first?" popup
 *             (wnd[1]) → capture it, answer Yes; reopen and check the value stuck.
 *
 * Fields are found by their visible label, like a user would: a label and its input
 * share the SAP Name (SUID_ST_NODE_WORKPLACE-DEPARTMENT), so the plain `name` locator
 * alone would hit the label first. Their Ids carry the subscreen path
 * (…/ssubMAINAREA:SAPLSUID_MAINTENANCE:1900/…), so they're avoided too.
 *
 * Ends with /n back to SAP Easy Access. Leaves the new Department value in place —
 * every run writes a new one, so the check never passes on a stale value.
 *
 * Precondition: a SAP connection is open and logged in, on SAP Easy Access.
 *
 * Output in test-output/sap-demo-su3/: SUMMARY.md, the save popup's page source, plus
 * the page source of the screen a step failed on (failed-<step>.xml).
 */
// The field next to the "Department" label: SAP gives a label and its input the same
// Name, so find the label by its visible text and take the text field with that Name.
const DEPARTMENT = "//GuiTextField[@Name=//GuiLabel[@Text='Department']/@Name]";
const SAVE_BUTTON = '~wnd[0]/tbar[0]/btn[11]'; // "Save (Ctrl+S)"
const BACK_BUTTON = '~wnd[0]/tbar[0]/btn[3]'; // "Back (F3)"
// In the popup: by visible text or tooltip — checked against the capture on the first run.
const YES_BUTTON = "//GuiButton[normalize-space(@Text)='Yes' or starts-with(@Tooltip,'Yes')]";

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
        const reopenedWith = async (value: string, step: string): Promise<boolean> => {
            if (!(await demo.backHome()
                && await demo.runTransaction('/nSU3', 'Reopen SU3', 'Maintain User Profile'))) {return false;}
            try {
                const now = await (await department(driver)).getText();
                if (now === value) {
                    demo.record(step, 'PASS', `"${now}"`);
                    return true;
                }
                return demo.fail(step, `expected "${value}", read "${now}"`);
            } catch (err) {
                return demo.fail(step, errMsg(err));
            }
        };
        const round1 = saved && await reopenedWith(newValue, 'Department after reopen');

        // 4. Round 2, the popup: change again and press Back without saving. SAP asks
        //    whether to save first (a popup, wnd[1] — its own window); answer Yes.
        if (round1) {
            const value2 = `${newValue} B`;
            try {
                await (await department(driver)).setValue(value2);
                demo.record('Change Department again', 'PASS', `→ "${value2}", not saved`);
                const popup = await demo.openPopup(BACK_BUTTON, 'Back with unsaved change → popup');
                if (popup) {
                    await demo.captureScreen('Save popup', '01-page-source-save-popup.xml');
                    const yes = await driver.$(YES_BUTTON);
                    if (await yes.isExisting()) {
                        await yes.click();
                        const closed = await driver.waitUntil(
                            async () => !(await driver.getWindowHandles()).includes(popup),
                            { timeout: 10_000 }).then(() => true, () => false);
                        await driver.switchToWindow(demo.mainWindow);
                        demo.record('Answer Yes', closed ? 'PASS' : 'FAIL',
                            `popup ${closed ? 'closed' : 'still open'}; now "${await demo.textOf(TITLE_BAR)}", status bar "${await demo.textOf(STATUS_BAR)}"`);
                        if (closed) {await reopenedWith(value2, 'Department after Yes');}
                    } else {
                        await demo.fail('Answer Yes', 'no "Yes" button in the popup — see buttons above');
                    }
                }
            } catch (err) {
                await demo.fail('Popup round', errMsg(err));
            }
        }

        await demo.backHome();

        expect(demo.failed).toEqual([]);
    }, 120_000);
});
