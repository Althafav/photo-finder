import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { Aperture } from 'lucide-react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110',
  secondary: 'bg-surface-2 text-fg border border-line hover:border-muted',
  ghost: 'text-fg hover:bg-surface-2',
  danger: 'text-danger hover:bg-danger/10',
};

export function buttonClass(variant: Variant = 'primary', extra?: string) {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-full px-4 h-10 text-sm font-medium transition',
    'disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    variants[variant],
    extra,
  );
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'w-full h-11 rounded-xl bg-surface border border-line px-3.5 text-sm text-fg placeholder:text-muted/70',
        'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition',
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl bg-surface border border-line', className)}>{children}</div>;
}

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-medium tracking-tight">
      <Aperture className="size-5 text-accent" strokeWidth={2.2} />
      <span>Event Photos</span>
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx('inline-block size-4 rounded-full border-2 border-current border-r-transparent animate-spin', className)}
      aria-hidden
    />
  );
}

export { cx };
