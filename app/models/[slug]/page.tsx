// app/models/[slug]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  listRunSlugs,
  readRunIndex,
  readFailureGallery,
} from '@/app/lib/modelRuns';
import { MetricTiles } from '@/app/components/ModelAnalysis/MetricTiles';
import { FailureGallery } from '@/app/components/ModelAnalysis/FailureGallery';
import { GraphCaption } from '@/app/components/ModelAnalysis/GraphCaption';
import { CollapsibleSection } from '@/app/components/ModelAnalysis/CollapsibleSection';

export function generateStaticParams() {
  return listRunSlugs().map((slug) => ({ slug }));
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function ModelPage({ params }: PageProps) {
  const { slug } = await params;
  const index = readRunIndex(slug);
  if (!index) notFound();

  const failure = readFailureGallery(slug);
  const publishedDate = new Date(index.published_at).toLocaleDateString();
  const lossCurves = `/ml-runs/${slug}/${index.assets.loss_curves_png}`;
  const labelDist = `/ml-runs/${slug}/${index.assets.label_distribution_png}`;

  return (
    <main style={{
      maxWidth: 960,
      margin: '0 auto',
      padding: '24px 16px',
      color: '#e5e7eb',
      background: '#0b1220',
      minHeight: '100vh',
    }}>
      <div style={{ marginBottom: 16, fontSize: 13 }}>
        <Link href="/" style={{ color: '#60a5fa' }}>← back to map</Link>
      </div>

      <h1 style={{ margin: 0 }}>{index.display_name}</h1>
      <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
        Published {publishedDate} · {index.config_summary.target_type} ·{' '}
        {index.metrics.epochs_completed ?? '?'} epochs
      </div>

      <section style={{ marginTop: 24 }}>
        <MetricTiles index={index} />
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ margin: '0 0 8px' }}>Failure gallery</h2>
        <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
          Top-{failure?.items.length ?? 0} worst predictions on the validation set, sorted by absolute error.
        </div>
        {failure
          ? <FailureGallery gallery={failure} />
          : <div style={{ color: '#94a3b8' }}>No failure gallery generated for this run.</div>}
      </section>

      <section style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lossCurves} alt="loss curves" style={{ width: '100%' }} />
          <GraphCaption slug="graph_loss_curves" />
        </div>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={labelDist} alt="label distribution" style={{ width: '100%' }} />
          <GraphCaption slug="graph_label_distribution" />
        </div>
      </section>

      <CollapsibleSection title="Run config">
        <pre style={{ background: '#0f172a', padding: 12, borderRadius: 4, overflow: 'auto' }}>
{JSON.stringify(index.config_summary, null, 2)}
        </pre>
      </CollapsibleSection>

      <CollapsibleSection title="Full run index (raw JSON)">
        <pre style={{ background: '#0f172a', padding: 12, borderRadius: 4, overflow: 'auto', fontSize: 11 }}>
{JSON.stringify(index, null, 2)}
        </pre>
      </CollapsibleSection>
    </main>
  );
}
