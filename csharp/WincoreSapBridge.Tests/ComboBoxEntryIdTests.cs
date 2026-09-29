using Wincore.SapBridge.Sap;

namespace Wincore.SapBridge.Tests;

/// <summary>
/// Dropdown entry element ids: <c>sap:&lt;dropdown id&gt;#entry:&lt;key&gt;</c>, parsed back
/// into the dropdown and the exact key — keys can be blank or hold any character.
/// </summary>
public class ComboBoxEntryIdTests
{
    private const string Combo = "/app/con[0]/ses[0]/wnd[0]/usr/cmbSUID_ST_NODE_DEFAULTS-DATFM";

    [Theory]
    [InlineData("2")]
    [InlineData("EN")]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("FR ")]
    [InlineData("A#B")]
    [InlineData("#entry:odd")]
    public void Round_trips_the_dropdown_and_the_exact_key(string key)
    {
        var id = SapGuiClient.EntryId(Combo, key);

        Assert.StartsWith("sap:", id);
        Assert.True(SapGuiClient.TryParseEntryId(id, out var combo, out var parsed));
        Assert.Equal(Combo, combo);
        Assert.Equal(key, parsed);
    }

    [Fact]
    public void Parses_without_the_sap_prefix_too()
    {
        Assert.True(SapGuiClient.TryParseEntryId(Combo + "#entry:2", out var combo, out var key));
        Assert.Equal((Combo, "2"), (combo, key));
    }

    [Theory]
    [InlineData("sap:/app/con[0]/ses[0]/wnd[0]/usr/cmbX")]
    [InlineData("sap:/app/con[0]/ses[0]/wnd[0]/usr/cntlTREE/shellcont/shell#node:0000000050")]
    [InlineData("sap:/app/con[0]/ses[0]/wnd[0]/usr/cntlGRID/shell#row:1")]
    public void Other_ids_are_not_entries(string id)
    {
        Assert.False(SapGuiClient.TryParseEntryId(id, out _, out _));
    }
}
