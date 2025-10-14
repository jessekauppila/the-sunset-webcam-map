function StarRating({ rating }: { rating: number }) {
  return (
    <div className="star-wrapper flex gap-1">
      {range(rating).map((num) => (
        <img
          key={num}
          alt="star"
          className="gold-star"
          src="/Five-pointed_star.svg-1.png"
          width={20}
        />
      ))}
    </div>
  );
}

const range = (start: number, end?: number, step: number = 1) => {
  const output = [];

  if (typeof end === 'undefined') {
    end = start;
    start = 0;
  }

  for (let i = start; i < end; i += step) {
    output.push(i);
  }

  return output;
};

export default StarRating;
