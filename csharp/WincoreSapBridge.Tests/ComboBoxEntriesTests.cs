using Wincore.SapBridge.Sap;

namespace Wincore.SapBridge.Tests;

/// <summary>
/// <see cref="ComboBoxEntries.ResolveKey"/>: what <c>setValue</c> on a SAP dropdown
/// (<c>GuiComboBox</c>) turns into the key SAP is given.
/// </summary>
public class ComboBoxEntriesTests
{
    // Shaped like SAP's logon-language dropdown, plus the awkward cases: a blank "no
    // selection" entry, a padded key, and a key that is also another entry's text.
    private static readonly ComboBoxEntry[] Languages =
    [
        new("", ""),
        new("EN", "English"),
        new("DE", "German"),
        new("FR ", "French"),
        new("X", "EN"),
    ];

    [Theory]
    [InlineData("EN", "EN")]
    [InlineData("DE", "DE")]
    [InlineData("", "")]
    public void Key_selects_that_entry(string input, string expected) =>
        Assert.Equal(expected, ComboBoxEntries.ResolveKey(Languages, input));

    [Theory]
    [InlineData("English", "EN")]
    [InlineData("German", "DE")]
    [InlineData("French", "FR ")]
    public void Visible_text_selects_that_entry(string input, string expected) =>
        Assert.Equal(expected, ComboBoxEntries.ResolveKey(Languages, input));

    [Fact]
    public void Key_wins_over_another_entrys_text()
    {
        // "EN" is entry EN's key and entry X's text — as before this change, a key is a key.
        Assert.Equal("EN", ComboBoxEntries.ResolveKey(Languages, "EN"));
    }

    [Fact]
    public void Returns_the_key_as_SAP_has_it_including_padding()
    {
        Assert.Equal("FR ", ComboBoxEntries.ResolveKey(Languages, "FR"));
        Assert.Equal("FR ", ComboBoxEntries.ResolveKey(Languages, "FR "));
    }

    [Theory]
    [InlineData(" English ", "EN")]
    [InlineData("english", "EN")]
    [InlineData("GERMAN", "DE")]
    [InlineData("de", "DE")]
    public void Ignores_surrounding_blanks_and_case(string input, string expected) =>
        Assert.Equal(expected, ComboBoxEntries.ResolveKey(Languages, input));

    [Fact]
    public void Exact_text_wins_over_case_insensitive_key()
    {
        // "x" is no text; key "X" matches ignoring case.
        Assert.Equal("X", ComboBoxEntries.ResolveKey(Languages, "x"));

        ComboBoxEntry[] entries = [new("de", "DE"), new("DE", "Deutsch")];
        Assert.Equal("de", ComboBoxEntries.ResolveKey(entries, "de"));
        Assert.Equal("DE", ComboBoxEntries.ResolveKey(entries, "DE"));
    }

    [Fact]
    public void Text_of_trimmed_entries_matches()
    {
        ComboBoxEntry[] dates = [new("1", "DD.MM.YYYY  "), new("2", "MM/DD/YYYY")];
        Assert.Equal("1", ComboBoxEntries.ResolveKey(dates, "DD.MM.YYYY"));
    }

    [Fact]
    public void Unknown_value_throws_and_lists_the_entries()
    {
        var ex = Assert.Throws<ArgumentException>(() => ComboBoxEntries.ResolveKey(Languages, "Klingon"));
        Assert.Contains("'Klingon'", ex.Message);
        Assert.Contains("'EN' (English)", ex.Message);
        Assert.Contains("'DE' (German)", ex.Message);
    }

    [Fact]
    public void Ambiguous_text_throws_instead_of_guessing()
    {
        ComboBoxEntry[] entries = [new("1", "Same"), new("2", "Same"), new("3", "Other")];
        var ex = Assert.Throws<ArgumentException>(() => ComboBoxEntries.ResolveKey(entries, "Same"));
        Assert.Contains("2 dropdown entries", ex.Message);
        // The key still reaches either one.
        Assert.Equal("2", ComboBoxEntries.ResolveKey(entries, "2"));
    }

    [Fact]
    public void Ambiguous_case_insensitive_text_throws()
    {
        ComboBoxEntry[] entries = [new("1", "Mixed"), new("2", "MIXED")];
        Assert.Equal("1", ComboBoxEntries.ResolveKey(entries, "Mixed"));
        Assert.Throws<ArgumentException>(() => ComboBoxEntries.ResolveKey(entries, "mixed"));
    }

    [Fact]
    public void No_entries_throws()
    {
        var ex = Assert.Throws<ArgumentException>(() => ComboBoxEntries.ResolveKey([], "EN"));
        Assert.Contains("(none)", ex.Message);
    }
}
