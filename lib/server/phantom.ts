// SERVER-ONLY. Synthetic CBCT phantom — the zero-patient-data demo volume.
//
// A fully procedural head phantom in HU: soft-tissue head, mandible + maxilla built on
// parabolic dental arches, 12 teeth per jaw (enamel cap / dentin body / pulp canal, one
// metal crown for artifact-style contrast), pharyngeal airway, paired maxillary sinuses,
// and condyle + ramus columns so the TMJ view has anatomy to find. Deterministic by
// construction (no randomness), generated once per process and cached.
//
// Coordinate frame matches the viewer contract: LPS-ish voxel grid, x-fastest / y /
// z-ascending, isotropic spacing, origin at the volume corner.
import { robustVoi, type AssembledVolume, type CbctVolumeMeta } from './dicom';

export const PHANTOM_ID = 'demo_cbc70de0f00d';
export const isPhantomId = (id: string) => id === PHANTOM_ID;

const NX = 256;
const NY = 256;
const NZ = 200;
const SP = 0.4; // mm, isotropic

// HU palette
const AIR = -1000;
const SOFT = 40;
const AIRWAY = -950;
const CANCELLOUS = 450;
const CORTICAL = 1300;
const DENTIN = 1700;
const ENAMEL = 2800;
const PULP = 150;
const METAL = 3000;

// mm helpers: x centered on the volume, y front(0)→back, z inferior(0)→superior
const xmm = (i: number) => (i - NX / 2) * SP;
const ymm = (j: number) => j * SP;
const zmm = (k: number) => k * SP;

/** dental arch: front at y=30, sweeping back parabolically */
const archY = (x: number) => 30 + (x * x) / 55;

interface Tooth {
  x: number;
  y: number;
  crownR: number;
  metal?: boolean;
}

function archTeeth(): Tooth[] {
  const teeth: Tooth[] = [];
  const xs = [-35.75, -29.25, -22.75, -16.25, -9.75, -3.25, 3.25, 9.75, 16.25, 22.75, 29.25, 35.75];
  xs.forEach((x, i) => {
    // molars are wider than incisors
    const crownR = Math.abs(x) > 22 ? 4.4 : Math.abs(x) > 12 ? 3.6 : 3.0;
    teeth.push({ x, y: archY(x), crownR, metal: i === 2 }); // one metal crown, lower-left molar
  });
  return teeth;
}

let cached: AssembledVolume | null = null;

export function getPhantomVolume(): AssembledVolume {
  if (cached) return cached;
  const vox = new Int16Array(NX * NY * NZ).fill(AIR);
  const idx = (i: number, j: number, k: number) => k * NX * NY + j * NX + i;

  // --- per-column pass: head soft tissue, airway, jaw bone along the arch ---
  const archSamples: [number, number][] = [];
  for (let x = -40; x <= 40; x += 1) archSamples.push([x, archY(x)]);

  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const x = xmm(i);
      const y = ymm(j);

      // head outline: ellipse in the axial plane
      const ex = x / 48;
      const ey = (y - 55) / 46;
      const inHead = ex * ex + ey * ey < 1;

      // distance to the dental arch polyline (shared by both jaws)
      let dArch = Infinity;
      for (const [ax, ay] of archSamples) {
        const d = Math.hypot(x - ax, y - ay);
        if (d < dArch) dArch = d;
      }

      // pharyngeal airway column
      const dAirway = Math.hypot(x, y - 72);

      for (let k = 0; k < NZ; k++) {
        const z = zmm(k);
        const p = idx(i, j, k);

        if (inHead && z < 78) vox[p] = SOFT;
        if (dAirway < 9 && z > 8 && z < 78 && inHead) vox[p] = AIRWAY;

        if (dArch < 7 && Math.abs(x) < 41) {
          // mandible body
          if (z >= 18 && z <= 42) {
            const nearShell = dArch > 5 || z < 20 || z > 40;
            vox[p] = nearShell ? CORTICAL : CANCELLOUS;
          }
          // maxilla / alveolar process
          if (z >= 52 && z <= 76) {
            const nearShell = dArch > 5 || z < 54 || z > 74;
            vox[p] = nearShell ? CORTICAL : CANCELLOUS;
          }
        }
      }
    }
  }

  // --- maxillary sinuses: air ellipsoids carved into the maxilla ---
  for (const sx of [-17, 17]) {
    rasterEllipsoid(vox, idx, sx, 42, 68, 9, 8, 8, AIRWAY);
  }

  // --- condyles + rami so the TMJ view has targets ---
  for (const side of [-1, 1]) {
    const cx = side * 44;
    // ramus: vertical bone column
    for (let k = Math.round(20 / SP); k <= Math.round(72 / SP); k++) {
      rasterDisc(vox, idx, cx, 64, k, 5.5, CORTICAL, CANCELLOUS);
    }
    // condylar head
    rasterEllipsoid(vox, idx, cx, 64, 74, 6.5, 5, 5, CORTICAL);
  }

  // --- teeth: mandibular (crowns up), maxillary (crowns down) ---
  for (const t of archTeeth()) {
    rasterTooth(vox, idx, t, { crownZ: [40, 47], rootZ: [26, 40], up: true });
    rasterTooth(vox, idx, { ...t, metal: false }, { crownZ: [55, 62], rootZ: [62, 76], up: false });
  }

  const frameLen = NX * NY;
  const mid = vox.subarray(Math.floor(NZ / 2) * frameLen, (Math.floor(NZ / 2) + 1) * frameLen);
  const meta: CbctVolumeMeta = {
    anon: PHANTOM_ID,
    kind: 'mf',
    dims: [NX, NY, NZ],
    spacing: [SP, SP, SP],
    fov: [Math.round(NX * SP) / 10, Math.round(NZ * SP) / 10],
    region: 'synthetic phantom',
    year: '',
    pair: null,
    origin: [-(NX / 2) * SP, 0, 0],
    defaultVoi: robustVoi(mid as Int16Array),
    bytes: vox.byteLength,
  };
  cached = { meta, data: Buffer.from(vox.buffer, 0, vox.byteLength) };
  return cached;
}

