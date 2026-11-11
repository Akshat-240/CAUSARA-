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

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab }) => {
  return (
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
      }}
    >
      <div
        style={{
          padding: '24px 20px',
          borderBottom: '1px solid var(--sidebar-border)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <span style={{ fontSize: '1.4rem' }}>⚡</span>
        <div>
          <div
            style={{
              fontSize: '1.15rem',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '-0.02em',
            }}
          >
            Causara
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--sidebar-text-muted)' }}>
            Logistics Intelligence
          </div>
        </div>
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
          Navigation
        </div>

        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onSelectTab(item.key)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 14px',
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
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'var(--sidebar-hover-bg)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {isActive && (
                    <span
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: '8px',
                        bottom: '8px',
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
          backgroundColor: '#090d16',
          fontSize: '0.725rem',
          color: 'var(--sidebar-text-muted)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <div style={{ fontWeight: 600, color: '#e2e8f0' }}>Causara Enterprise MVP</div>
        <div>Built for Explainable Logistics</div>
      </div>
    </aside>
  );
};
