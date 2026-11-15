'use client';
// Export: the CBCT viewer's output door, one menu that works the same in every view mode
// (it exports the VOLUME, not a pane; the header's Snapshot button stays the "what I see
// right now" door). Three client-side formats, three downstream universes:
//   PNG slice stack (.zip)   slides/papers/any image tool — what-you-see windowing
//   NIfTI (.nii.gz)          research/ML — Slicer, ITK-SNAP, nibabel, MONAI
//   binary STL               3D printing/CAD — iso-surface at a threshold, honors the 3D crop
// Everything is computed in the browser and lands in this machine's Downloads: nothing is
// uploaded, matching the local-first rule.
import React, { useCallback, useRef, useState } from 'react';
import { useDismiss, useKeepInViewport } from './menus';
import {
  downloadBlob,
  exportNifti,
  exportSliceStack,
  exportStl,
  type ExportWindow,
  type SlicePlane,
} from './exporters';
import { getCachedVolume, loadVolumeData, type VolumeEntry } from './volumeData';
import type { Crop3d } from './CbctViewport';

const QUALITY: Record<string, { cap: number; label: string }> = {
  draft: { cap: 160, label: 'Draft (up to 160³, about 1 s)' },
  standard: { cap: 256, label: 'Standard (up to 256³, a few s)' },
  fine: { cap: 384, label: 'Fine (up to 384³, about 15 s)' },
  full: { cap: 0, label: 'Full resolution (a minute or more)' },
};

interface Props {
  anon: string | null;
  voi: { center: number; width: number };
  invert: boolean;
  gamma: number;
  /** the 3D render's current cut-off — the STL threshold default */
  stlThreshold: number;
  crop3d: Crop3d;
}

