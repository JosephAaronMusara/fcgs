import { PDFDocument } from "pdf-lib";

export async function mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
  const nonEmpty = buffers.filter((buffer) => buffer.length > 0);
  if (!nonEmpty.length) throw new Error("No PDF documents were available to merge");
  if (nonEmpty.length === 1) return nonEmpty[0];

  const startedAt = Date.now();
  const merged = await PDFDocument.create();
  let pageCount = 0;
  for (const buffer of nonEmpty) {
    const source = await PDFDocument.load(buffer, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    const pages = await merged.copyPages(source, source.getPageIndices());
    for (const page of pages) merged.addPage(page);
    pageCount += pages.length;
  }

  const bytes = await merged.save({
    addDefaultPage: false,
    useObjectStreams: true,
    updateFieldAppearances: false,
  });
  const result = Buffer.from(bytes);
  console.info(`[academic-pdf] merged documents=${nonEmpty.length} pages=${pageCount} bytes=${result.length} totalMs=${Date.now() - startedAt}`);
  return result;
}
