// app/components/ModelAnalysis/GlossaryTerm.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlossaryTerm } from './GlossaryTerm';

describe('GlossaryTerm', () => {
  it('renders the child text with a dotted underline class', () => {
    render(<GlossaryTerm slug="val_f1">F1</GlossaryTerm>);
    const el = screen.getByText('F1');
    expect(el).toBeInTheDocument();
    expect(el.className).toMatch(/glossary-term/);
  });

  it('falls back to plain text when the slug is unknown', () => {
    render(<GlossaryTerm slug="not_a_real_slug">F1</GlossaryTerm>);
    const el = screen.getByText('F1');
    expect(el).toBeInTheDocument();
    expect(el.getAttribute('aria-label')).toBeFalsy();
  });

  it('shows tooltip content on focus', async () => {
    const user = userEvent.setup();
    render(<GlossaryTerm slug="val_f1">F1</GlossaryTerm>);
    await user.tab();
    // The tooltip has a real 200ms enterDelay, so this wait has a hard floor
    // rather than resolving on the next tick. findBy's 1000ms default left only
    // ~4x headroom, the tightest margin in this directory; be explicit instead.
    expect(
      await screen.findByText(/precision \+ recall/i, {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('renders an info icon next to the label when withIcon is true', () => {
    const { container } = render(
      <GlossaryTerm slug="val_f1" withIcon>F1</GlossaryTerm>
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('does not render an icon when withIcon is omitted', () => {
    const { container } = render(<GlossaryTerm slug="val_f1">F1</GlossaryTerm>);
    expect(container.querySelector('svg')).toBeNull();
  });
});
