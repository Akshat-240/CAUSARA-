import React from 'react';

export type AlertType = 'info' | 'success' | 'warning' | 'error' | 'epistemology';

interface AlertProps {
  type?: AlertType;
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  style?: React.CSSProperties;
}

export const Alert: React.FC<AlertProps> = ({
  type = 'info',
  title,
  children,
  onClose,
  style,
}) => {
  const getStyles = () => {
    switch (type) {
      case 'success':
        return { bg: 'var(--status-green-bg)', border: 'var(--status-green-border)', text: 'var(--status-green)' };
      case 'warning':
        return { bg: 'var(--status-amber-bg)', border: 'var(--status-amber-border)', text: '#b45309' };
      case 'error':
        return { bg: 'var(--status-red-bg)', border: 'var(--status-red-border)', text: 'var(--status-red)' };
      case 'epistemology':
        return { bg: '#faf5ff', border: '#e9d5ff', text: '#6b21a8' };
      case 'info':
      default:
        return { bg: 'var(--status-blue-bg)', border: 'var(--status-blue-border)', text: 'var(--status-blue)' };
    }
  };

  const colors = getStyles();

  return (
    <div
      style={{
        padding: '12px 16px',
        backgroundColor: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 'var(--radius-md)',
        color: 'var(--text-main)',
        fontSize: '0.85rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        marginBottom: '16px',
        ...style,
      }}
      role="alert"
    >
      <div style={{ flex: 1 }}>
        {title && (
          <div style={{ fontWeight: 600, color: colors.text, marginBottom: '4px' }}>
            {title}
          </div>
        )}
        <div style={{ color: 'var(--text-main)', lineHeight: 1.4 }}>{children}</div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: colors.text,
            cursor: 'pointer',
            fontSize: '1rem',
            padding: 0,
            lineHeight: 1,
          }}
          aria-label="Dismiss alert"
        >
          &times;
        </button>
      )}
    </div>
  );
};
