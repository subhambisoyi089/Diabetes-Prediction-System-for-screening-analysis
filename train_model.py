"""
train_model.py
--------------
Trains ML models on diabetes datasets and saves what the Flask app needs.
Supports both:
  1. Diverse Multi-Cohort Dataset (Male & Female clinical patients, NHANES & Pima combined)
  2. Classic Pima Indians Dataset (Female cohort only)

Features:
    * Preprocessing Pipeline (zeros -> NaN -> scale -> KNN-impute).
    * Class imbalance handled with class weights.
    * 5-fold stratified cross-validation, picking best model by CV ROC-AUC.
    * Multi-gender evaluation: computes separate metrics for male vs. female patients.
    * XGBoost automatically included if installed.

Outputs (in models/):
    best_model.pkl          {"name": ..., "model": <fitted Pipeline>}
    all_models.pkl          dict of every fitted Pipeline
    model_comparison.json   CV + hold-out metrics for every model + dataset info + gender metrics
    population_stats.json   mean/std per feature, split by outcome
    background.json         small reference sample used for explanations

Run:
    python train_model.py                    # Auto-selects diverse dataset if available
    python train_model.py --dataset pima     # Explicitly train on classic Pima
    python train_model.py --dataset diverse  # Explicitly train on diverse cohort
"""

import argparse
import json
import os
import pickle
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC

from ml_utils import FEATURE_COLS, TARGET_COL, build_pipeline

DIVERSE_DATA_PATH = "data/diabetes_diverse.csv"
PIMA_DATA_PATH = "data/diabetes.csv"
MODELS_DIR = "models"
RANDOM_STATE = 42
CV_FOLDS = 5
BACKGROUND_SIZE = 40


def load_data(dataset_choice: str = "auto") -> tuple[pd.DataFrame, dict]:
    """Load the dataset (diverse multi-cohort or classic Pima)."""
    if dataset_choice == "pima":
        path = PIMA_DATA_PATH
    elif dataset_choice == "diverse":
        path = DIVERSE_DATA_PATH
    else:
        path = DIVERSE_DATA_PATH if os.path.exists(DIVERSE_DATA_PATH) else PIMA_DATA_PATH

    if not os.path.exists(path):
        raise SystemExit(f"Dataset not found at {path}. Run data/generate_diverse_dataset.py first.")

    df = pd.read_csv(path)
    missing = set(FEATURE_COLS + [TARGET_COL]) - set(df.columns)
    if missing:
        raise SystemExit(f"{path} is missing columns: {sorted(missing)}")

    has_gender = "Gender" in df.columns
    total = len(df)
    males = int((df["Gender"] == "male").sum()) if has_gender else 0
    females = int((df["Gender"] == "female").sum()) if has_gender else total

    dataset_info = {
        "file": os.path.basename(path),
        "is_diverse": "diverse" in path.lower() or has_gender,
        "name": (
            "Diverse Multi-Cohort (Male & Female Clinical Records)"
            if (has_gender and males > 0)
            else "Pima Indians Diabetes Cohort (Female Only)"
        ),
        "total_records": total,
        "male_records": males,
        "female_records": females,
        "diabetic_records": int((df[TARGET_COL] == 1).sum()),
        "non_diabetic_records": int((df[TARGET_COL] == 0).sum()),
    }
    return df, dataset_info


def compute_population_stats(df: pd.DataFrame) -> dict:
    """Mean/std per feature, split by outcome and gender if available."""
    clean = df.copy()
    for col in ["Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI"]:
        clean[col] = clean[col].replace(0, np.nan)

    def block(frame):
        return {
            col: {
                "mean": round(float(frame[col].mean()), 2) if len(frame) and not np.isnan(frame[col].mean()) else 0.0,
                "std": round(float(frame[col].std()), 2) if len(frame) and not np.isnan(frame[col].std()) else 0.0,
            }
            for col in FEATURE_COLS
        }

    stats = {
        "overall": block(clean),
        "diabetic": block(clean[clean[TARGET_COL] == 1]),
        "non_diabetic": block(clean[clean[TARGET_COL] == 0]),
    }

    if "Gender" in clean.columns:
        stats["male"] = block(clean[clean["Gender"] == "male"])
        stats["female"] = block(clean[clean["Gender"] == "female"])

    return stats


