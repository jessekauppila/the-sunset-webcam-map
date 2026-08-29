import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { KioskTab } from './KioskTab';

const linkTo = (name: RegExp) =>
  screen.getByRole('link', { name }) as HTMLAnchorElement;

describe('KioskTab', () => {
  it('offers a preview link for each feed and panel combination', () => {
    render(<KioskTab />);
    expect(screen.getAllByRole('link', { name: /open/i })).toHaveLength(4);
  });

  it('points the dell sunset link at the sunset kiosk composed for a dell', () => {
    render(<KioskTab />);
    const href = linkTo(/open sunset on dell/i).getAttribute('href')!;

    expect(href).toContain('/kiosk/sunset');
    expect(href).toContain('panel=dell');
  });

  it('points the ktc sunrise link at the sunrise kiosk composed for a ktc', () => {
    render(<KioskTab />);
    const href = linkTo(/open sunrise on ktc/i).getAttribute('href')!;

    expect(href).toContain('/kiosk/sunrise');
    expect(href).toContain('panel=ktc');
  });

  it('turns the setup overlay on, since these links exist for tuning', () => {
    render(<KioskTab />);
    expect(linkTo(/open sunset on dell/i).getAttribute('href')).toContain(
      'setup=1'
    );
  });

  it('opens previews in a new tab so the drawer is not navigated away', () => {
    render(<KioskTab />);
    const link = linkTo(/open sunset on dell/i);

    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });

  it('documents every tunable param', () => {
    render(<KioskTab />);
    const table = screen.getByRole('table');

    for (const param of [
      'floor',
      'ceil',
      'upscale',
      'growth',
      'pad',
      'cull',
      'lat',
      'panel',
      'quiet',
    ]) {
      expect(within(table).getByText(param)).toBeTruthy();
    }
  });

  it('explains why a smaller browser window is not a substitute', () => {
    render(<KioskTab />);
    expect(screen.getByText(/different composition/i)).toBeTruthy();
  });

  it('names quiet=off as the fix for a preview that goes dark', () => {
    render(<KioskTab />);
    expect(screen.getByText(/quiet=off/)).toBeTruthy();
  });
});
