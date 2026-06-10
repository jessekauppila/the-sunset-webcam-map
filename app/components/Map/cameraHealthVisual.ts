import type { CameraHealth } from '@/app/lib/cameraHealth';

export interface HealthVisual {
  color: string;
  badge: string;
  label: string;
}

export function healthVisual(health: CameraHealth): HealthVisual {
  switch (health) {
    case 'live':
      return { color: '#37d67a', badge: '✓', label: 'Live' };
    case 'stale':
      return { color: '#f5a623', badge: '!', label: 'Stale' };
    case 'offline':
      return { color: '#e74c3c', badge: '×', label: 'Offline' };
    case 'never':
      return { color: '#8a93a3', badge: '?', label: 'Never reported' };
  }
}
