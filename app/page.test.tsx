import { render, screen } from '@testing-library/react';
import Home from './page';

describe('Home Page', () => {
  it('renders the Next.js welcome content', () => {
    render(<Home />);

    // Test that key elements are present
    expect(
      screen.getByText('Get started by editing', { exact: false })
    ).toBeInTheDocument();
    expect(screen.getByText('app/page.tsx')).toBeInTheDocument();
    expect(screen.getByAltText('Next.js logo')).toBeInTheDocument();
  });

  it('has all the expected navigation links', () => {
    render(<Home />);

    expect(screen.getByText('Deploy now')).toBeInTheDocument();
    expect(screen.getByText('Read our docs')).toBeInTheDocument();
    expect(screen.getByText('Learn')).toBeInTheDocument();
  });
});
