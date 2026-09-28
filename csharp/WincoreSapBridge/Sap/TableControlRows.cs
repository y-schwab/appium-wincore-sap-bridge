using System.Text.RegularExpressions;
using System.Xml;

namespace Wincore.SapBridge.Sap;

/// <summary>
/// Page-source shape of a <c>GuiTableControl</c>. SAP lists its cells as flat children
/// whose id ends in the cell's screen position, <c>txtDD03D-FIELDNAME[col,row]</c>.
/// This groups them into <c>TableRow</c> elements and stamps each cell with its column
/// title, so XPath can say "the data type in the MANDT row":
/// <c>//TableRow[*[@Name='DD03D-FIELDNAME' and @Text='MANDT']]/*[@Name='DD03D-DATATYPE']</c>.
/// Works on the XML only — the positions come from ids already read — so it costs no
/// SAP calls and is unit-tested without SAP.
/// </summary>
internal static class TableControlRows
{
    private static readonly Regex CellPosition = new(@"\[(\d+),(\d+)\]$", RegexOptions.Compiled);

    /// <summary>A cell id's column and (screen) row, e.g. <c>…[4,2]</c> → (4, 2).</summary>
    public static bool TryParseCell(string id, out int column, out int row)
    {
        var m = CellPosition.Match(id);
        column = m.Success ? int.Parse(m.Groups[1].Value) : -1;
        row = m.Success ? int.Parse(m.Groups[2].Value) : -1;
        return m.Success;
    }

    /// <summary>
    /// Moves <paramref name="table"/>'s cell children into one <c>TableRow</c> per screen
    /// row, in row order, keeping the cells' order within a row. A row carries
    /// <c>Index</c> (the screen row, as in the cell ids) and <c>AbsoluteRow</c> (the row
    /// in the whole table: <paramref name="scrollPosition"/> + Index). A cell in column
    /// <c>c</c> gets <c>Title</c> = <paramref name="titles"/>[c] when there is one.
    /// Children that aren't cells stay where they are.
    /// </summary>
    public static void Group(XmlElement table, int scrollPosition, IReadOnlyList<string> titles)
    {
        var doc = table.OwnerDocument;
        var rows = new SortedDictionary<int, XmlElement>();
        foreach (var cell in table.ChildNodes.OfType<XmlElement>().ToList())
        {
            if (!TryParseCell(cell.GetAttribute("Id"), out var column, out var row)) continue;
            if (!rows.TryGetValue(row, out var rowEl))
            {
                rowEl = doc.CreateElement("TableRow");
                rowEl.SetAttribute("Index", row.ToString());
                rowEl.SetAttribute("AbsoluteRow", (scrollPosition + row).ToString());
                rows[row] = rowEl;
            }
            if (column < titles.Count && titles[column].Length > 0) cell.SetAttribute("Title", titles[column]);
            table.RemoveChild(cell);
            rowEl.AppendChild(cell);
        }
        foreach (var rowEl in rows.Values) table.AppendChild(rowEl);
    }
}
