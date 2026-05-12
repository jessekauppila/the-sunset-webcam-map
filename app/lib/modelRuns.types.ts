// app/lib/modelRuns.types.ts

export type RunStatus =
  | 'healthy'
  | 'mild_overfit'
  | 'overfit'
  | 'severe_overfit';

export type TargetType = 'binary' | 'regression';

export interface BinaryMetrics {
  val_f1?: number | null;
  val_precision?: number | null;
  val_recall?: number | null;
  val_accuracy?: number | null;
}

export interface RegressionMetrics {
  pearson_r?: number | null;
  spearman_r?: number | null;
  r_squared?: number | null;
  val_mse?: number | null;
}

export interface ManifestEntry {
  slug: string;
  display_name: string;
  published_at: string;
  started_at?: string | null;
  target_type: TargetType;
  binary_metrics: BinaryMetrics;
  regression_metrics: RegressionMetrics;
  best_metric_name: string;
  best_metric_value: number;
  best_epoch: number | null;
  epochs_total: number | null;
  early_stopped: boolean;
  train_samples?: number | null;
  val_samples?: number | null;
  test_samples?: number | null;
  status: RunStatus;
  status_note: string;
}

export interface Manifest {
  schema_version: 1;
  generated_at: string;
  runs: ManifestEntry[];
}

export interface RunIndex {
  schema_version: 1;
  slug: string;
  display_name: string;
  published_at: string;
  started_at?: string | null;
  config_summary: {
    model: string | null;
    target_type: TargetType;
    epochs_configured: number | null;
    lr_schedule: string | null;
    early_stopping_patience: number | null;
    head_dropout: number | null;
    class_weighting: string | null;
    label_source: string | null;
  };
  metrics: BinaryMetrics & RegressionMetrics & {
    best_f1?: number | null;
    best_epoch: number | null;
    epochs_completed: number | null;
    early_stopped_epoch: number | null;
  };
  diagnosis: { status: RunStatus; note: string };
  data: {
    train_samples: number | null;
    val_samples: number | null;
    test_samples: number | null;
    class_balance: {
      negative: number | null;
      positive: number | null;
      ratio: number | null;
    };
    label_distribution?: {
      train?: Record<string, number> | null;
      val?: Record<string, number> | null;
      test?: Record<string, number> | null;
    };
  };
  assets: {
    loss_curves_png: string;
    label_distribution_png: string;
    config_yaml: string;
    failure_gallery_json: string;
  };
}

export interface FailureGalleryItem {
  snapshot_id: string;
  webcam_id: number | null;
  image_url: string | null;
  true_label: number;
  predicted_score: number;
  absolute_error: number;
  captured_at: string | null;
  llm_explanation: string | null;
}

export interface FailureGallery {
  schema_version: 1;
  generated_at: string;
  split: string;
  target_type: TargetType;
  items: FailureGalleryItem[];
}
