using System.Runtime.InteropServices;
using System.Text;
using System.Xml;
using Wincore.ServerSdk;

namespace Wincore.SapBridge.Sap;

/// <summary>
/// In-process COM client for SAP GUI for Windows, via the SAP GUI Scripting API.
///
/// Standard UI Automation cannot see inside SAP GUI's custom-drawn controls — to it a
/// SAP session window is one opaque pane. SAP ships its own automation surface instead:
/// the <c>GuiApplication</c> COM object, reachable through the Running Object Table under
/// the moniker <c>"SAPGUI"</c>. This class is the counterpart of the Java / .NET bridge
/// plugins — an alternate tree provider for a runtime real UIA can't reach — except no
/// injection is needed: the
/// scripting engine already runs inside <c>saplogon.exe</c> whenever the user has ticked
/// "Enable scripting" in SAP GUI options (and the server allows it via profile parameter
/// <c>sapgui/user_scripting</c>).
///
/// All member access goes through <see cref="Disp"/> (hand-rolled <c>IDispatch</c>): SAP
/// GUI 8.00 registers only a 32-bit scripting typelib, so a 64-bit process cannot use
/// <c>dynamic</c> / <c>Type.InvokeMember</c> here. Every read is wrapped — SAP throws for
/// properties a given component type does not implement, and one unreadable node must not
/// abort a tree dump.
///
/// Threading: SAP GUI Scripting is single-threaded-apartment. The host's command
/// dispatcher runs every plugin handler inline on the server process's one STA
/// thread, so calls originating from <see cref="Plugin"/> / <see cref="SapTreeProvider"/>
/// satisfy that for free — do not call this class from any other thread.
///
/// Attach uses <see cref="Marshal.BindToMoniker"/>, the .NET equivalent of VBScript's
/// <c>GetObject("SAPGUI")</c>. <see cref="Marshal.GetActiveObject"/> is wrong here — it
/// resolves a ProgID via CLSID and "SAPGUI" is a moniker — and is absent from modern .NET.
/// </summary>
internal sealed class SapGuiClient : IDisposable
{
    internal const string IdPrefix = "sap:";
    private const string Moniker = "SAPGUI";
    private const int MaxDepth = 200;
    private const string NodeKeyAttr = "__sapNodeKey";
    private const string NodeMarker = "#node:";

    private Disp? _engine;
    private Disp? _session;

    public bool IsAttached => _session != null;

    // ── Attach ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// Binds to the running SAP GUI scripting engine and selects a session to drive.
    /// </summary>
    /// <param name="connectionIndex">Which open SAP connection (system) to use, default 0.</param>
    /// <param name="sessionIndex">Which session within that connection, default 0.</param>
    public object Attach(int connectionIndex = 0, int sessionIndex = 0)
    {
        var engine = EnsureEngine();

        var connections = engine.GetObj("Children");
        int connectionCount = connections.GetInt("Count");
        if (connectionCount == 0)
        {
            _session = null;
            return new
            {
                attached = false,
                reason = "no_open_connection",
                message = "The SAP GUI scripting engine is reachable but no SAP connection is open. " +
                          "Log into an SAP system first, then attach again.",
                connectionCount = 0,
            };
        }

        if (connectionIndex < 0 || connectionIndex >= connectionCount)
            throw new ArgumentOutOfRangeException(nameof(connectionIndex),
                $"connectionIndex {connectionIndex} out of range (0..{connectionCount - 1}).");

        var connection = connections.GetObj("ElementAt", connectionIndex);
        var sessions = connection.GetObj("Children");
        int sessionCount = sessions.GetInt("Count");
        if (sessionIndex < 0 || sessionIndex >= sessionCount)
        {
            // Not an argument error in practice: a connection that's open but exposes no
            // sessions (disabled by server, wrong connection picked, still logging on, …).
            // Report every connection as the engine sees it so the cause is visible.
            _session = null;
            return new
            {
                attached = false,
                reason = sessionCount == 0 ? "no_session_in_connection" : "session_index_out_of_range",
                message = $"Connection {connectionIndex} exposes {sessionCount} session(s); sessionIndex {sessionIndex} " +
                          "is not available. See 'connections' for what the scripting engine sees.",
                connectionCount,
                connectionIndex,
                sessionIndex,
                connections = DescribeConnections(connections, connectionCount),
            };
        }