def candidate_models() -> dict:
    models = {
        "Logistic Regression": LogisticRegression(
            max_iter=2500, class_weight="balanced", random_state=RANDOM_STATE
        ),
        "Random Forest": RandomForestClassifier(
            n_estimators=300,
            min_samples_leaf=3,
            class_weight="balanced",
            random_state=RANDOM_STATE,
            n_jobs=-1,
        ),
        "SVM (RBF Kernel)": SVC(
            probability=True, class_weight="balanced", random_state=RANDOM_STATE
        ),
        "K-Nearest Neighbors": KNeighborsClassifier(n_neighbors=15, weights="distance"),
        "Gradient Boosting": HistGradientBoostingClassifier(
            max_depth=3,
            learning_rate=0.05,
            max_iter=200,
            class_weight="balanced",
            random_state=RANDOM_STATE,
        ),
    }
    try:
        from xgboost import XGBClassifier

        models["XGBoost"] = XGBClassifier(
            n_estimators=250,
            max_depth=3,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            scale_pos_weight=1.5,
            eval_metric="logloss",
            random_state=RANDOM_STATE,
        )
    except ImportError:
        pass
    return models


def evaluate(pipe, X_train, y_train, X_test, y_test, cv, gender_test=None) -> tuple:
    """Cross-validate on the training set, fit, and score on the hold-out test set."""
    scoring = ["accuracy", "precision", "recall", "f1", "roc_auc"]
    cv_res = cross_validate(pipe, X_train, y_train, cv=cv, scoring=scoring, n_jobs=1)

    pipe.fit(X_train, y_train)
    preds = pipe.predict(X_test)
    proba = pipe.predict_proba(X_test)[:, 1]

    def pct(x):
        return round(float(x) * 100, 2)

    metrics = {
        # hold-out test set
        "accuracy": pct(accuracy_score(y_test, preds)),
        "precision": pct(precision_score(y_test, preds, zero_division=0)),
        "recall": pct(recall_score(y_test, preds)),
        "f1_score": pct(f1_score(y_test, preds)),
        "roc_auc": pct(roc_auc_score(y_test, proba)),
        # cross-validation (train set, 5 folds)
        "cv_accuracy": pct(cv_res["test_accuracy"].mean()),
        "cv_accuracy_std": pct(cv_res["test_accuracy"].std()),
        "cv_recall": pct(cv_res["test_recall"].mean()),
        "cv_f1": pct(cv_res["test_f1"].mean()),
        "cv_roc_auc": pct(cv_res["test_roc_auc"].mean()),
        "cv_roc_auc_std": pct(cv_res["test_roc_auc"].std()),
    }

    # Gender-segmented test metrics if gender column provided
    if gender_test is not None:
        male_idx = gender_test == "male"
        female_idx = gender_test == "female"

        if male_idx.sum() > 0:
            y_m = y_test[male_idx]
            p_m = preds[male_idx]
            pr_m = proba[male_idx]
            metrics["male_accuracy"] = pct(accuracy_score(y_m, p_m))
            metrics["male_recall"] = pct(recall_score(y_m, p_m, zero_division=0))
            metrics["male_roc_auc"] = pct(roc_auc_score(y_m, pr_m)) if len(np.unique(y_m)) > 1 else None

        if female_idx.sum() > 0:
            y_f = y_test[female_idx]
            p_f = preds[female_idx]
            pr_f = proba[female_idx]
            metrics["female_accuracy"] = pct(accuracy_score(y_f, p_f))
            metrics["female_recall"] = pct(recall_score(y_f, p_f, zero_division=0))
            metrics["female_roc_auc"] = pct(roc_auc_score(y_f, pr_f)) if len(np.unique(y_f)) > 1 else None

    return pipe, metrics


