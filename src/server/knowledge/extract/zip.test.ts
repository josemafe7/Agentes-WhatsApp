// The ZIP check in front of the Word and Excel readers ([SEG-13], docs/security.md «Entradas»): the XLSX reader streams
// the archive entry by entry from the start and allocates each entry by the size its local header declares, so the
// check walks the same entries, refuses sizes that do not match what they really unpack to, anything the central
// directory does not list, and more entries or bytes than the limits. Archives are built here byte by byte.
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_ZIP_ENTRIES, readZipEntry, zipUnpacksWithinLimits } from "./zip";

type Entry = {
  name: string;
  content: string;
  /** Sizes written in the headers instead of the real ones. */
  declared?: { central?: number; local?: number; descriptor?: number };
  /** Bit 3: sizes after the data (Java's ZipOutputStream, Apache POI…); the local header says 0. */
  descriptor?: boolean;
  /** Written as data but left out of the central directory. */
  hidden?: boolean;
};

function zip(entries: Entry[], options: { count?: number; reverseDirectory?: boolean } = {}): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.content, "utf8");
    const compressed = deflateRawSync(data);
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(data);
    const flags = entry.descriptor ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(entry.descriptor ? 0 : crc, 14);
    local.writeUInt32LE(entry.descriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(entry.declared?.local ?? (entry.descriptor ? 0 : data.length), 22);
    local.writeUInt16LE(name.length, 26);
    const parts = [local, name, compressed];
    if (entry.descriptor) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(entry.declared?.descriptor ?? data.length, 12);
      parts.push(descriptor);
    }
    locals.push(...parts);
    if (!entry.hidden) {
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(flags, 8);
      central.writeUInt16LE(8, 10);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(compressed.length, 20);
      central.writeUInt32LE(entry.declared?.central ?? data.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      centrals.push(Buffer.concat([central, name]));
    }
    offset += parts.reduce((sum, part) => sum + part.length, 0);
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const listed = entries.filter((entry) => !entry.hidden).length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.count ?? listed, 8);
  end.writeUInt16LE(options.count ?? listed, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, ...(options.reverseDirectory ? [...centrals].reverse() : centrals), end]));
}

const MB = 1024 * 1024;
const limits = { maxUnpackedBytes: MB, maxEntries: 10 };
const sheet = { name: "xl/worksheets/sheet1.xml", content: "<worksheet><sheetData/></worksheet>" };

describe("the ZIP check before the Word and Excel readers [SEG-13]", () => {
  it("lets an ordinary archive through, also one written with its sizes after the data (bit 3)", () => {
    expect(zipUnpacksWithinLimits(zip([sheet, { name: "[Content_Types].xml", content: "<Types/>" }]), limits)).toBe(true);
    expect(zipUnpacksWithinLimits(zip([{ ...sheet, descriptor: true }, { name: "[Content_Types].xml", content: "<Types/>", descriptor: true }]), limits)).toBe(true);
    expect(new TextDecoder().decode(readZipEntry(zip([{ ...sheet, descriptor: true }]), sheet.name, 1024) ?? new Uint8Array())).toBe(sheet.content);
    // A directory may list the entries in another order than they are written.
    expect(zipUnpacksWithinLimits(zip([sheet, { name: "[Content_Types].xml", content: "<Types/>" }], { reverseDirectory: true }), limits)).toBe(true);
  });

  it("refuses sizes declared bigger than what the entry really unpacks to: the reader would reserve that much memory", () => {
    const huge = 3_000 * MB;
    expect(zipUnpacksWithinLimits(zip([{ ...sheet, declared: { local: huge } }]), limits)).toBe(false);
    expect(zipUnpacksWithinLimits(zip([{ ...sheet, declared: { central: huge } }]), limits)).toBe(false);
    expect(zipUnpacksWithinLimits(zip([{ ...sheet, declared: { central: sheet.content.length + 1, local: sheet.content.length + 1 } }]), limits)).toBe(false);
    expect(zipUnpacksWithinLimits(zip([{ ...sheet, descriptor: true, declared: { descriptor: huge } }]), limits)).toBe(false);
    expect(zipUnpacksWithinLimits(zip([{ ...sheet, descriptor: true, declared: { local: huge } }]), limits)).toBe(false);
    expect(readZipEntry(zip([{ ...sheet, declared: { central: huge } }]), sheet.name, 1024)).toBeNull();
  });

  it("refuses sizes declared smaller than the real ones (a zip bomb that lies)", () => {
    expect(zipUnpacksWithinLimits(zip([{ name: "xl/sharedStrings.xml", content: "0".repeat(2 * MB), declared: { central: 10, local: 10 } }]), { ...limits, maxUnpackedBytes: 10 * MB })).toBe(false);
  });

  it("refuses entries the central directory does not list: the streaming reader would read them all the same", () => {
    const bomb = { name: "xl/worksheets/sheet2.xml", content: "0".repeat(2 * MB), hidden: true };
    expect(zipUnpacksWithinLimits(zip([sheet, bomb]), limits)).toBe(false);
    expect(zipUnpacksWithinLimits(zip([bomb, sheet]), limits)).toBe(false);
  });

  it("refuses more entries than allowed, and an end record that lies about how many there are", () => {
    const many = Array.from({ length: 11 }, (_, index) => ({ name: `xl/worksheets/sheet${index}.xml`, content: "<a/>" }));
    expect(zipUnpacksWithinLimits(zip(many), limits)).toBe(false);
    expect(zipUnpacksWithinLimits(zip(many.slice(0, 3), { count: 2 }), limits)).toBe(false);
    expect(MAX_ZIP_ENTRIES).toBe(10_000);
  });

  it("refuses more unpacked bytes in total than allowed, counting every entry", () => {
    const half = (index: number) => ({ name: `xl/worksheets/sheet${index}.xml`, content: "0".repeat(0.6 * MB) });
    expect(zipUnpacksWithinLimits(zip([half(1)]), limits)).toBe(true);
    expect(zipUnpacksWithinLimits(zip([half(1), half(2)]), limits)).toBe(false);
  });
});
