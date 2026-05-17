'use client';

import { useState } from 'react';
import type { DeliveryPreferences as Prefs } from '../types';

// Screen 3. operator_preferences.delivery. Where the daily photo goes
// and how often.
export default function DeliveryPreferences({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: Prefs | null;
  onChange: (v: Prefs) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [channel, setChannel] = useState<Prefs['channel']>(
    value?.channel ?? 'email'
  );
  const [email, setEmail] = useState(value?.email ?? '');
  const [phone, setPhone] = useState(value?.phone ?? '');
  const [cadence, setCadence] = useState<Prefs['cadence']>(
    value?.cadence ?? 'daily'
  );

  const isValid =
    (channel === 'gallery-only') ||
    (channel === 'email' && /.+@.+\..+/.test(email)) ||
    (channel === 'sms' && phone.replace(/\D/g, '').length >= 7);

  const commit = () => {
    onChange({
      channel,
      email: channel === 'email' ? email : undefined,
      phone: channel === 'sms' ? phone : undefined,
      cadence,
    });
    onNext();
  };

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mb-1 text-2xl font-light">Where should your photos go?</h1>
      <p className="mb-6 text-sm text-neutral-400">
        We’ll send the best one from each window.
      </p>

      <fieldset className="mb-6 flex flex-col gap-2">
        <label className="text-xs uppercase tracking-wider text-neutral-500">
          Channel
        </label>
        <div className="flex flex-col gap-2">
          {(['email', 'sms', 'gallery-only'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`rounded border p-3 text-left text-sm ${
                channel === c
                  ? 'border-white bg-white/10'
                  : 'border-neutral-700'
              }`}
            >
              {c === 'email' && 'Email'}
              {c === 'sms' && 'Text message (SMS)'}
              {c === 'gallery-only' && 'Don’t send anything — gallery only'}
            </button>
          ))}
        </div>
      </fieldset>

      {channel === 'email' && (
        <label className="mb-6 block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
            Email address
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded border border-neutral-700 bg-transparent px-3 py-2 text-sm"
          />
        </label>
      )}
      {channel === 'sms' && (
        <label className="mb-6 block">
          <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
            Phone number
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 555 5555"
            className="w-full rounded border border-neutral-700 bg-transparent px-3 py-2 text-sm"
          />
        </label>
      )}

      <fieldset className="mb-6 flex flex-col gap-2">
        <label className="text-xs uppercase tracking-wider text-neutral-500">
          Cadence
        </label>
        <div className="flex flex-col gap-2">
          {(['daily', 'per-event', 'quality-gated'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCadence(c)}
              className={`rounded border p-3 text-left text-sm ${
                cadence === c
                  ? 'border-white bg-white/10'
                  : 'border-neutral-700'
              }`}
            >
              {c === 'daily' && 'One photo per day'}
              {c === 'per-event' && 'Every sunset/sunrise window'}
              {c === 'quality-gated' && 'Only when the model thinks it was great'}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-auto flex justify-between pt-4">
        <button type="button" onClick={onBack} className="text-sm text-neutral-400">
          Back
        </button>
        <button
          type="button"
          onClick={commit}
          disabled={!isValid}
          className="rounded bg-white px-6 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
