import { useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string, describedBy?: string) => ReactNode;
  className?: string;
}

export function Field({ label, hint, error, children, className = '' }: FieldProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children(id, hint || error ? hintId : undefined)}
      {(error || hint) && (
        <p id={hintId} className={error ? 'field__error' : 'field__hint'}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, hint, error, className, ...rest }: { label: string; hint?: ReactNode; error?: string | null } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!error || undefined} className="input" {...rest} />}
    </Field>
  );
}

export function TextArea({ label, hint, error, className, ...rest }: { label: string; hint?: ReactNode; error?: string | null } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id, d) => <textarea id={id} aria-describedby={d} className="input input--area" {...rest} />}
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id, d) => (
        <select id={id} aria-describedby={d} className="input input--select" value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Free-form list input (genres, tags, alternative titles). Enter or comma adds; suggestions appear as you type. */
export function ChipInput({
  label,
  values,
  onChange,
  suggestions = [],
  placeholder,
  hint,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  hint?: ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = (raw: string) => {
    const parts = raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setDraft('');
  };
  const matching = draft
    ? suggestions.filter((s) => s.toLowerCase().includes(draft.toLowerCase()) && !values.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8)
    : [];
  return (
    <Field label={label} hint={hint}>
      {(id, d) => (
        <div className="chip-input">
          {values.map((v) => (
            <span key={v} className="chip chip--removable">
              {v}
              <button type="button" className="chip__x" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
                <X size={12} strokeWidth={2} />
              </button>
            </span>
          ))}
          <input
            id={id}
            aria-describedby={d}
            className="chip-input__field"
            value={draft}
            list={matching.length ? listId : undefined}
            placeholder={values.length ? '' : placeholder}
            onChange={(e) => {
              const v = e.target.value;
              if (/[,;]$/.test(v)) add(v);
              else setDraft(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(draft);
              } else if (e.key === 'Backspace' && !draft && values.length) {
                onChange(values.slice(0, -1));
              }
            }}
            onBlur={() => add(draft)}
          />
          <datalist id={listId}>
            {matching.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      )}
    </Field>
  );
}

export function Switch({ checked, onChange, label, hint, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; id?: string }) {
  const auto = useId();
  const sid = id ?? auto;
  return (
    <div className="switch-row">
      <div className="switch-row__text">
        <label htmlFor={sid} className="switch-row__label">
          {label}
        </label>
        {hint && <p className="switch-row__hint">{hint}</p>}
      </div>
      <button id={sid} type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const indicator = useSlidingIndicator(ref, '.segmented__opt.is-on', [value, options.length]);
  return (
    <div ref={ref} className={`segmented ${className}`} role="radiogroup" aria-label={label}>
      <span className="slider-indicator segmented__thumb" style={indicator} aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          className={`segmented__opt ${value === o.value ? 'is-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Position an indicator over the active child of `container` (for sliding tab/segment highlights). */
export function useSlidingIndicator(container: React.RefObject<HTMLElement | null>, activeSelector: string, deps: unknown[]): React.CSSProperties {
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const c = container.current;
      const el = c?.querySelector<HTMLElement>(activeSelector);
      if (!c || !el) return setStyle({ opacity: 0 });
      setStyle({ width: el.offsetWidth, height: el.offsetHeight, transform: `translate(${el.offsetLeft}px, ${el.offsetTop}px)`, opacity: 1 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (container.current) ro.observe(container.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return style;
}

export function Stepper({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const id = useId();
  return (
    <div className="stepper">
      <label className="stepper__label" htmlFor={id}>
        {label}
      </label>
      <div className="stepper__control">
        <button type="button" className="stepper__btn" aria-label={`Decrease ${label.toLowerCase()}`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
          −
        </button>
        <input
          id={id}
          type="range"
          className="stepper__range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          aria-valuetext={format ? format(value) : String(value)}
        />
        <button type="button" className="stepper__btn" aria-label={`Increase ${label.toLowerCase()}`} onClick={() => onChange(clamp(value + step))} disabled={value >= max}>
          +
        </button>
        <output className="stepper__value" htmlFor={id}>
          {format ? format(value) : value}
        </output>
      </div>
    </div>
  );
}