export default function ExportMenu({ anon, voi, invert, gamma, stlThreshold, crop3d }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  busyRef.current = busy;
  const [note, setNote] = useState<{ msg: string; ok: boolean } | null>(null);
  const [planes, setPlanes] = useState<Record<SlicePlane, boolean>>({ axial: true, sagittal: false, coronal: false });
  const [everyNth, setEveryNth] = useState(1);
  const [stlThr, setStlThr] = useState(stlThreshold);
  const [quality, setQuality] = useState<keyof typeof QUALITY>('standard');
  const [useCrop, setUseCrop] = useState(true);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const panelRef = useRef<HTMLDivElement | null>(null);
  // a press outside closes it, but never mid-export (the progress line must stay visible),
  // and never while a field INSIDE the menu has focus: a stray click would close the menu
  // mid-typing and eat the slice interval or threshold. Escape is the deliberate close.
  const close = useCallback(() => setOpen(false), []);
  const keepOpen = useCallback((e: Event) => {
    if (busyRef.current) return true;
    if (e.type === 'keydown') return false;
    const active = document.activeElement;
    return !!(
      active &&
      boxRef.current?.contains(active) &&
      (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')
    );
  }, []);
  useDismiss(open, close, boxRef, { keepOpen });
  useKeepInViewport(open, panelRef);

  const toggleOpen = () => {
    if (!open) setStlThr(stlThreshold); // fresh default from the live 3D render each opening
    setOpen((v) => !v);
  };

  /** current volume from the shared cache (loads it if this mode hasn't yet). */
  const getEntry = async (): Promise<VolumeEntry> => {
    if (!anon) throw new Error('no volume open');
    return (
      getCachedVolume(anon) ??
      (await loadVolumeData(anon, (f) => setBusy(`loading volume ${(f * 100).toFixed(0)}%…`)))
    );
  };

  const winOf = (entry: VolumeEntry): ExportWindow => {
    // displayed window; if the app hasn't resolved one yet, the volume's own default
    const v = voi.width >= 10 ? voi : entry.meta.defaultVoi;
    return {
      lower: Math.round(v.center - v.width / 2),
      upper: Math.round(v.center + v.width / 2),
      gamma,
      invert,
    };
  };

  const run = async (job: () => Promise<void>) => {
    if (busyRef.current) return;
    setNote(null);
    try {
      await job();
    } catch (err) {
      setNote({ msg: `export failed: ${err instanceof Error ? err.message : String(err)}`, ok: false });
    } finally {
      setBusy(null);
    }
  };

  const doSlices = () =>
    run(async () => {
      const chosen = (Object.keys(planes) as SlicePlane[]).filter((p) => planes[p]);
      if (!chosen.length) throw new Error('pick at least one plane');
      setBusy('preparing…');
      const entry = await getEntry();
      const blob = await exportSliceStack(entry, { planes: chosen, everyNth, window: winOf(entry) }, setBusy);
      downloadBlob(blob, `${entry.meta.anon}_slices.zip`);
      setNote({ msg: `slice stack exported · ${(blob.size / 1e6).toFixed(0)} MB`, ok: true });
    });

  const doNifti = () =>
    run(async () => {
      setBusy('preparing…');
      const entry = await getEntry();
      setBusy('compressing…');
      const { blob, ext } = await exportNifti(entry);
      downloadBlob(blob, `${entry.meta.anon}.${ext}`);
      setNote({ msg: `NIfTI exported · ${(blob.size / 1e6).toFixed(0)} MB`, ok: true });
    });

  const doStl = () =>
    run(async () => {
      setBusy('preparing…');
      const entry = await getEntry();
      setBusy('computing surface… (the page may pause)');
      await new Promise((res) => setTimeout(res, 30)); // let the busy line paint before the sync crunch
      const { blob, triangles } = exportStl(entry, {
        thresholdHU: stlThr,
        maxDim: QUALITY[quality].cap,
        crop: useCrop ? crop3d : null,
      });
      if (!triangles) throw new Error('no surface at this threshold: lower it');
      downloadBlob(blob, `${entry.meta.anon}_${stlThr}hu.stl`);
      setNote({ msg: `STL exported · ${triangles.toLocaleString()} triangles · ${(blob.size / 1e6).toFixed(0)} MB`, ok: true });
    });

  const dlBtn: React.CSSProperties = { justifyContent: 'flex-start', marginTop: 4 };
  const head: React.CSSProperties = { marginTop: 12 };
  const num: React.CSSProperties = {
    width: 64,
    height: 'var(--ctl-h)',
    background: 'var(--panel-2)',
    border: '1px solid var(--ctl-border)',
    borderRadius: 'var(--ctl-radius)',
    padding: '0 8px',
    fontSize: 'var(--fs-meta)',
    color: 'var(--text)',
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        className="ctl"
        aria-expanded={open}
        aria-haspopup="true"
        disabled={!anon}
        onClick={toggleOpen}
        title="Export the open volume: PNG slice stack, NIfTI, or STL surface (computed in-browser, saved to Downloads)"
      >
        Export
      </button>
      {open && (
        <div
          ref={panelRef}
          className="menu-panel"
          style={{
            left: 0,
            width: 300,
            padding: '0 12px 12px',
            // on a short window the panel would run off the bottom with the export
            // buttons unreachable; scroll inside it instead
            maxHeight: 'calc(100vh - 140px)',
            overflowY: 'auto',
          }}
        >
          <div className="pop-head" style={head}>Slice images: window/invert/gamma as displayed</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {(['axial', 'sagittal', 'coronal'] as SlicePlane[]).map((p) => (
              <label key={p} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={planes[p]}
                  onChange={(e) => setPlanes((s) => ({ ...s, [p]: e.target.checked }))}
                />
                {p[0].toUpperCase() + p.slice(1)}
              </label>
            ))}
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            Every
            <input
              type="number"
              min={1}
              max={20}
              value={everyNth}
              onChange={(e) => setEveryNth(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              style={num}
            />
            slice(s)
          </label>
          <button className="ctl ctl-wide" style={dlBtn} disabled={!!busy} onClick={doSlices} title="one .zip: PNG per slice + meta.json (geometry + the window used)">
            PNG slice stack (.zip)
          </button>

          <div className="pop-head" style={head}>Full volume, research formats</div>
          <button
            className="ctl ctl-wide" style={dlBtn}
            disabled={!!busy}
            onClick={doNifti}
            title="NIfTI (.nii.gz): the volume in HU, for Slicer, ITK-SNAP, nibabel, MONAI"
          >
            NIfTI volume (.nii.gz)
          </button>

          <div className="pop-head" style={head}>Surface mesh (marching cubes at an HU threshold)</div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            Threshold
            <input
              type="number"
              value={stlThr}
              onChange={(e) => setStlThr(Number(e.target.value) || 0)}
              style={num}
            />
            HU
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            Detail
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as keyof typeof QUALITY)}
              style={{ ...num, width: 'auto', flex: 1 }}
            >
              {(Object.keys(QUALITY) as (keyof typeof QUALITY)[]).map((q) => (
                <option key={q} value={q}>
                  {QUALITY[q].label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <input type="checkbox" checked={useCrop} onChange={(e) => setUseCrop(e.target.checked)} />
            Honor the 3D crop box
          </label>
          <button
            className="ctl ctl-wide" style={dlBtn}
            disabled={!!busy}
            onClick={doStl}
            title="binary STL, mm units, for any print slicer, Blender, Meshmixer, CAD"
          >
            STL surface mesh (.stl)
          </button>

          {busy && <div style={{ color: 'var(--accent)', marginTop: 12 }}>{busy}</div>}
          {note && !busy && (
            <div style={{ color: note.ok ? 'var(--text-dim)' : 'var(--warn)', marginTop: 12 }}>{note.msg}</div>
          )}
        </div>
      )}
    </div>
  );
}
