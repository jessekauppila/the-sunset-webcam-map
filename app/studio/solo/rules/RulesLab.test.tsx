import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { RulesLab } from './RulesLab';

const heads = () => within(screen.getByTestId('col-3')).getAllByTestId(/^chip-/).map((el) => el.dataset.testid!.slice(5));

describe('RulesLab', () => {
  it('renders the twelve chips in the pool column and the six column heads', () => {
    render(<RulesLab />);
    expect(within(screen.getByTestId('col-pool')).getAllByTestId(/^chip-/)).toHaveLength(12);
    for (const id of ['col-pool', 'col-5', 'col-4', 'col-2', 'col-1', 'col-3']) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.getByText('5 · floors')).toBeInTheDocument();
    expect(screen.getByText('3 · sort')).toBeInTheDocument();
  });

  it('a chip a rule drops stays in that column greyed with the reason', () => {
    render(<RulesLab />);
    // Default detection floor 0.3 drops N4 (0.2) at rule 5.
    const col5 = screen.getByTestId('col-5');
    const n4 = within(col5).getByTestId('chip-N4');
    expect(n4.dataset.dim).toBe('1');
    expect(within(n4).getByText('sunset 20% < 30%')).toBeInTheDocument();
    expect(within(screen.getByTestId('col-4')).queryByTestId('chip-N4')).toBeNull();
  });

  it('stepping forward changes the head, and back restores it', () => {
    render(<RulesLab />);
    expect(heads()[0]).toBe('S1');
    fireEvent.click(screen.getByLabelText('next draw'));
    expect(screen.getByTestId('slot')).toHaveTextContent('draw 2');
    expect(heads()[0]).toBe('S2');
    expect(screen.getByTestId('history')).toHaveTextContent('S1');
    fireEvent.click(screen.getByLabelText('previous draw'));
    expect(heads()[0]).toBe('S1');
  });

  it('a dial change re-runs the sieve', () => {
    render(<RulesLab />);
    fireEvent.change(screen.getByLabelText('valleys per peak'), { target: { value: '1' } });
    // period 2, beat = slot mod 2: draw 1 is a valley, the worst eligible unshown sunset.
    expect(within(screen.getByTestId('col-3')).getByText('valley · worst first')).toBeInTheDocument();
    expect(heads()[0]).toBe('S8');
  });

  it('numbers the bins by place in the next draws', () => {
    render(<RulesLab />);
    expect(within(screen.getByTestId('bin-sunset')).getByTestId('num-S1')).toHaveTextContent('1');
    expect(within(screen.getByTestId('bin-sunset')).getByTestId('num-S2')).toHaveTextContent('2');
  });

  it('links the rotation-scheduler cousins', () => {
    render(<RulesLab />);
    expect(screen.getByRole('link', { name: /Which Rules are a Top Priority/ })).toHaveAttribute('href', 'https://musicmaster.com/?p=8886');
  });
});
