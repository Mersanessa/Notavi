import { useState } from 'react';
import { Star } from 'lucide-react';

/** Your rating, 1–5 stars. Tap the current rating again to clear it. Arrow keys work too. */
export function StarRating({ value, onChange, size = 22 }: { value: number; onChange: (v: number) => void; size?: number }) {
  const [hover, setHover] = useState(0);
  const [popped, setPopped] = useState(0);
  const shown = hover || value;
  const set = (v: number) => {
    const next = v === value ? 0 : v;
    onChange(next);
    setPopped(next);
  };
  return (
    <div
      className="stars"
      role="radiogroup"
      aria-label="Your rating"
      onPointerLeave={() => setHover(0)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') (e.preventDefault(), set(Math.min(5, value + 1)));
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') (e.preventDefault(), onChange(Math.max(0, value - 1)));
      }}
      data-testid="stars"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
          tabIndex={(value || 1) === n ? 0 : -1}
          className={`stars__star ${n <= shown ? 'is-on' : ''} ${hover && n <= hover ? 'is-hover' : ''} ${popped && n <= popped ? 'is-pop' : ''}`}
          style={{ '--i': n } as React.CSSProperties}
          onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(n)}
          onClick={() => set(n)}
          onAnimationEnd={() => n === popped && setPopped(0)}
        >
          <Star size={size} aria-hidden />
        </button>
      ))}
      {value > 0 && <span className="stars__label">{['', 'Not for me', 'It was all right', 'Liked it', 'Really liked it', 'Loved it'][value]}</span>}
    </div>
  );
}

/** Read-only stars for lists. */
export function StarsShown({ value }: { value: number }) {
  if (!value) return null;
  return (
    <span className="stars-shown" aria-label={`Rated ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={12} aria-hidden className={n <= value ? 'is-on' : ''} />
      ))}
    </span>
  );
}
