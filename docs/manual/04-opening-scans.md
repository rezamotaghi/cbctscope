# 4 · Opening images

## 4.1 What the viewer accepts

CBCTScope reads **uncompressed DICOM**, in any of these shapes:

| You have | What to open |
|---|---|
| A folder of `.dcm` slice files | The folder |
| A DICOMDIR export (folder tree with a `DICOMDIR` index) | The folder |
| One multiframe DICOM file holding the whole volume | The file |
| One slice file of a series | The file; the whole series opens |
| A single 2D radiograph (modality PX, DX, CR, IO; 16-bit) | The file |

Every CBCT unit's software can produce such an export; the option is usually
named *export DICOM* or similar. If your export was written with compression,
re-export with compression off; the viewer will name the problem precisely if
it finds compressed files (chapter 11).

## 4.2 Opening

Click **📂 open** in the header:

- **📁 Open folder / DICOMDIR…** for an export folder.
- **🗄 Open DICOM file…** for a single file (a DICOMDIR, a multiframe volume,
  one slice of a series, or a 2D radiograph).

The system file dialog appears; pick the export. Every volume found in it is
listed in the volume picker, and the first one displays. The scan is read in
place: nothing is copied, converted, or imported, and closing the source
releases it untouched.

> **Note.** The interface never shows the full path of what you opened. It
> shows a short label built from the last folder and file names, so name your
> export folders the way you want to see them on screen, and keep patient
> identifiers out of folder names when you plan to record or present.

## 4.3 Closing

**📂 open → ✕ Close** closes the current source and returns the viewer to the
built-in phantom. In normal mode the viewer remembers the last opened source
and restores it on the next start; in demo mode it never does (section 2.4).

## 4.4 Opening without the dialog

The file dialog is native on macOS and Windows. On Linux it uses the
desktop's dialog helper: zenity, or kdialog if zenity is absent; most
distributions ship one of the two. If neither is installed (the viewer says
so when you click **open**), either install zenity from your distribution's
package manager, or point the running viewer at an export with one command in
a second terminal (forward slashes work in Windows paths):

```sh
curl -X POST http://localhost:3810/api/cbct/source -H "Content-Type: application/json" -d "{\"path\":\"C:/scans/case-export\"}"
```

The viewer picks the source up immediately; everything else is identical.

## 4.5 2D radiographs

A radiograph opens into its own single-image view: window, gamma, invert,
cursor-centered wheel zoom, left-drag pan, and double-click or `R` to fit.
Gray values are display-normalized to a 12-bit scale at load, since
radiographs carry no HU calibration, and MONOCHROME1 files are flipped so
bright is always radiopaque. The volumetric reading modes and HU presets do
not apply to radiographs; the header hint line reflects this while one is
selected.
