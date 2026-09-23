import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser } from 'webdriverio';
import { createSapGuiSession, quitSession } from './helpers/session.js';

/**
 * Attach against an already logged-in SAP window.
 *
 * Precondition: a SAP connection is open and logged in (e.g. SAP Easy Access). The
 * test does not open or log into anything itself.
 *
 * Flow: switch to the SAP window by title → attach → page source (should now be the
 * SAP tree). Output in test-output/attached-window/: SUMMARY.md, 01-attach-result.json
 * (includes per-connection diagnostics when attach fails) and
 * 02-page-source-after-attach.xml.
 *
 * Env:
 *   SAP_WINDOW_TITLE  partial title of the logged-in window, matched via
 *                     `windows: switchToWindowByTitle` (default: "SAP Easy")
 */
const OUTPUT_DIR = resolve(process.cwd(), 'test-output', 'attached-window');
const WINDOW_TITLE = process.env.SAP_WINDOW_TITLE ?? 'SAP Easy';

type Status = 'PASS' | 'FAIL' | 'INFO';

interface Check {
    step: string;
    status: Status;
    detail: string;
}

const checks: Check[] = [];

function save(name: string, content: unknown): void {
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    writeFileSync(resolve(OUTPUT_DIR, name), text, 'utf8');
}

function record(step: string, status: Status, detail: string): void {
    checks.push({ step, status, detail });
    writeReport();
}

/** Rewritten after every check, so a crash midway still leaves everything seen so far. */
function writeReport(): void {
    const icon: Record<Status, string> = { PASS: '✅', FAIL: '❌', INFO: 'ℹ️' };
    const lines = [
        '# SAP attached-window e2e',
        '',
        `Run: ${new Date().toISOString()}  `,
        `PASS: ${checks.filter((c) => c.status === 'PASS').length} · FAIL: ${checks.filter((c) => c.status === 'FAIL').length}`,
        '',
        '| # | Status | Step | Detail |',
        '| --- | --- | --- | --- |',
        ...checks.map((c, i) =>
            `| ${i + 1} | ${icon[c.status]} ${c.status} | ${c.step} | ${c.detail.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')} |`),
        '',
    ];
    save('SUMMARY.md', lines.join('\n'));
}

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Distinct SAP `Type` tags in a page source, with counts — the quickest tell of which tree served it. */
function guiTagSummary(xml: string): { total: number; tags: Record<string, number> } {
    const tags: Record<string, number> = {};
    for (const m of xml.matchAll(/<(Gui\w+|GridRow|GridCell|TreeNode)\b/g)) {
        tags[m[1]] = (tags[m[1]] ?? 0) + 1;
    }
    return { total: Object.values(tags).reduce((a, b) => a + b, 0), tags };
}

function rootTag(xml: string): string {
    return xml.match(/<([A-Za-z]\w*)/)?.[1] ?? '(none)';
}

interface AttachResult {
    attached?: boolean;
    reason?: string;
    message?: string;
    windowHandles?: string[];
    connections?: unknown[];
    [key: string]: unknown;
}

describe('sap-bridge attached window', () => {
    let driver: Browser;

    beforeAll(async () => {
        rmSync(OUTPUT_DIR, { recursive: true, force: true });
        mkdirSync(OUTPUT_DIR, { recursive: true });
        driver = await createSapGuiSession();
    });

    afterAll(async () => {
        // Best-effort: never leave the provider owning the window for the next session.
        try { await driver?.executeScript('windows: detachSapGui', []); } catch { /* noop */ }
        await quitSession(driver);
    });

    it('serves page source from the SAP tree once attached', async () => {
        // 1. Switch to the logged-in SAP window by (partial) title.
        let target: { handle: string; title: string };
        try {
            await driver.executeScript('windows: switchToWindowByTitle', [{ title: WINDOW_TITLE }]);
            target = { handle: await driver.getWindowHandle(), title: await driver.getTitle() };
        } catch (err) {
            record(`Switch to window by title "${WINDOW_TITLE}"`, 'FAIL',
                `${errMsg(err)} — is a SAP connection open and logged in? (or set SAP_WINDOW_TITLE)`);
            expect(checks.filter((c) => c.status === 'FAIL')).toEqual([]);
            return;
        }
        record(`Switch to window by title "${WINDOW_TITLE}"`, 'INFO', `${target.handle} "${target.title}"`);

        // 2. Attach. Retry only on throw (COM moniker can lag); record whatever comes back.
        let attach: AttachResult = {};
        const deadline = Date.now() + 20_000;
        while (true) {
            try {
                attach = await driver.executeScript('windows: attachSapGui', [{}]) as AttachResult;
                break;
            } catch (err) {
                attach = { error: errMsg(err) };
                if (Date.now() > deadline) {break;}
                await delay(1000);
            }
        }
        save('01-attach-result.json', attach);
        if (!attach.attached) {
            record('Attach', 'FAIL', `reason=${attach.reason ?? attach.error ?? 'unknown'}${attach.message ? ` — ${attach.message}` : ''}`);
            for (const con of attach.connections ?? []) {
                record('Connection seen by scripting engine', 'INFO', JSON.stringify(con));
            }
            expect(checks.filter((c) => c.status === 'FAIL')).toEqual([]);
            return;
        }
        record('Attach', 'PASS', `system=${attach.system}; sessionInfo=${JSON.stringify(attach.sessionInfo)}`);

        // The provider owns windows by handle — the window we're on must be one of them.
        const owned = (attach.windowHandles ?? []).map((h) => h.toLowerCase());
        record('Target handle is in attach windowHandles',
            owned.includes(target.handle.toLowerCase()) ? 'PASS' : 'FAIL',
            `target ${target.handle} vs ${JSON.stringify(attach.windowHandles)}`);

        // 3. Page source after attach — should now come from the SAP tree.
        const after = await driver.getPageSource();
        save('02-page-source-after-attach.xml', after);
        const afterGui = guiTagSummary(after);
        record('Page source after attach is SAP tree', afterGui.total > 0 ? 'PASS' : 'FAIL',
            `${after.length} chars, root <${rootTag(after)}>, Gui* tags: ${afterGui.total} ${JSON.stringify(afterGui.tags)}`);

        expect(checks.filter((c) => c.status === 'FAIL')).toEqual([]);
    }, 90_000);
});
