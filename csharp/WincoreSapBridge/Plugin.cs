using System.Text.Json;
using System.Xml;
using Wincore.ServerSdk;
using Wincore.SapBridge.Sap;

namespace Wincore.SapBridge;

/// <summary>
/// Server plugin for SAP GUI for Windows — loaded by WincoreServer's PluginLoader
/// from this package's <c>native/plugin/</c> folder (on
/// <c>WINCORE_SERVER_PLUGINS</c>). Contributes a tree provider for the <c>sap:</c>
/// element-id namespace plus the <c>sap.attach</c> / <c>sap.detach</c> lifecycle
/// commands (client-side <c>windows: attachSapGui</c> / <c>windows: detachSapGui</c>).
///
/// Unlike the Java / .NET bridges, nothing is injected: SAP GUI's scripting engine
/// already runs inside <c>saplogon.exe</c> whenever "Enable scripting" is ticked in
/// SAP GUI options. <c>sap.attach</c> binds to it via
/// <see cref="System.Runtime.InteropServices.Marshal.BindToMoniker"/> and selects a
/// session.
///
/// Once attached, everything else is standard WebDriver, same model as the Java
/// bridge: the provider owns the attached session's frame windows (matched by
/// <c>GuiFrameWindow.Handle</c>), so find / page source / XPath rooted at one of them
/// auto-route into the SAP tree, and element commands reach it by the <c>sap:</c> id
/// prefix.
/// </summary>
public sealed class Plugin : IServerPlugin
{
    private SapTreeProvider? _provider;

    public string Name => "sap-bridge";
    public string SdkVersion => SdkContract.Version;

    public ITreeProvider CreateProvider(ISessionContext context)
    {
        _provider = new SapTreeProvider(context);
        return _provider;
    }

    private SapTreeProvider Provider =>
        _provider ?? throw new InvalidOperationException("SAP provider not created for this session.");

    private SapGuiClient Client =>
        Provider.Client ?? throw new InvalidOperationException(
            "SAP GUI is not attached. Call sap.attach first.");

    public IReadOnlyDictionary<string, PluginCommandHandler> GetCommands() => new Dictionary<string, PluginCommandHandler>
    {
        ["sap.attach"] = Attach,
        ["sap.detach"] = Detach,
        // Server-only (no windows: command) — scripts/sap-inspect.mjs talks to
        // WincoreServer.exe directly, without a window-rooted session to route through.
        ["sap.pageSource"] = PageSource,
        // SAP virtual keys (F-keys, Enter sent to the window rather than a field) have no
        // WebDriver equivalent — disabled for now.
        // ["sap.sendVKey"] = SendVKey,
    };

    // ── sap.attach / sap.detach ───────────────────────────────────────────────

    private object? Attach(ISessionContext ctx, JsonElement? parameters)
    {
        int connectionIndex = GetInt(parameters, "connectionIndex", 0);
        int sessionIndex = GetInt(parameters, "sessionIndex", 0);
        var result = Provider.Attach(connectionIndex, sessionIndex);
        ctx.LogInfo("[sap-bridge] attach: connection=" + connectionIndex + " session=" + sessionIndex);
        return result;
    }

    private object? Detach(ISessionContext ctx, JsonElement? parameters)
    {
        Provider.Detach();
        return new { detached = true };
    }

    // ── page source (inspector) ───────────────────────────────────────────────

    private object? PageSource(ISessionContext ctx, JsonElement? parameters) =>
        Client.GetPageSourceXml(GetString(parameters, "contextElementId"));

    // private object? SendVKey(ISessionContext ctx, JsonElement? parameters)
    // {
    //     int vkey = GetInt(parameters, "vkey", 0);
    //     Client.SendVKey(vkey, GetString(parameters, "windowElementId"));
    //     return null;
    // }

    // ── param helpers ──────────────────────────────────────────────────────

    private static string? GetString(JsonElement? p, string name) =>
        p?.TryGetProperty(name, out var v) == true && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static int GetInt(JsonElement? p, string name, int fallback) =>
        p?.TryGetProperty(name, out var v) == true && v.ValueKind == JsonValueKind.Number
            ? v.GetInt32()
            : fallback;
}

