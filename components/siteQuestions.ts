// The questions and answers of the site's questions and answers page (app/online-cbct-viewer),
// in one array: the page renders its headings, answers and links from it, and its FAQPage
// structured data (components/jsonLd.ts) from the same array, so the two always say the same.
// Every statement is the user manual's, and each answer links the manual pages that cover it.
// The page is also shown in the desktop app and the local app (the About page links it), so a
// statement about the website names cbctscope.com. tests/siteExport.test.ts finds every
// question, answer and link in the exported page.

export interface SiteQuestion {
  /** the question, as the page's h2 */
  question: string;
  /** the answer, one paragraph; the first sentence answers the question */
  answer: string;
  /** the manual pages or reading guides that cover it, relative to the page */
  links: readonly { href: string; label: string }[];
}

export const SITE_QUESTIONS: readonly SiteQuestion[] = [
  {
    question: 'How do I open a CBCT scan online?',
    answer:
      'Open cbctscope.com in a browser on a computer, click Open in the header and choose Open DICOMDIR or DICOM folder, or drop the export folder on the viewer: nothing is installed. The files are read into the browser tab and sent nowhere.',
    links: [{ href: 'manual/04-opening-scans.html#46-opening-in-the-browser-the-web-build', label: 'Opening in the browser, manual section 4.6' }],
  },
  {
    question: 'Is CBCTScope free?',
    answer:
      'Yes: CBCTScope is a free, open source CBCT viewer, with no account, under the GNU Affero General Public License, version 3 or later (AGPL-3.0-or-later).',
    links: [{ href: 'manual/00-front.html#license-and-citation', label: 'Licence and citation, in the manual' }],
  },
  {
    question: 'Is my scan uploaded?',
    answer:
      'No: on cbctscope.com, scans you open are read in the browser tab and never uploaded, and the site sets no cookies. The files are read from your disk into the tab\'s memory and are gone when the tab closes; your marks stay in the browser\'s storage as labels, millimetre coordinates and density statistics, never pixels. The optional agent, which moves the camera and never produces findings (the human reads), is off until you switch it on; when you do, your prompts and snapshots of the view go directly from your browser to the model provider you chose, under your own account with that provider, or to a model server on your own computer, and cbctscope.com receives nothing.',
    links: [{ href: 'manual/10-data-privacy.html#105-the-web-build', label: 'Data storage and privacy, manual section 10.5' }],
  },
  {
    question: 'How do I open a CBCT scan on a CD from my dentist?',
    answer:
      'Copy everything on the disc, the DICOMDIR file and the folders beside it, into one new folder on your computer, then open that folder with Open DICOMDIR or DICOM folder or drop it on the viewer. A USB stick works the same way. If the viewer says the files are compressed, export the scan again uncompressed from the software that made the disc, or ask whoever made it for an uncompressed DICOM export.',
    links: [{ href: 'manual/04-opening-scans.html#47-a-cbct-on-a-disc-or-a-usb-stick', label: 'A CBCT on a disc or a USB stick, manual section 4.7' }],
  },
  {
    question: 'Which DICOM files can CBCTScope open?',
    answer:
      'CBCTScope opens uncompressed DICOM: a folder of slice files or a DICOMDIR export (open the folder), one multiframe file holding the whole volume, or a single 16-bit 2D radiograph of modality PX, DX, CR or IO. A compressed export does not open: export it again with compression off.',
    links: [{ href: 'manual/04-opening-scans.html#41-what-the-viewer-accepts', label: 'What the viewer accepts, manual section 4.1' }],
  },
  {
    question: 'Which browsers does CBCTScope work in?',
    answer:
      'CBCTScope runs in a current browser with WebGL2, such as Chrome, Edge, Firefox or Safari, and Chrome or Edge read folders most reliably. A tablet at least 600 px on its shorter side gets the viewer; on a phone the site shows a short page instead.',
    links: [{ href: 'manual/02-installation.html#21-system-requirements', label: 'System requirements, manual section 2.1' }],
  },
  {
    question: 'Can I open a CBCT scan on a Mac or a Windows PC?',
    answer:
      'Yes: open it on cbctscope.com in a current browser, or install the desktop app for a Mac with Apple silicon, a Mac with Intel, or Windows. The desktop app is the web build in its own window, with no Node.js and no terminal, and cbctscope.com\'s Download the desktop app menu links each installer.',
    links: [{ href: 'manual/02-installation.html#26-the-desktop-app', label: 'The desktop app, manual section 2.6' }],
  },
  {
    question: 'Can I measure on a CBCT scan?',
    answer:
      'Yes: on the MPR slice panes, Length measures distances in true millimetres, Angle measures angles in degrees, and the ROI tools give density statistics in raw HU. Density values in CBCT are approximate by nature.',
    links: [{ href: 'manual/06-measure-annotate.html', label: 'Measuring and annotating, manual chapter 6' }],
  },
  {
    question: 'How do I get a panoramic view from a CBCT and trace the nerve?',
    answer:
      'In Pano, draw the dental arch in one stroke on an axial slice, or click Auto arch and adjust the dots, and double-click to finish: the curved panoramic and its cross-sections render live. To follow the mandibular canal, click Add nerve, click along the canal on the pano, then correct each point\'s buccolingual position on the cross-sections.',
    links: [{ href: 'manual/pano.html', label: 'The Pano reading guide' }],
  },
  {
    question: 'Can CBCTScope show the airway and the TMJ?',
    answer:
      'Yes: Region grows a connected region by density from a seed point and reports its volume, density statistics and cross-sectional area by height, the upper airway being the usual case, and TMJ shows both temporomandibular joints side by side, each cut against its own condylar axis. Segmentations and traces are drawn by the reader.',
    links: [
      { href: 'manual/region.html', label: 'The Region reading guide' },
      { href: 'manual/tmj.html', label: 'The TMJ reading guide' },
    ],
  },
  {
    question: 'How do I export images from a CBCT scan?',
    answer:
      'Snapshot saves a PNG of what the current mode shows, exactly as displayed, and Export saves the volume as a PNG slice stack, a NIfTI volume or an STL surface mesh, computed in the browser. In a browser the files go to your Downloads folder; the desktop app shows a save panel that starts in Downloads.',
    links: [{ href: 'manual/07-exporting.html', label: 'Exporting, manual chapter 7' }],
  },
  {
    question: 'Is CBCTScope a medical device?',
    answer:
      'No: CBCTScope is research software, not a medical device; it displays and navigates images and produces no findings or diagnoses, so do not use it for clinical decision-making.',
    links: [{ href: 'manual/00-front.html#intended-use', label: 'Intended use, in the manual' }],
  },
];
