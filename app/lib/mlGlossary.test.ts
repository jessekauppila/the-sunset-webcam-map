// app/lib/mlGlossary.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ML_GLOSSARY, GLOSSARY_SKIP_LIST } from './mlGlossary';

const REQUIRED_UI_TERMS = [
  'val_f1', 'val_precision', 'val_recall', 'val_accuracy',
  'pearson_r', 'spearman_r', 'r_squared', 'val_mse',
  'best_epoch', 'early_stopped',
  'overfitting', 'healthy', 'mild_overfit', 'severe_overfit',
  'train_loss', 'val_loss',
  'class_balance', 'class_weighting',
  'threshold_sweep', 'failure_gallery',
  'binary_classification', 'regression',
  'webcam_id', 'snapshot_id',
  'graph_loss_curves', 'graph_label_distribution', 'graph_comparison_overlay',
];

describe('mlGlossary', () => {
  it.each(REQUIRED_UI_TERMS)('has an entry for %s', (slug) => {
    const entry = ML_GLOSSARY[slug];
    expect(entry, `${slug} missing from ML_GLOSSARY`).toBeDefined();
    expect(entry.label.length).toBeGreaterThan(0);
    expect(entry.short.length).toBeGreaterThan(0);
    expect(entry.long.length).toBeGreaterThan(0);
  });

  it('every entry has all three required fields and no empty strings', () => {
    for (const [slug, entry] of Object.entries(ML_GLOSSARY)) {
      expect(entry.label, `${slug}.label`).toBeTruthy();
      expect(entry.short, `${slug}.short`).toBeTruthy();
      expect(entry.long, `${slug}.long`).toBeTruthy();
    }
  });

  it('every glossary term in OPERATING_GUIDE.md section 16 is covered', () => {
    const guidePath = path.join(process.cwd(), 'ml', 'OPERATING_GUIDE.md');
    const md = fs.readFileSync(guidePath, 'utf8');
    const sectionMatch = md.match(/## 16\. Glossary([\s\S]*?)(\n## |\n---)/);
    expect(sectionMatch, 'OPERATING_GUIDE.md section 16 not found').toBeTruthy();
    const rows = (sectionMatch![1].match(/^\| \*\*([^*]+)\*\* \|/gm) ?? [])
      .map((line) => line.replace(/^\| \*\*([^*]+)\*\* \|/, '$1').trim());
    expect(rows.length).toBeGreaterThan(0);
    for (const term of rows) {
      const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const covered = !!ML_GLOSSARY[slug] || GLOSSARY_SKIP_LIST.includes(slug);
      expect(covered, `Operating-guide term "${term}" (slug "${slug}") is not in ML_GLOSSARY and not skip-listed`).toBe(true);
    }
  });
});
