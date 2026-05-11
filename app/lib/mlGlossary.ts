// app/lib/mlGlossary.ts

export interface GlossaryEntry {
  /** Human-readable name shown inline. */
  label: string;
  /** ~1 sentence — fits in a tooltip. */
  short: string;
  /** 2-4 sentences — shown in the click-to-expand popover. */
  long: string;
}

export const ML_GLOSSARY: Record<string, GlossaryEntry> = {
  // Metrics
  val_f1: {
    label: 'F1 score',
    short: 'Combined precision + recall, 0 to 1, higher is better.',
    long: 'The harmonic mean of precision (how many predicted positives were correct) and recall (how many real positives were caught). F1 of 1.0 is perfect; 0.0 is random. Well-tuned sunset classifiers reach 0.88-0.92.',
  },
  val_precision: {
    label: 'Precision',
    short: 'Of the images flagged as sunsets, how many actually were.',
    long: 'Precision = true positives / (true positives + false positives). High precision means few false alarms — when the model says "sunset", it usually is one.',
  },
  val_recall: {
    label: 'Recall',
    short: 'Of all actual sunsets, how many the model caught.',
    long: 'Recall = true positives / (true positives + false negatives). For an "archive great sunsets" pipeline this is the key metric — missing a sunset is worse than capturing a mediocre one.',
  },
  val_accuracy: {
    label: 'Accuracy',
    short: 'Fraction of all predictions that were correct.',
    long: 'Accuracy is misleading on imbalanced data. With 80% non-sunsets, a model that always predicts "no sunset" scores 80% accuracy while being useless.',
  },
  pearson_r: {
    label: 'Pearson correlation',
    short: 'How strongly predicted scores track true labels, -1 to 1.',
    long: 'Measures linear agreement between predicted and actual quality scores. 1.0 = perfectly aligned, 0.0 = no relationship. The LLM-vs-human validation gate is Pearson > 0.80.',
  },
  spearman_r: {
    label: 'Spearman correlation',
    short: 'Rank correlation, robust to scale differences.',
    long: 'Like Pearson but compares ranked orders instead of raw values. Useful when the model is in the right order but its scores are squashed or stretched.',
  },
  r_squared: {
    label: 'R²',
    short: 'Fraction of variance in true labels the model explains, 0 to 1.',
    long: 'R² = 1 means perfect prediction; R² = 0 means the model does no better than always guessing the mean. Negative values mean the model is worse than guessing the mean.',
  },
  val_mse: {
    label: 'Validation MSE',
    short: 'Mean squared error on the validation set, lower is better.',
    long: 'Average of (predicted − actual)² across the validation set. Squared so that big mistakes count disproportionately more than small ones. Reported in label-units²; for a 0-1 quality target a "good" MSE is roughly < 0.05.',
  },
  best_epoch: {
    label: 'Best epoch',
    short: 'The training pass that produced the saved model.',
    long: 'An epoch is one full pass over the training data. The "best epoch" is the one where validation performance peaked — that checkpoint is what gets saved as best.pt and used for evaluation.',
  },
  early_stopped: {
    label: 'Early stopping',
    short: 'Training stopped after no improvement for N epochs.',
    long: 'A guardrail that halts training once the validation metric has not improved for the configured patience window. Prevents wasted compute and overfitting on long runs.',
  },

  // Diagnosis statuses
  overfitting: {
    label: 'Overfitting',
    short: 'Model memorised training data instead of learning the pattern.',
    long: "Signaled when training loss keeps falling but validation loss rises. The model fits the training set's noise rather than its underlying structure. Fixes include more data, dropout, early stopping, or fewer epochs.",
  },
  healthy: {
    label: 'Healthy',
    short: 'Train and val loss tracked together.',
    long: 'Validation loss kept descending alongside training loss, with no late-epoch divergence. Best case — this run can be deployed as-is or trained longer for marginal gains.',
  },
  mild_overfit: {
    label: 'Mild overfit',
    short: 'Small late-run val-loss drift (5-20%).',
    long: 'Validation loss drifted up slightly after the best epoch. Tolerable but worth adding dropout or shortening training. The saved checkpoint is from the best epoch so the deployed model is still reasonable.',
  },
  severe_overfit: {
    label: 'Severe overfit',
    short: 'Val loss grew >50% after the best epoch.',
    long: 'The model continued training long past the point of useful improvement. Strong indicator that the validation set is too small, labels are noisy, or the model has too much capacity for the data.',
  },

  // Graph terms
  train_loss: {
    label: 'Training loss',
    short: 'How wrong the model is on the data it sees during training.',
    long: 'Loss is a scalar summary of prediction error, computed on each epoch. Training loss almost always decreases — the model is rewarded for getting training examples right. Watching it alone is misleading; pair with validation loss.',
  },
  val_loss: {
    label: 'Validation loss',
    short: 'How wrong the model is on data it has never seen.',
    long: 'Computed on the held-out validation set after each epoch. The gap between training and validation loss reveals generalisation: small gap = the model is learning real patterns; large gap = memorisation.',
  },
  class_balance: {
    label: 'Class balance',
    short: 'How many positive vs. negative examples are in the data.',
    long: 'Severe imbalance (e.g. 4:1 non-sunset to sunset) lets a lazy model score well by always predicting the majority class. The training pipeline upweights the minority class via class_weighting: balanced.',
  },
  class_weighting: {
    label: 'Class weighting',
    short: 'Penalty multiplier for misclassifying rare classes.',
    long: 'When set to "balanced", the loss function upweights minority-class examples in inverse proportion to their frequency. Forces the model to pay attention to rare positives instead of optimizing for majority-class accuracy.',
  },
  threshold_sweep: {
    label: 'Threshold sweep',
    short: 'Tries multiple yes/no cutoffs to find the best one.',
    long: 'A regression model outputs scores in [0, 1]. To convert to a yes/no decision we pick a threshold (e.g. 0.5). The sweep evaluates many thresholds and reports the one that maximises F1, exposing the precision-recall trade-off.',
  },

  // UI terms
  failure_gallery: {
    label: 'Failure gallery',
    short: 'The top-N images the model got most wrong.',
    long: 'Sorted by absolute prediction error. Each card shows the image, the true label, and what the model predicted. The fastest way to find systematic mistakes — labelling errors, blind spots, edge cases.',
  },
  binary_classification: {
    label: 'Binary classification',
    short: 'Yes/no decision per image.',
    long: 'The model outputs the probability of one class (e.g. "sunset"). Reported with F1, precision, recall, accuracy.',
  },
  regression: {
    label: 'Regression',
    short: 'Continuous score per image, typically 0.0 to 1.0.',
    long: 'The model outputs a quality score rather than a yes/no. Reported with Pearson r, Spearman r, R², and MSE. Better suited to the LLM-labeled dataset because human ratings cluster in the middle of the scale.',
  },
  webcam_id: {
    label: 'Webcam ID',
    short: 'Identifier for the camera that captured this image.',
    long: 'Each webcam in the system has a stable integer ID. Useful when investigating systematic failures — if errors cluster on one webcam, the camera angle or framing may be the issue.',
  },
  snapshot_id: {
    label: 'Snapshot ID',
    short: 'Identifier for a single captured frame.',
    long: 'Every image in the archive has a unique snapshot ID. Used to deep-link from the failure gallery back to the database record for human review.',
  },

  // Per-graph "how to read this" content
  graph_loss_curves: {
    label: 'Loss curves',
    short: 'Train and val loss per epoch; dashed line marks the saved checkpoint.',
    long: 'Healthy runs show both curves descending together. Diverging curves (train down, val up) signal overfitting. The dashed vertical line marks the best epoch — the model state that gets saved and deployed.',
  },
  graph_label_distribution: {
    label: 'Label distribution',
    short: 'How ratings are spread across the training data.',
    long: 'Left panel: histogram of raw 1-5 ratings. Right panel: class balance (positive vs negative). Clustering in the middle (2.5-3.5) means most images are "average" — the model will struggle to learn clear positive/negative boundaries.',
  },
  graph_comparison_overlay: {
    label: 'Comparison overlay',
    short: 'Validation metric curves from every run on one axis.',
    long: 'Each line is one experiment. Use this to see how a config change (crop strategy, class weighting, regularisation) moves the validation curve. Higher and more stable is better.',
  },
};

/**
 * Glossary terms from ml/OPERATING_GUIDE.md section 16 that intentionally
 * do not appear in the UI (e.g., implementation jargon not surfaced to users).
 * Adding a term here suppresses the parity test failure.
 */
export const GLOSSARY_SKIP_LIST: string[] = [
  'manifest',       // pipeline CSV, never shown in UI
  'target_type',    // surfaced via "Binary" / "Regression" toggle, not as raw term
  'label_source',   // shown as config field, no UI tooltip needed
  'split',          // not surfaced as a clickable term
  'checkpoint',     // mentioned in best_epoch tooltip, no own term
  'early_stopping', // guide uses "early stopping" (technique); UI surfaces early_stopped (status flag)
  'cosine_lr',      // shown in config dropdown only
  'head_dropout',   // shown in config dropdown only
  'onnx',           // not shown in UI
  'llm_rater',      // not shown in UI (handled by separate disambiguation)
  'domain_shift',   // mentioned indirectly in long-form copy
  'model_card',     // the page IS the model card
];
