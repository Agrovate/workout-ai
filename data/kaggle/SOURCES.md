# Kaggle data sources

The model-evaluation notebook (`model_metrics.ipynb`) is trained and validated on
real public workout logs rather than the synthetic `backend/dev.db` seed.

## Datasets referenced

| File | Kaggle dataset | Used for |
|------|----------------|----------|
| `weightlifting_721_workouts.csv` | [joep89/weightlifting](https://www.kaggle.com/datasets/joep89/weightlifting) | **Primary training data.** A single lifter's Strong-app export, 9,932 sets across 583 sessions (2015-10 → 2018-09), 83 exercises. Set-level `Date / Exercise / Set Order / Weight / Reps`, which is exactly what `ProgressionPredictor` needs. |
| `exercise_dataset.csv` | [aakashjoshi123/exercise-and-fitness-metrics-dataset](https://www.kaggle.com/datasets/aakashjoshi123/exercise-and-fitness-metrics-dataset) | Context only. One row per activity with calories, heart rate, BMI, duration — no per-set progression, so it is **not** fed to the progression model. Kept for the effort/HR exploratory plots. |

## Datasets that were evaluated but not used

- [praveenkumarsatya/workout](https://www.kaggle.com/datasets/praveenkumarsatya/workout) — routine/plan descriptions, no logged set history.
- [valakhorasani/gym-members-exercise-dataset](https://www.kaggle.com/datasets/valakhorasani/gym-members-exercise-dataset) — one aggregate row per gym member (session averages, no time series).

Neither contains the per-session weight progression the model predicts, so they
are documented here for completeness but not ingested.

## Regenerating

```
# CSVs are committed under data/kaggle/. To refresh from Kaggle:
kaggle datasets download -d joep89/weightlifting -p data/kaggle --unzip
kaggle datasets download -d aakashjoshi123/exercise-and-fitness-metrics-dataset -p data/kaggle --unzip
```

Ingestion into the record format used by `app.ml.features.build_training_dataset`
is handled by `scripts/ingest_kaggle.py`.
