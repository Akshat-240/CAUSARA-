import React from 'react';

export type NavigationTab =
  | 'overview'
  | 'orders'
  | 'timeline'
  | 'evidence'
  | 'delay-analysis'
  | 'interventions'
  | 'scenarios'
  | 'decisions'
  | 'verification';

interface SidebarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

interface NavItem {
  key: NavigationTab;
  label: string;
  icon: string;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'orders', label: 'Orders', icon: '📦' },
  { key: 'timeline', label: 'Order Timeline', icon: '⏱️' },
  { key: 'evidence', label: 'Evidence', icon: '📁' },
  { key: 'delay-analysis', label: 'Delay Analysis', icon: '🔍' },
  { key: 'interventions', label: 'Interventions', icon: '💡' },
  { key: 'scenarios', label: 'Scenario Simulator', icon: '⚙️' },
  { key: 'decisions', label: 'Decisions', icon: '⚖️' },
  { key: 'verification', label: 'Verification', icon: '✅' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  mobileOpen = false,
  onCloseMobile,
}) => {
  const handleItemClick = (key: NavigationTab) => {
    onSelectTab(key);
    if (onCloseMobile) {
      onCloseMobile();
    }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          onClick={onCloseMobile}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(33, 29, 26, 0.6)',
            backdropFilter: 'blur(2px)',
            zIndex: 89,
          }}
          aria-hidden="true"
        />
      )}

      <aside
        style={{
          width: 'var(--sidebar-width)',
          backgroundColor: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          position: 'sticky',
          top: 0,
          zIndex: 90,
          transition: 'transform 0.25s ease, background-color 0.2s ease',
          ...(mobileOpen
            ? {
                position: 'fixed',
                left: 0,
                transform: 'translateX(0)',
              }
            : {}),
        }}
        className={mobileOpen ? 'sidebar-mobile-open' : 'sidebar-desktop'}
      >
        <div
          style={{
            padding: '20px 20px',
            borderBottom: '1px solid var(--sidebar-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <img
              src="/assets/causara-logo-dark.svg"
              alt="Causara"
              style={{ height: '28px', width: 'auto', display: 'block' }}
            />
            <div style={{ fontSize: '0.685rem', color: 'var(--sidebar-text-muted)' }}>
              Logistics Intelligence
            </div>
          </div>
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--sidebar-text-muted)',
                fontSize: '1.25rem',
                cursor: 'pointer',
                display: 'none',
                padding: '4px',
              }}
              className="sidebar-close-btn"
              aria-label="Close navigation"
            >
              &times;
            </button>
          )}
        </div>

        <nav style={{ padding: '16px 12px', flex: 1, overflowY: 'auto' }}>
          <div
            style={{
              fontSize: '0.675rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--sidebar-text-muted)',
              padding: '4px 12px 10px',
            }}
          >
            Intelligence Navigation
          </div>

          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.key;
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item.key)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '9px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: 'none',
                      backgroundColor: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
                      color: isActive ? 'var(--sidebar-active-text)' : 'var(--sidebar-text)',
                      fontSize: '0.85rem',
                      fontWeight: isActive ? 600 : 500,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.12s ease',
                      position: 'relative',
                      outline: 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'var(--sidebar-hover-bg)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.boxShadow = 'var(--focus-ring)';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    {isActive && (
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '6px',
                          bottom: '6px',
                          width: '3px',
                          borderRadius: '0 2px 2px 0',
                          backgroundColor: 'var(--primary)',
                        }}
                      />
                    )}
                    <span style={{ fontSize: '1rem', width: '20px', textAlign: 'center' }}>
                      {item.icon}
                    </span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div
          style={{
            padding: '16px',
            borderTop: '1px solid var(--sidebar-border)',
            backgroundColor: 'rgba(0, 0, 0, 0.15)',
            fontSize: '0.725rem',
            color: 'var(--sidebar-text-muted)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--sidebar-text)' }}>Causara Enterprise</div>
          <div>Porcelain & Terracotta 1.0</div>
        </div>
      </aside>
    </>
  );
};
