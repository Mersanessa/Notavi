import { useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { IconButton } from './Button';

/**
 * Drag-to-reorder list that works with touch, pen and mouse (pointer events),
 * plus up/down buttons for keyboard and precise moves.
 */
export function ReorderList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  label,
}: {
  items: T[];
  onReorder: (ids: string[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  label: (item: T) => string;
}) {
  const [drag, setDrag] = useState<{ id: string; from: number; over: number; dy: number } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const startY = useRef(0);
  const rowH = useRef(56);

  const order = (() => {
    if (!drag) return items;
    const next = [...items];
    const [x] = next.splice(drag.from, 1);
    next.splice(drag.over, 0, x);
    return next;
  })();

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const ids = items.map((i) => i.id);
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x);
    onReorder(ids);
  };

  const onPointerDown = (e: React.PointerEvent, id: string, index: number) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const row = (e.target as Element).closest('li');
    rowH.current = row?.getBoundingClientRect().height || 56;
    startY.current = e.clientY;
    setDrag({ id, from: index, over: index, dy: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dy = e.clientY - startY.current;
    const over = Math.max(0, Math.min(items.length - 1, drag.from + Math.round(dy / rowH.current)));
    setDrag({ ...drag, dy, over });
    // Auto-scroll near the edges.
    const vh = window.innerHeight;
    if (e.clientY < 80) window.scrollBy(0, -12);
    else if (e.clientY > vh - 80) window.scrollBy(0, 12);
  };
  const onPointerUp = () => {
    if (drag && drag.over !== drag.from) move(drag.from, drag.over);
    setDrag(null);
  };

  return (
    <ol className={`reorder ${drag ? 'is-dragging' : ''}`} ref={listRef}>
      {order.map((item, i) => {
        const isDragged = drag?.id === item.id;
        const realIndex = items.findIndex((x) => x.id === item.id);
        return (
          <li key={item.id} className={`reorder__row ${isDragged ? 'is-dragged' : ''}`}>
            <button
              type="button"
              className="reorder__handle"
              aria-label={`Drag to reorder ${label(item)}`}
              onPointerDown={(e) => onPointerDown(e, item.id, realIndex)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
            >
              <GripVertical size={18} aria-hidden />
            </button>
            <div className="reorder__content">{renderItem(item, i)}</div>
            <IconButton icon={ArrowUp} size="sm" label={`Move ${label(item)} up`} disabled={realIndex === 0} onClick={() => move(realIndex, realIndex - 1)} />
            <IconButton icon={ArrowDown} size="sm" label={`Move ${label(item)} down`} disabled={realIndex === items.length - 1} onClick={() => move(realIndex, realIndex + 1)} />
          </li>
        );
      })}
    </ol>
  );
}
