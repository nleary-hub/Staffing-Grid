/*
 * Minimal, dependency-free .xlsx writer.
 *
 * Produces a real Office Open XML workbook (multiple sheets, column widths,
 * merged cells, bold/filled headers, number formats) using STORED (uncompressed)
 * ZIP entries so no deflate implementation is required. Excel, LibreOffice,
 * Numbers and Google Sheets all open stored-entry xlsx files.
 *
 * Usage:
 *   SGXlsx.build({ sheets: [{ name, cols, merges, rows: [[cell, ...]] }] })
 *   cell = { v: value, t: 's'|'n', s: 'header'|'num1'|... } or a bare string/number
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SGXlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- CRC32 ---------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  /* ---------- ZIP (store only) ---------- */
  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))) & 0xffff;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  }

  function zip(files) {
    var now = new Date();
    var time = dosTime(now), date = dosDate(now);
    var locals = [], centrals = [], offset = 0;

    files.forEach(function (f) {
      var nameBytes = utf8(f.name);
      var data = utf8(f.data);
      var crc = crc32(data);

      var lh = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);          // version needed
      lv.setUint16(6, 0x0800, true);      // UTF-8 filename flag
      lv.setUint16(8, 0, true);           // method: store
      lv.setUint16(10, time, true);
      lv.setUint16(12, date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true);
      cv.setUint16(14, date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);

      locals.push(lh, data);
      centrals.push(cd);
      offset += lh.length + data.length;
    });

    var centralSize = centrals.reduce(function (a, c) { return a + c.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    var parts = locals.concat(centrals, [eocd]);
    var total = parts.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  /* ---------- XML helpers ---------- */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  }

  function colLetter(i) {
    var s = '';
    i += 1;
    while (i > 0) {
      var r = (i - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  /* ---------- styles ----------
   * Style keys map to fixed cellXfs indexes declared in styles.xml below.
   */
  var STYLE_INDEX = {
    default: 0,
    bold: 1,
    header: 2,
    title: 3,
    subtitle: 4,
    int: 5,
    dec1: 6,
    dec2: 7,
    pct1: 8,
    text: 9,
    label: 10,
    bad: 11,
    good: 12,
    badNum: 13,
    goodNum: 14,
    totalText: 15,
    totalNum1: 16,
    totalNum2: 17
  };

  var STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="4">' +
      '<numFmt numFmtId="164" formatCode="#,##0"/>' +
      '<numFmt numFmtId="165" formatCode="#,##0.0"/>' +
      '<numFmt numFmtId="166" formatCode="#,##0.00"/>' +
      '<numFmt numFmtId="167" formatCode="0.0%"/>' +
    '</numFmts>' +
    '<fonts count="6">' +
      '<font><sz val="11"/><name val="Calibri"/><color theme="1"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/><color theme="1"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FFFFFFFF"/></font>' +
      '<font><b/><sz val="16"/><name val="Calibri"/><color rgb="FF00427A"/></font>' +
      '<font><sz val="10"/><name val="Calibri"/><color rgb="FF5A6672"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF9B1B1B"/></font>' +
    '</fonts>' +
    '<fills count="6">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF00427A"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF3F8"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFBE3E3"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE7F5E7"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFBFC9D4"/></left><right style="thin"><color rgb="FFBFC9D4"/></right>' +
      '<top style="thin"><color rgb="FFBFC9D4"/></top><bottom style="thin"><color rgb="FFBFC9D4"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="18">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                   // 0 default
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                     // 1 bold
      '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' + // 2 header
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                     // 3 title
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                     // 4 subtitle
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +            // 5 int
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +            // 6 dec1
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +            // 7 dec2
      '<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +            // 8 pct1
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' + // 9 text
      '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +        // 10 label
      '<xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +        // 11 bad text
      '<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +        // 12 good text
      '<xf numFmtId="166" fontId="5" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' + // 13 bad num
      '<xf numFmtId="166" fontId="1" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' + // 14 good num
      '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +        // 15 total text
      '<xf numFmtId="165" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' + // 16 total dec1
      '<xf numFmtId="166" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' + // 17 total dec2
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* ---------- sheet rendering ---------- */
  function cellXml(ref, cell) {
    if (cell === null || cell === undefined || cell === '') return '';
    if (typeof cell !== 'object') cell = { v: cell };
    var v = cell.v;
    if (v === null || v === undefined || v === '') {
      if (!cell.s) return '';
      return '<c r="' + ref + '" s="' + (STYLE_INDEX[cell.s] || 0) + '"/>';
    }
    var s = STYLE_INDEX[cell.s] !== undefined ? STYLE_INDEX[cell.s] : 0;
    var isNum = cell.t === 'n' || (cell.t !== 's' && typeof v === 'number' && isFinite(v));
    if (isNum) {
      var n = typeof v === 'number' ? v : parseFloat(v);
      if (!isFinite(n)) n = 0;
      return '<c r="' + ref + '" s="' + s + '"><v>' + n + '</v></c>';
    }
    return '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
  }

  function sheetXml(sheet) {
    var rows = sheet.rows || [];
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';

    if (sheet.freeze) {
      xml += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + sheet.freeze +
        '" topLeftCell="A' + (sheet.freeze + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    }
    xml += '<sheetFormatPr defaultRowHeight="15"/>';

    if (sheet.cols && sheet.cols.length) {
      xml += '<cols>';
      sheet.cols.forEach(function (c, i) {
        xml += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 12) + '" customWidth="1"/>';
      });
      xml += '</cols>';
    }

    xml += '<sheetData>';
    rows.forEach(function (row, r) {
      if (!row || !row.length) { xml += '<row r="' + (r + 1) + '"/>'; return; }
      var cells = '';
      row.forEach(function (cell, c) { cells += cellXml(colLetter(c) + (r + 1), cell); });
      xml += '<row r="' + (r + 1) + '">' + cells + '</row>';
    });
    xml += '</sheetData>';

    if (sheet.merges && sheet.merges.length) {
      xml += '<mergeCells count="' + sheet.merges.length + '">';
      sheet.merges.forEach(function (m) { xml += '<mergeCell ref="' + m + '"/>'; });
      xml += '</mergeCells>';
    }

    xml += '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="' + (sheet.orientation || 'landscape') + '" fitToWidth="1" fitToHeight="0"/>' +
      '</worksheet>';
    return xml;
  }

  function safeSheetName(name, index, used) {
    var n = String(name || ('Sheet' + (index + 1))).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31).trim() || ('Sheet' + (index + 1));
    var base = n, i = 2;
    while (used[n.toLowerCase()]) { n = (base.slice(0, 28) + ' ' + i).slice(0, 31); i++; }
    used[n.toLowerCase()] = true;
    return n;
  }

  function build(workbook) {
    var sheets = (workbook && workbook.sheets) || [];
    var used = {};
    var names = sheets.map(function (s, i) { return safeSheetName(s.name, i, used); });

    var files = [
      {
        name: '[Content_Types].xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          sheets.map(function (s, i) {
            return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
          }).join('') +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
          '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
          '</Types>'
      },
      {
        name: '_rels/.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
          '</Relationships>'
      },
      {
        name: 'docProps/core.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
          ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
          ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          '<dc:title>' + esc((workbook && workbook.title) || 'Staffing Grid') + '</dc:title>' +
          '<dc:creator>' + esc((workbook && workbook.creator) || 'CaroMont Staffing Grid Builder') + '</dc:creator>' +
          '<cp:lastModifiedBy>' + esc((workbook && workbook.creator) || 'CaroMont Staffing Grid Builder') + '</cp:lastModifiedBy>' +
          '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + '</dcterms:created>' +
          '<dcterms:modified xsi:type="dcterms:W3CDTF">' + new Date().toISOString() + '</dcterms:modified>' +
          '</cp:coreProperties>'
      },
      {
        name: 'docProps/app.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"' +
          ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
          '<Application>CaroMont Staffing Grid Builder</Application></Properties>'
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map(function (s, i) {
            return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
          }).join('') +
          '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>'
      },
      {
        name: 'xl/workbook.xml',
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
          ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
          names.map(function (n, i) {
            return '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
          }).join('') +
          '</sheets></workbook>'
      },
      { name: 'xl/styles.xml', data: STYLES_XML }
    ];

    sheets.forEach(function (s, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) });
    });

    return zip(files);
  }

  function toBlob(workbook) {
    return new Blob([build(workbook)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  return { build: build, toBlob: toBlob, colLetter: colLetter, STYLE_INDEX: STYLE_INDEX };
});
