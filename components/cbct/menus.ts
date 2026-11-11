'use client';
// The shell's menus, popovers and dialogues behave one way: Escape closes a menu or popover
// and gives focus back to its button; a press anywhere outside it closes it, the image
// included (a capture-phase pointerdown, so a canvas that swallows its mouse events still
// counts); arrow keys move through a menu's items; a menu stays inside the viewport; and Tab
// stays inside an open dialogue.
import React, { useEffect, useLayoutEffect } from 'react';

/** close an open menu or popover on Escape and on a press outside `ref` */
export function useDismiss(
  open: boolean,
  close: () => void,
  ref: React.RefObject<HTMLElement | null>,
  opts: { keepOpen?: (e: Event) => boolean } = {},
): void {
  const { keepOpen } = opts;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      if (keepOpen?.(e)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || keepOpen?.(e)) return;
      const inside = ref.current?.contains(document.activeElement);
      close();
      // focus returns to the button that opened it, so the keyboard reader keeps their place
      if (inside) ref.current?.querySelector<HTMLElement>('[aria-expanded]')?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, ref, keepOpen]);
}

const ITEMS = '[role="menuitem"]';

/** arrow keys, Home and End move focus through the menu's items */
export function onMenuKeyDown(e: React.KeyboardEvent<HTMLElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(ITEMS));
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? items.length - 1
        : e.key === 'ArrowDown'
          ? (at + 1) % items.length
          : (at - 1 + items.length) % items.length;
  items[next].focus();
}

/** a menu button's own keys: ArrowDown opens the menu and moves into its first item */
export function onMenuButtonKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
  open: boolean,
  setOpen: (v: boolean) => void,
  panel: React.RefObject<HTMLElement | null>,
): void {
  if (e.key !== 'ArrowDown') return;
  e.preventDefault();
  if (!open) setOpen(true);
  requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(ITEMS)?.focus());
}

/** shift an open panel sideways so it stays inside the viewport, 8 px from either edge */
export function useKeepInViewport(open: boolean, panel: React.RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    const fit = () => {
      el.style.transform = '';
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      let dx = 0;
      if (r.right > vw - 8) dx = vw - 8 - r.right;
      if (r.left + dx < 8) dx = 8 - r.left;
      if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, panel]);
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift-Tab cycle inside the open dialogue; focus that strays outside comes back */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const box = ref.current;
      if (!box) return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !box.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [ref]);
}
