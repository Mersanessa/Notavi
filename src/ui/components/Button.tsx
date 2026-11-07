import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  busy?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, busy, children, className = '', type = 'button', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`btn btn--${variant} btn--${size} ${busy ? 'is-busy' : ''} ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {Icon && <Icon className="btn__icon" aria-hidden size={size === 'sm' ? 16 : 18} strokeWidth={1.75} />}
      {children && <span className="btn__label">{children}</span>}
      {IconRight && <IconRight className="btn__icon" aria-hidden size={size === 'sm' ? 16 : 18} strokeWidth={1.75} />}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'brass' | 'danger' | 'heart';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, active, size = 'md', tone = 'default', className = '', type = 'button', ...rest },
  ref,
) {
  const px = size === 'sm' ? 16 : size === 'lg' ? 22 : 20;
  return (
    <button
      ref={ref}
      type={type}
      className={`icon-btn icon-btn--${size} icon-btn--${tone} ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      {...rest}
    >
      <Icon size={px} strokeWidth={1.75} aria-hidden fill={active && tone === 'heart' ? 'currentColor' : 'none'} />
    </button>
  );
});
