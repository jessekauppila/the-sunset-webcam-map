import { useState } from 'react';
import Image from 'next/image';
import type { Webcam } from '../../lib/types';

interface WebcamMarkerProps {
  webcam: Webcam;
  onClick?: (webcam: Webcam) => void;
  onHover?: (webcam: Webcam, isHovering: boolean) => void;
  className?: string;
  showThumbnail?: boolean;
  showSource?: boolean;
  size?: 'small' | 'medium' | 'large';
}

/**
 * Individual webcam marker component
 * Can be used standalone or as part of a map overlay
 */
export default function WebcamMarker({
  webcam,
  onClick,
  onHover,
  className = '',
  showThumbnail = false,
  showSource = false,
  size = 'medium',
}: WebcamMarkerProps) {
  const [imageError, setImageError] = useState(false);

  const sizeClasses = {
    small: 'w-8 h-8',
    medium: 'w-10 h-10',
    large: 'w-12 h-12',
  };

  const handleClick = () => {
    if (onClick) {
      onClick(webcam);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  };

  const handleMouseEnter = () => {
    if (onHover) {
      onHover(webcam, true);
    }
  };

  const handleMouseLeave = () => {
    if (onHover) {
      onHover(webcam, false);
    }
  };

  return (
    <div
      data-testid="webcam-marker"
      data-active={webcam.isActive}
      className={`
        relative flex flex-col items-center cursor-pointer transition-all duration-200
        ${webcam.isActive ? 'opacity-100' : 'opacity-60'}
        ${className}
      `}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="button"
      tabIndex={0}
      aria-label={`Webcam: ${webcam.name}`}
    >
      {/* Main marker circle */}
      <div
        className={`
          ${sizeClasses[size]}
          rounded-full border-2 border-white shadow-lg
          flex items-center justify-center
          ${
            webcam.isActive
              ? 'bg-orange-500 hover:bg-orange-600'
              : 'bg-gray-400 hover:bg-gray-500'
          }
          transform hover:scale-110 transition-transform duration-200
        `}
      >
        {/* Camera icon */}
        <svg
          className="w-1/2 h-1/2 text-white"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M4 5a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586l-.707-.707A1 1 0 0012.293 4H7.707a1 1 0 00-.707.293L6.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>
      </div>

      {/* Webcam name label */}
      <div className="mt-1 px-2 py-1 bg-black bg-opacity-75 text-white text-xs rounded whitespace-nowrap">
        {webcam.name}
      </div>

      {/* Source indicator */}
      {showSource && (
        <div className="text-xs text-gray-500 mt-1">
          {webcam.source}
        </div>
      )}

      {/* Thumbnail preview */}
      {showThumbnail && webcam.thumbnailUrl && !imageError && (
        <div className="absolute -top-20 left-1/2 transform -translate-x-1/2 z-10">
          <div className="bg-white p-1 rounded shadow-lg">
            <Image
              src={webcam.thumbnailUrl}
              alt={`${webcam.name} thumbnail`}
              width={120}
              height={80}
              className="rounded"
              onError={() => setImageError(true)}
            />
          </div>
        </div>
      )}

      {/* Activity indicator */}
      <div
        className={`
          absolute -top-1 -right-1 w-3 h-3 rounded-full border border-white
          ${webcam.isActive ? 'bg-green-500' : 'bg-red-500'}
        `}
        title={webcam.isActive ? 'Active' : 'Inactive'}
      />
    </div>
  );
}