type Idx = (i: number, j: number, k: number) => number;

function rasterEllipsoid(
  vox: Int16Array,
  idx: Idx,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  hu: number,
) {
  const i0 = Math.max(0, Math.floor((cx - rx) / SP + NX / 2));
  const i1 = Math.min(NX - 1, Math.ceil((cx + rx) / SP + NX / 2));
  const j0 = Math.max(0, Math.floor((cy - ry) / SP));
  const j1 = Math.min(NY - 1, Math.ceil((cy + ry) / SP));
  const k0 = Math.max(0, Math.floor((cz - rz) / SP));
  const k1 = Math.min(NZ - 1, Math.ceil((cz + rz) / SP));
  for (let k = k0; k <= k1; k++)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const dx = (xmm(i) - cx) / rx;
        const dy = (ymm(j) - cy) / ry;
        const dz = (zmm(k) - cz) / rz;
        if (dx * dx + dy * dy + dz * dz < 1) vox[idx(i, j, k)] = hu;
      }
}

/** filled disc at slice k with a cortical rim and cancellous core */
function rasterDisc(vox: Int16Array, idx: Idx, cx: number, cy: number, k: number, r: number, rim: number, core: number) {
  const i0 = Math.max(0, Math.floor((cx - r) / SP + NX / 2));
  const i1 = Math.min(NX - 1, Math.ceil((cx + r) / SP + NX / 2));
  const j0 = Math.max(0, Math.floor((cy - r) / SP));
  const j1 = Math.min(NY - 1, Math.ceil((cy + r) / SP));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(xmm(i) - cx, ymm(j) - cy);
      if (d < r) vox[idx(i, j, k)] = d > r - 1.2 ? rim : core;
    }
}

function rasterTooth(
  vox: Int16Array,
  idx: Idx,
  t: Tooth,
  shape: { crownZ: [number, number]; rootZ: [number, number]; up: boolean },
) {
  const [c0, c1] = shape.crownZ;
  const [r0, r1] = shape.rootZ;
  const zLo = Math.min(c0, r0);
  const zHi = Math.max(c1, r1);
  const rMax = t.crownR;
  const i0 = Math.max(0, Math.floor((t.x - rMax) / SP + NX / 2));
  const i1 = Math.min(NX - 1, Math.ceil((t.x + rMax) / SP + NX / 2));
  const j0 = Math.max(0, Math.floor((t.y - rMax) / SP));
  const j1 = Math.min(NY - 1, Math.ceil((t.y + rMax) / SP));
  const k0 = Math.max(0, Math.floor(zLo / SP));
  const k1 = Math.min(NZ - 1, Math.ceil(zHi / SP));

  for (let k = k0; k <= k1; k++) {
    const z = zmm(k);
    const inCrown = z >= c0 && z <= c1;
    const inRoot = z >= r0 && z <= r1;
    if (!inCrown && !inRoot) continue;
    // root tapers toward its apex; crown keeps full radius
    let r = t.crownR;
    if (inRoot && !inCrown) {
      // 0 at the apex → 1 where the root meets the crown
      const toward = shape.up ? (z - r0) / (r1 - r0) : (r1 - z) / (r1 - r0);
      r = 1.2 + (t.crownR * 0.6 - 1.2) * toward;
    }
    const occlusal = shape.up ? z > c1 - 4 : z < c0 + 4;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(xmm(i) - t.x, ymm(j) - t.y);
        if (d >= r) continue;
        const p = idx(i, j, k);
        if (t.metal && inCrown) {
          vox[p] = METAL;
        } else if (d < 0.9 && !occlusal) {
          vox[p] = PULP; // pulp canal through crown center and root
        } else if (inCrown && occlusal) {
          vox[p] = ENAMEL; // occlusal enamel cap
        } else {
          vox[p] = DENTIN;
        }
      }
  }
}
