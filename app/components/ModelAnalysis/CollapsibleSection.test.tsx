// app/components/ModelAnalysis/CollapsibleSection.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleSection } from './CollapsibleSection';

describe('CollapsibleSection', () => {
  it('renders only the heading when collapsed', () => {
    render(
      <CollapsibleSection title="Config">
        <p>hidden body</p>
      </CollapsibleSection>
    );
    expect(screen.getByText('Config')).toBeInTheDocument();
    expect(screen.queryByText('hidden body')).not.toBeInTheDocument();
  });

  it('reveals body when toggled', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection title="Config">
        <p>hidden body</p>
      </CollapsibleSection>
    );
    await user.click(screen.getByRole('button', { name: /config/i }));
    expect(screen.getByText('hidden body')).toBeInTheDocument();
  });
});
