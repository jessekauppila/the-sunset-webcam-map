import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FrameModal, takenLine } from './FrameModal';

vi.mock('@/app/components/Webcam/FrameLabelCard', () => ({
  FrameLabelCard: ({ webcam }: { webcam: { title: string } }) => <div data-testid="card">{webcam.title}</div>,
}));

const AT = Date.UTC(2026, 8, 5, 2, 42); // 7:42 pm in Mazatlán on 4 Sep
const frame = (id: number, minutesBefore: number) => ({
  snapshotId: id, webcamId: 7, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: id, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: 'Cabo', region: 'BCS', country: 'Mexico', eligible: true, rank: 1,
  capturedAt: AT - minutesBefore * 60_000, timezone: 'America/Mazatlan', sunAltitudeDeg: null,
  stage: { kind: 'inLine' as const, position: null },
});
const list = [frame(1, 30), frame(2, 15), frame(3, 0)];

it('says when the picture was taken, in the camera\'s zone, or in UTC without one', () => {
  expect(takenLine(list[2])).toBe('taken 7:42 pm there · 4 Sep');
  expect(takenLine({ capturedAt: AT, timezone: null })).toBe('taken 02:42 UTC · 5 Sep');
});

it('shows the frame line and card, and the arrows step through the column; keys work too', () => {
  const onIndex = vi.fn();
  const onClose = vi.fn();
  const { rerender } = render(<FrameModal list={list} index={1} feed="sunset" onIndex={onIndex} onClose={onClose} />);
  expect(screen.getByTestId('frame-line')).toHaveTextContent('frame 2 · sunset bin · shown ×2 · taken 7:27 pm there · 4 Sep');
  expect(screen.getByTestId('card')).toHaveTextContent('t2');
  expect(screen.getByText('2 of 3')).toBeInTheDocument();
  fireEvent.click(screen.getByTitle(/Previous frame/));
  expect(onIndex).toHaveBeenLastCalledWith(0);
  fireEvent.click(screen.getByTitle(/Next frame/));
  expect(onIndex).toHaveBeenLastCalledWith(2);
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(onIndex).toHaveBeenLastCalledWith(2);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
  // At the ends the arrow is disabled and the key does nothing.
  rerender(<FrameModal list={list} index={2} feed="sunset" onIndex={onIndex} onClose={onClose} />);
  expect(screen.getByTitle(/Next frame/)).toBeDisabled();
  onIndex.mockClear();
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(onIndex).not.toHaveBeenCalled();
});
