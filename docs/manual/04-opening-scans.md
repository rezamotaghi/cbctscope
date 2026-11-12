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

Click **Open** in the header:

- **Open DICOMDIR or DICOM folder…** for an export folder.
- **Open a single DICOM file…** for a single file (a DICOMDIR, a multiframe
  volume, one slice of a series, or a 2D radiograph).

The system file dialog appears; pick the export. Every volume found in it is
listed in the volume list, and the first one displays. The scan is read in
place: nothing is copied, converted, or imported, and closing the source
releases it untouched.

> **Note.** The interface never shows the full path of what you opened. It
> shows a short label built from the last folder and file names, so name your
> export folders the way you want to see them on screen, and keep patient
> identifiers out of folder names when you plan to record or present.

## 4.3 Closing

**Close** at the end of the **Open** menu (it names the source) closes the current source and returns the viewer to the
built-in phantom. In normal mode the viewer remembers the last opened source
and restores it on the next start; in demo mode it never does (section 2.4).

## 4.4 Opening without the dialog

The file dialog is native on macOS and Windows. On Linux it uses the
desktop's dialog helper: zenity, or kdialog if zenity is absent; most
distributions ship one of the two. If neither is installed (the viewer says
so when you click **Open**), either install zenity from your distribution's
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
not apply to radiographs; the status line's gesture legend reflects this while
one is selected.

## 4.6 Opening in the browser (the web build)

In the web build (section 2.5) the **Open** menu offers:

- **Open DICOMDIR or DICOM folder** for an export folder (a DICOMDIR tree,
  a slice series, or multiframe files). The confirmation the browser shows is
  the browser's own wording. In Chrome, Edge and Arc the entry opens the
  browser's folder picker with read access only; the browser asks **Allow this
  site to view and copy files?**, says the site "will be able to view and make
  its own copies of files in" the folder, and offers **Don't Allow** and
  **Allow**. The line under the entry reads **Your browser will ask to let this
  page view and copy the files. It reads them into this tab and sends them
  nowhere.** The page asks for nothing more and does not keep the folder for
  next time; the picker only reopens in the folder you chose last. In Brave
  and Firefox the entry opens the classic file picker; Chromium-based browsers
  such as Brave then ask **Upload N files to this site?** with an **Upload**
  button, and the line says that the browser may say "upload", which is its
  word for letting the page read the files, and that they stay in the tab.
  Safari asks nothing. In both plain-browser cases a second line reads **Or
  drop the folder on the viewer: the browser asks nothing.** In every case the
  files are read into the tab's memory and nothing is sent anywhere. In the desktop app the entry opens its Open sheet, and
  the line says the same of that sheet, and that the files stay on the
  computer.
- **Open a single DICOM file** for one multiframe volume or one 2D
  radiograph.

A **drop** anywhere on the viewer opens too: drag an export folder or a file
from your file manager onto the image area, which then reads
**Drop a DICOM folder, a DICOMDIR or a single file here**. Folders are read
with all their subfolders. The same accepted formats apply as in section 4.1, and the files
are recognized by their content, never by their names. In the desktop app,
**Open…** in the File menu does the same as the first entry.

From the moment the files are handed over until the volume is on screen, a
progress panel covers the image area with the step it is on and the seconds
elapsed, and says where the files are read: in this tab on the website, in
this app on this computer in the desktop app:

1. **Reading headers: 312 of 801 files**: every file's first bytes are read to
   find the DICOM ones and their geometry. Pixels are not read yet.
2. **Assembling the volume: 43 %**: the slices are read and stacked into one
   volume, off the page's main thread.
3. **Preparing the display**: the volume is handed to the renderer, until the
   first frame shows.

When nothing in the files opens, the panel says so and stays until you
dismiss it. Its first line says what went wrong in plain words and what to
do, for example **These files are not DICOM images. Export from your CBCT
software as DICOM, with compression off.** (chapter 11 lists the cases);
**Open another folder** beside **Dismiss** opens the picker again. Under the
first line comes the technical reason: **No DICOM volume found in 3,412
files**, followed by what the scan saw, for example files with a compressed transfer syntax (re-export with
compression off), a CT series with too few slices to be a CBCT volume (at
least 30), or files without the DICM magic bytes (not DICOM at all). The scan
reads at most 8,000 files, skipping hidden folders and anything deeper than
eight folders; pick the export folder itself rather than a folder that holds
much else.

The first time a real scan is opened in a browser profile, the
**Research use only** dialogue explains that this is not a medical device,
that the agent moves the camera and the human reads, and that nothing leaves
the tab (on the website) or this computer (in the desktop app), except the
agent's snapshots of the view, which go to the model you chose once you switch
the agent on. **I understand** dismisses it for good in that profile. The phantom
never shows it.

A volume above the size threshold (512 MiB of voxels by default) shows the
**Large volume** notice before it loads: its size, and that the browser must
hold it in memory (the tab's on the website, the app's in the desktop app),
and that the viewer run from the repository holds it in a browser tab as well and only shows no notice. **Continue** loads it; **Cancel** leaves the viewer as it
was. **Close** works as in section 4.3, without any memory of the source
between visits.
