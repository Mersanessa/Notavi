import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useStore } from '../../app/store';
import type { ReadingStatus } from '../../data/model';
import { statusLabel } from '../../data/model';

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon className="empty__icon" size={28} strokeWidth={1.5} aria-hidden />
      <h3 className="empty__title">{title}</h3>
      {children && <div className="empty__body">{children}</div>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

/** The brass ribbon: progress through a novel or chapter. */
export function Ribbon({ value, label, className = '' }: { value: number; label?: string; className?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={`ribbon ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label ?? 'Progress'}>
      <div className="ribbon__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatusBadge({ status }: { status: ReadingStatus }) {
  return <span className={`status status--${status}`}>{statusLabel(status)}</span>;
}

export function SectionHeader({ title, action, id }: { title: string; action?: ReactNode; id?: string }) {
  return (
    <div className="section-head">
      <h2 className="section-head__title" id={id}>
        {title}
      </h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, children, lead, back }: { title: ReactNode; children?: ReactNode; lead?: ReactNode; back?: ReactNode }) {
  return (
    <header className="page-head">
      {back}
      <div className="page-head__row">
        <h1 className="page-head__title">{title}</h1>
        {children && <div className="page-head__actions">{children}</div>}
      </div>
      {lead && <p className="page-head__lead">{lead}</p>}
    </header>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone ?? 'default'}`}>
          {t.tone === 'error' && <CircleAlert size={18} aria-hidden />}
          {t.tone === 'success' && <CircleCheck size={18} aria-hidden />}
          <span className="toast__msg">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast__x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Chip({ children, active, onClick, title }: { children: ReactNode; active?: boolean; onClick?: () => void; title?: string }) {
  if (!onClick) return <span className="chip">{children}</span>;
  return (
    <button type="button" className={`chip chip--button ${active ? 'is-on' : ''}`} aria-pressed={active} onClick={onClick} title={title}>
      {children}
    </button>
  );
}
