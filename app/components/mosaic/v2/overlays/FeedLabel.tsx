export function FeedLabel({ feed }: { feed: 'sunrise' | 'sunset' }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        opacity: 0.35,
        color: '#fff',
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        pointerEvents: 'none',
      }}
    >
      {feed === 'sunrise' ? 'SUNRISE' : 'SUNSET'}
    </div>
  );
}
