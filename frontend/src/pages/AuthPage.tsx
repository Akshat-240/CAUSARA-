import React, { useState } from 'react';
import { AuthUser, HealthData } from '../types/api';
import { loginUser, registerUser } from '../services/api';
import { Alert } from '../components/common/Alert';
import { Button } from '../components/common/Button';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { useTheme } from '../context/ThemeContext';

interface AuthPageProps {
  onAuthSuccess: (user: AuthUser) => void;
  health: HealthData | null;
  healthLoading: boolean;
  healthError: string | null;
}

type AuthMode = 'login' | 'register';

interface RoleCard {
  id: string;
  title: string;
  badge: string;
  description: string;
  iconSvg: React.ReactNode;
}

const ROLES: RoleCard[] = [
  {
    id: 'SELLER',
    title: 'Merchant / Seller',
    badge: 'Operations & Fulfillment',
    description: 'Track stage duration variances, attach evidence, and evaluate counterfactual interventions.',
    iconSvg: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    id: 'MANAGER',
    title: 'Operations Manager',
    badge: 'Governance & Approval',
    description: 'Audit delay risk, review intervention financial trade-offs, and authorize formal decisions.',
    iconSvg: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'ANALYST',
    title: 'Supply Chain Analyst',
    badge: 'Causal Modelling',
    description: 'Simulate scenario interventions, inspect causal graph DAGs, and analyze root cause probabilities.',
    iconSvg: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  {
    id: 'CUSTOMER',
    title: 'Customer Service Representative',
    badge: 'Client Resolution',
    description: 'View customer-facing timeline updates, SLA status, and verified resolution explanations.',
    iconSvg: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: 'AUDITOR',
    title: 'Compliance Auditor',
    badge: 'Verification & History',
    description: 'Verify cryptographic evidence hashes, review decision verification outcomes, and inspect outbox sync.',
    iconSvg: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
];

const DEMO_PRESETS = [
  { name: 'Apex Retail', role: 'SELLER', email: 'demo_seller@causara.com', pass: 'demo123' },
  { name: 'Elena Rostova', role: 'MANAGER', email: 'demo_manager@causara.com', pass: 'demo123' },
  { name: 'Marcus Vance', role: 'ANALYST', email: 'demo_analyst@causara.com', pass: 'demo123' },
  { name: 'Sarah Chen', role: 'CUSTOMER', email: 'demo_customer@causara.com', pass: 'demo123' },
];

export const AuthPage: React.FC<AuthPageProps> = ({
  onAuthSuccess,
  health,
  healthLoading,
  healthError,
}) => {
  const { theme } = useTheme();
  const [mode, setMode] = useState<AuthMode>('login');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [selectedRole, setSelectedRole] = useState('SELLER');
  const [businessName, setBusinessName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Status states
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const applyDemoPreset = (preset: typeof DEMO_PRESETS[0]) => {
    setEmail(preset.email);
    setPassword(preset.pass);
    setSelectedRole(preset.role);
    setErrorMessage(null);
    setSuccessMessage(`Loaded ${preset.name} (${preset.role}) demo credentials.`);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage('Please enter both your email address and password.');
      return;
    }

    setLoading(true);
    try {
      const user = await loginUser({
        email: email.trim(),
        password,
        role: selectedRole,
      });
      setSuccessMessage('Welcome back! Initializing workspace...');
      setTimeout(() => {
        onAuthSuccess(user);
      }, 400);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid credentials. Please verify your email and password.';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!fullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter your password.');
      return;
    }

    setLoading(true);
    try {
      const user = await registerUser({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        role: selectedRole,
        business_name: selectedRole === 'SELLER' ? businessName.trim() : undefined,
      });
      setSuccessMessage('Account registered successfully! Accessing Causara workspace...');
      setTimeout(() => {
        onAuthSuccess(user);
      }, 500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg-main)',
        color: 'var(--text-main)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 16px',
        fontFamily: 'var(--font-family)',
        position: 'relative',
        transition: 'background-color 0.2s ease, color 0.2s ease',
      }}
    >
      {/* Top Bar with Theme Toggle */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          right: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <ThemeToggle />
      </div>

      {/* Branding Header */}
      <div style={{ textAlign: 'center', marginBottom: '24px', maxWidth: '640px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
          <img
            src={theme === 'dark' ? '/assets/causara-logo-dark.svg' : '/assets/causara-logo-light.svg'}
            alt="Causara"
            style={{ height: '42px', width: 'auto', display: 'block' }}
          />
          <h1 style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', border: 0 }}>
            Causara
          </h1>
        </div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: '4px 0 12px 0' }}>
          Explainable Order Delay Intelligence & Intervention Analysis Platform
        </p>

        {/* Live Connectivity Badge */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.75rem',
              padding: '3px 10px',
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
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: 'currentColor',
              }}
            />
            <span>
              {healthLoading ? 'Checking...' : healthError ? 'Disconnected' : 'Operational'}
            </span>
            {health && (
              <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>
                {health.service}
              </span>
            )}
          </div>
        </div>
        {healthError && (
          <div style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--status-red)' }}>
            Connection Error: {healthError}
          </div>
        )}
      </div>

      {/* Main Authentication Card */}
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          transition: 'background-color 0.2s ease, border-color 0.2s ease',
        }}
      >
        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-surface-subtle)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMessage(null);
            }}
            style={{
              flex: 1,
              padding: '16px',
              fontSize: '0.95rem',
              fontWeight: 600,
              color: mode === 'login' ? 'var(--text-main)' : 'var(--text-muted)',
              backgroundColor: mode === 'login' ? 'var(--bg-surface)' : 'transparent',
              border: 'none',
              borderBottom: mode === 'login' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Sign In to Workspace
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMessage(null);
            }}
            style={{
              flex: 1,
              padding: '16px',
              fontSize: '0.95rem',
              fontWeight: 600,
              color: mode === 'register' ? 'var(--text-main)' : 'var(--text-muted)',
              backgroundColor: mode === 'register' ? 'var(--bg-surface)' : 'transparent',
              border: 'none',
              borderBottom: mode === 'register' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Create New Account
          </button>
        </div>

        <div style={{ padding: '28px' }}>
          {/* Messages */}
          {errorMessage && (
            <div style={{ marginBottom: '20px' }}>
              <Alert type="error">{errorMessage}</Alert>
            </div>
          )}
          {successMessage && (
            <div style={{ marginBottom: '20px' }}>
              <Alert type="success">{successMessage}</Alert>
            </div>
          )}

          {/* LOGIN MODE */}
          {mode === 'login' && (
            <form noValidate onSubmit={handleLoginSubmit}>
              {/* Quick Demo Accounts Banner */}
              <div
                style={{
                  backgroundColor: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  marginBottom: '20px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Quick Demo Presets (One-Click Testing)
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Pass: demo123</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {DEMO_PRESETS.map((p) => (
                    <button
                      key={p.role}
                      type="button"
                      onClick={() => applyDemoPreset(p)}
                      style={{
                        padding: '5px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-main)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-subtle)')}
                      onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface)')}
                    >
                      {p.name} <span style={{ opacity: 0.6 }}>({p.role})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Email Input */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="login-email"
                  style={{ display: 'block', fontSize: '0.825rem', fontWeight: 500, color: 'var(--text-main)', marginBottom: '6px' }}
                >
                  Email Address
                </label>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. demo_seller@causara.com"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '0.9rem',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-main)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Password Input */}
              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label htmlFor="login-password" style={{ fontSize: '0.825rem', fontWeight: 500, color: 'var(--text-main)' }}>
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '0.75rem',
                      color: 'var(--primary)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {showPassword ? 'Hide password' : 'Show password'}
                  </button>
                </div>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '0.9rem',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-main)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Operating Role Filter */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 500, color: 'var(--text-main)', marginBottom: '8px' }}>
                  Active Workspace Role
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '8px' }}>
                  {['SELLER', 'MANAGER', 'ANALYST', 'CUSTOMER', 'AUDITOR'].map((role) => {
                    const isSelected = selectedRole === role;
                    return (
                      <button
                        key={role}
                        type="button"
                        onClick={() => setSelectedRole(role)}
                        style={{
                          padding: '8px 4px',
                          textAlign: 'center',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          borderRadius: 'var(--radius-sm)',
                          border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                          backgroundColor: isSelected ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                          color: isSelected ? 'var(--primary)' : 'var(--text-muted)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {role}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Submit Button */}
              <Button
                type="submit"
                variant="primary"
                loading={loading}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                }}
              >
                Sign In to Causara Platform
              </Button>
            </form>
          )}

          {/* REGISTER MODE */}
          {mode === 'register' && (
            <form noValidate onSubmit={handleRegisterSubmit}>
              {/* Full Name */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="reg-name"
                  style={{ display: 'block', fontSize: '0.825rem', fontWeight: 500, color: 'var(--text-main)', marginBottom: '6px' }}
                >
                  Full Name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. David Vance"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '0.9rem',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-main)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Email Address */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="reg-email"
                  style={{ display: 'block', fontSize: '0.825rem', fontWeight: 500, color: 'var(--text-main)', marginBottom: '6px' }}
                >
                  Work / Personal Email
                </label>
                <input
                  id="reg-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. david.vance@logistics.com"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: '0.9rem',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-main)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Role Selection Cards */}
              <div style={{ marginBottom: '18px' }}>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 500, color: 'var(--text-main)', marginBottom: '8px' }}>
                  Select Operational Role
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {ROLES.map((r) => {
                    const isSelected = selectedRole === r.id;
                    return (
                      <div
                        key={r.id}
                        onClick={() => setSelectedRole(r.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '12px',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-md)',
                          border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                          backgroundColor: isSelected ? 'var(--primary-subtle)' : 'var(--bg-surface)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div
                          style={{
                            color: isSelected ? 'var(--primary)' : 'var(--text-muted)',
                            marginTop: '2px',
                          }}
                        >
                          {r.iconSvg}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isSelected ? 'var(--primary)' : 'var(--text-main)' }}>
                              {r.title}
                            </span>
                            <span
                              style={{
                                fontSize: '0.675rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: isSelected ? 'var(--primary)' : 'var(--bg-surface-subtle)',
                                color: isSelected ? 'var(--text-inverse)' : 'var(--text-muted)',
                                fontWeight: 600,
                              }}
                            >
                              {r.badge}
                            </span>
                          </div>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '3px 0 0 0', lineHeight: 1.3 }}>
                            {r.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Business Name (Optional if SELLER) */}
              {selectedRole === 'SELLER' && (
                <div style={{ marginBottom: '16px' }}>
                  <label
                    htmlFor="reg-business"
                    style={{ display: 'block', fontSize: '0.825rem', fontWeight: 500, color: 'var(--text-main)', marginBottom: '6px' }}
                  >
                    Merchant / Logistics Business Name
                  </label>
                  <input
                    id="reg-business"
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Apex Express Courier LLC"
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '0.9rem',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-main)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}

              {/* Password & Confirm */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '22px' }}>
                <div>
                  <label
                    htmlFor="reg-password"
                    style={{ display: 'block', fontSize: '0.825rem', fontWeight: 500, color: 'var(--text-main)', marginBottom: '6px' }}
                  >
                    Password
                  </label>
                  <input
                    id="reg-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    required
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '0.9rem',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-main)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="reg-confirm-password"
                    style={{ display: 'block', fontSize: '0.825rem', fontWeight: 500, color: 'var(--text-main)', marginBottom: '6px' }}
                  >
                    Confirm Password
                  </label>
                  <input
                    id="reg-confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      fontSize: '0.9rem',
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-main)',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              {/* Submit Registration Button */}
              <Button
                type="submit"
                variant="primary"
                loading={loading}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '0.95rem',
                  fontWeight: 600,
                }}
              >
                Create {selectedRole} Account & Open Workspace
              </Button>
            </form>
          )}
        </div>

        {/* Security / Epistemology Card Footer */}
        <div
          style={{
            padding: '14px 28px',
            backgroundColor: 'var(--bg-surface-subtle)',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.725rem',
            color: 'var(--text-muted)',
          }}
        >
          <span>Epistemological Integrity: Facts • Hypotheses • Estimates</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Encrypted Session
          </span>
        </div>
      </div>

      {/* Outer Footnote */}
      <p style={{ marginTop: '24px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        Causara Order Intelligence &copy; 2026. All operational actions are recorded to immutable audit trails.
      </p>
    </div>
  );
};