        _session = sessions.GetObj("ElementAt", sessionIndex);

        return new
        {
            attached = true,
            connectionCount,
            sessionCount,
            connectionIndex,
            sessionIndex,
            system = connection.GetString("Description"),
            sessionInfo = DescribeSessionInfo(_session),
            // Same "0x%08x" form the driver's getWindowHandles returns — pass one to
            // switchToWindow to root standard find / page source in this session.
            windowHandles = SessionWindows().Select(w => $"0x{w.Hwnd.ToInt64():x8}").ToArray(),
        };
    }

    /// <summary>
    /// Binds to the running SAP GUI scripting engine (<c>Marshal.BindToMoniker("SAPGUI")</c>
    /// → <c>GetScriptingEngine</c>), caching the result. Requires <c>saplogon.exe</c> to
    /// already be running — the moniker is only registered by a live process — and requires
    /// no open connection at all, unlike <see cref="Attach"/>.
    /// </summary>
    private Disp EnsureEngine()
    {
        if (_engine != null) return _engine;

        // BindToMoniker + GetScriptingEngine trigger SAP's "a script is attaching" modal
        // when the client notification option is left on; the watchdog clicks it away so
        // an unattended attach doesn't hang. On a correctly configured machine the modal
        // never appears and the watchdog is a no-op.
        _engine = SapDialogWatchdog.Guard(() =>
        {
            object comObject;
            try
            {
                comObject = Marshal.BindToMoniker(Moniker);
            }
            catch (COMException ex)
            {
                throw new InvalidOperationException(
                    "Could not bind to the SAP GUI scripting engine. Is SAP Logon (saplogon.exe) running? " +
                    $"(0x{ex.HResult:X8}: {ex.Message})", ex);
            }

            var sapgui = new Disp(comObject);
            try
            {
                return sapgui.GetObj("GetScriptingEngine");
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    "SAP GUI is running but scripting could not be started. Enable it in SAP GUI Options → " +
                    "Accessibility & Scripting → Scripting (client side), and ensure the server profile " +
                    $"parameter sapgui/user_scripting is TRUE. Underlying error: {ex.Message}", ex);
            }
        });

