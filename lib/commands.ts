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
 * when the engine is reachable but nobody is logged in yet.
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

/** `windows: sapGuiStatus` — whether a SAP session is currently attached. */
export async function sapGuiStatus(this: unknown, _next: NextPluginCallback, driver: ExternalDriver): Promise<unknown> {
    return send(driver, 'sap.status');
}

/** `windows: sapPageSource` — XML dump of the SAP component tree under `contextElementId` (or the active window). */
export async function sapPageSource(
    this: unknown,
    _next: NextPluginCallback,
    driver: ExternalDriver,
    contextElementId?: string,
): Promise<unknown> {
    return send(driver, 'sap.pageSource', { contextElementId: contextElementId ?? null });
}

/** `windows: sapFindElement` — resolve a SAP id locator (e.g. `/app/con[0]/ses[0]/wnd[0]/usr/txtRSYST-BNAME`). */
export async function sapFindElement(
    this: unknown,
    _next: NextPluginCallback,
    driver: ExternalDriver,
    id: string,
): Promise<unknown> {
    return send(driver, 'sap.findElement', { id });
}

/** `windows: sapEvaluateXPath` — full XPath 1.0 over the SAP subtree. */
export async function sapEvaluateXPath(
    this: unknown,
    _next: NextPluginCallback,
    driver: ExternalDriver,
    expression: string,
    multiple?: boolean,
    contextElementId?: string,
): Promise<unknown> {
    return send(driver, 'sap.evaluateXPath', {
        expression,
        multiple: multiple ?? false,
        contextElementId: contextElementId ?? null,
    });
}

/** `windows: sapGetProperty` — arbitrary SAP scripting property by name (e.g. `Text`, `Changeable`). */
export async function sapGetProperty(
    this: unknown,
    _next: NextPluginCallback,
    driver: ExternalDriver,
    elementId: string,
    property: string,
): Promise<unknown> {
    return send(driver, 'sap.getProperty', { elementId, property });
}

export async function sapGetText(this: unknown, _next: NextPluginCallback, driver: ExternalDriver, elementId: string): Promise<unknown> {
    return send(driver, 'sap.getText', { elementId });
}

export async function sapGetTagName(this: unknown, _next: NextPluginCallback, driver: ExternalDriver, elementId: string): Promise<unknown> {
    return send(driver, 'sap.getTagName', { elementId });
}

export async function sapGetRect(this: unknown, _next: NextPluginCallback, driver: ExternalDriver, elementId: string): Promise<unknown> {
    return send(driver, 'sap.getRect', { elementId });
}

/** `windows: sapSetValue` — text/key/checked value, dispatched per SAP control type (see SapGuiClient.SetValue). */
export async function sapSetValue(
    this: unknown,
    _next: NextPluginCallback,
    driver: ExternalDriver,
    elementId: string,
    value: string,
): Promise<unknown> {
    return send(driver, 'sap.setValue', { elementId, value });
}

/** `windows: sapInvoke` — Press/Select/toggle, dispatched per SAP control type. */
export async function sapInvoke(this: unknown, _next: NextPluginCallback, driver: ExternalDriver, elementId: string): Promise<unknown> {
    return send(driver, 'sap.invoke', { elementId });
}

export async function sapSetFocus(this: unknown, _next: NextPluginCallback, driver: ExternalDriver, elementId: string): Promise<unknown> {
    return send(driver, 'sap.setFocus', { elementId });
}

export async function sapSelect(this: unknown, _next: NextPluginCallback, driver: ExternalDriver, elementId: string): Promise<unknown> {
    return send(driver, 'sap.select', { elementId });
}

/** `windows: sapSendVKey` — send a virtual key to a window, e.g. 0 = Enter, 8 = F8. Defaults to the active window. */
export async function sapSendVKey(
    this: unknown,
    _next: NextPluginCallback,
    driver: ExternalDriver,
    vkey: number,
    windowElementId?: string,
): Promise<unknown> {
    return send(driver, 'sap.sendVKey', { vkey, windowElementId: windowElementId ?? null });
}
