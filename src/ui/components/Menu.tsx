import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
}

/** A popover menu anchored to its trigger. Arrow keys move, Escape closes. */
export function Menu({
  trigger,
  items,
  align = 'end',
  label,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  items: (MenuItem | 'divider')[];
  align?: 'start' | 'end';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !menu.current) return;
    const r = anchor.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = align === 'end' ? r.right - m.width : r.left;
    left = Math.max(8, Math.min(vw - m.width - 8, left));
    let top = r.bottom + 6;
    if (top + m.height > vh - 8 && r.top - m.height - 6 > 8) top = r.top - m.height - 6;
    setPos({ top, left, maxH: vh - top - 12 });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])');
    first?.focus();
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        anchor.current?.querySelector<HTMLElement>('button')?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
        const i = els.indexOf(document.activeElement as HTMLElement);
        els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', () => setOpen(false), { once: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <span ref={anchor} className="menu-anchor">
        {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      </span>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="menu"
            role="menu"
            aria-label={label}
            style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxH } : { visibility: 'hidden', top: 0, left: 0 }}
          >
            {items.map((it, i) =>
              it === 'divider' ? (
                <div key={i} className="menu__divider" role="separator" />
              ) : (
                <button
                  key={i}
                  type="button"
                  role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={it.checked}
                  disabled={it.disabled}
                  className={`menu__item ${it.danger ? 'is-danger' : ''}`}
                  onClick={() => {
                    setOpen(false);
                    it.onSelect();
                  }}
                >
                  {it.icon && <it.icon size={17} strokeWidth={1.75} aria-hidden />}
                  <span>{it.label}</span>
                  {it.checked && <span className="menu__check" aria-hidden>✓</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
