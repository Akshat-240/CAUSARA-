import React from 'react';
import { HealthData, DemoActor, AuthUser } from '../../types/api';
import { ThemeToggle } from '../common/ThemeToggle';
import { useTheme } from '../../context/ThemeContext';

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
  onToggleMobileMenu?: () => void;
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
  onToggleMobileMenu,
}) => {
  const { theme } = useTheme();
  const logoSrc = theme === 'dark' ? '/assets/causara-logo-dark.svg' : '/assets/causara-logo-light.svg';
  return (
    <header
      style={{
        height: 'var(--header-height)',
        backgroundColor: 'var(--header-bg)',
        borderBottom: '1px solid var(--header-border)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 80,
        boxShadow: 'var(--shadow-sm)',
        transition: 'background-color 0.2s ease, border-color 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {onToggleMobileMenu && (
          <button
            type="button"
            onClick={onToggleMobileMenu}
            aria-label="Toggle navigation menu"
            style={{
              display: 'none',
              background: 'none',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 8px',
              color: 'var(--text-main)',
              cursor: 'pointer',
            }}
            className="mobile-menu-trigger"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img
            src={logoSrc}
            alt="Causara"
            style={{ height: '26px', width: 'auto', display: 'block' }}
          />
          <h1 style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', border: 0 }}>
            Causara
          </h1>
          <p
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              borderLeft: '1px solid var(--border-color)',
              paddingLeft: '12px',
            }}
            className="header-tagline"
          >
            Explainable Order Delay Intelligence & Intervention Analysis Platform
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        {/* Backend Connectivity Indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.775rem',
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            backgroundColor: healthLoading
              ? 'var(--status-amber-bg)'
              : healthError
              ? 'var(--status-red-bg)'
              : 'var(--status-green-bg)',
            color: healthLoading
              ? 'var(--status-amber)'
              : healthError
              ? 'var(--status-red)'
              : 'var(--status-green)',
            border: `1px solid ${
              healthLoading
                ? 'var(--status-amber-border)'
                : healthError
                ? 'var(--status-red-border)'
                : 'var(--status-green-border)'
            }`,
            transition: 'all 0.2s ease',
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

        {/* Theme Toggle Button */}
        <ThemeToggle />

        {/* Demo Mode Actor Switcher dynamically populated from backend API */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 10px',
            backgroundColor: 'var(--bg-surface-subtle)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            fontSize: '0.775rem',
          }}
        >
          <span
            style={{
              fontSize: '0.675rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--primary)',
              backgroundColor: 'var(--primary-subtle)',
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
              padding: 0,
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
              padding: '4px 10px',
              backgroundColor: 'var(--bg-surface-subtle)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              fontSize: '0.8rem',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: 'var(--primary)',
                color: 'var(--text-inverse)',
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
                  marginLeft: '4px',
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--status-red)',
                  backgroundColor: 'var(--status-red-bg)',
                  border: '1px solid var(--status-red-border)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.15s ease',
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
