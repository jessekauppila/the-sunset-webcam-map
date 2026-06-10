// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const isOwnerMock = vi.fn();
const fetchCameraDetailMock = vi.fn();
const redirectMock = vi.fn(() => {
  throw new Error('REDIRECT');
});
const notFoundMock = vi.fn(() => {
  throw new Error('NOT_FOUND');
});

vi.mock('@/auth', () => ({ auth: (...a: unknown[]) => authMock(...a) }));
vi.mock('@/app/lib/owner', () => ({ isOwner: (...a: unknown[]) => isOwnerMock(...a) }));
vi.mock('@/app/lib/cameraDetail', () => ({
  fetchCameraDetail: (...a: unknown[]) => fetchCameraDetailMock(...a),
}));
vi.mock('next/navigation', () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
  notFound: (...a: unknown[]) => notFoundMock(...a),
}));
// Client components are not exercised in this node-env gating test.
vi.mock('@/app/components/CameraDetail/CameraBestStrip', () => ({ CameraBestStrip: () => null }));
vi.mock('@/app/components/CameraDetail/CameraImageHistory', () => ({ CameraImageHistory: () => null }));
vi.mock('@/app/components/CameraDetail/CameraDetailHeader', () => ({ CameraDetailHeader: () => null }));

import CameraDetailPage from './page';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { email: 'owner@x.com' } });
  isOwnerMock.mockReset().mockReturnValue(true);
  fetchCameraDetailMock.mockReset().mockResolvedValue({ cameraId: 7, webcamId: 42 });
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

describe('CameraDetailPage gating', () => {
  it('redirects a non-owner', async () => {
    isOwnerMock.mockReturnValue(false);
    await expect(CameraDetailPage(params('7'))).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/');
    expect(fetchCameraDetailMock).not.toHaveBeenCalled();
  });

  it('404s a non-numeric id', async () => {
    await expect(CameraDetailPage(params('abc'))).rejects.toThrow('NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
    expect(fetchCameraDetailMock).not.toHaveBeenCalled();
  });

  it('404s an unknown camera id', async () => {
    fetchCameraDetailMock.mockResolvedValue(null);
    await expect(CameraDetailPage(params('999'))).rejects.toThrow('NOT_FOUND');
    expect(fetchCameraDetailMock).toHaveBeenCalledWith(999);
  });

  it('renders for the owner with a valid camera', async () => {
    const el = await CameraDetailPage(params('7'));
    expect(el).toBeTruthy();
    expect(fetchCameraDetailMock).toHaveBeenCalledWith(7);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
