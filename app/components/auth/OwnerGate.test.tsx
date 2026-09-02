import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const useSession = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => useSession(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { OwnerGate } from './OwnerGate';

describe('OwnerGate', () => {
  it('renders the surface for the operator', () => {
    useSession.mockReturnValue({ status: 'authenticated', data: { user: { email: 'x@y.z' } } });
    render(<OwnerGate label="Studio"><div data-testid="inner" /></OwnerGate>);
    expect(screen.getByTestId('inner')).toBeInTheDocument();
  });

  it('names the surface in the prompt, so the two gates are distinguishable', () => {
    useSession.mockReturnValue({ status: 'unauthenticated', data: null });
    render(<OwnerGate label="My Cameras"><div data-testid="inner" /></OwnerGate>);
    expect(screen.queryByTestId('inner')).toBeNull();
    expect(screen.getByTestId('owner-gate')).toHaveTextContent('My Cameras requires owner sign-in.');
  });

  it('shows no prompt while auth resolves, so it cannot flash', () => {
    useSession.mockReturnValue({ status: 'loading', data: null });
    render(<OwnerGate label="Studio"><div data-testid="inner" /></OwnerGate>);
    expect(screen.queryByTestId('inner')).toBeNull();
    expect(screen.getByTestId('owner-gate')).toHaveTextContent('');
  });
});
