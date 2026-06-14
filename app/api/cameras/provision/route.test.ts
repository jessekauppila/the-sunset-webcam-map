// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
const sqlMock = vi.fn();
const mintClaimCodeMock = vi.fn();
const mintDeviceTokenMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v) }));
vi.mock('@/app/lib/cameraClaimCode', () => ({ mintClaimCode: (...a: unknown[]) => mintClaimCodeMock(...a) }));
vi.mock('@/app/lib/cameraRegistration', () => ({ mintDeviceToken: (...a: unknown[]) => mintDeviceTokenMock(...a) }));
import { POST } from './route';

beforeEach(() => {
  sqlMock.mockReset(); mintClaimCodeMock.mockReset(); mintDeviceTokenMock.mockReset();
  process.env.CRON_SECRET = 'secret';
  mintClaimCodeMock.mockResolvedValue({ code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01') });
  mintDeviceTokenMock.mockReturnValue({ plaintext: 'tok-plain', hash: 'tok-hash' });
});

function req(body: unknown, auth = 'Bearer secret') {
  return new Request('http://t/api/cameras/provision', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify(body),
  });
}

describe('POST /api/cameras/provision', () => {
  it('rejects without the secret', async () => {
    expect((await POST(req({ hardware_id: 'sunset-cam-2' }, 'Bearer nope'))).status).toBe(401);
  });
  it('mints code + token, inserts the camera, returns the token once', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 2 }]);  // INSERT cameras
    sqlMock.mockResolvedValueOnce([{ code: 'SUNSET-AAAA-BBBB' }]); // bind claim code
    const res = await POST(req({ hardware_id: 'sunset-cam-2' }));
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b.camera_id).toBe(2);
    expect(b.claim_code).toBe('SUNSET-AAAA-BBBB');
    expect(b.device_token).toBe('tok-plain');
  });
  it('rejects missing hardware_id with 400', async () => {
    expect((await POST(req({}))).status).toBe(400);
  });
});
