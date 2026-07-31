const encoder = new TextEncoder();

export function downloadQuotationPdf(quote, company, type = 'project') {
  const lines = buildPrintableLines(quote, company, type);
  const blob = buildSimplePdf(lines);
  downloadBlob(blob, `${safeFileName(quote.quoteNo || quote.id)}.pdf`);
}

export function downloadQuotationXlsx(quote, company, type = 'project') {
  const rows = buildSpreadsheetRows(quote, company, type);
  const blob = buildXlsx(rows, type === 'project' ? 'Project Quotation' : 'Repair Quotation');
  downloadBlob(blob, `${safeFileName(quote.quoteNo || quote.id)}.xlsx`);
}

export function downloadQuotationDocx(quote, company, type = 'project') {
  const blob = buildDocx(quote, company, type);
  downloadBlob(blob, `${safeFileName(quote.quoteNo || quote.id)}.docx`);
}

function buildPrintableLines(quote, company, type) {
  const money = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines = [
    { text: company.companyName || 'TONEXT TECH', size: 18, bold: true },
    { text: company.tagline || 'I.T. Solutions & Repair Services', size: 10 },
    { text: [company.address, company.contact, company.email].filter(Boolean).join(' | '), size: 9 },
    { text: '', size: 8 },
    { text: type === 'project' ? 'PROJECT QUOTATION' : 'REPAIR QUOTATION', size: 15, bold: true },
    { text: `Quote No.: ${quote.quoteNo || quote.id}`, size: 10 },
    { text: `Date: ${formatDate(quote.date || quote.updatedAt)}`, size: 10 },
    { text: `Customer: ${quote.customerName || ''}`, size: 10 },
  ];

  if (type === 'project') {
    lines.push(
      { text: `Service: ${quote.serviceType || ''}`, size: 10 },
      { text: `Project Location: ${quote.projectLocation || ''}`, size: 10 },
      { text: '', size: 7 },
      { text: 'QTY   DESCRIPTION                                      UNIT         UNIT PRICE          TOTAL', size: 9, bold: true }
    );
    (quote.lineItems || []).forEach(line => {
      lines.push({ text: fitColumns([
        String(line.quantity || 0),
        line.description || '',
        line.unit || '',
        money(line.unitPrice),
        money(line.lineTotal)
      ], [5, 47, 12, 18, 18]), size: 8 });
    });
    lines.push(
      { text: '', size: 7 },
      { text: `Materials: ${money(quote.materialSrpTotal)}`, size: 10 },
      { text: `Labor: ${money(quote.laborUsed)}`, size: 10 },
      { text: `Subtotal: ${money(quote.subtotal)}`, size: 10 },
      { text: `Discount: ${money(quote.discount)}`, size: 10 },
      { text: `GRAND TOTAL: ${money(quote.grandTotal)}`, size: 12, bold: true },
      { text: `Downpayment: ${money(quote.downpaymentAmount)}`, size: 10 },
      { text: `Balance: ${money(quote.balance)}`, size: 10 }
    );
  } else {
    lines.push(
      { text: `Device: ${[quote.deviceType, quote.brand, quote.model].filter(Boolean).join(' ')}`, size: 10 },
      { text: `Reported Problem: ${quote.problem || ''}`, size: 10 },
      { text: '', size: 7 },
      { text: 'QTY   DESCRIPTION                                             UNIT PRICE      LABOR       TOTAL', size: 9, bold: true }
    );
    (quote.lineItems || []).forEach(line => {
      lines.push({ text: fitColumns([
        String(line.quantity || 0),
        line.description || '',
        money(line.unitPrice),
        money(line.labor),
        money(line.lineTotal)
      ], [5, 54, 15, 12, 14]), size: 8 });
    });
    lines.push(
      { text: '', size: 7 },
      { text: `Parts Total: ${money(quote.partsTotal)}`, size: 10 },
      { text: `Labor Total: ${money(quote.laborTotal)}`, size: 10 },
      { text: `GRAND TOTAL: ${money(quote.grandTotal)}`, size: 12, bold: true }
    );
  }

  if (quote.notes) lines.push({ text: `Notes: ${quote.notes}`, size: 9 });
  const warranty = type === 'project' ? company.projectWarranty : company.repairWarranty;
  if (warranty) lines.push({ text: `Warranty: ${warranty}`, size: 9 });
  if (company.bankName || company.accountName || company.accountNumber) {
    lines.push(
      { text: '', size: 7 },
      { text: 'PAYMENT DETAILS', size: 10, bold: true },
      { text: [company.bankName, company.accountName, company.accountNumber].filter(Boolean).join(' | '), size: 9 }
    );
  }
  lines.push(
    { text: '', size: 10 },
    { text: 'Prepared by: ____________________        Customer Approval: ____________________', size: 9 }
  );
  return lines;
}

