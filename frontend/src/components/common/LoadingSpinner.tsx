import React from 'react';

interface LoadingSpinnerProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Loading data...',
  size = 'md',
}) => {
  const dim = size === 'sm' ? '18px' : size === 'lg' ? '36px' : '26px';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        gap: '12px',
        color: 'var(--text-muted)',
        fontSize: '0.875rem',
      }}
    >
      <div
        style={{
          width: dim,
          height: dim,
          border: '3px solid #e2e8f0',
          borderTopColor: 'var(--primary)',
          borderRadius: '50%',
          animation: 'spin 0.75s linear infinite',
        }}
        aria-hidden="true"
      />
      {message && <span>{message}</span>}
    </div>
  );
};