        return _engine;
    }

    private static object? DescribeSessionInfo(Disp session)
    {
        try
        {
            var info = session.GetObj("Info");
            return new
            {
                systemName = info.GetString("SystemName"),
                client = info.GetString("Client"),
                user = info.GetString("User"),
                language = info.GetString("Language"),
                transaction = info.GetString("Transaction"),
                program = info.GetString("Program"),
                screenNumber = info.GetString("ScreenNumber"),
            };
        }
        catch { return null; }
    }

    /// <summary>
    /// Diagnostic snapshot of every open connection for a failed attach. Reads raw
    /// values (not <see cref="Disp.GetInt"/>, which turns a throw into 0) so a COM
    /// error is reported as such rather than as "0 sessions".
    /// </summary>
    private static object?[] DescribeConnections(Disp connections, int connectionCount)
    {
        static object? Try(Func<object?> read)
        {
            try { return read(); }
            catch (Exception ex) { return $"error: {ex.GetBaseException().Message}"; }
        }

        var result = new object?[connectionCount];
        for (int i = 0; i < connectionCount; i++)
        {
            int index = i;
            result[i] = Try(() =>
            {
                var con = connections.GetObj("ElementAt", index);
                return new
                {
                    index,
                    id = Try(() => con.Get("Id")),
                    description = Try(() => con.Get("Description")),
                    connectionString = Try(() => con.Get("ConnectionString")),
                    disabledByServer = Try(() => con.Get("DisabledByServer")),
                    childrenCount = Try(() => con.GetObj("Children").Get("Count")),
                    sessionsCount = Try(() => con.GetObj("Sessions").Get("Count")),
                };
            });
        }
        return result;
    }

    // ── Element lookup ─────────────────────────────────────────────────────────

    private Disp SessionOrThrow() =>
        _session ?? throw new InvalidOperationException(
            "SAP GUI is not attached. Call sap.attach first (needs an open SAP session).");

    internal static string RawId(string elementId) =>
        elementId.StartsWith(IdPrefix, StringComparison.Ordinal) ? elementId[IdPrefix.Length..] : elementId;

    internal static bool IsSapId(string? id) =>
        id != null && id.StartsWith(IdPrefix, StringComparison.Ordinal);

    /// <summary>
    /// Tree nodes are not SAP components — they have no scripting id of their own and
    /// are addressed by key on their tree shell. Their element id is the shell's id plus
    /// <see cref="NodeMarker"/> and the node key, e.g.
    /// <c>sap:/app/con[0]/ses[0]/wnd[0]/usr/…/shell#node:0000000050</c>.
    /// </summary>
    internal static string NodeId(string shellId, string nodeKey) => IdPrefix + shellId + NodeMarker + nodeKey;

    private static bool TryParseNodeId(string elementId, out string shellId, out string nodeKey)
    {
        var raw = RawId(elementId);
        int at = raw.IndexOf(NodeMarker, StringComparison.Ordinal);
        shellId = at < 0 ? "" : raw[..at];
        nodeKey = at < 0 ? "" : raw[(at + NodeMarker.Length)..];
        return at >= 0;
    }

    /// <summary>The tree shell a node id points into, plus the node key.</summary>
    private (Disp Tree, string Key)? ResolveNode(string elementId)
    {
        if (!TryParseNodeId(elementId, out var shellId, out var key)) return null;
        return (Resolve(shellId), key);
    }

    /// <summary>True if the element (component or tree node) is still on screen.</summary>
    public bool Exists(string elementId)
    {
        try
        {
            if (ResolveNode(elementId) is var (tree, key))
            {
                var keys = tree.CallObjOrNull("GetAllNodeKeys");
                int n = keys?.GetInt("Count") ?? 0;
                for (int i = 0; i < n; i++)
                    if (keys!.Get("ElementAt", i)?.ToString() == key) return true;
                return false;
            }
            Resolve(elementId);
            return true;
        }
        catch { return false; }
    }

    /// <summary>
    /// Resolves an element id to a live SAP component via <c>session.FindById(id, false)</c>
    /// (<c>false</c> = return null instead of throwing). SAP ids
    /// (e.g. <c>/app/con[0]/ses[0]/wnd[0]/usr/txtRSYST-BNAME</c>) are stable and globally
    /// unique, so we always re-resolve rather than trust a cached COM pointer.
    /// </summary>
    public Disp Resolve(string elementId)
    {
        if (TryParseNodeId(elementId, out _, out _))
            throw new InvalidOperationException(
                $"'{elementId}' is a SAP tree node, not a component; this command is not supported on it.");
        var raw = RawId(elementId);
        var comp = SessionOrThrow().CallObjOrNull("FindById", raw, false);
        if (comp == null)
            throw new KeyNotFoundException($"No SAP element with id '{raw}' on the current screen.");
        return comp;
    }

    // ── Window ownership ───────────────────────────────────────────────────────

    /// <summary>
    /// The attached session's top-level frame windows (<c>wnd[0]</c>, modal
    /// <c>wnd[1]</c>, …) with their native handles — what lets the host route a
    /// standard find / page source rooted at a SAP window into this tree.
    /// </summary>
    public IReadOnlyList<(IntPtr Hwnd, string Id)> SessionWindows()
    {
        var result = new List<(IntPtr, string)>();
        if (_session == null) return result;
        try
        {
            var children = _session.GetObj("Children");
            int n = children.GetInt("Count");
            for (int i = 0; i < n; i++)
            {
                var wnd = children.GetObjOrNull("ElementAt", i);
                if (wnd == null) continue;
                var handle = wnd.Get("Handle");
                if (handle == null) continue;
                result.Add((new IntPtr(Convert.ToInt64(handle)), wnd.GetString("Id")));
            }
        }
        catch { }
        return result;
    }

    public string? WindowRootId(IntPtr hwnd)
    {
        foreach (var (h, id) in SessionWindows())
            if (h == hwnd) return IdPrefix + id;
        return null;
    }

    // ── Condition find ─────────────────────────────────────────────────────────

    /// <summary>
    /// Standard-locator find over the SAP subtree, walked in document order. UIA
    /// property names map onto SAP scripting properties: <c>AutomationId</c> → the SAP
    /// <c>Id</c> (full <c>/app/con[0]/ses[0]/wnd[0]/usr/txtX</c> or any trailing path such
    /// as <c>wnd[0]/usr/txtX</c>), <c>Name</c> → <c>Name</c>, <c>ClassName</c> /
    /// <c>ControlType</c> / <c>LocalizedControlType</c> → <c>Type</c>, <c>IsEnabled</c> →
    /// <c>Changeable</c>.
    /// </summary>
    public List<string> FindByCondition(string rootElementId, ConditionDto condition, string scope, bool first)
    {
        var results = new List<string>();
        var root = Resolve(rootElementId);
        scope = scope.ToLowerInvariant();

        if (scope is "element" or "subtree") Visit(root, condition, results);
        if (first && results.Count > 0) return results;

        if (scope is "children") VisitChildren(root, c => Visit(c, condition, results), results, first);
        else if (scope is not "element") VisitChildren(root, c => Walk(c, condition, results, first, 0), results, first);
        return results;
    }

    private void Walk(Disp comp, ConditionDto condition, List<string> results, bool first, int depth)
    {
        if (depth > MaxDepth || (first && results.Count > 0)) return;
        Visit(comp, condition, results);
        VisitChildren(comp, c => Walk(c, condition, results, first, depth + 1), results, first);
    }

    private static void VisitChildren(Disp comp, Action<Disp> action, List<string> results, bool first)
    {
        if (!comp.GetBool("ContainerType")) return;
        var children = comp.GetObjOrNull("Children");
        int n = children?.GetInt("Count") ?? 0;
        for (int i = 0; i < n; i++)
        {
            if (first && results.Count > 0) return;
            Disp? child;
            try { child = children!.GetObjOrNull("ElementAt", i); }
            catch { continue; }
            if (child != null) action(child);
        }
    }

    private static void Visit(Disp comp, ConditionDto condition, List<string> results)
    {
        try
        {
            if (Matches(comp, condition)) results.Add(IdPrefix + comp.GetString("Id"));
        }
        catch { }
    }

    private static bool Matches(Disp comp, ConditionDto c) => c.Type.ToLowerInvariant() switch
    {
        "true" => true,
        "false" => false,
        "and" => (c.Conditions ?? []).All(x => Matches(comp, x)),
        "or" => (c.Conditions ?? []).Any(x => Matches(comp, x)),
        "not" => c.Condition != null && !Matches(comp, c.Condition),
        "property" => MatchesProperty(comp, c),
        _ => false,
    };

    private static bool MatchesProperty(Disp comp, ConditionDto c)
    {
        var expected = c.Value switch
        {
            null => "",
            { ValueKind: System.Text.Json.JsonValueKind.String } v => v.GetString() ?? "",
            { } v => v.ToString(),
        };

        switch (c.Property?.ToLowerInvariant())
        {
            case "automationid":
            {
                var id = comp.GetString("Id");
                if (c.Match == null)
                    return id == expected || (expected.Length > 0 && id.EndsWith("/" + expected.TrimStart('/'), StringComparison.Ordinal));
                return MatchString(id, expected, c.Match, StringComparison.Ordinal);
            }
            case "name":
                return MatchString(comp.GetString("Name"), expected, c.Match, StringComparison.Ordinal);
            case "classname":
            case "controltype":
            case "localizedcontroltype":
                return MatchString(comp.GetString("Type"), expected, c.Match, StringComparison.OrdinalIgnoreCase);
            case "isenabled":
                return comp.GetBool("Changeable") == ParseBool(expected);
            default:
                return false;
        }
    }

    private static bool MatchString(string actual, string expected, string? match, StringComparison cmp) =>
        match?.ToLowerInvariant() switch
        {
            "contains" => actual.Contains(expected, cmp),
            "startswith" => actual.StartsWith(expected, cmp),
            _ => string.Equals(actual, expected, cmp),
        };

    // ── Page source / tree ─────────────────────────────────────────────────────

    public string GetPageSourceXml(string? contextElementId)
    {
        var doc = new XmlDocument();
        var root = ResolveContextOrActiveWindow(contextElementId);
        var rootXml = BuildXml(doc, root, 0, null, null) ?? doc.CreateElement("DummyRoot");
        doc.AppendChild(rootXml);
        return doc.OuterXml;
    }

    private Disp ResolveContextOrActiveWindow(string? contextElementId)
    {
        if (!string.IsNullOrEmpty(contextElementId))
            return Resolve(contextElementId!);
        var session = SessionOrThrow();
        return session.GetObjOrNull("ActiveWindow")
            ?? session.GetObj("Children").GetObj("ElementAt", 0);
    }

    /// <summary>
    /// Evaluates a full XPath 1.0 expression against a materialised snapshot of the SAP
    /// subtree, reusing <see cref="XPathEvaluator"/> (System.Xml.XPath) exactly as the UIA
    /// and .NET-bridge paths do. Result nodes carry the SAP element id.
    /// </summary>
    public object? EvaluateXPath(string? contextElementId, string expression, bool multiple)
    {
        var doc = new XmlDocument();
        var nodeToId = new Dictionary<string, string>(StringComparer.Ordinal);
        int counter = 0;
        var root = ResolveContextOrActiveWindow(contextElementId);
        var rootXml = BuildXml(doc, root, 0, nodeToId, () => "x" + counter++)
                      ?? doc.CreateElement("DummyRoot");
        doc.AppendChild(rootXml);

        var ids = XPathEvaluator.Evaluate(
            doc, null, NodeKeyAttr, expression, multiple,
            nodeKey => nodeToId.TryGetValue(nodeKey, out var elId) ? elId : null);

        return multiple ? ids.ToArray() : (ids.Count > 0 ? (object)ids[0] : null);
    }

    private XmlElement? BuildXml(
        XmlDocument doc,
        Disp component,
        int depth,
        Dictionary<string, string>? nodeToId,
        Func<string>? nextNodeKey)
    {
        if (depth > MaxDepth) return null;

        XmlElement el;
        string sapId;
        string type;
        string subType = "";
        try
        {
            sapId = component.GetString("Id");
            type = component.GetString("Type");
            el = doc.CreateElement(ValidTag(type));

            if (nodeToId != null && nextNodeKey != null)
            {
                var key = nextNodeKey();
                el.SetAttribute(NodeKeyAttr, key);
                nodeToId[key] = IdPrefix + sapId;
            }

            el.SetAttribute("Id", sapId);
            el.SetAttribute("Type", type);
            el.SetAttribute("Name", component.GetString("Name"));
            var text = Sanitize(component.GetString("Text"));
            el.SetAttribute("Text", text);
            el.SetAttribute("Tooltip", Sanitize(component.GetString("Tooltip")));
            el.SetAttribute("Changeable", component.GetBool("Changeable").ToString());
            el.SetAttribute("IconName", component.GetString("IconName"));
            // Shell controls all report Type "GuiShell"; SubType says which kind (Tree,
            // GridView, Toolbar, HTMLViewer, …). Only GuiShell has the property.
            if (type == "GuiShell")
            {
                subType = component.GetString("SubType");
                el.SetAttribute("SubType", subType);
            }
            // Ticked state, so XPath can pick e.g. //GuiCheckBox[@Selected='True'].
            if (type is "GuiCheckBox" or "GuiRadioButton")
                el.SetAttribute("Selected", component.GetBool("Selected").ToString());

            // GuiVComponent screen geometry — absolute screen pixels. SAP has no cheap
            // "root rect" to offset against; the Actions layer can use absolute coords
            // directly, so emit as-is.
            el.SetAttribute("x", component.GetInt("ScreenLeft").ToString());
            el.SetAttribute("y", component.GetInt("ScreenTop").ToString());
            el.SetAttribute("width", component.GetInt("Width").ToString());
            el.SetAttribute("height", component.GetInt("Height").ToString());

            if (text.Length > 0) el.AppendChild(doc.CreateTextNode(text));
        }
        catch
        {
            return null;
        }

        // Children — only containers expose a Children collection.
        try
        {
            if (component.GetBool("ContainerType"))
            {
                var children = component.GetObjOrNull("Children");
                int n = children?.GetInt("Count") ?? 0;
                for (int i = 0; i < n; i++)
                {
                    Disp? child;
                    try { child = children!.GetObjOrNull("ElementAt", i); }
                    catch { continue; }
                    if (child == null) continue;
                    var childXml = BuildXml(doc, child, depth + 1, nodeToId, nextNodeKey);
                    if (childXml != null) el.AppendChild(childXml);
                }
            }
        }
        catch { }

        // Virtualised controls whose rows/nodes are not children.
        // Grids and trees are shells: Type "GuiShell", kind in SubType ("GridView", "Tree").
        try { if (subType == "GridView") AppendGridRows(doc, el, component); } catch { }
        try { if (subType == "Tree") AppendTreeNodes(doc, el, component, sapId, nodeToId, nextNodeKey); } catch { }

        return el;
    }

    /// <summary>
    /// <c>GuiGridView</c> (ALV grid — a <c>GuiShell</c> with <c>SubType</c> "GridView") does not expose cells through <c>Children</c> — rows
    /// are virtualised and addressed by index + column id. Emit the visible rows as
    /// <c>GridRow</c> / <c>GridCell</c> children so they show up in page source and are
    /// XPath-addressable. Full row access still needs scrolling via the Actions layer.
    /// </summary>
    private static void AppendGridRows(XmlDocument doc, XmlElement parent, Disp component)
    {
        int rowCount = component.GetInt("RowCount");
        int firstVisible = component.GetInt("FirstVisibleRow");
        int visibleRows = component.GetInt("VisibleRowCount");
        if (visibleRows <= 0) visibleRows = rowCount;
        var columnOrder = component.GetObjOrNull("ColumnOrder");
        int colCount = columnOrder?.GetInt("Count") ?? 0;

        int lastRow = Math.Min(rowCount, firstVisible + visibleRows);
        for (int r = firstVisible; r < lastRow; r++)
        {
            var rowEl = doc.CreateElement("GridRow");
            rowEl.SetAttribute("Index", r.ToString());
            for (int c = 0; c < colCount; c++)
            {
                string colId;
                try { colId = columnOrder!.Get("ElementAt", c)?.ToString() ?? ""; }
                catch { continue; }
                if (colId.Length == 0) continue;
                var cellEl = doc.CreateElement("GridCell");
                cellEl.SetAttribute("Column", colId);
                cellEl.SetAttribute("Text", Sanitize(component.GetString("GetCellValue", r, colId)));
                rowEl.AppendChild(cellEl);
            }
            parent.AppendChild(rowEl);
        }
        parent.SetAttribute("RowCount", rowCount.ToString());
    }

    /// <summary>
    /// <c>GuiTree</c> (a <c>GuiShell</c> with <c>SubType</c> "Tree") nodes are addressed by
    /// key, not exposed as <c>Children</c>. Emit them as nested <c>TreeNode</c> elements,
    /// following <c>GetParent</c>. Like a closed dropdown in UIA, the children of a
    /// collapsed folder are left out even when SAP has them loaded — expand the folder
    /// (<c>windows: expand</c>) to reveal them.
    /// </summary>
    private static void AppendTreeNodes(
        XmlDocument doc,
        XmlElement parent,
        Disp tree,
        string shellId,
        Dictionary<string, string>? nodeToId,
        Func<string>? nextNodeKey)
    {
        var keys = tree.CallObjOrNull("GetAllNodeKeys");
        if (keys == null) return;
        int n = keys.GetInt("Count");

        var order = new List<string>();
        var parentOf = new Dictionary<string, string>(StringComparer.Ordinal);
        for (int i = 0; i < n; i++)
        {
            string key;
            try { key = keys.Get("ElementAt", i)?.ToString() ?? ""; }
            catch { continue; }
            if (key.Length == 0 || parentOf.ContainsKey(key)) continue;
            order.Add(key);
            parentOf[key] = tree.GetString("GetParent", key);
        }

        // Keep SAP's node order within each parent. A node whose parent is empty or
        // unknown is a top-level node (so a failing GetParent degrades to a flat list).
        var roots = new List<string>();
        var childrenOf = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var key in order)
        {
            var p = parentOf[key];
            if (p.Length == 0 || !parentOf.ContainsKey(p)) { roots.Add(key); continue; }
            if (!childrenOf.TryGetValue(p, out var list)) childrenOf[p] = list = new List<string>();
            list.Add(key);
        }

        foreach (var key in roots)
            AppendTreeNode(doc, parent, tree, shellId, key, childrenOf, nodeToId, nextNodeKey, 0);
    }

    private static void AppendTreeNode(
        XmlDocument doc,
        XmlElement parent,
        Disp tree,
        string shellId,
        string key,
        Dictionary<string, List<string>> childrenOf,
        Dictionary<string, string>? nodeToId,
        Func<string>? nextNodeKey,
        int depth)
    {
        if (depth > MaxDepth) return;
        childrenOf.TryGetValue(key, out var children);
        bool isFolder = children != null || tree.GetBool("IsFolder", key);
        bool isExpanded = isFolder && tree.GetBool("IsFolderExpanded", key);

        var nodeEl = doc.CreateElement("TreeNode");
        if (nodeToId != null && nextNodeKey != null)
        {
            var nodeKey = nextNodeKey();
            nodeEl.SetAttribute(NodeKeyAttr, nodeKey);
            nodeToId[nodeKey] = NodeId(shellId, key);
        }
        nodeEl.SetAttribute("Key", key);
        nodeEl.SetAttribute("Text", Sanitize(tree.GetString("GetNodeTextByKey", key)));
        nodeEl.SetAttribute("IsFolder", isFolder.ToString());
        if (isFolder) nodeEl.SetAttribute("IsExpanded", isExpanded.ToString());
        parent.AppendChild(nodeEl);

        if (!isExpanded || children == null) return;
        foreach (var child in children)
            AppendTreeNode(doc, nodeEl, tree, shellId, child, childrenOf, nodeToId, nextNodeKey, depth + 1);
    }

    // ── Property access ────────────────────────────────────────────────────────

    public object? GetProperty(string elementId, string property)
    {
        if (ResolveNode(elementId) is var (tree, key))
            return GetNodeProperty(tree, key, elementId, property);
        var comp = Resolve(elementId);
        return property.ToLowerInvariant() switch
        {
            "id" => comp.GetString("Id"),
            "type" => comp.GetString("Type"),
            "name" => comp.GetString("Name"),
            "text" or "value" => comp.GetString("Text"),
            "tooltip" => comp.GetString("Tooltip"),
            "changeable" or "enabled" => comp.GetBool("Changeable"),
            // Typed, not the generic GetString below: IsSelected needs a bool back.
            "selected" or "isselected" => comp.GetBool("Selected"),
            "iconname" => comp.GetString("IconName"),
            "screenleft" or "x" => comp.GetInt("ScreenLeft").ToString(),
            "screentop" or "y" => comp.GetInt("ScreenTop").ToString(),
            "width" => comp.GetInt("Width").ToString(),
            "height" => comp.GetInt("Height").ToString(),
            _ => comp.GetString(property),
        };
    }

    private static object? GetNodeProperty(Disp tree, string key, string elementId, string property)
    {
        bool IsFolder() => tree.GetBool("IsFolder", key) || tree.GetInt("GetNodeChildrenCount", key) > 0;
        return property.ToLowerInvariant() switch
        {
            "id" => RawId(elementId),
            "type" or "tagname" or "classname" or "controltype" or "localizedcontroltype" => "TreeNode",
            "key" => key,
            "text" or "value" => tree.GetString("GetNodeTextByKey", key),
            "isfolder" => IsFolder(),
            "isexpanded" => tree.GetBool("IsFolderExpanded", key),
            // What the driver's windows: expand reads back to confirm the expand took.
            "expandcollapsestate" => !IsFolder() ? "LeafNode"
                : tree.GetBool("IsFolderExpanded", key) ? "Expanded" : "Collapsed",
            "selected" or "isselected" => IsNodeSelected(tree, key),
            "changeable" or "enabled" or "isenabled" => true,
            // No per-node screen geometry in the scripting API — ClickablePoint, x, y, …
            // come back null, so act on nodes with windows: select / invoke / expand.
            _ => null,
        };
    }

    private static bool IsNodeSelected(Disp tree, string key)
    {
        // Single-selection trees report SelectedNode; multi-selection ones only the collection.
        if (tree.GetString("SelectedNode") == key) return true;
        try
        {
            var selected = tree.CallObjOrNull("GetSelectedNodes");
            int n = selected?.GetInt("Count") ?? 0;
            for (int i = 0; i < n; i++)
                if (selected!.Get("ElementAt", i)?.ToString() == key) return true;
        }
        catch { }
        return false;
    }

    public bool IsSelected(string elementId) =>
        ResolveNode(elementId) is var (tree, key)
            ? IsNodeSelected(tree, key)
            : GetProperty(elementId, "Selected") is bool b && b;

    public string GetText(string elementId) =>
        ResolveNode(elementId) is var (tree, key)
            ? tree.GetString("GetNodeTextByKey", key)
            : Resolve(elementId).GetString("Text");

    public string GetTagName(string elementId) =>
        ResolveNode(elementId) is not null ? "TreeNode" : Resolve(elementId).GetString("Type");

    public object GetRect(string elementId)
    {
        if (ResolveNode(elementId) is not null)
            throw new NotSupportedException(
                "SAP tree nodes have no screen geometry in the scripting API, so they cannot be clicked with " +
                "the mouse. Use windows: select (select the node), windows: invoke (double-click: opens the " +
                "node / starts its transaction) or windows: expand instead.");
        var comp = Resolve(elementId);
        return new
        {
            x = comp.GetInt("ScreenLeft"),
            y = comp.GetInt("ScreenTop"),
            width = comp.GetInt("Width"),
            height = comp.GetInt("Height"),
        };
    }

    // ── Interaction ────────────────────────────────────────────────────────────

    public void SetValue(string elementId, string value)
    {
        var comp = Resolve(elementId);
        switch (comp.GetString("Type"))
        {
            case "GuiCheckBox":
                comp.Set("Selected", ParseBool(value));
                break;
            case "GuiRadioButton":
                if (ParseBool(value)) comp.Call("Select");
                break;
            case "GuiComboBox":
                comp.Set("Key", value);
                break;
            default:
                comp.Set("Text", value); // GuiTextField, GuiCTextField, GuiPasswordField, GuiTextEdit…
                break;
        }
    }

    public void Invoke(string elementId)
    {
        // A double-click is what "activating" a node means in SAP: it toggles a folder
        // and starts the transaction behind a leaf (e.g. SAP Easy Access).
        if (ResolveNode(elementId) is var (tree, key))
        {
            tree.Call("DoubleClickNode", key);
            return;
        }
        var comp = Resolve(elementId);
        switch (comp.GetString("Type"))
        {
            case "GuiButton":
                comp.Call("Press");
                break;
            case "GuiTab":
            case "GuiRadioButton":
            case "GuiMenu":
                comp.Call("Select");
                break;
            case "GuiCheckBox":
                comp.Set("Selected", !comp.GetBool("Selected"));
                break;
            default:
                try { comp.Call("Press"); }
                catch { comp.Call("Select"); }
                break;
        }
    }

    public void SetFocus(string elementId)
    {
        if (ResolveNode(elementId) is var (tree, key)) tree.Call("SelectNode", key);
        else Resolve(elementId).Call("SetFocus");
    }

    public void Select(string elementId)
    {
        if (ResolveNode(elementId) is var (tree, key)) tree.Call("SelectNode", key);
        else Resolve(elementId).Call("Select");
    }

    /// <summary>Expands a tree folder node. No-op for anything else.</summary>
    public void Expand(string elementId)
    {
        if (ResolveNode(elementId) is var (tree, key)) tree.Call("ExpandNode", key);
    }

    /// <summary>Sends a virtual key to a window, e.g. 0 = Enter, 8 = F8.</summary>
    public void SendVKey(int vkey, string? windowElementId = null)
    {
        var wnd = windowElementId != null ? Resolve(windowElementId) : SessionOrThrow().GetObj("ActiveWindow");
        wnd.Call("SendVKey", vkey);
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /// <summary>
    /// SAP's <c>Type</c> string (e.g. "GuiTextField", "GuiButton", "GuiGridView") is already
    /// a stable, language-neutral PascalCase identifier — use it directly as the XML tag,
    /// falling back to "GuiComponent" when it is somehow not a valid XML name.
    /// </summary>
    private static string ValidTag(string type)
    {
        if (string.IsNullOrEmpty(type)) return "GuiComponent";
        try { XmlConvert.VerifyName(type); return type; }
        catch { return "GuiComponent"; }
    }

    private static bool ParseBool(string s) =>
        s.Equals("true", StringComparison.OrdinalIgnoreCase) || s == "1" ||
        s.Equals("x", StringComparison.OrdinalIgnoreCase) || s.Equals("yes", StringComparison.OrdinalIgnoreCase);

    private static string Sanitize(string s)
    {
        if (string.IsNullOrEmpty(s)) return s;
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
        {
            if (ch == '\t' || ch == '\n' || ch == '\r' ||
                (ch >= 0x20 && ch <= 0xD7FF) || (ch >= 0xE000 && ch <= 0xFFFD))
                sb.Append(ch);
        }
        return sb.ToString();
    }

    public void Dispose()
    {
        _session = null;
        _engine = null;
    }
}