function fitColumns(values, widths) {
  return values.map((value, index) => {
    const width = widths[index];
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return (text.length > width ? text.slice(0, Math.max(1, width - 1)) + '…' : text).padEnd(width, ' ');
  }).join(' ');
}

function buildSimplePdf(lines) {
  const width = 595.28;
  const height = 841.89;
  const marginX = 42;
  const top = 800;
  const bottom = 45;
  const pageLines = [];
  let current = [];
  let y = top;

  for (const line of lines) {
    const lineHeight = Math.max(11, Number(line.size || 10) + 4);
    if (y - lineHeight < bottom && current.length) {
      pageLines.push(current);
      current = [];
      y = top;
    }
    current.push({ ...line, y });
    y -= lineHeight;
  }
  if (current.length) pageLines.push(current);

  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const pageObjectNumbers = [];
  let nextObject = 4;

  pageLines.forEach(() => {
    pageObjectNumbers.push(nextObject);
    nextObject += 2;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map(n => `${n} 0 R`).join(' ')}] /Count ${pageLines.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pageLines.forEach((page, index) => {
    const pageObj = pageObjectNumbers[index];
    const contentObj = pageObj + 1;
    const commands = [];
    for (const line of page) {
      const size = Number(line.size || 10);
      const font = line.bold ? '/F1' : '/F1';
      commands.push(`BT ${font} ${size} Tf ${marginX} ${line.y.toFixed(2)} Td (${pdfEscape(line.text)}) Tj ET`);
    }
    const stream = commands.join('\n');
    objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = encoder.encode(pdf).length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([encoder.encode(pdf)], { type: 'application/pdf' });
}

function pdfEscape(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/([\\()])/g, '\\$1');
}

function buildSpreadsheetRows(quote, company, type) {
  const rows = [
    [company.companyName || 'TONEXT TECH'],
    [company.tagline || 'I.T. Solutions & Repair Services'],
    [[company.address, company.contact, company.email].filter(Boolean).join(' | ')],
    [],
    [type === 'project' ? 'PROJECT QUOTATION' : 'REPAIR QUOTATION'],
    ['Quote No.', quote.quoteNo || quote.id],
    ['Date', formatDate(quote.date || quote.updatedAt)],
    ['Customer', quote.customerName || '']
  ];

  if (type === 'project') {
    rows.push(['Service Type', quote.serviceType || ''], ['Project Location', quote.projectLocation || ''], []);
    rows.push(['Qty', 'Description', 'Unit', 'Unit Price', 'Line Total']);
    (quote.lineItems || []).forEach(line => rows.push([
      Number(line.quantity || 0), line.description || '', line.unit || '', Number(line.unitPrice || 0), Number(line.lineTotal || 0)
    ]));
    rows.push([], ['Materials', Number(quote.materialSrpTotal || 0)], ['Labor', Number(quote.laborUsed || 0)], ['Subtotal', Number(quote.subtotal || 0)], ['Discount', Number(quote.discount || 0)], ['Grand Total', Number(quote.grandTotal || 0)], ['Downpayment', Number(quote.downpaymentAmount || 0)], ['Balance', Number(quote.balance || 0)]);
  } else {
    rows.push(['Device', [quote.deviceType, quote.brand, quote.model].filter(Boolean).join(' ')], ['Reported Problem', quote.problem || ''], []);
    rows.push(['Qty', 'Description', 'Unit Price', 'Labor', 'Line Total']);
    (quote.lineItems || []).forEach(line => rows.push([
      Number(line.quantity || 0), line.description || '', Number(line.unitPrice || 0), Number(line.labor || 0), Number(line.lineTotal || 0)
    ]));
    rows.push([], ['Parts Total', Number(quote.partsTotal || 0)], ['Labor Total', Number(quote.laborTotal || 0)], ['Grand Total', Number(quote.grandTotal || 0)]);
  }

  if (quote.notes) rows.push([], ['Notes', quote.notes]);
  return rows;
}

function buildXlsx(rows, sheetName) {
  const sheetXmlRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex + 1)}${rowIndex + 1}`;
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="1"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value ?? ''))}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');

  const entries = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName.slice(0,31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="48" customWidth="1"/><col min="3" max="6" width="18" customWidth="1"/></cols><sheetData>${sheetXmlRows}</sheetData></worksheet>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;PHP &quot;#,##0.00"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>TonexT Quotation</dc:title><dc:creator>TonexT Business Suite MVP 9.5</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>TonexT Business Suite MVP 9.5</Application></Properties>`
  };
  return zipBlob(entries, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function buildDocx(quote, company, type) {
  const rows = buildSpreadsheetRows(quote, company, type);
  const body = rows.map((row, index) => {
    if (row.length === 0) return paragraph('');
    if (index < 5 || row.length <= 2) return paragraph(row.map(v => String(v ?? '')).join('    '), index === 0 || index === 4);
    return tableRow(row);
  }).join('');

  const entries = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`,
    'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>TonexT Quotation</dc:title><dc:creator>TonexT Business Suite MVP 9.5</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`
  };
  return zipBlob(entries, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

function paragraph(text, bold = false) {
  return `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEscape(String(text || ''))}</w:t></w:r></w:p>`;
}

function tableRow(values) {
  const cells = values.map(value => `<w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${xmlEscape(String(value ?? ''))}</w:t></w:r></w:p></w:tc>`).join('');
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8C5D9"/><w:left w:val="single" w:sz="4" w:color="B8C5D9"/><w:bottom w:val="single" w:sz="4" w:color="B8C5D9"/><w:right w:val="single" w:sz="4" w:color="B8C5D9"/><w:insideH w:val="single" w:sz="4" w:color="B8C5D9"/><w:insideV w:val="single" w:sz="4" w:color="B8C5D9"/></w:tblBorders></w:tblPr><w:tr>${cells}</w:tr></w:tbl>`;
}

function zipBlob(entries, mimeType) {
  const files = Object.entries(entries).map(([name, content]) => ({ name, data: encoder.encode(content) }));
  const chunks = [];
  const central = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime(new Date());

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const localHeader = concatBytes(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(file.data.length), u32(file.data.length), u16(nameBytes.length), u16(0), nameBytes
    );
    chunks.push(localHeader, file.data);

    const centralHeader = concatBytes(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate),
      u32(crc), u32(file.data.length), u32(file.data.length), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes
    );
    central.push(centralHeader);
    offset += localHeader.length + file.data.length;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = concatBytes(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(centralOffset), u16(0)
  );
  return new Blob([...chunks, ...central, end], { type: mimeType });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(...arrays) {
  const length = arrays.reduce((sum, array) => sum + array.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function columnName(number) {
  let result = '';
  while (number > 0) {
    number--;
    result = String.fromCharCode(65 + (number % 26)) + result;
    number = Math.floor(number / 26);
  }
  return result;
}

function xmlEscape(value) {
  return String(value || '').replace(/[<>&"']/g, character => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  }[character]));
}

function safeFileName(value) {
  return String(value || 'quotation').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'quotation';
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleDateString('en-PH');
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
