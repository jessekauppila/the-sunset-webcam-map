'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { WindyWebcam, Orientation } from '@/app/lib/types';
import { useAllWebcamsStore } from '@/app/store/useAllWebcamsStore';
import {
  detectionReadout,
  qualityReadout,
  shortModelName,
} from '@/app/lib/modelReadout';
import StarRating from './console/StarRating';

/**
 * What the two model heads said about this cam, stated separately —
 * detection (is a sunset happening?) and quality (how good is it?).
 * Manual per-webcam rating controls were removed 2026-08-30: frame labels
 * come from the Hard Examples / Random sample queues now, and this console
 * reports the models' own judgments instead.
 */
function ModelReadout({ webcam }: { webcam: WindyWebcam }) {
  const detection = detectionReadout(webcam);
  const quality = qualityReadout(webcam);
  const detectionModel = shortModelName(webcam.aiModelVersionBinary);
  const qualityModel = shortModelName(webcam.aiModelVersionRegression);

  return (
    <div className="mt-1">
      <p className="webcam-console-details">
        Detection{detectionModel ? ` (${detectionModel})` : ''}:{' '}
        {detection ? (
          <span
            className={
              detection.verdict === 'sunset'
                ? 'font-semibold text-orange-600'
                : 'text-gray-500'
            }
          >
            {detection.verdict} · {Math.round(detection.probability * 100)}%
          </span>
        ) : (
          <span className="text-gray-400">not scored yet</span>
        )}
      </p>
      <div className="webcam-console-details">
        Quality{qualityModel ? ` (${qualityModel})` : ''}:{' '}
        {quality !== null ? (
          <>
            <StarRating rating={quality} />
            <span className="ml-1">{quality.toFixed(1)} / 5</span>
            {detection && detection.verdict === 'not a sunset' && (
              <span className="text-gray-400">
                {' '}
                (below gate — renders minimal)
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-400">not scored yet</span>
        )}
      </div>
    </div>
  );
}

export function WebcamConsole({
  webcams,
  title,
}: {
  webcams: WindyWebcam[];
  title: string;
}) {
  const setOrientation = useAllWebcamsStore((s) => s.setOrientation);
  const [updatingWebcams, setUpdatingWebcams] = useState<Set<number>>(
    new Set()
  );

  const handleOrientationChange = async (
    webcamId: number,
    orientation: Orientation
  ) => {
    setUpdatingWebcams((prev) => new Set(prev).add(webcamId));
    try {
      await setOrientation(webcamId, orientation);
    } catch (error) {
      console.error('Failed to update orientation:', error);
    } finally {
      setUpdatingWebcams((prev) => {
        const newSet = new Set(prev);
        newSet.delete(webcamId);
        return newSet;
      });
    }
  };
  return (
    <div className="console-container">
      <h3 className="text-lg font-bold text-gray-700 mb-2">
        {title}: {webcams.length} Webcams
      </h3>

      {webcams.length === 0 ? (
        <p className="text-green-700">
          No webcams found in this area.
        </p>
      ) : (
        <div className="console-grid">
          {webcams.map((webcam) => (
            <div key={webcam.webcamId} className="console-card">
              {/* Webcam Image */}
              {webcam.images?.current?.preview && (
                <Image
                  src={webcam.images.current.preview}
                  alt={webcam.title}
                  width={600}
                  height={300}
                  className="console-card-image"
                  unoptimized
                />
              )}

              <h4 className="console-card-title">{webcam.title}</h4>

              {/* Location Info */}
              <p className="webcam-console-details">
                {webcam.location?.city}, {webcam.location?.region}{' '}
                {webcam.location?.country}
              </p>

              {/* Views and Status */}
              <p className="webcam-console-details">
                Views: {webcam.viewCount?.toLocaleString() || 'N/A'}
              </p>
              <p className="webcam-console-details">
                Status: {webcam.status || 'Unknown'}
              </p>

              {/* Categories */}
              {webcam.categories && webcam.categories.length > 0 && (
                <p className="webcam-console-details">
                  {' '}
                  {webcam.categories
                    .map((cat) => cat.name)
                    .join(', ')}
                </p>
              )}

              {/* Last Updated */}
              <p className="webcam-console-details">
                Updated:{' '}
                {webcam.lastUpdatedOn
                  ? new Date(
                      webcam.lastUpdatedOn
                    ).toLocaleDateString()
                  : 'Unknown'}
              </p>

              {/* ID */}
              <p className="webcam-console-details">
                ID: {webcam.webcamId}
              </p>

              {/* Model judgments — detection head + quality head */}
              <ModelReadout webcam={webcam} />

              {/* Orientation Controls */}
              <div className="mt-2">
                <label className="webcam-console-details">
                  Orientation:
                </label>
                <select
                  value={webcam.orientation || ''}
                  onChange={(e) =>
                    handleOrientationChange(
                      webcam.webcamId,
                      e.target.value as Orientation
                    )
                  }
                  disabled={updatingWebcams.has(webcam.webcamId)}
                  className={`w-full text-xs p-1 border rounded ${
                    updatingWebcams.has(webcam.webcamId)
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-pointer'
                  }`}
                >
                  <option value="">Select orientation</option>
                  <option value="N">North (N)</option>
                  <option value="NE">Northeast (NE)</option>
                  <option value="E">East (E)</option>
                  <option value="SE">Southeast (SE)</option>
                  <option value="S">South (S)</option>
                  <option value="SW">Southwest (SW)</option>
                  <option value="W">West (W)</option>
                  <option value="NW">Northwest (NW)</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
