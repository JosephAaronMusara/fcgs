/** GSM-7 basic/extension table, otherwise count UTF-16 code units (UCS-2 SMS). */
const GSM_BASIC = new Set([..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"]);
const GSM_EXTENDED = new Set([..."^{}\\[~]|€\f"]);

export function estimateSmsSegments(message: string) {
  let gsmUnits = 0;
  let gsm = true;
  for (const char of message) {
    if (GSM_BASIC.has(char)) gsmUnits += 1;
    else if (GSM_EXTENDED.has(char)) gsmUnits += 2;
    else { gsm = false; break; }
  }
  const encoding = gsm ? "GSM-7" : "Unicode";
  const units = gsm ? gsmUnits : message.length;
  const singleLimit = gsm ? 160 : 70;
  const multipartLimit = gsm ? 153 : 67;
  return { encoding, characters: [...message].length, units,
    segments: units === 0 ? 0 : units <= singleLimit ? 1 : Math.ceil(units / multipartLimit),
  };
}

/** Align SMS preview with the text sent by the Newsletter publish workflow. */
export function newsletterSmsText(content: string): string {
  return content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