/// <summary>
/// <see cref="ITreeProvider"/> over <see cref="SapGuiClient"/>. Owns the client and
/// its attach lifecycle. Owns every frame window of the attached session, auto-routes
/// standard find and swaps page source for them (UIA sees a SAP session window as one
/// opaque pane), and answers element commands for the <c>sap:</c> ids it minted.
/// </summary>
internal sealed class SapTreeProvider : ITreeProvider
{
    private static readonly string[] Prefixes = { SapGuiClient.IdPrefix };

    private readonly ISessionContext _ctx;
    private SapGuiClient? _client;

    public SapTreeProvider(ISessionContext ctx) => _ctx = ctx;

    internal SapGuiClient? Client => _client;

    internal object? Attach(int connectionIndex, int sessionIndex)
    {
        _client ??= new SapGuiClient();
        return _client.Attach(connectionIndex, sessionIndex);
    }

    internal void Detach()
    {
        _client?.Dispose();
        _client = null;
    }

    public string Name => "sap";
    public IReadOnlyList<string> ElementIdPrefixes => Prefixes;
    public bool OwnsElementId(string elementId) => SapGuiClient.IsSapId(elementId);
    public bool IsAttached => _client?.IsAttached ?? false;

    public bool AutoRouteStandardFind => true;
    public bool AutoSwapsPageSource => true;

    public bool OwnsWindow(IntPtr hwnd, string windowTitle) => _client?.WindowRootId(hwnd) != null;
    public string? GetWindowRootId(IntPtr hwnd, string windowTitle) => _client?.WindowRootId(hwnd);

    private SapGuiClient RequireClient() =>
        _client ?? throw new InvalidOperationException("SAP GUI is not attached. Call sap.attach first.");

    public string? FindFirst(string rootElementId, ConditionDto condition, string scope) =>
        RequireClient().FindByCondition(rootElementId, condition, scope, first: true).FirstOrDefault();

    public IReadOnlyList<string> FindAll(string rootElementId, ConditionDto condition, string scope) =>
        RequireClient().FindByCondition(rootElementId, condition, scope, first: false);

    public object? EvaluateXPath(string rootElementId, string expression, bool multiple) =>
        RequireClient().EvaluateXPath(rootElementId, expression, multiple);

    public object? GetProperty(string elementId, string propertyName) =>
        RequireClient().GetProperty(elementId, propertyName);

    public string GetText(string elementId) => RequireClient().GetText(elementId);
    public string GetTagName(string elementId) => RequireClient().GetTagName(elementId);
    public object GetRect(string elementId) => RequireClient().GetRect(elementId);

    // SAP has no ToggleState/SelectionItem pattern of its own — GuiCheckBox /
    // GuiRadioButton expose a plain "Selected" property (see SapGuiClient.SetValue),
    // which both of these read straight through.
    public string GetToggleState(string elementId) => IsSelected(elementId) ? "On" : "Off";

    public bool IsSelected(string elementId) => RequireClient().IsSelected(elementId);

    public bool IsAlive(string elementId) => _client?.Exists(elementId) ?? false;

    public void Invoke(string elementId) => RequireClient().Invoke(elementId);
    public void SetValue(string elementId, string value) => RequireClient().SetValue(elementId, value);
    public void Select(string elementId) => RequireClient().Select(elementId);
    public void RequestFocus(string elementId) => RequireClient().SetFocus(elementId);
    public void Expand(string elementId) => RequireClient().Expand(elementId);

    public void BuildPageSourceXml(string rootElementId, XmlDocument doc, XmlElement? parent)
    {
        var xml = RequireClient().GetPageSourceXml(rootElementId);
        var fragment = new XmlDocument();
        fragment.LoadXml(xml);
        if (fragment.DocumentElement is XmlElement el)
        {
            var imported = (XmlElement)doc.ImportNode(el, true);
            (parent ?? (XmlNode)doc).AppendChild(imported);
        }
    }

    public void Dispose() => _client?.Dispose();
}
