'use client';

import { useState } from 'react';
import { useIsOperator } from '@/app/components/auth/useIsOperator';

const TAPE_OPTIONS = [
  { value: '14x75', label: '14 × 75 mm' },
  { value: '14x50', label: '14 × 50 mm' },
  { value: '14x40', label: '14 × 40 mm' },
] as const;

export default function AdminLabelPage() {
  const { isOperator, loading } = useIsOperator();

  const [claimCode, setClaimCode] = useState('');
  const [name, setName] = useState('');
  const [tape, setTape] = useState<string>('14x75');
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGenerating(true);

    try {
      const params = new URLSearchParams({ claim_code: claimCode, name, tape });
      const res = await fetch(`/api/admin/label?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `Request failed: ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const newUrl = URL.createObjectURL(blob);
      setPngUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return newUrl;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-300">
        <p className="text-sm">Loading…</p>
      </main>
    );
  }

  if (!isOperator) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-300">
        <p className="text-sm">Sign in as the owner to generate labels.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center py-16 px-4">
      <div className="w-full max-w-md">
        <h1 className="text-xl font-semibold mb-8 tracking-tight">
          Label Generator
        </h1>

        <form onSubmit={handleGenerate} className="flex flex-col gap-5">
          {/* Claim Code */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="claim-code" className="text-sm text-gray-400">
              Claim Code
            </label>
            <input
              id="claim-code"
              type="text"
              value={claimCode}
              onChange={(e) => setClaimCode(e.target.value)}
              placeholder="e.g. ABC-123"
              className="rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Camera Name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cam-name" className="text-sm text-gray-400">
              Camera Name
            </label>
            <input
              id="cam-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sunset Camera"
              className="rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Tape Size */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tape-size" className="text-sm text-gray-400">
              Tape Size
            </label>
            <select
              id="tape-size"
              value={tape}
              onChange={(e) => setTape(e.target.value)}
              className="rounded-md bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TAPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={!claimCode.trim() || generating}
            className="mt-1 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition-colors"
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </form>

        {pngUrl && (
          <div className="mt-10 flex flex-col items-center gap-4">
            <img
              src={pngUrl}
              alt="label preview"
              className="max-w-full rounded border border-gray-700"
            />
            <a
              href={pngUrl}
              download={`label-${claimCode}.png`}
              className="rounded-md bg-gray-700 hover:bg-gray-600 px-4 py-2 text-sm font-medium transition-colors"
            >
              Download PNG
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
