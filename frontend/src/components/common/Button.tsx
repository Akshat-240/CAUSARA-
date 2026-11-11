import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  style,
  ...props
}) => {
  const getStyles = (): React.CSSProperties => {
    let bg = 'var(--primary)';
    let color = '#ffffff';
    let border = '1px solid var(--primary)';

    if (variant === 'secondary') {
      bg = '#f1f5f9';
      color = '#0f172a';
      border = '1px solid #e2e8f0';
    } else if (variant === 'outline') {
      bg = 'transparent';
      color = 'var(--primary)';
      border = '1px solid var(--primary-border)';
    } else if (variant === 'danger') {
      bg = '#dc2626';
      color = '#ffffff';
      border = '1px solid #dc2626';
    } else if (variant === 'ghost') {
      bg = 'transparent';
      color = 'var(--text-muted)';
      border = '1px solid transparent';
    }

    const padding = size === 'sm' ? '6px 12px' : size === 'lg' ? '12px 24px' : '8px 16px';
    const fontSize = size === 'sm' ? '0.8rem' : size === 'lg' ? '1rem' : '0.875rem';

    return {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      padding,
      fontSize,
      fontWeight: 500,
      borderRadius: 'var(--radius-md)',
      backgroundColor: bg,
      color,
      border,
      cursor: disabled || loading ? 'not-allowed' : 'pointer',
      opacity: disabled || loading ? 0.65 : 1,
      transition: 'all 0.15s ease',
      whiteSpace: 'nowrap',
      ...style,
    };
  };

  return (
    <button
      {...props}
      disabled={disabled || loading}
      style={getStyles()}
    >
      {loading && (
        <span
          style={{
            width: '14px',
            height: '14px',
            border: '2px solid currentColor',
            borderRightColor: 'transparent',
            borderRadius: '50%',
            display: 'inline-block',
            animation: 'spin 0.75s linear infinite',
          }}
          aria-hidden="true"
        />
      )}
      {!loading && icon}
      {children}
    </button>
  );
};
