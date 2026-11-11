import React from 'react';

export type BadgeVariant =
  | 'green'
  | 'blue'
  | 'amber'
  | 'red'
  | 'gray'
  | 'purple'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'gray',
  size = 'md',
  dot = false,
}) => {
  const getColors = (): { bg: string; text: string; border: string } => {
    switch (variant) {
      case 'green':
      case 'success':
        return { bg: 'var(--status-green-bg)', text: 'var(--status-green)', border: 'var(--status-green-border)' };
      case 'blue':
      case 'info':
        return { bg: 'var(--status-blue-bg)', text: 'var(--status-blue)', border: 'var(--status-blue-border)' };
      case 'amber':
      case 'warning':
        return { bg: 'var(--status-amber-bg)', text: 'var(--status-amber)', border: 'var(--status-amber-border)' };
      case 'red':
      case 'danger':
        return { bg: 'var(--status-red-bg)', text: 'var(--status-red)', border: 'var(--status-red-border)' };
      case 'purple':
        return { bg: '#faf5ff', text: '#9333ea', border: '#e9d5ff' };
      case 'gray':
      case 'neutral':
      default:
        return { bg: 'var(--status-gray-bg)', text: 'var(--status-gray)', border: 'var(--status-gray-border)' };
    }
  };

  const colors = getColors();
  const padding = size === 'sm' ? '2px 8px' : '4px 10px';
  const fontSize = size === 'sm' ? '0.725rem' : '0.8rem';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding,
        fontSize,
        fontWeight: 600,
        borderRadius: 'var(--radius-full)',
        backgroundColor: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        lineHeight: 1.2,
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: colors.text,
          }}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
};

export interface EpistemologyBadgeProps {
  type: 'FACT' | 'VARIANCE' | 'HYPOTHESIS' | 'ESTIMATE';
}

export const EpistemologyBadge: React.FC<EpistemologyBadgeProps> = ({ type }) => {
  let variant: BadgeVariant = 'gray';
  if (type === 'FACT') variant = 'green';
  else if (type === 'VARIANCE') variant = 'purple';
  else if (type === 'HYPOTHESIS') variant = 'amber';
  else if (type === 'ESTIMATE') variant = 'blue';

  return <Badge label={type} variant={variant} size="sm" />;
};

export function getStatusBadgeVariant(status: string): BadgeVariant {
  switch (status.toUpperCase()) {
    case 'DELIVERED':
    case 'COMPLETED':
    case 'APPROVED':
    case 'VALID':
    case 'READY':
    case 'ACTIVE':
    case 'FACT':
      return 'green';
    case 'PROCESSING':
    case 'IN_TRANSIT':
    case 'DISPATCHED':
    case 'IN_PROGRESS':
    case 'ANALYZING':
    case 'LOW':
      return 'blue';
    case 'PLACED':
    case 'PENDING':
    case 'PENDING_APPROVAL':
    case 'PENDING_UPLOAD':
    case 'PENDING_PERSISTENCE':
    case 'MEDIUM':
    case 'HYPOTHESIS':
      return 'amber';
    case 'DELAYED':
    case 'CANCELLED':
    case 'REJECTED':
    case 'FAILED':
    case 'CONFLICT':
    case 'HIGH':
      return 'red';
    case 'ESTIMATE':
    case 'SKIPPED':
    case 'OUT_OF_ORDER':
    case 'DUPLICATE':
    default:
      return 'gray';
  }
}
