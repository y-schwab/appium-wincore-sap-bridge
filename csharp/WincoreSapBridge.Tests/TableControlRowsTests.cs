using System.Xml;
using Wincore.SapBridge.Sap;

namespace Wincore.SapBridge.Tests;

/// <summary>
/// <see cref="TableControlRows.Group"/>: how a <c>GuiTableControl</c>'s flat cells are
/// regrouped into rows in page source.
/// </summary>
public class TableControlRowsTests
{
    private const string Table = "/app/con[0]/ses[0]/wnd[0]/usr/tblSAPLSD41TC0";

    /// <summary>SE11's field list, shaped as SAP lists it: cells column by column.</summary>
    private static XmlElement FieldList(params (string Id, string Text)[] cells)
    {
        var doc = new XmlDocument();
        var table = doc.CreateElement("GuiTableControl");
        table.SetAttribute("Id", Table);
        doc.AppendChild(table);
        foreach (var (id, text) in cells)
        {
            var cell = doc.CreateElement(id.Contains("/chk") ? "GuiCheckBox" : "GuiTextField");
            cell.SetAttribute("Id", Table + id);
            cell.SetAttribute("Text", text);
            table.AppendChild(cell);
        }
        return table;
    }

    private static readonly (string, string)[] Cells =
    [
        ("/txtDD03D-FIELDNAME[0,0]", "MANDT"),
        ("/txtDD03D-FIELDNAME[0,1]", "MTEXT"),
        ("/chkDD03P-KEYFLAG[1,0]", ""),
        ("/chkDD03P-KEYFLAG[1,1]", ""),
        ("/txtDD03D-DATATYPE[2,0]", "CLNT"),
        ("/txtDD03D-DATATYPE[2,1]", "CHAR"),
    ];

    private static readonly string[] Titles = ["Field", "Key", "Data Type"];

    [Fact]
    public void Groups_cells_into_one_row_per_screen_row_in_column_order()
    {
        var table = FieldList(Cells);
        TableControlRows.Group(table, 0, Titles);

        var rows = table.ChildNodes.OfType<XmlElement>().ToList();
        Assert.All(rows, r => Assert.Equal("TableRow", r.Name));
        Assert.Equal(["0", "1"], rows.Select(r => r.GetAttribute("Index")));
        Assert.Equal(["MANDT", "", "CLNT"], rows[0].ChildNodes.OfType<XmlElement>().Select(c => c.GetAttribute("Text")));
        Assert.Equal(["MTEXT", "", "CHAR"], rows[1].ChildNodes.OfType<XmlElement>().Select(c => c.GetAttribute("Text")));
    }

    [Fact]
    public void Cells_get_their_column_title()
    {
        var table = FieldList(Cells);
        TableControlRows.Group(table, 0, Titles);

        var row = (XmlElement)table.FirstChild!;
        Assert.Equal(["Field", "Key", "Data Type"], row.ChildNodes.OfType<XmlElement>().Select(c => c.GetAttribute("Title")));
    }

    [Fact]
    public void Missing_or_blank_titles_leave_the_cell_without_one()
    {
        var table = FieldList(Cells);
        TableControlRows.Group(table, 0, ["Field", ""]);

        var cells = ((XmlElement)table.FirstChild!).ChildNodes.OfType<XmlElement>().ToList();
        Assert.True(cells[0].HasAttribute("Title"));
        Assert.False(cells[1].HasAttribute("Title"));
        Assert.False(cells[2].HasAttribute("Title"));
    }

    [Fact]
    public void Absolute_row_adds_the_scroll_position()
    {
        var table = FieldList(Cells);
        TableControlRows.Group(table, 15, Titles);

        Assert.Equal(["15", "16"], table.ChildNodes.OfType<XmlElement>().Select(r => r.GetAttribute("AbsoluteRow")));
    }

    [Fact]
    public void Rows_are_sorted_by_number_not_text()
    {
        var table = FieldList(("/txtF[0,10]", "ten"), ("/txtF[0,2]", "two"), ("/txtF[0,1]", "one"));
        TableControlRows.Group(table, 0, []);

        Assert.Equal(["1", "2", "10"], table.ChildNodes.OfType<XmlElement>().Select(r => r.GetAttribute("Index")));
    }

    [Fact]
    public void Children_that_are_not_cells_stay_put()
    {
        var table = FieldList(("/txtF[0,0]", "cell"), ("/btnSCROLL", "not a cell"));
        TableControlRows.Group(table, 0, []);

        var kids = table.ChildNodes.OfType<XmlElement>().ToList();
        Assert.Equal("GuiTextField", kids[0].Name);
        Assert.Equal("not a cell", kids[0].GetAttribute("Text"));
        Assert.Equal("TableRow", kids[1].Name);
    }

    [Fact]
    public void XPath_finds_a_cell_by_another_cell_in_its_row()
    {
        var table = FieldList(Cells);
        TableControlRows.Group(table, 0, Titles);

        var hit = table.OwnerDocument.SelectSingleNode(
            "//TableRow[*[contains(@Id,'FIELDNAME') and @Text='MTEXT']]/*[@Title='Data Type']") as XmlElement;
        Assert.Equal("CHAR", hit?.GetAttribute("Text"));
    }

    [Theory]
    [InlineData("/app/wnd[0]/usr/tbl/txtX[4,2]", true, 4, 2)]
    [InlineData("/app/wnd[0]/usr/tbl/txtX[12,130]", true, 12, 130)]
    [InlineData("/app/wnd[0]/usr/lbl[4]", false, -1, -1)]
    [InlineData("/app/wnd[0]/usr/txtX", false, -1, -1)]
    public void Parses_the_cell_position_from_the_id(string id, bool ok, int column, int row)
    {
        Assert.Equal(ok, TableControlRows.TryParseCell(id, out var c, out var r));
        Assert.Equal((column, row), (c, r));
    }
}
