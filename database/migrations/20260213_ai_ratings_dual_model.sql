-- AI Ratings dual-model schema extension.
-- Purpose:
-- 1) Keep legacy ai_rating/ai_model_version for compatibility.
-- 2) Store explicit binary and regression webcam-level ratings for popup/UI.

ALTER TABLE webcams
ADD COLUMN IF NOT EXISTS ai_rating_binary DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS ai_model_version_binary TEXT,
ADD COLUMN IF NOT EXISTS ai_rating_regression DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS ai_model_version_regression TEXT;
