import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser, ChainablePromiseElement } from 'webdriverio';

/**
 * Shared plumbing for the SAP demo tests (sap-demo-*.e2e.ts): a SUMMARY.md report
 * rewritten after every check, and the few moves every SAP flow is made of — type into
 * a field, press a button and wait for the next screen, run a transaction.
 */

// Standard SAP GUI ids, the same on every screen of the main window.
export const OKCODE = '~wnd[0]/tbar[0]/okcd'; // command field
export const ENTER_BUTTON = '~wnd[0]/tbar[0]/btn[0]'; // green check mark = Enter
export const TITLE_BAR = '~wnd[0]/titl';
export const STATUS_BAR = '~wnd[0]/sbar';
const START_BUTTON = '~wnd[0]/usr/btnSTARTBUTTON'; // "Start SAP Easy Access", on the "SAP" start screen

export const WINDOW_TITLE = process.env.SAP_WINDOW_TITLE ?? 'SAP Easy';

type Status = 'PASS' | 'FAIL' | 'INFO';

interface Check {
    step: string;
    status: Status;
    detail: string;
}

export function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `sap:/app/con[0]/ses[0]/wnd[0]/…` → `wnd[0]/…`. */
export function shortId(id: string): string {
    return id.replace(/^(sap:)?\/app\/con\[\d+\]\/ses\[\d+\]\//, '');
}

/** Raw element id of a WebDriver element reference. */
export function refId(ref: object): string {
    return Object.values(ref)[0] as string;
}

export class SapDemo {
    readonly checks: Check[] = [];
    private readonly dir: string;
    driver!: Browser;
    /** Handle of the SAP main window (wnd[0]), set by attachHome. */
    mainWindow = '';

    constructor(outputName: string, private readonly title: string) {
        this.dir = resolve(process.cwd(), 'test-output', outputName);
    }

    resetOutput(): void {
        rmSync(this.dir, { recursive: true, force: true });
        mkdirSync(this.dir, { recursive: true });
    }

    get failed(): Check[] {
        return this.checks.filter((c) => c.status === 'FAIL');
    }

    save(name: string, content: string): void {
        writeFileSync(resolve(this.dir, name), content, 'utf8');
    }

    record(step: string, status: Status, detail: string): void {
        this.checks.push({ step, status, detail });
        this.writeReport();
    }

    /** Rewritten after every check, so a crash midway still leaves everything seen so far. */
    private writeReport(): void {
        const icon: Record<Status, string> = { PASS: '✅', FAIL: '❌', INFO: 'ℹ️' };
        const lines = [
            `# ${this.title}`,
            '',
            `Run: ${new Date().toISOString()}  `,
            `PASS: ${this.checks.filter((c) => c.status === 'PASS').length} · FAIL: ${this.failed.length}`,
            '',
            '| # | Status | Step | Detail |',
            '| --- | --- | --- | --- |',
            ...this.checks.map((c, i) =>
                `| ${i + 1} | ${icon[c.status]} ${c.status} | ${c.step} | ${c.detail.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')} |`),
            '',
        ];
        this.save('SUMMARY.md', lines.join('\n'));
    }

    /** Records a failure along with the page source of the screen it happened on. */
    async fail(step: string, detail: string): Promise<false> {
        const file = `failed-${step.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.xml`;
        try {
            this.save(file, await this.driver.getPageSource());
            detail += ` — page source in ${file}`;
        } catch { /* noop */ }
        this.record(step, 'FAIL', detail);
        return false;
    }

    async textOf(selector: string): Promise<string> {
        try {
            const el = await this.driver.$(selector);
            return (await el.isExisting()) ? await el.getText() : '(not found)';
        } catch (err) {
            return `(error: ${errMsg(err)})`;
        }
    }

    /** Switches to the logged-in SAP Easy Access window and attaches. */
    async attachHome(): Promise<boolean> {
        // Retried: right after another test's /n the window can still be mid-reload.
        const deadline = Date.now() + 15_000;
        for (;;) {
            try {
                await this.driver.executeScript('windows: switchToWindowByTitle', [{ title: WINDOW_TITLE }]);
                break;
            } catch (err) {
                if (Date.now() > deadline) {
                    this.record(`Switch to "${WINDOW_TITLE}"`, 'FAIL', `${errMsg(err)} — is SAP logged in and on SAP Easy Access?`);
                    return false;
                }
                await delay(1000);
            }
        }
        this.mainWindow = await this.driver.getWindowHandle();
        const attach = await this.driver.executeScript('windows: attachSapGui', [{}]) as Record<string, unknown>;
        if (!attach.attached) {
            this.record('Attach', 'FAIL', JSON.stringify(attach));
            return false;
        }
        this.record('Attach', 'PASS', `${attach.system}, "${await this.textOf(TITLE_BAR)}"`);
        return true;
    }

    async typeInto(selector: string, label: string, value: string): Promise<boolean> {
        try {
            await (await this.driver.$(selector)).setValue(value);
            return true;
        } catch (err) {
            return this.fail(`Type "${value}" in ${label}`, errMsg(err));
        }
    }

    /**
     * Clicks a button and waits for SAP to move to the next screen: the title bar
     * changes — to one containing `expectTitle`, when given (SAP shows a bare "SAP" in
     * between while a screen reloads). Passes with the title SAP landed on.
     */
    async pressAndWait(selector: string, step: string, expectTitle?: string, timeoutMs = 15_000): Promise<boolean> {
        const before = await this.textOf(TITLE_BAR);
        try {
            await (await this.driver.$(selector)).click();
        } catch (err) {
            return this.fail(step, `click ${selector}: ${errMsg(err)}`);
        }
        const deadline = Date.now() + timeoutMs;
        let now = before;
        while (Date.now() < deadline) {
            now = await this.textOf(TITLE_BAR);
            if (now !== before && !now.startsWith('(') && (!expectTitle || now.includes(expectTitle))) {
                this.record(step, 'PASS', `→ "${now.replace(/\s{2,}/g, ' ')}"`);
                return true;
            }
            await delay(500);
        }
        return this.fail(step, `screen stayed "${now}"; status bar "${await this.textOf(STATUS_BAR)}"`);
    }

    async runTransaction(tcode: string, step: string, expectTitle?: string): Promise<boolean> {
        return await this.typeInto(OKCODE, 'command field', tcode)
            && this.pressAndWait(ENTER_BUTTON, step, expectTitle);
    }

    /**
     * /n back to SAP Easy Access, so the next test (or rerun) starts from there. /n can
     * land on SAP's start screen instead (title "SAP", a single "Start SAP Easy Access"
     * button) — press that, like a user would.
     */
    async backHome(timeoutMs = 20_000): Promise<boolean> {
        const step = 'Back to SAP Easy Access';
        if (this.mainWindow) {await this.driver.switchToWindow(this.mainWindow).catch(() => undefined);}
        if (!(await this.typeInto(OKCODE, 'command field', '/n'))) {return false;}
        try {
            await (await this.driver.$(ENTER_BUTTON)).click();
        } catch (err) {
            return this.fail(step, `click ${ENTER_BUTTON}: ${errMsg(err)}`);
        }
        let viaStart = false;
        let now = '';
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            now = await this.textOf(TITLE_BAR);
            if (now.includes('SAP Easy Access')) {
                this.record(step, 'PASS', `→ "${now.replace(/\s{2,}/g, ' ')}"${viaStart ? ' (via start screen)' : ''}`);
                return true;
            }
            const start = await this.driver.$(START_BUTTON);
            if (!viaStart && await start.isExisting()) {
                await start.click();
                viaStart = true;
            }
            await delay(500);
        }
        return this.fail(step, `screen stayed "${now}"; status bar "${await this.textOf(STATUS_BAR)}"`);
    }

    /**
     * Clicks a button that opens a popup (wnd[1] — its own window) and switches to it.
     * Returns the popup's handle, or undefined (recorded as FAIL) if none appeared.
     */
    async openPopup(selector: string, step: string, timeoutMs = 10_000): Promise<string | undefined> {
        const before = new Set(await this.driver.getWindowHandles());
        try {
            await (await this.driver.$(selector)).click();
        } catch (err) {
            await this.fail(step, `click ${selector}: ${errMsg(err)}`);
            return undefined;
        }
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const added = (await this.driver.getWindowHandles()).filter((h) => !before.has(h));
            if (added.length > 0) {
                await this.driver.switchToWindow(added[0]);
                this.record(step, 'PASS', `new window ${added[0]} "${await this.driver.getTitle()}"`);
                return added[0];
            }
            await delay(500);
        }
        await this.fail(step, `no new window within ${timeoutMs / 1000}s; status bar "${await this.textOf(STATUS_BAR)}"`);
        return undefined;
    }

    /**
     * Discovery for a screen that isn't scripted yet: saves its page source and records
     * what a person would look at — title, status bar, windows, tabs, input fields,
     * application toolbar buttons, shell controls (grid, tree, …) with their grid rows.
     */
    async captureScreen(label: string, file: string): Promise<void> {
        const d = this.driver;
        const xml = await d.getPageSource();
        this.save(file, xml);

        const list = async (xpath: string, describe: (el: ChainablePromiseElement, id: string) => Promise<string>) => {
            const rows: string[] = [];
            for (const ref of await d.findElements('xpath', xpath)) {
                const id = shortId(refId(ref));
                try { rows.push(await describe(await d.$(ref), id)); } catch (err) { rows.push(`${id}: ${errMsg(err)}`); }
            }
            return rows.length ? rows : ['(none)'];
        };

        const tabs = await list('//GuiTab', async (el, id) =>
            `${id} "${await el.getText()}"${(await el.isSelected().catch(() => false)) ? ' (selected)' : ''}`);
        const fields = await list(
            '//GuiUserArea//*[self::GuiTextField or self::GuiCTextField or self::GuiPasswordField or self::GuiComboBox or self::GuiCheckBox or self::GuiRadioButton]',
            async (el, id) => {
                const changeable = String(await el.getAttribute('Changeable')).toLowerCase() === 'true' ? '' : ' (read-only)';
                const value = /\/(chk|rad)/.test(id) ? `selected=${await el.isSelected()}` : `"${await el.getText()}"`;
                return `${id} = ${value}${changeable}`;
            });
        // Main window: the application toolbar; a popup: all of its buttons.
        const buttons = await list("//GuiToolbar[@Name='tbar[1]']//GuiButton | //GuiModalWindow//GuiButton", async (el, id) =>
            `${id} "${await el.getAttribute('Tooltip')}"`);
        // A popup's message sits in labels / read-only text fields of the modal window.
        const popupTexts = (await list("//GuiModalWindow//GuiUserArea//*[self::GuiLabel or self::GuiTextField][@Text!='']",
            async (el) => (await el.getText()).trim())).filter((t) => t !== '(none)');
        const shells = [...xml.matchAll(/<GuiShell\b[^>]*\bId="([^"]*)"[^>]*\bSubType="([^"]*)"/g)]
            .map((m) => `${m[2]} ${shortId(m[1])}`);
        const gridRows = (xml.match(/<GridRow\b/g) ?? []).length;
        const gridCells = (xml.match(/<GridCell\b/g) ?? []).length;

        this.record(`${label} screen`, 'INFO', [
            `window ${await d.getWindowHandle()} "${await d.getTitle()}", all windows ${JSON.stringify(await d.getWindowHandles())}`,
            `status bar "${await this.textOf(STATUS_BAR)}"`,
            `page source in ${file} (${xml.length} chars)`,
            '— tabs —', ...tabs,
            '— fields —', ...fields,
            ...(popupTexts.length ? ['— popup text —', ...popupTexts] : []),
            '— buttons —', ...buttons,
            '— shells —', ...(shells.length ? shells : ['(none)']),
            `GridRow: ${gridRows}, GridCell: ${gridCells}`,
        ].join('\n'));
    }
}
