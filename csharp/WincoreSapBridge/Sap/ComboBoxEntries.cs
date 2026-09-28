namespace Wincore.SapBridge.Sap;

/// <summary>One dropdown entry: SAP's internal <c>Key</c> (e.g. "EN") and the <c>Value</c> the user sees ("English").</summary>
internal readonly record struct ComboBoxEntry(string Key, string Value);

/// <summary>
/// Maps what a test passes to <c>setValue</c> on a <c>GuiComboBox</c> to the entry key SAP
/// needs. <c>GuiComboBox</c> only accepts a key (<c>Key = "EN"</c>), but tests read and
/// think in the visible text ("English"), so both are accepted. Kept free of COM so it
/// can be unit-tested.
/// </summary>
internal static class ComboBoxEntries
{
    /// <summary>
    /// The key of the entry <paramref name="input"/> names, tried in this order — each
    /// step only when the one before found nothing:
    /// <list type="number">
    /// <item>a key, exactly (so passing a key behaves as before);</item>
    /// <item>a visible text, exactly;</item>
    /// <item>a visible text, ignoring case;</item>
    /// <item>a key, ignoring case ("en" → "EN").</item>
    /// </list>
    /// Surrounding blanks are ignored on both sides — SAP pads some keys and texts. A step
    /// that matches more than one entry is an error, not a guess.
    /// </summary>
    /// <exception cref="ArgumentException">No entry matches, or a step matches several.</exception>
    public static string ResolveKey(IReadOnlyList<ComboBoxEntry> entries, string input)
    {
        // A blank key is a real entry in many SAP dropdowns (e.g. "no selection"); keep it
        // exact rather than trimming it away.
        foreach (var e in entries)
            if (e.Key == input) return e.Key;

        var wanted = input.Trim();
        return Single(entries, e => e.Key.Trim() == wanted, input, "key")
            ?? Single(entries, e => e.Value.Trim() == wanted, input, "text")
            ?? Single(entries, e => string.Equals(e.Value.Trim(), wanted, StringComparison.OrdinalIgnoreCase), input, "text")
            ?? Single(entries, e => string.Equals(e.Key.Trim(), wanted, StringComparison.OrdinalIgnoreCase), input, "key")
            ?? throw new ArgumentException(
                $"The dropdown has no entry with key or text '{input}'. Entries: {Describe(entries)}.");
    }

    /// <summary>"EN (English), DE (German)" — for error messages.</summary>
    public static string Describe(IReadOnlyList<ComboBoxEntry> entries) =>
        entries.Count == 0 ? "(none)" : string.Join(", ", entries.Select(e => $"'{e.Key}' ({e.Value})"));

    private static string? Single(IReadOnlyList<ComboBoxEntry> entries, Func<ComboBoxEntry, bool> match, string input, string what)
    {
        var hits = entries.Where(match).ToList();
        if (hits.Count <= 1) return hits.Count == 1 ? hits[0].Key : null;
        throw new ArgumentException(
            $"'{input}' matches the {what} of {hits.Count} dropdown entries: {Describe(hits)}. Pass the key instead.");
    }
}
