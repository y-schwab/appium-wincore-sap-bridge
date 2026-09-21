using System.Text.Json;
using System.Xml;
using Wincore.ServerSdk;
using Wincore.SapBridge.Sap;

namespace Wincore.SapBridge;

/// <summary>
/// Server plugin for SAP GUI for Windows — loaded by WincoreServer's PluginLoader
/// from this package's <c>native/plugin/</c> folder (on
/// <c>WINCORE_SERVER_PLUGINS</c>). Contributes 16 <c>sap.*</c> commands (reached
/// client-side via <c>windows: attachSapGui</c> plus this package's <c>lib/</c>
/// helpers) and a tree provider for the <c>sap:</c> element-id namespace.
///
/// Unlike the Java / .NET bridges, nothing is injected: SAP GUI's scripting engine
/// already runs inside <c>saplogon.exe</c> whenever "Enable scripting" is ticked in
/// SAP GUI options. <c>sap.attach</c> binds to it via
/// <see cref="System.Runtime.InteropServices.Marshal.BindToMoniker"/>; every other
/// command needs an attached session first.
///
/// SAP has no attribute-based find and no per-window ownership model the way the
/// Java / .NET trees do — a session is attached by connection/session index, not by
/// hwnd — so <see cref="SapTreeProvider.AutoRouteStandardFind"/> is false and
/// standard <c>findElement</c> never routes here; every SAP interaction goes through
/// this plugin's own <c>sap.*</c> commands (id or XPath addressed).
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
        ["sap.status"] = Status,
        ["sap.pageSource"] = PageSource,
        ["sap.dumpTree"] = DumpTree,
        ["sap.findElement"] = FindElement,
        ["sap.evaluateXPath"] = EvaluateXPath,
        ["sap.getProperty"] = GetProperty,
        ["sap.getText"] = GetText,
        ["sap.getTagName"] = GetTagName,
        ["sap.getRect"] = GetRect,
        ["sap.setValue"] = SetValue,
        ["sap.invoke"] = Invoke,
        ["sap.setFocus"] = SetFocus,
        ["sap.select"] = Select,
        ["sap.sendVKey"] = SendVKey,
    };

    // ── sap.attach / sap.detach / sap.status ──────────────────────────────────

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

    private object? Status(ISessionContext ctx, JsonElement? parameters) =>
        new { attached = Provider.IsAttached };

    // ── tree / find ──────────────────────────────────────────────────────────

    private object? PageSource(ISessionContext ctx, JsonElement? parameters) =>
        Client.GetPageSourceXml(GetString(parameters, "contextElementId"));

    private object? DumpTree(ISessionContext ctx, JsonElement? parameters) =>
        Client.DumpTree(GetString(parameters, "contextElementId"));

    private object? FindElement(ISessionContext ctx, JsonElement? parameters)
    {
        var id = GetString(parameters, "id")
            ?? throw new ArgumentException("sap.findElement requires 'id'.");
        return Client.FindFirstById(SapGuiClient.RawId(id));
    }

    private object? EvaluateXPath(ISessionContext ctx, JsonElement? parameters)
    {
        var p = parameters ?? throw new ArgumentException("Parameters required.");
        var expression = p.GetProperty("expression").GetString()
            ?? throw new ArgumentException("expression is required.");
        bool multiple = p.TryGetProperty("multiple", out var m) && m.ValueKind == JsonValueKind.True;
        return Client.EvaluateXPath(GetString(parameters, "contextElementId"), expression, multiple);
    }

    // ── element getters / interaction ───────────────────────────────────────

    private object? GetProperty(ISessionContext ctx, JsonElement? parameters)
    {
        var id = RequireId(parameters);
        var property = GetString(parameters, "property")
            ?? throw new ArgumentException("sap.getProperty requires 'property'.");
        return Client.GetProperty(id, property);
    }

    private object? GetText(ISessionContext ctx, JsonElement? parameters) =>
        Client.GetText(RequireId(parameters));

    private object? GetTagName(ISessionContext ctx, JsonElement? parameters) =>
        Client.GetTagName(RequireId(parameters));

    private object? GetRect(ISessionContext ctx, JsonElement? parameters) =>
        Client.GetRect(RequireId(parameters));

    private object? SetValue(ISessionContext ctx, JsonElement? parameters)
    {
        var id = RequireId(parameters);
        var value = GetString(parameters, "value") ?? "";
        Client.SetValue(id, value);
        return null;
    }

    private object? Invoke(ISessionContext ctx, JsonElement? parameters)
    {
        Client.Invoke(RequireId(parameters));
        return null;
    }

    private object? SetFocus(ISessionContext ctx, JsonElement? parameters)
    {
        Client.SetFocus(RequireId(parameters));
        return null;
    }

    private object? Select(ISessionContext ctx, JsonElement? parameters)
    {
        Client.Select(RequireId(parameters));
        return null;
    }

    private object? SendVKey(ISessionContext ctx, JsonElement? parameters)
    {
        int vkey = GetInt(parameters, "vkey", 0);
        Client.SendVKey(vkey, GetString(parameters, "windowElementId"));
        return null;
    }

    // ── param helpers ──────────────────────────────────────────────────────

    private static string RequireId(JsonElement? p) =>
        GetString(p, "elementId") ?? GetString(p, "id")
        ?? throw new ArgumentException("This sap command requires 'elementId'.");

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
/// its attach lifecycle; the host only ever reaches SAP elements through ids this
/// provider minted (<c>sap:</c> prefix), by way of this plugin's <c>sap.*</c>
/// commands rather than generic find, since SAP exposes no attribute-based find and
/// attach is keyed by connection/session index, not by window.
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

    public bool AutoRouteStandardFind => false;
    public bool AutoSwapsPageSource => false;

    public bool OwnsWindow(IntPtr hwnd, string windowTitle) => false;
    public string? GetWindowRootId(IntPtr hwnd, string windowTitle) => null;

    private SapGuiClient RequireClient() =>
        _client ?? throw new InvalidOperationException("SAP GUI is not attached. Call sap.attach first.");

    public string? FindFirst(string rootElementId, ConditionDto condition, string scope) =>
        throw new NotSupportedException("SAP GUI has no attribute-based find — use sap.findElement (by id) or sap.evaluateXPath.");

    public IReadOnlyList<string> FindAll(string rootElementId, ConditionDto condition, string scope) =>
        throw new NotSupportedException("SAP GUI has no attribute-based find — use sap.evaluateXPath.");

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

    public bool IsSelected(string elementId) =>
        RequireClient().GetProperty(elementId, "Selected") is bool b && b;

    public bool IsAlive(string elementId)
    {
        if (_client == null) return false;
        try { RequireClient().Resolve(elementId); return true; }
        catch { return false; }
    }

    public void Invoke(string elementId) => RequireClient().Invoke(elementId);
    public void SetValue(string elementId, string value) => RequireClient().SetValue(elementId, value);
    public void Select(string elementId) => RequireClient().Select(elementId);
    public void RequestFocus(string elementId) => RequireClient().SetFocus(elementId);
    public void Expand(string elementId) { /* GuiTree nodes expand via sap.invoke on the TreeNode's key — not modelled as a UIA ExpandCollapse pattern. */ }

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
