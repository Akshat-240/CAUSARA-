import React from 'react';
import { HealthData, DemoActor, AuthUser } from '../../types/api';

interface HeaderProps {
  health: HealthData | null;
  healthLoading: boolean;
  healthError: string | null;
  actors: DemoActor[];
  actorsLoading?: boolean;
  activeActor: DemoActor | null;
  onActorChange: (actor: DemoActor) => void;
  currentUser?: AuthUser | null;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  healthLoading,
  healthError,
  actors,
  actorsLoading = false,
  activeActor,
  onActorChange,
  currentUser,
  onLogout,
}) => {
  return (
    <header
      style={{
        height: 'var(--header-height)',
        backgroundColor: '#ffffff',
        borderBottom: '1px solid var(--border-color)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div>
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--text-main)',
              lineHeight: 1.1,
            }}
          >
            Caus<span style={{ color: 'var(--primary)' }}>ara</span>
          </h1>
          <p
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            Explainable Order Delay Intelligence & Intervention Analysis Platform
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Backend Connectivity Indicator reflecting live health and database connection */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.775rem',
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            backgroundColor: healthLoading
              ? '#fffbeb'
              : healthError
              ? '#fef2f2'
              : '#f0fdf4',
            color: healthLoading
              ? '#d97706'
              : healthError
              ? '#dc2626'
              : '#16a34a',
            border: `1px solid ${
              healthLoading ? '#fde68a' : healthError ? '#fecaca' : '#bbf7d0'
            }`,
          }}
          title={
            healthError
              ? `Backend Connection Error: ${healthError}`
              : health
              ? `${health.service} v${health.version} (${health.environment}) • Database: ${health.database || 'connected'}`
              : 'Probing backend health...'
          }
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: 'currentColor',
            }}
          />
          <span>
            {healthLoading
              ? 'Checking...'
              : healthError
              ? 'Disconnected'
              : 'Operational'}
          </span>
          {health && (
            <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>
              {health.service}
            </span>
          )}
        </div>

        {/* Demo Mode Actor Switcher dynamically populated from backend API */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 12px',
            backgroundColor: '#f1f5f9',
            borderRadius: 'var(--radius-md)',
            border: '1px solid #cbd5e1',
            fontSize: '0.775rem',
          }}
        >
          <span
            style={{
              fontSize: '0.675rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: '#475569',
              backgroundColor: '#e2e8f0',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
          >
            Demo Mode
          </span>
          <select
            value={activeActor?.id ?? ''}
            onChange={(e) => {
              const selectedId = parseInt(e.target.value, 10);
              const selected = actors.find((a) => a.id === selectedId);
              if (selected) onActorChange(selected);
            }}
            style={{
              border: 'none',
              backgroundColor: 'transparent',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--text-main)',
              cursor: 'pointer',
              outline: 'none',
            }}
            aria-label="Select Demo Actor"
            disabled={actorsLoading || actors.length === 0}
          >
            {actors.length === 0 ? (
              <option value="">{actorsLoading ? 'Loading actors...' : 'No actors available'}</option>
            ) : (
              actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.label}
                </option>
              ))
            )}
          </select>
        </div>

        {/* Current Authenticated User Badge & Sign Out Button */}
        {currentUser && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '4px 12px',
              backgroundColor: '#f8fafc',
              borderRadius: 'var(--radius-md)',
              border: '1px solid #e2e8f0',
              fontSize: '0.8rem',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.75rem',
              }}
              title={currentUser.email}
            >
              {currentUser.full_name ? currentUser.full_name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-main)', lineHeight: 1.2 }}>
                {currentUser.full_name}
              </span>
              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  color: 'var(--primary)',
                  letterSpacing: '0.04em',
                }}
              >
                {currentUser.role}
                {currentUser.business_name ? ` • ${currentUser.business_name}` : ''}
              </span>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                style={{
                  marginLeft: '6px',
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#dc2626',
                  backgroundColor: '#fee2e2',
                  border: '1px solid #fecaca',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'background-color 0.15s ease',
                }}
                title="Sign out of Causara workspace"
              >
                Sign Out
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
