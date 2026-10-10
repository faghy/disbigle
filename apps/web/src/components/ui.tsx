import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
} from 'react';

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover border-transparent',
  secondary: 'bg-surface text-fg border-border-strong hover:bg-surface-muted',
  ghost: 'bg-transparent text-fg border-transparent hover:bg-surface-muted',
  danger: 'bg-surface text-danger border-danger/50 hover:bg-danger-soft',
};

export const buttonClass = (variant: ButtonVariant = 'primary', extra?: string) =>
  cx(
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2',
    'text-sm font-medium transition-colors focus-ring',
    'disabled:cursor-not-allowed disabled:opacity-60',
    buttonVariants[variant],
    extra,
  );

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent',
        className,
      )}
    />
  );
}

interface FieldShellProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}

function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
}

export function TextField({ label, hint, error, className, ...props }: TextFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        className={cx('input-base', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      />
    </FieldShell>
  );
}

export interface TextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
}

export function TextAreaField({ label, hint, error, className, ...props }: TextAreaFieldProps) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        className={cx('input-base min-h-24 resize-y', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...props}
      />
    </FieldShell>
  );
}

export interface CheckboxFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
}

export function CheckboxField({ label, hint, error, ...props }: CheckboxFieldProps) {
  const id = useId();
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded accent-accent focus-ring"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          {...props}
        />
        <label htmlFor={id} className="cursor-pointer text-sm">
          {label}
        </label>
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="pl-8 text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="pl-8 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Announces messages to assistive technology. Errors use `role="alert"`, confirmations
 * `role="status"`; the region renders nothing visible when there is no message.
 */
export function Alert({
  tone = 'error',
  children,
  className,
}: {
  tone?: 'error' | 'success' | 'info';
  children?: ReactNode;
  className?: string;
}) {
  const styles = {
    error: 'border-danger/40 bg-danger-soft text-danger',
    success: 'border-success/40 bg-success-soft text-success',
    info: 'border-border bg-surface-muted text-fg',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      {children ? (
        <div className={cx('rounded-lg border px-4 py-3 text-sm', styles, className)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Card({
  children,
  className,
  as: Tag = 'section',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
  'aria-labelledby'?: string;
}) {
  return (
    <Tag
      className={cx('rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function PageTitle({
  children,
  description,
}: {
  children: ReactNode;
  description?: ReactNode;
}) {
  return (
    <header className="mb-6 space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {description && <p className="text-fg-muted">{description}</p>}
    </header>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-fg-muted" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}
