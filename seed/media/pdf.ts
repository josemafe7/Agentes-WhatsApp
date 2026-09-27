// A one-page PDF made in code: the simulator's sample document ([AJU-12]). Standard Helvetica fonts with WinAnsi
// encoding (Spanish accents, «ñ», «¿», «¡» and «€»), a title and short lines of text. Pure: same text, same bytes.

/** WinAnsi (cp1252) bytes of a string: Latin-1 as is, «€» at 0x80, anything else as «?». */
function winAnsi(text: string): number[] {
  return [...text].map((char) => {
    if (char === "€") return 0x80;
    const code = char.charCodeAt(0);
    return code <= 0xff ? code : 0x3f;
  });
}

/** A PDF literal string: (…) with its backslashes and parentheses escaped. */
function literal(text: string): number[] {
  const escaped: number[] = [];
  for (const byte of winAnsi(text)) {
    if (byte === 0x5c || byte === 0x28 || byte === 0x29) escaped.push(0x5c);
    escaped.push(byte);
  }
  return [0x28, ...escaped, 0x29];
}

const bytesOf = (text: string) => [...Buffer.from(text, "latin1")];

/** A valid single-page A4 PDF with `title` in bold and `lines` below it. */
export function simplePdf({ title, lines }: { title: string; lines: readonly string[] }): Uint8Array {
  const content = [
    ...bytesOf("BT /F2 18 Tf 72 770 Td "),
    ...literal(title),
    ...bytesOf(" Tj ET\nBT /F1 11 Tf 16 TL 72 736 Td "),
    ...lines.flatMap((line, index) => [...(index > 0 ? bytesOf("T* ") : []), ...literal(line), ...bytesOf(" Tj\n")]),
    ...bytesOf("ET\n"),
  ];
  const objects: number[][] = [
    bytesOf("<< /Type /Catalog /Pages 2 0 R >>"),
    bytesOf("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    bytesOf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>"),
    bytesOf("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
    bytesOf("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"),
    [...bytesOf(`<< /Length ${content.length} >>\nstream\n`), ...content, ...bytesOf("endstream")],
  ];

  // A binary comment after the header tells tools the file has 8-bit bytes.
  const out: number[] = [...bytesOf("%PDF-1.4\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a];
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out.push(...bytesOf(`${index + 1} 0 obj\n`), ...object, ...bytesOf("\nendobj\n"));
  });
  const xref = out.length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out.push(...bytesOf(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Uint8Array(out);
}
