# CBCTScope User Manual

**A local-first CBCT viewer with native AI-agent control.**

| | |
|---|---|
| Software version | 1.2.1 |
| Manual revision | July 2026 |
| Author | Dr. Reza Motaghi, oral and maxillofacial radiologist |
| Project page | <https://github.com/rezamotaghi/cbctscope> |
| Contact | <https://rezamotaghi.com/contact> |

## Intended use

CBCTScope is research software for visualizing and navigating cone-beam CT
volumes and 2D dental radiographs on the user's own computer. It is intended
for research, education, and methodological work such as multi-reader studies.

> **CBCTScope is not a medical device.** It produces no findings,
> no measurements-as-conclusions, and no diagnoses, in the interface or over
> the AI-agent connection. Do not use it for clinical decision-making.
> Density values in CBCT are approximate by nature; every number the software
> reports is raw geometry or raw density, and its interpretation is the
> reader's alone.

## How to read this manual

- **Bold** text names an element you can see in the interface, such as the
  **open** button.
- `Code` text is something you type, or a key you press, such as `npm run demo`
  or `R`.
- A blockquote marked **Note** adds context; one marked **Caution** prevents a
  mistake.

Chapters 1 to 7 cover the application as a whole: installing it, the screen,
opening images, display, measuring, and exporting. Chapter 8 introduces the
eight reading modes; each mode then has its own guide written from clinical
reading practice. Chapters 9 to 12 cover AI-agent control, data handling,
troubleshooting, and the keyboard and mouse reference.

## License and citation

CBCTScope is free software under the AGPL-3.0-or-later license. If you use it
in research, please cite it: the citation record is the `CITATION.cff` file in
the repository, and the archived releases carry DOI
[10.5281/zenodo.21431452](https://doi.org/10.5281/zenodo.21431452). For uses
the AGPL does not fit, a commercial license is available through the contact
page above.
