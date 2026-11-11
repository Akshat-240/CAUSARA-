import React from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  icon,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 24px',
        textAlign: 'center',
        backgroundColor: '#ffffff',
        borderRadius: 'var(--radius-lg)',
        border: '1px dashed var(--border-color)',
        maxWidth: '560px',
        margin: '24px auto',
      }}
    >
      {icon && (
        <div
          style={{
            fontSize: '2.5rem',
            marginBottom: '16px',
            color: 'var(--text-light)',
          }}
        >
          {icon}
        </div>
      )}
      <h3
        style={{
          fontSize: '1.1rem',
          fontWeight: 600,
          color: 'var(--text-main)',
          marginBottom: '8px',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: '0.875rem',
          color: 'var(--text-muted)',
          maxWidth: '400px',
          marginBottom: actionLabel ? '20px' : '0',
          lineHeight: 1.5,
        }}
      >
        {description}
      </p>
      {actionLabel && onAction && (
        <Button onClick={onAction} variant="primary">
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
