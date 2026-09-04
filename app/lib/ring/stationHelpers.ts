export const PHONE_ID_KEY = 'ring.phoneId';

export function getOrCreatePhoneId(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  rand: () => string = () => Math.random().toString(36).slice(2)
): string {
  const existing = storage.getItem(PHONE_ID_KEY);
  if (existing) return existing;
  const id = rand();
  storage.setItem(PHONE_ID_KEY, id);
  return id;
}

export function clockLabel(angleDeg: number): string {
  const normalized = ((angleDeg % 360) + 360) % 360;
  const hour = Math.round(normalized / 30) % 12; // 0..11
  const display = hour === 0 ? 12 : hour;
  return `${display} o'clock`;
}
