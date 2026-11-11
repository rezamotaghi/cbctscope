// Every reading mode's mouse gestures, read from the handlers that bind them. The Keys card
// lists them in full under "Mouse"; the status line shows at most three of them for the
// current mode, then points to the Keys card. Each line is a plain clause: gesture, effect.

export type GestureMode = 'mpr' | 'grid' | 'pano' | 'tmj' | 'reslice' | 'ceph' | 'region' | 'stitch' | 'xray';

export interface GesturePane {
  /** the pane or part of the screen the gestures act on, or null for the whole mode */
  pane: string | null;
  lines: readonly (readonly [gesture: string, effect: string])[];
}

/** the gestures every mode shares */
export const EVERY_MODE_GESTURES: readonly (readonly [string, string])[] = [['Double-click a slider', 'reset it']];

const RANGE_HANDLES: GesturePane = {
  pane: 'Vertical range handles',
  lines: [['Drag a handle', 'trim the top or the bottom']],
};

export const MODE_GESTURES: Record<GestureMode, readonly GesturePane[]> = {
  mpr: [
    {
      pane: 'Slice panes',
      lines: [
        ['Wheel', 'move the slice'],
        ['Left-click, Crosshairs tool', 'place the crosshairs'],
        ['Left-drag, Crosshairs or Pan tool', 'pan'],
        ['Left-drag, any other tool', 'use that tool (W/L sets the window, 3D ROI draws a box)'],
        ['Shift and left-click an annotation', 'select it'],
        ['Right-drag', 'rotate the section about the crosshairs'],
        ['Right and left drag together', 'zoom'],
        ['Shift and right-drag', 'zoom'],
        ['Middle-drag', 'pan'],
        ['Hover', 'read the HU under the cursor'],
        ['Double-click a pane', 'maximize or restore it'],
      ],
    },
    {
      pane: '3D pane',
      lines: [
        ['Left-drag', 'rotate the render'],
        ['Left-drag, Eraser on', 'erase what you touch'],
        ['Right-drag', 'cut into the render, up deeper, down back out'],
        ['Right and left drag together', 'zoom'],
        ['Wheel', 'zoom'],
        ['Middle-drag', 'pan'],
        ['Double-click', 'maximize or restore the pane'],
      ],
    },
  ],
  grid: [
    {
      pane: 'Scout',
      lines: [
        ['Left-click or left-drag', 'move the section window'],
        ['Right-drag', 'rotate the scout and the frame'],
        ['Wheel', 'step the window'],
      ],
    },
    {
      pane: 'Tiles',
      lines: [
        ['Right-drag', 'rotate in-plane about the tile'],
        ['Wheel', 'step the window'],
      ],
    },
    {
      pane: 'Divider',
      lines: [
        ['Drag', 'resize the scout'],
        ['Double-click', 'restore the width'],
      ],
    },
  ],
  pano: [
    {
      pane: 'Axial',
      lines: [
        ['Left stroke', 'draw the arch'],
        ['Left-click', 'add a dot'],
        ['Double-click', 'finish the dots as an arch (three or more)'],
        ['Left-drag a dot', 'move the dot'],
        ['Left-drag the arch', 'move the whole arch'],
        ['Right-click or double-click a dot', 'delete the dot'],
        ['Wheel', 'move the slice'],
      ],
    },
    {
      pane: 'Pano',
      lines: [
        ['Left-click', 'move the sections there'],
        ['Left-click, a trace active', 'add a trace point'],
        ['Left-drag, measure on', 'measure in mm'],
        ['Right-click', 'delete the nearest trace point or measurement'],
        ['Wheel', 'move the sections'],
      ],
    },
    {
      pane: 'Sections',
      lines: [
        ['Right-drag', 'tilt the fan'],
        ['Right-click', 'delete the nearest measurement'],
        ['Left-click, a trace active', 'set the canal point'],
        ['Left-drag, measure on', 'measure in mm'],
        ['Wheel', 'move the sections'],
      ],
    },
    RANGE_HANDLES,
  ],
  tmj: [
    {
      pane: 'Axial',
      lines: [
        ['Left-drag', 'draw an axis line, one per side'],
        ['Left-drag an end', 'move that end'],
        ['Left-drag a line', 'move the line'],
        ['Right-click a line', 'delete the line'],
        ['Wheel', 'move the slice'],
      ],
    },
    { pane: 'Tiles', lines: [['Right-drag', "tilt that side's fan"]] },
    RANGE_HANDLES,
  ],
  reslice: [
    {
      pane: 'Scout',
      lines: [
        ['Left-drag', 'draw a line'],
        ['Left-click', 'add a dot'],
        ['Double-click', 'finish the dots as a path (two or more)'],
        ['Left-drag a dot', 'move the dot'],
        ['Left-drag the path', 'move the whole path'],
        ['Right-click or double-click a dot', 'delete the dot'],
        ['Wheel', 'move the slice'],
      ],
    },
    { pane: 'Tiles', lines: [['Right-drag', 'tilt the stack']] },
    RANGE_HANDLES,
  ],
  ceph: [
    {
      pane: null,
      lines: [
        ['Horizontal drag', 'turn the projection (yaw)'],
        ['Vertical drag', 'nod the projection (pitch)'],
      ],
    },
  ],
  region: [
    {
      pane: 'Axial',
      lines: [
        ['Left-drag', 'draw a box'],
        ['Left-click', 'drop the seed'],
        ['Left-drag a corner', 'resize the box'],
        ['Left-drag inside the box', 'move the box'],
        ['Right-click', 'delete the box'],
        ['Wheel', 'move the slice'],
      ],
    },
    {
      pane: 'Divider',
      lines: [
        ['Drag', 'resize the two planes'],
        ['Double-click', 'split them evenly'],
      ],
    },
    RANGE_HANDLES,
  ],
  stitch: [{ pane: 'Any pane', lines: [['Wheel', 'step the compared slice']] }],
  xray: [
    {
      pane: null,
      lines: [
        ['Wheel', 'zoom about the cursor'],
        ['Left-drag', 'pan'],
        ['Double-click', 'fit the radiograph to the pane'],
      ],
    },
  ],
};

/**
 * The status line's legend: at most three short gestures of this mode, then the pointer to
 * the full list. MPR's left button follows the active tool (its label, or null for Crosshairs).
 */
export function statusLegend(mode: GestureMode, mprTool: string | null): string {
  const short: Record<GestureMode, string[]> = {
    mpr: [
      'Wheel: move the slice',
      mprTool === null ? 'Left-click: place the crosshairs' : `Left-drag: ${mprTool}`,
      'Right-drag: rotate the section',
    ],
    grid: ['Scout left-drag: move the window', 'Right-drag: rotate', 'Wheel: step'],
    pano: ['Axial stroke: draw the arch', 'Pano click: move the sections', 'Wheel: move the slice'],
    tmj: ['Axial drag: draw an axis line', 'Right-click: delete a line', 'Tile right-drag: tilt'],
    reslice: ['Scout drag: draw a line', 'Double-click: finish the dots', 'Tile right-drag: tilt'],
    ceph: ['Horizontal drag: turn', 'Vertical drag: nod'],
    region: ['Axial drag: draw a box', 'Click: drop the seed', 'Right-click: delete the box'],
    stitch: ['Wheel: step the slice'],
    xray: ['Wheel: zoom', 'Left-drag: pan', 'Double-click: fit'],
  };
  return `${short[mode].slice(0, 3).join('. ')}. All gestures: Keys.`;
}
