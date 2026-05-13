import type { RunStatus } from '@/app/lib/modelRuns.types';

export const STATUS_EMOJI: Record<RunStatus, string> = {
  healthy: '🟢',
  mild_overfit: '🟡',
  overfit: '🟠',
  severe_overfit: '🔴',
};

export const STATUS_LABEL: Record<RunStatus, string> = {
  healthy: 'Healthy',
  mild_overfit: 'Mild overfit',
  overfit: 'Overfit',
  severe_overfit: 'Severe overfit',
};
