// Small PNG pictures drawn in code: the image of each sector's demo conversation ([ARR-08]) and the simulator's
// sample image ([AJU-12]). Nothing binary lives in the repository: shapes are painted on an RGB canvas with 2×2
// supersampling (smooth edges) and encoded as PNG with node:zlib. Pure: the same sector always gives the same bytes.
import { crc32, deflateSync } from "node:zlib";
import type { Sector } from "@/lib/enums";

type Rgb = readonly [number, number, number];
/** A flat colour, or one that depends on the point (gradients, textures). Coordinates are output pixels. */
type Paint = Rgb | ((x: number, y: number) => Rgb);
type Shape = (x: number, y: number) => boolean;

export const DEMO_IMAGE_WIDTH = 320;
export const DEMO_IMAGE_HEIGHT = 240;
const SUPERSAMPLING = 2;

class Canvas {
  private readonly pixels: Float32Array;
  private readonly sw: number;
  private readonly sh: number;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Paint,
  ) {
    this.sw = width * SUPERSAMPLING;
    this.sh = height * SUPERSAMPLING;
    this.pixels = new Float32Array(this.sw * this.sh * 3);
    this.fill(() => true, background);
  }

  /** Paints every sub-pixel inside `shape`, optionally mixed with what is below (`alpha` < 1). */
  fill(shape: Shape, paint: Paint, alpha = 1): void {
    for (let sy = 0; sy < this.sh; sy++) {
      const y = (sy + 0.5) / SUPERSAMPLING;
      for (let sx = 0; sx < this.sw; sx++) {
        const x = (sx + 0.5) / SUPERSAMPLING;
        if (!shape(x, y)) continue;
        const color = typeof paint === "function" ? paint(x, y) : paint;
        const index = (sy * this.sw + sx) * 3;
        for (let channel = 0; channel < 3; channel++) {
          this.pixels[index + channel] = this.pixels[index + channel] * (1 - alpha) + color[channel] * alpha;
        }
      }
    }
  }

  /** Averages each 2×2 block and encodes the result as an 8-bit RGB PNG. */
  toPng(): Uint8Array {
    const rowBytes = this.width * 3 + 1;
    const raw = Buffer.alloc(rowBytes * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * rowBytes] = 0; // filter: none
      for (let x = 0; x < this.width; x++) {
        for (let channel = 0; channel < 3; channel++) {
          let sum = 0;
          for (let dy = 0; dy < SUPERSAMPLING; dy++) {
            for (let dx = 0; dx < SUPERSAMPLING; dx++) {
              sum += this.pixels[((y * SUPERSAMPLING + dy) * this.sw + x * SUPERSAMPLING + dx) * 3 + channel];
            }
          }
          raw[y * rowBytes + 1 + x * 3 + channel] = Math.round(Math.min(255, Math.max(0, sum / SUPERSAMPLING ** 2)));
        }
      }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(this.width, 0);
    header.writeUInt32BE(this.height, 4);
    header.set([8, 2, 0, 0, 0], 8); // 8 bits per channel, RGB, deflate, no filter set, no interlace
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return new Uint8Array(Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
  }
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// ─── Shapes ─────────────────────────────────────────────────────────────────────────────────────────────

const rect =
  (x0: number, y0: number, x1: number, y1: number): Shape =>
  (x, y) =>
    x >= x0 && x < x1 && y >= y0 && y < y1;

const circle =
  (cx: number, cy: number, r: number): Shape =>
  (x, y) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const ellipse =
  (cx: number, cy: number, rx: number, ry: number): Shape =>
  (x, y) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

const ring =
  (cx: number, cy: number, r: number, width: number): Shape =>
  (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return d <= r && d >= r - width;
  };

function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): Shape {
  return (x, y) => {
    if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
}

/** Even-odd point in polygon. */
function polygon(points: readonly (readonly [number, number])[]): Shape {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

const union =
  (...shapes: Shape[]): Shape =>
  (x, y) =>
    shapes.some((shape) => shape(x, y));

const outline = (outer: Shape, inner: Shape): Shape => (x, y) => outer(x, y) && !inner(x, y);

/** Colour between `from` and `to` (t from 0 to 1). */
function mix(from: Rgb, to: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
}

const verticalGradient = (top: Rgb, bottom: Rgb, y0: number, y1: number) => (_x: number, y: number) => mix(top, bottom, (y - y0) / (y1 - y0));

// ─── The picture of each sector (what the customer sends in the demo, described in its conversation) ─────

const W = DEMO_IMAGE_WIDTH;
const H = DEMO_IMAGE_HEIGHT;

/** A lock of copper-dyed hair: strands along the lock, lighter reflections. */
function hairLock(canvas: Canvas): void {
  const lock: Shape = (x, y) => Math.abs(x - (W / 2 + Math.sin(y / 38) * 26)) < 74 - y / 8;
  canvas.fill(lock, (x, y) => {
    const base = mix([196, 98, 45], [122, 46, 20], y / H);
    const strand = 0.84 + 0.16 * Math.sin(x / 2.6 + Math.sin(y / 17) * 3);
    const shine = Math.max(0, Math.sin((x - y / 3) / 22)) ** 6 * 0.35;
    return [base[0] * strand + 255 * shine * 0.6, base[1] * strand + 190 * shine * 0.6, base[2] * strand + 120 * shine * 0.6];
  });
}

/** A dental shade guide: six tooth-shaped tabs from white to yellowish; the third one circled. */
function shadeGuide(canvas: Canvas): void {
  const shades: Rgb[] = [
    [250, 249, 243],
    [244, 238, 222],
    [238, 228, 202],
    [232, 216, 180],
    [224, 203, 160],
    [214, 188, 140],
  ];
  canvas.fill(roundRect(20, 150, 300, 176, 8), [150, 160, 172]);
  shades.forEach((shade, index) => {
    const x0 = 30 + index * 46;
    const tab = union(roundRect(x0, 70, x0 + 34, 150, 14), rect(x0 + 6, 140, x0 + 28, 160));
    canvas.fill(tab, (x, y) => mix(shade, [shade[0] - 18, shade[1] - 20, shade[2] - 26], (y - 70) / 90));
  });
  canvas.fill(outline(ellipse(30 + 2 * 46 + 17, 110, 30, 52), ellipse(30 + 2 * 46 + 17, 110, 26, 48)), [200, 40, 40]);
}

/** A figure seen from behind with the lower back marked in red. */
function backPain(canvas: Canvas): void {
  const skin: Rgb = [226, 186, 160];
  const shirt: Rgb = [92, 124, 160];
  canvas.fill(circle(160, 52, 26), [70, 52, 40]); // hair, back of the head
  canvas.fill(rect(150, 74, 170, 90), skin); // neck
  canvas.fill(union(roundRect(104, 84, 216, 210, 28), roundRect(80, 90, 110, 190, 14), roundRect(210, 90, 240, 190, 14)), shirt);
  canvas.fill(roundRect(112, 206, 208, 240, 10), [60, 66, 84]); // trousers
  canvas.fill(circle(182, 178, 24), [214, 40, 40], 0.55);
  canvas.fill(outline(circle(182, 178, 24), circle(182, 178, 21)), [190, 20, 20]);
}

/** A two-tier pink birthday cake with five lit candles. */
function birthdayCake(canvas: Canvas): void {
  canvas.fill(ellipse(160, 206, 120, 18), [236, 236, 240]); // plate
  canvas.fill(roundRect(64, 140, 256, 204, 10), [242, 170, 196]);
  canvas.fill(roundRect(96, 92, 224, 144, 10), [248, 196, 214]);
  canvas.fill(rect(64, 162, 256, 170), [255, 255, 255]);
  canvas.fill(rect(96, 112, 224, 119), [255, 255, 255]);
  for (let index = 0; index < 5; index++) {
    const x = 112 + index * 24;
    canvas.fill(roundRect(x - 3, 64, x + 3, 94, 2), index % 2 === 0 ? [120, 170, 230] : [250, 220, 90]);
    canvas.fill(ellipse(x, 54, 5, 9), [255, 180, 40]);
    canvas.fill(ellipse(x, 57, 2.5, 4.5), [255, 244, 170]);
  }
}

/** A car dashboard with an amber warning light between the two dials. */
function dashboard(canvas: Canvas): void {
  canvas.fill(roundRect(12, 40, 308, 214, 40), [24, 26, 32]);
  for (const cx of [90, 230]) {
    canvas.fill(circle(cx, 126, 58), [36, 40, 50]);
    canvas.fill(ring(cx, 126, 58, 4), [150, 160, 176]);
    for (let tick = 0; tick < 9; tick++) {
      const angle = Math.PI * (0.8 + (tick / 8) * 1.4);
      const [x, y] = [cx + Math.cos(angle) * 46, 126 + Math.sin(angle) * 46];
      canvas.fill(circle(x, y, 2.5), [220, 224, 232]);
    }
    const needle = Math.PI * (cx === 90 ? 1.1 : 1.45);
    canvas.fill(
      polygon([
        [cx - 3, 126],
        [cx + 3, 126],
        [cx + Math.cos(needle) * 44, 126 + Math.sin(needle) * 44],
      ]),
      [240, 80, 60],
    );
  }
  canvas.fill(roundRect(144, 110, 176, 136, 6), [255, 176, 0]);
  canvas.fill(roundRect(151, 116, 169, 130, 3), [120, 70, 0]);
  canvas.fill(circle(160, 123, 3), [255, 176, 0]);
}

/** A bar chart of five subjects; the lowest one, in red. */
function gradesChart(canvas: Canvas): void {
  for (let line = 1; line <= 5; line++) canvas.fill(rect(38, 204 - line * 36, 296, 205 - line * 36), [214, 218, 226]);
  const grades = [7.5, 8, 6.5, 4, 9];
  grades.forEach((grade, index) => {
    const x0 = 54 + index * 48;
    const top = 204 - grade * 18;
    canvas.fill(roundRect(x0, top, x0 + 30, 204, 4), index === 3 ? [214, 48, 48] : [61, 109, 242]);
  });
  canvas.fill(rect(36, 30, 38, 206), [120, 128, 140]);
  canvas.fill(rect(36, 204, 296, 206), [120, 128, 140]);
}

/** A two-storey house with a white front, red roof and front garden. */
function house(canvas: Canvas): void {
  canvas.fill(rect(0, 180, W, H), verticalGradient([110, 176, 90], [76, 140, 64], 180, H));
  canvas.fill(rect(88, 96, 232, 196), [246, 244, 238]);
  canvas.fill(
    polygon([
      [72, 100],
      [160, 36],
      [248, 100],
    ]),
    [186, 62, 48],
  );
  canvas.fill(rect(146, 146, 174, 196), [120, 78, 48]);
  for (const [x, y] of [
    [104, 112],
    [192, 112],
    [104, 150],
    [192, 150],
  ] as const) {
    canvas.fill(rect(x, y, x + 26, y + 24), [140, 190, 230]);
    canvas.fill(rect(x + 12, y, x + 14, y + 24), [246, 244, 238]);
  }
  canvas.fill(ellipse(50, 184, 30, 22), [60, 120, 56]);
  canvas.fill(ellipse(276, 186, 26, 20), [60, 120, 56]);
}

/** An olive short-sleeved T-shirt on a light background. */
function tShirt(canvas: Canvas): void {
  const shirt = polygon([
    [118, 40],
    [140, 34],
    [160, 48],
    [180, 34],
    [202, 40],
    [256, 76],
    [236, 110],
    [214, 98],
    [214, 214],
    [106, 214],
    [106, 98],
    [84, 110],
    [64, 76],
  ]);
  canvas.fill(shirt, (x, y) => mix([128, 132, 72], [104, 108, 58], (x + y) / (W + H)));
  canvas.fill(ellipse(160, 34, 20, 12), [243, 241, 237]); // neckline
  const collar = outline(ellipse(160, 34, 24, 16), ellipse(160, 34, 20, 12));
  canvas.fill((x, y) => collar(x, y) && y >= 34, [96, 100, 52]);
}

/** A simple floor plan: three rooms and the entrance marked in blue. */
function floorPlan(canvas: Canvas): void {
  const wall: Rgb = [52, 60, 76];
  const walls = union(rect(40, 40, 280, 46), rect(40, 194, 280, 200), rect(40, 40, 46, 200), rect(274, 40, 280, 200), rect(150, 40, 156, 150), rect(150, 120, 280, 126));
  canvas.fill(rect(46, 46, 274, 194), [248, 246, 240]);
  canvas.fill(walls, wall);
  canvas.fill(rect(186, 194, 236, 200), [248, 246, 240]); // entrance
  const swing = outline(circle(186, 194, 50), circle(186, 194, 47));
  canvas.fill((x, y) => swing(x, y) && x >= 186 && y <= 194, [61, 109, 242]);
  canvas.fill(rect(186, 144, 189, 194), [61, 109, 242]); // open door
}

const SECTOR_PICTURES: Record<Sector, (canvas: Canvas) => void> = {
  peluqueria: hairLock,
  "clinica-dental": shadeGuide,
  fisioterapia: backPain,
  restaurante: birthdayCake,
  taller: dashboard,
  academia: gradesChart,
  inmobiliaria: house,
  tienda: tShirt,
  otro: floorPlan,
};

const BACKGROUNDS: Record<Sector, Paint> = {
  peluqueria: verticalGradient([243, 238, 232], [228, 220, 212], 0, H),
  "clinica-dental": verticalGradient([226, 234, 240], [206, 218, 228], 0, H),
  fisioterapia: verticalGradient([236, 240, 236], [220, 228, 222], 0, H),
  restaurante: verticalGradient([250, 240, 222], [236, 220, 196], 0, H),
  taller: verticalGradient([70, 74, 84], [44, 46, 54], 0, H),
  academia: [252, 252, 250],
  inmobiliaria: verticalGradient([150, 200, 240], [214, 234, 250], 0, 190),
  tienda: verticalGradient([244, 242, 238], [230, 226, 220], 0, H),
  otro: [236, 238, 242],
};

/** The picture a customer sends in the sector's demo conversation (PNG, 320×240). */
export function sectorImagePng(sector: Sector): Uint8Array {
  const canvas = new Canvas(W, H, BACKGROUNDS[sector]);
  SECTOR_PICTURES[sector](canvas);
  return canvas.toPng();
}
