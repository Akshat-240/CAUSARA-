import React, { useState } from 'react';
import { Header } from './Header';
import { Sidebar, NavigationTab } from './Sidebar';
import { HealthData, DemoActor, AuthUser } from '../../types/api';
import { Alert } from '../common/Alert';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
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

export const Layout: React.FC<LayoutProps> = ({
  children,
  activeTab,
  onSelectTab,
  health,
  healthLoading,
  healthError,
  actors,
  actorsLoading,
  activeActor,
  onActorChange,
  currentUser,
  onLogout,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        backgroundColor: 'var(--bg-main)',
        color: 'var(--text-main)',
        transition: 'background-color 0.2s ease, color 0.2s ease',
      }}
    >
      <Sidebar
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header
          health={health}
          healthLoading={healthLoading}
          healthError={healthError}
          actors={actors}
          actorsLoading={actorsLoading}
          activeActor={activeActor}
          onActorChange={onActorChange}
          currentUser={currentUser}
          onLogout={onLogout}
          onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}
        />
        <main
          style={{
            flex: 1,
            padding: '28px 32px 48px',
            maxWidth: '1440px',
            width: '100%',
            margin: '0 auto',
            boxSizing: 'border-box',
          }}
          className="layout-main-content"
        >
          {healthError && (
            <div style={{ marginBottom: '24px' }}>
              <Alert type="error" title="Backend API Connectivity Error">
                Connection Error: {healthError}
              </Alert>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
};
