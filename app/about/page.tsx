'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import Home from '../page';

type Slide = {
  eyebrow?: string;
  titleNode?: React.ReactNode;
  body: React.ReactNode;
  image?: { src: string; alt: string };
  cta?: { href: string; label: string };
};

const slides: Slide[] = [
  {
    titleNode: (
      <>
        Sunrise
        <span className="slash">/</span>
        Sunset
      </>
    ),
    body: (
      <p>
        A project that streams live sunrises and sunsets from around
        the world, as they happen.
      </p>
    ),
    // image: { src: '/about/slide-1.jpg', alt: 'Opening image' },
  },
  {
    eyebrow: '§ i — how it works',
    body: (
      <>
        <p>
          A line wraps around the planet where day turns to night,
          moving continuously with the earth&rsquo;s rotation.
        </p>
        <p style={{ marginTop: '1.2em' }}>
          The project follows that line, pulling from webcams along
          it.
        </p>
      </>
    ),
    // image: { src: '/about/slide-2-map.jpg', alt: 'Map with day/night line' },
  },
  {
    eyebrow: '§ ii — the pieces',
    body: (
      <>
        <p>The project has six parts.</p>
        <ol style={{ marginTop: '1.4em' }}>
          <li>
            <strong>Webcam network.</strong> Public webcams accessed
            via API.
          </li>
          <li>
            <strong>Map.</strong> Feeds from current webcams where
            there should be a sunrise or sunset &mdash; the
            centerpiece of the current website.
          </li>
          <li>
            <strong>Archive.</strong> Composed of sunrise and sunset
            snapshots.
          </li>
          <li>
            <strong>Rating tool.</strong> For ranking snapshots in
            the archive.
          </li>
          <li>
            <strong>AI model.</strong> A machine-learning model based
            on human ratings, used to find and save the best sunsets.
          </li>
          <li>
            <strong>Art installation.</strong> I dream of standing at
            the center of a room of sunrises and sunsets all happening
            now.
          </li>
        </ol>
      </>
    ),
    // image: { src: '/about/slide-3-diagram.jpg', alt: 'Diagram of the pieces' },
  },
  {
    eyebrow: '§ iii — this site',
    body: (
      <>
        <p>
          Click to drag the globe and pinch to zoom in on different
          areas.
        </p>
        <p style={{ marginTop: '1.2em' }}>
          Click on a circle to see more details about that webcam.
        </p>
      </>
    ),
    cta: { href: '/', label: 'Open the tool' },
    // image: { src: '/about/slide-4-app.jpg', alt: 'Screenshot of the tool' },
  },
];

export default function AboutPage() {
  const router = useRouter();
  const [i, setI] = useState(0);
  const atStart = i === 0;
  const atEnd = i === slides.length - 1;

  const prev = useCallback(
    () => setI((x) => Math.max(0, x - 1)),
    []
  );
  const next = useCallback(
    () => setI((x) => Math.min(slides.length - 1, x + 1)),
    []
  );
  const close = useCallback(() => router.push('/'), [router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, close]);

  const slide = slides[i];

  return (
    <>
      {/* Live tool rendered behind the overlay.
          pointer-events are disabled on the wrapper so all input
          goes to the overlay; once closed, this goes away along
          with the /about route. */}
      <div className="about-bg" aria-hidden="true">
        <Home />
      </div>

      <section
        className="about-overlay about-root"
        role="dialog"
        aria-modal="true"
        aria-label="About Sunrise / Sunset"
      >
        {/* Sticky top chrome */}
        <header className="px-6 md:px-14 lg:px-20 pt-6 pb-5 flex items-center justify-between">
          <span className="about-wordmark">
            sunrise<span className="slash">/</span>sunset
          </span>

          <Link
            href="/"
            className="about-close"
            aria-label="Close the intro and open the tool"
          >
            <span className="esc">esc</span>
            <span>close</span>
            <span className="x" aria-hidden>
              ×
            </span>
          </Link>
        </header>

        <div className="about-rule" />

        {/* Scrolling main content */}
        <section className="flex items-center px-6 md:px-14 lg:px-20 py-10 md:py-14">
          <div
            key={i}
            className="w-full max-w-[88rem] mx-auto grid md:grid-cols-12 gap-12 md:gap-16 items-start"
          >
            {/* Text column */}
            <div className="about-text-col md:col-span-5 flex flex-col">
              {slide.eyebrow && (
                <p className="about-mono accent mb-8">
                  {slide.eyebrow}
                </p>
              )}

              {slide.titleNode && (
                <h1 className="about-title text-[3.2rem] md:text-[5.2rem] lg:text-[6.5rem] mb-10">
                  {slide.titleNode}
                </h1>
              )}

              <div className="about-body text-lg md:text-xl">
                {slide.body}
              </div>

              {slide.cta && (
                <Link
                  href={slide.cta.href}
                  className="about-cta mt-12"
                >
                  <span>{slide.cta.label}</span>
                  <span className="arrow">→</span>
                </Link>
              )}
            </div>

            {/* Image column */}
            <div className="about-image-col md:col-span-6 md:col-start-7">
              <div
                className={`about-image-frame aspect-[4/3] w-full${
                  slide.image ? '' : ' is-empty'
                }`}
              >
                {slide.image ? (
                  <Image
                    src={slide.image.src}
                    alt={slide.image.alt}
                    fill
                    sizes="(min-width: 768px) 44rem, 100vw"
                    priority={i === 0}
                    className="object-cover"
                  />
                ) : null}

                {/*
                  To add "pointing" annotations over a screenshot,
                  drop in absolute-positioned spans using percentages:

                  <span style={{
                    position: 'absolute',
                    left: '30%',
                    top: '40%',
                    fontFamily: 'var(--font-geist-mono), monospace',
                    fontSize: '0.65rem',
                    letterSpacing: '0.18em',
                    textTransform: 'lowercase',
                    color: 'var(--paper)',
                    background: 'var(--ink)',
                    padding: '0.35em 0.6em',
                    borderLeft: '2px solid var(--ember)',
                  }}>
                    webcam marker
                  </span>
                */}
              </div>
            </div>
          </div>
        </section>

        <div className="about-rule" />

        {/* Sticky bottom nav */}
        <nav
          className="px-6 md:px-14 lg:px-20 py-5 flex items-center justify-between"
          aria-label="Slide navigation"
        >
          <button
            type="button"
            onClick={prev}
            disabled={atStart}
            className="about-nav-btn"
          >
            ← previous
          </button>

          <div className="flex gap-2 items-center">
            {slides.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setI(idx)}
                aria-label={`Go to slide ${idx + 1}`}
                className={`about-dot ${
                  idx === i ? 'active w-8' : 'w-3'
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={next}
            disabled={atEnd}
            className="about-nav-btn"
          >
            next →
          </button>
        </nav>
      </section>
    </>
  );
}
