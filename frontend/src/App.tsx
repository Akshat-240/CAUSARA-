import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from './components/layout/Layout';
import { NavigationTab } from './components/layout/Sidebar';
import { DemoActor, HealthData } from './types/api';
import { fetchHealth, fetchActors } from './services/api';

// Pages
import { OverviewPage } from './pages/OverviewPage';
import { OrdersPage } from './pages/OrdersPage';
import { TimelinePage } from './pages/TimelinePage';
import { EvidencePage } from './pages/EvidencePage';
import { DelayAnalysisPage } from './pages/DelayAnalysisPage';
import { InterventionsPage } from './pages/InterventionsPage';
import { ScenariosPage } from './pages/ScenariosPage';
import { DecisionsPage } from './pages/DecisionsPage';
import { VerificationPage } from './pages/VerificationPage';

interface NavigationParams {
  orderId?: number;
  caseId?: number;
  scenarioId?: number;
  decisionId?: number;
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('overview');
  const [navParams, setNavParams] = useState<NavigationParams>({});

  // Actors state dynamically loaded from backend database
  const [actors, setActors] = useState<DemoActor[]>([]);
  const [actorsLoading, setActorsLoading] = useState<boolean>(true);
  const [activeActor, setActiveActor] = useState<DemoActor | null>(null);

  // Connectivity State
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const checkConnectivity = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = await fetchHealth();
      setHealth(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect to backend service';
      setHealthError(message);
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const loadActors = useCallback(async () => {
    setActorsLoading(true);
    try {
      const actorList = await fetchActors();
      setActors(actorList);
      if (actorList.length > 0) {
        setActiveActor((prev) => prev || actorList[0]);
      }
    } catch {
      // If actors fail to load due to backend offline, error banner will reflect connectivity
      setActors([]);
      setActiveActor(null);
    } finally {
      setActorsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkConnectivity();
    loadActors();
  }, [checkConnectivity, loadActors]);

  const handleNavigate = (
    tab: NavigationTab,
    params?: NavigationParams
  ) => {
    if (params) {
      setNavParams((prev) => ({ ...prev, ...params }));
    }
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewPage onNavigate={handleNavigate} />;
      case 'orders':
        return (
          <OrdersPage
            initialOrderId={navParams.orderId}
            onNavigate={handleNavigate}
          />
        );
      case 'timeline':
        return (
          <TimelinePage
            initialOrderId={navParams.orderId}
            onNavigate={handleNavigate}
          />
        );
      case 'evidence':
        return (
          <EvidencePage
            initialOrderId={navParams.orderId}
            activeActor={activeActor}
            onNavigate={handleNavigate}
          />
        );
      case 'delay-analysis':
        return (
          <DelayAnalysisPage
            initialOrderId={navParams.orderId}
            activeActor={activeActor}
            onNavigate={handleNavigate}
          />
        );
      case 'interventions':
        return (
          <InterventionsPage
            initialCaseId={navParams.caseId}
            initialOrderId={navParams.orderId}
            onNavigate={handleNavigate}
          />
        );
      case 'scenarios':
        return (
          <ScenariosPage
            initialCaseId={navParams.caseId}
            initialOrderId={navParams.orderId}
            onNavigate={handleNavigate}
          />
        );
      case 'decisions':
        return (
          <DecisionsPage
            initialCaseId={navParams.caseId}
            initialOrderId={navParams.orderId}
            initialScenarioId={navParams.scenarioId}
            actors={actors}
            activeActor={activeActor}
            onNavigate={handleNavigate}
          />
        );
      case 'verification':
        return (
          <VerificationPage
            initialCaseId={navParams.caseId}
            initialOrderId={navParams.orderId}
            initialDecisionId={navParams.decisionId}
            onNavigate={handleNavigate}
          />
        );
      default:
        return <OverviewPage onNavigate={handleNavigate} />;
    }
  };

  return (
    <Layout
      activeTab={activeTab}
      onSelectTab={(tab) => handleNavigate(tab)}
      health={health}
      healthLoading={healthLoading}
      healthError={healthError}
      actors={actors}
      actorsLoading={actorsLoading}
      activeActor={activeActor}
      onActorChange={setActiveActor}
    >
      {renderContent()}
    </Layout>
  );
};

export default App;
