import type { ExternalDriver, NextPluginCallback } from '@appium/types';

/**
 * `driver.sendCommand` is a server-side method of appium-wincore-driver (its
 * stdin/stdout bridge to WincoreServer.exe), not part of the generic
 * `ExternalDriver` type — same cast the sibling appium-wincore-java-bridge /
 * dotnet-bridge / uia-bridge plugins use. The `sap.*` server commands reached here
 * are contributed by this package's WincoreSapBridge.dll tree provider.
 */
type ServerDriver = ExternalDriver & {
    sendCommand(method: string, params: Record<string, unknown>): Promise<unknown>;
};

function send(driver: ExternalDriver, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return (driver as ServerDriver).sendCommand(method, params);
}

/**
 * `windows: attachSapGui` — bind to the running SAP GUI scripting engine
 * (`saplogon.exe`) and select a connection/session to drive. Nothing is injected:
 * the scripting engine is already in-process whenever "Enable scripting" is ticked
 * in SAP GUI options. Returns `{ attached: false, reason: "no_open_connection" }`
 * when the engine is reachable but nothing is open yet.
 *
 * On success the result carries the session's `windowHandles`. Everything after
 * attach is standard WebDriver: `switchToWindow` to one of those handles and
 * find / page source / XPath / click / setValue / getText are served from the SAP
 * tree by this package's tree provider.
 */
export async function attachSapGui(
    this: unknown,
    _next: NextPluginCallback,
    driver: ExternalDriver,
    connectionIndex?: number,
    sessionIndex?: number,
): Promise<unknown> {
    return send(driver, 'sap.attach', {
        connectionIndex: connectionIndex ?? 0,
        sessionIndex: sessionIndex ?? 0,
    });
}

/** `windows: detachSapGui` — drop the SAP session reference. */
export async function detachSapGui(this: unknown, _next: NextPluginCallback, driver: ExternalDriver): Promise<unknown> {
    return send(driver, 'sap.detach');
}


// SAP virtual keys (F-keys, Enter sent to the window rather than a field) have no
// WebDriver equivalent — disabled for now, re-enable together with `sap.sendVKey` in
// csharp/WincoreSapBridge/Plugin.cs.
//
// /** `windows: sapSendVKey` — send a virtual key to a window, e.g. 0 = Enter, 8 = F8. Defaults to the active window. */
// export async function sapSendVKey(
//     this: unknown,
//     _next: NextPluginCallback,
//     driver: ExternalDriver,
//     vkey: number,
//     windowElementId?: string,
// ): Promise<unknown> {
//     return send(driver, 'sap.sendVKey', { vkey, windowElementId: windowElementId ?? null });
// }
