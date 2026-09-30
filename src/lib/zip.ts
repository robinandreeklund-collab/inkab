import { deflateRaw } from "node:zlib";
import { promisify } from "node:util";

/**
 * En minimal ZIP-skrivare.
 *
 * Demo-paketet är den enda platsen som behöver en, och ett arkivbibliotek i
 * package.json för tre kilobyte huvudstruktur är fel pris. Formatet är från
 * 1989 och har inte ändrats: lokalt huvud per fil, en central katalog sist,
 * och en avslutspost som pekar på katalogen. Ingen zip64 — paketet är
 * biblioteksfilen plus några hundra kilobyte GLB per maskin, aldrig i
 * närheten av fyra gigabyte.
 */

const deflate = promisify(deflateRaw);

export type ZipEntry = {
  /** Sökvägen i arkivet, relativ och med snedstreck. */
  path: string;
  data: Uint8Array | string;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Tid och datum i MS-DOS-format: sekunder i tvåstegs upplösning sedan 1980. */
function dosStamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Bit 11 säger att filnamnet är UTF-8. Utan den blir åäö skräp i Utforskaren. */
const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATE = 8;
const METHOD_STORE = 0;

export async function createZip(entries: ZipEntry[], now = new Date()): Promise<Buffer> {
  const stamp = dosStamp(now);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf-8");
    const raw =
      typeof entry.data === "string" ? Buffer.from(entry.data, "utf-8") : Buffer.from(entry.data);

    // Deflate på redan komprimerad data kostar tid och ger ibland fler bytes
    // tillbaka. Vinner den inte lagrar vi rått i stället.
    const packed = raw.length > 0 ? await deflate(raw, { level: 6 }) : Buffer.alloc(0);
    const useDeflate = packed.length < raw.length;
    const body = useDeflate ? packed : raw;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versionen som krävs för att packa upp
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // inget extrafält
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // versionen som skrev arkivet
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // kommentar
    central.writeUInt16LE(0, 34); // disknummer
    central.writeUInt16LE(0, 36); // interna attribut
    central.writeUInt32LE(0, 38); // externa attribut
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // den här disken
  end.writeUInt16LE(0, 6); // disken med katalogen
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // ingen arkivkommentar

  return Buffer.concat([...locals, directory, end]);
}
