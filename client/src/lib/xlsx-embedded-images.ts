export type XlsxEmbeddedImageRow = Record<string, string | null | undefined>;

export type XlsxEmbeddedImageExportOptions = {
  filename: string;
  sheetName: string;
  columns: string[];
  rows: XlsxEmbeddedImageRow[];
  imageColumn?: string;
  imageWidthPx?: number;
  imageHeightPx?: number;
  columnWidths?: Record<string, number>;
};

type ZipEntry = { name: string; data: Uint8Array; crc: number; offset?: number };
type ParsedImage = { bytes: Uint8Array; extension: "png" | "jpeg" };

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function makeZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const prepared: ZipEntry[] = entries.map((entry) => ({ ...entry, crc: crc32(entry.data) }));
  const localParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of prepared) {
    entry.offset = offset;
    const name = encoder.encode(entry.name);
    const header = concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(entry.crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name]);
    localParts.push(header, entry.data);
    offset += header.length + entry.data.length;
  }
  const centralStart = offset;
  const centralParts: Uint8Array[] = [];
  for (const entry of prepared) {
    const name = encoder.encode(entry.name);
    const header = concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(entry.crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.offset || 0), name]);
    centralParts.push(header);
    offset += header.length;
  }
  const centralSize = offset - centralStart;
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(prepared.length), u16(prepared.length), u32(centralSize), u32(centralStart), u16(0)]);
  return concat([...localParts, ...centralParts, end]);
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function columnLetters(index: number): string {
  let n = index + 1, out = "";
  while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

function sanitizeSheetName(value: string): string {
  const cleaned = value.replace(/[\\/*?:\[\]]/g, " ").trim();
  return (cleaned || "Sheet1").slice(0, 31);
}

function parseImage(dataUrl: string): ParsedImage | null {
  const match = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return match[1].toLowerCase() === "image/png" ? { bytes, extension: "png" } : { bytes, extension: "jpeg" };
}


export async function blobToXlsxImageDataUrl(blob: Blob): Promise<string> {
  if (!blob.size) return "";
  if (blob.type === "image/png" || blob.type === "image/jpeg" || blob.type === "image/jpg") {
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.naturalWidth || image.width);
    canvas.height = Math.max(1, image.naturalHeight || image.height);
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function downloadBlob(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportXlsxWithEmbeddedImages(options: XlsxEmbeddedImageExportOptions) {
  const { filename, columns, rows, imageColumn = "Photo", imageWidthPx = 56, imageHeightPx = 56, columnWidths = {} } = options;
  if (!columns.length) throw new Error("At least one export column is required");
  const sheetName = sanitizeSheetName(options.sheetName);
  const imageColumnIndex = columns.indexOf(imageColumn);
  const images: Array<{ rowIndex: number; parsed: ParsedImage; mediaIndex: number }> = [];
  let mediaIndex = 1;
  rows.forEach((row, rowIndex) => {
    const parsed = imageColumnIndex >= 0 ? parseImage(String(row[imageColumn] || "")) : null;
    if (parsed) images.push({ rowIndex, parsed, mediaIndex: mediaIndex++ });
  });

  const imageTypes = new Set(images.map((image) => image.parsed.extension));
  const contentTypeDefaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    ...(imageTypes.has("png") ? ['<Default Extension="png" ContentType="image/png"/>'] : []),
    ...(imageTypes.has("jpeg") ? ['<Default Extension="jpeg" ContentType="image/jpeg"/>'] : []),
  ].join("");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${contentTypeDefaults}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${images.length ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ""}</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="center"/></xf><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const colDefs = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${columnWidths[column] ?? (column === imageColumn ? 10 : Math.min(40, Math.max(12, column.length + 3)))}" customWidth="1"/>`).join("");
  const headerCells = columns.map((column, index) => `<c r="${columnLetters(index)}1" t="inlineStr" s="2"><is><t>${escapeXml(column)}</t></is></c>`).join("");
  const imageRows = new Set(images.map((image) => image.rowIndex));
  const dataRows = rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 2;
    const cells = columns.map((column, colIndex) => `<c r="${columnLetters(colIndex)}${excelRow}" t="inlineStr" s="1"><is><t xml:space="preserve">${escapeXml(column === imageColumn ? "" : String(row[column] ?? ""))}</t></is></c>`).join("");
    return `<row r="${excelRow}"${imageRows.has(rowIndex) ? ' ht="48" customHeight="1"' : ""}>${cells}</row>`;
  }).join("");
  const dimensionEnd = `${columnLetters(columns.length - 1)}${rows.length + 1}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${dimensionEnd}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${colDefs}</cols><sheetData><row r="1" ht="20" customHeight="1">${headerCells}</row>${dataRows}</sheetData><autoFilter ref="A1:${dimensionEnd}"/>${images.length ? '<drawing r:id="rId1"/>' : ""}</worksheet>`;
  const entries: Array<{ name: string; data: Uint8Array }> = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    { name: "xl/styles.xml", data: encoder.encode(styles) },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheet) },
  ];
  if (images.length) {
    const emuPerPixel = 9525;
    const drawingAnchors = images.map((image, index) => `<xdr:oneCellAnchor><xdr:from><xdr:col>${imageColumnIndex}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${image.rowIndex + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${imageWidthPx * emuPerPixel}" cy="${imageHeightPx * emuPerPixel}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 1}" name="Photo ${index + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${index + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`).join("");
    const drawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${drawingAnchors}</xdr:wsDr>`;
    const drawingRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${images.map((image, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${image.mediaIndex}.${image.parsed.extension}"/>`).join("")}</Relationships>`;
    const sheetRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
    entries.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", data: encoder.encode(sheetRels) }, { name: "xl/drawings/drawing1.xml", data: encoder.encode(drawing) }, { name: "xl/drawings/_rels/drawing1.xml.rels", data: encoder.encode(drawingRels) });
    for (const image of images) entries.push({ name: `xl/media/image${image.mediaIndex}.${image.parsed.extension}`, data: image.parsed.bytes });
  }
  downloadBlob(makeZip(entries), filename);
}
