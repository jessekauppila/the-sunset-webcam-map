export function Sparkline({
  values,
  width = 120,
  height = 28,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
}) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) =>
      v === null ? null : `${i * step},${height - ((v - min) / span) * (height - 2) - 1}`,
    )
    .filter(Boolean)
    .join(' ');
  return (
    <svg width={width} height={height} role="img" aria-label="sparkline">
      <polyline points={points} fill="none" stroke="#60a5fa" strokeWidth={1.5} />
    </svg>
  );
}
