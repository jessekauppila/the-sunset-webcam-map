// app/components/ModelAnalysis/GraphCaption.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphCaption } from './GraphCaption';

describe('GraphCaption', () => {
  it('renders the caption label', () => {
    render(<GraphCaption slug="graph_loss_curves" />);
    expect(screen.getByText(/loss curves/i)).toBeInTheDocument();
  });

  it('opens a popover with the long description when the ? button is clicked', async () => {
    const user = userEvent.setup();
    render(<GraphCaption slug="graph_loss_curves" />);
    await user.click(screen.getByRole('button', { name: /how to read/i }));
    expect(
      await screen.findByText(/saved and deployed/i)
    ).toBeInTheDocument();
  });

  it('renders nothing when slug is unknown', () => {
    const { container } = render(<GraphCaption slug="not_a_real_slug" />);
    expect(container).toBeEmptyDOMElement();
  });
});
