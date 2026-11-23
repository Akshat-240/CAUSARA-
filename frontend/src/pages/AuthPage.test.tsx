import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthPage } from './AuthPage';
import * as api from '../services/api';

describe('AuthPage Component', () => {
  const mockOnAuthSuccess = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    mockOnAuthSuccess.mockClear();
  });

  it('renders sign in screen with role filters and demo presets', () => {
    render(
      <AuthPage
        onAuthSuccess={mockOnAuthSuccess}
        health={{ status: 'healthy', service: 'causara-api', version: '1.0.0', environment: 'development' }}
        healthLoading={false}
        healthError={null}
      />
    );

    // Title and branding
    expect(screen.getByText(/Explainable Order Delay Intelligence & Intervention Analysis Platform/i)).toBeInTheDocument();
    expect(screen.getByText('Operational')).toBeInTheDocument();

    // Mode tabs
    expect(screen.getByRole('button', { name: /Sign In to Workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create New Account/i })).toBeInTheDocument();

    // Demo presets
    expect(screen.getByText(/Apex Retail/i)).toBeInTheDocument();
    expect(screen.getByText(/Elena Rostova/i)).toBeInTheDocument();
    expect(screen.getByText(/Marcus Vance/i)).toBeInTheDocument();
    expect(screen.getByText(/Sarah Chen/i)).toBeInTheDocument();

    // Role buttons in login mode
    expect(screen.getByRole('button', { name: 'SELLER' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MANAGER' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ANALYST' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CUSTOMER' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AUDITOR' })).toBeInTheDocument();
  });

  it('populates fields when a demo preset is clicked', () => {
    render(
      <AuthPage
        onAuthSuccess={mockOnAuthSuccess}
        health={null}
        healthLoading={false}
        healthError={null}
      />
    );

    const sellerPreset = screen.getByText(/Apex Retail/i);
    fireEvent.click(sellerPreset);

    const emailInput = screen.getByLabelText(/Email Address/i) as HTMLInputElement;
    expect(emailInput.value).toBe('demo_seller@causara.com');
  });

  it('validates empty inputs on login submission', async () => {
    render(
      <AuthPage
        onAuthSuccess={mockOnAuthSuccess}
        health={null}
        healthLoading={false}
        healthError={null}
      />
    );

    const submitBtn = screen.getByRole('button', { name: /Sign In to Causara Platform/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Please enter both your email address and password/i)).toBeInTheDocument();
    expect(mockOnAuthSuccess).not.toHaveBeenCalled();
  });

  it('submits login payload and triggers onAuthSuccess', async () => {
    const mockUser = {
      user_id: 1,
      email: 'demo_seller@causara.com',
      full_name: 'Apex Retail',
      role: 'SELLER',
      seller_id: 1,
      business_name: 'Apex Retail Co.',
    };

    vi.spyOn(api, 'loginUser').mockResolvedValueOnce(mockUser);

    render(
      <AuthPage
        onAuthSuccess={mockOnAuthSuccess}
        health={null}
        healthLoading={false}
        healthError={null}
      />
    );

    // Click demo preset
    fireEvent.click(screen.getByText(/Apex Retail/i));

    // Submit login
    const submitBtn = screen.getByRole('button', { name: /Sign In to Causara Platform/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.loginUser).toHaveBeenCalledWith({
        email: 'demo_seller@causara.com',
        password: 'demo123',
        role: 'SELLER',
      });
      expect(mockOnAuthSuccess).toHaveBeenCalledWith(mockUser);
    });
  });

  it('switches to registration mode and validates matching passwords', async () => {
    render(
      <AuthPage
        onAuthSuccess={mockOnAuthSuccess}
        health={null}
        healthLoading={false}
        healthError={null}
      />
    );

    // Switch to Register tab
    const registerTab = screen.getByRole('button', { name: /Create New Account/i });
    fireEvent.click(registerTab);

    // Role cards should now be visible
    expect(screen.getByText('Merchant / Seller')).toBeInTheDocument();
    expect(screen.getByText('Operations Manager')).toBeInTheDocument();
    expect(screen.getByText('Supply Chain Analyst')).toBeInTheDocument();

    expect(screen.getByLabelText(/Full Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm Password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Merchant \/ Logistics Business Name/i)).toBeInTheDocument();

    // Fill mismatched passwords
    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'New Merchant' } });
    fireEvent.change(screen.getByLabelText(/Work \/ Personal Email/i), { target: { value: 'merchant@test.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText(/Confirm Password/i), { target: { value: 'different123' } });
    fireEvent.change(screen.getByLabelText(/Merchant \/ Logistics Business Name/i), { target: { value: 'Test Merchant Store' } });

    const submitBtn = screen.getByRole('button', { name: /Create SELLER Account/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Passwords do not match/i)).toBeInTheDocument();
    expect(mockOnAuthSuccess).not.toHaveBeenCalled();
  });

  it('registers new user and calls onAuthSuccess', async () => {
    const newUser = {
      user_id: 99,
      email: 'new_manager@causara.com',
      full_name: 'John Manager',
      role: 'MANAGER',
    };

    vi.spyOn(api, 'registerUser').mockResolvedValueOnce(newUser);

    render(
      <AuthPage
        onAuthSuccess={mockOnAuthSuccess}
        health={null}
        healthLoading={false}
        healthError={null}
      />
    );

    // Switch to Register tab
    fireEvent.click(screen.getByRole('button', { name: /Create New Account/i }));

    // Select MANAGER role
    const managerCard = screen.getByText('Operations Manager');
    fireEvent.click(managerCard);

    // Fill form
    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'John Manager' } });
    fireEvent.change(screen.getByLabelText(/Work \/ Personal Email/i), { target: { value: 'new_manager@causara.com' } });
    fireEvent.change(screen.getByLabelText(/^Password/i), { target: { value: 'manager123' } });
    fireEvent.change(screen.getByLabelText(/Confirm Password/i), { target: { value: 'manager123' } });

    const submitBtn = screen.getByRole('button', { name: /Create MANAGER Account/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.registerUser).toHaveBeenCalledWith({
        full_name: 'John Manager',
        email: 'new_manager@causara.com',
        password: 'manager123',
        role: 'MANAGER',
        business_name: undefined,
      });
      expect(mockOnAuthSuccess).toHaveBeenCalledWith(newUser);
    });
  });
});
