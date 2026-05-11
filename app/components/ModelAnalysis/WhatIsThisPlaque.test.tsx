// app/components/ModelAnalysis/WhatIsThisPlaque.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WhatIsThisPlaque } from './WhatIsThisPlaque';

beforeEach(() => {
  sessionStorage.clear();
});

describe('WhatIsThisPlaque', () => {
  it('renders the explainer text by default', () => {
    render(<WhatIsThisPlaque />);
    expect(screen.getByText(/machine-learning model/i)).toBeInTheDocument();
  });

  it('hides itself when the dismiss button is clicked', async () => {
    const user = userEvent.setup();
    render(<WhatIsThisPlaque />);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/machine-learning model/i)).not.toBeInTheDocument();
  });

  it('does not render if sessionStorage marks it dismissed', () => {
    sessionStorage.setItem('model-analysis-plaque-dismissed', '1');
    render(<WhatIsThisPlaque />);
    expect(screen.queryByText(/machine-learning model/i)).not.toBeInTheDocument();
  });
});
