import { PDFDocument } from "pdf-lib";
import { mergePdfBuffers } from "../server/pdf-merge";

async function makePdf(width: number, height: number): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([width, height]);
  return Buffer.from(await document.save());
}

async function main(): Promise<void> {
  const first = await makePdf(595, 842);
  const second = await makePdf(612, 792);
  const merged = await mergePdfBuffers([first, second]);
  const verified = await PDFDocument.load(merged, { updateMetadata: false });
  const sizes = verified.getPages().map((page) => page.getSize());

  if (verified.getPageCount() !== 2) {
    throw new Error(`Expected 2 merged pages, received ${verified.getPageCount()}`);
  }
  if (Math.round(sizes[0].width) !== 595 || Math.round(sizes[1].width) !== 612) {
    throw new Error(`Merged page dimensions were not preserved: ${JSON.stringify(sizes)}`);
  }

  console.log(JSON.stringify({
    status: "READY",
    inputDocuments: 2,
    mergedPages: verified.getPageCount(),
    mergedBytes: merged.length,
    pageSizes: sizes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
