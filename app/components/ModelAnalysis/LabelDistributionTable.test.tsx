// app/components/ModelAnalysis/LabelDistributionTable.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LabelDistributionTable } from './LabelDistributionTable';

const baseData = {
  train_samples: 100,
  val_samples: 20,
  test_samples: 10,
  class_balance: { negative: null, positive: null, ratio: null },
};

describe('LabelDistributionTable', () => {
  it('renders nothing when no label_distribution is present', () => {
    const { container } = render(<LabelDistributionTable data={baseData} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders counts and totals per split', () => {
    render(
      <LabelDistributionTable
        data={{
          ...baseData,
          label_distribution: {
            train: { '1': 60, '2': 10, '3': 15, '4': 10, '5': 5 },
            val: { '1': 12, '2': 2, '3': 3, '4': 2, '5': 1 },
          },
        }}
      />
    );
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument(); // train total
    expect(screen.getByText('20')).toBeInTheDocument(); // val total
  });

  it('flags unnormalised samples when present', () => {
    render(
      <LabelDistributionTable
        data={{
          ...baseData,
          label_distribution: {
            train: { '1': 60, '5': 5, unnormalized: 26 },
          },
        }}
      />
    );
    expect(screen.getByText(/26 samples have label values outside/i)).toBeInTheDocument();
  });
});