def main():
    parser = argparse.ArgumentParser(description="Train Diabetes Risk ML Models")
    parser.add_argument(
        "--dataset",
        choices=["auto", "diverse", "pima"],
        default="auto",
        help="Dataset choice (default: diverse if available)",
    )
    args = parser.parse_args()

    os.makedirs(MODELS_DIR, exist_ok=True)
    df, dataset_info = load_data(args.dataset)

    print(f"\n=======================================================")
    print(f"  Training on: {dataset_info['name']}")
    print(f"  Total records: {dataset_info['total_records']}")
    print(f"  Males: {dataset_info['male_records']} | Females: {dataset_info['female_records']}")
    print(f"=======================================================\n")

    X, y = df[FEATURE_COLS], df[TARGET_COL]
    gender_series = df["Gender"] if "Gender" in df.columns else None

    if gender_series is not None:
        X_train, X_test, y_train, y_test, g_train, g_test = train_test_split(
            X, y, gender_series, test_size=0.2, random_state=RANDOM_STATE, stratify=y
        )
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y
        )
        g_test = None

    cv = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=RANDOM_STATE)

    trained, comparison = {}, {}
    for name, model in candidate_models().items():
        print(f"Training {name} ...")
        pipe, metrics = evaluate(build_pipeline(model), X_train, y_train, X_test, y_test, cv, gender_test=g_test)
        trained[name] = pipe
        comparison[name] = metrics

    # Best = highest cross-validated ROC-AUC
    best_name = max(comparison, key=lambda k: comparison[k]["cv_roc_auc"])

    print("\nResults (CV = 5-fold on train set, Test = untouched 20%):")
    header = f"  {'Model':22s} {'CV AUC':>14s} {'Test acc':>9s} {'Test rec':>9s} {'Test F1':>8s}"
    if g_test is not None:
        header += f" {'Male Acc':>9s} {'Fem Acc':>9s}"
    print(header)

    for name, m in comparison.items():
        mark = "  <-- BEST" if name == best_name else ""
        row = (
            f"  {name:22s} {m['cv_roc_auc']:6.2f}±{m['cv_roc_auc_std']:4.2f}"
            f" {m['accuracy']:9.2f} {m['recall']:9.2f} {m['f1_score']:8.2f}"
        )
        if g_test is not None:
            m_acc = f"{m.get('male_accuracy', 0):6.1f}%"
            f_acc = f"{m.get('female_accuracy', 0):6.1f}%"
            row += f" {m_acc:>9s} {f_acc:>9s}"
        row += mark
        print(row)

    # Reference sample for the explanation module
    background = X_train.sample(BACKGROUND_SIZE, random_state=RANDOM_STATE)

    with open(f"{MODELS_DIR}/best_model.pkl", "wb") as f:
        pickle.dump({"name": best_name, "model": trained[best_name]}, f)
    with open(f"{MODELS_DIR}/all_models.pkl", "wb") as f:
        pickle.dump(trained, f)
    with open(f"{MODELS_DIR}/model_comparison.json", "w") as f:
        json.dump(
            {
                "comparison": comparison,
                "best_model": best_name,
                "cv_folds": CV_FOLDS,
                "dataset_info": dataset_info,
            },
            f,
            indent=2,
        )
    with open(f"{MODELS_DIR}/population_stats.json", "w") as f:
        json.dump(compute_population_stats(df), f, indent=2)
    with open(f"{MODELS_DIR}/background.json", "w") as f:
        json.dump(background.values.tolist(), f)

    print(f"\nBest model: {best_name}  ->  saved to {MODELS_DIR}/")


if __name__ == "__main__":
    main()
