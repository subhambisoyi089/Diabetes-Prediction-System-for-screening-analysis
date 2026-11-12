"""
explain.py
----------
Explains WHY the model gave a certain risk, feature by feature.

We compute exact Shapley values (the same quantity the `shap` library
estimates). With only 8 features there are 2^8 = 256 feature subsets, so the
exact answer is cheap and no approximation or extra dependency is needed.

How it works
    A feature's Shapley value is its average marginal effect on the model's
    output across every possible ordering of the features. "Feature absent"
    is simulated by swapping in values from a small background sample of real
    patients. The result is additive:

        risk(you) = average_risk(background) + sum(feature contributions)

    and it works for any model that has predict_proba (all of ours do).
"""

from math import factorial

import numpy as np
import pandas as pd

from ml_utils import FEATURE_COLS

LABELS = {
    "Pregnancies": "Pregnancies",
    "Glucose": "Glucose",
    "BloodPressure": "Blood pressure",
    "SkinThickness": "Skin thickness",
    "Insulin": "Insulin",
    "BMI": "BMI",
    "DiabetesPedigreeFunction": "Family history",
    "Age": "Age",
}

_N = len(FEATURE_COLS)
_MASKS = np.array(
    [[(m >> i) & 1 for i in range(_N)] for m in range(2**_N)], dtype=bool
)  # (256, 8): row m says which features are "present" in coalition m
_WEIGHTS = np.array(
    [factorial(s) * factorial(_N - s - 1) / factorial(_N) for s in range(_N)]
)
_POPCOUNT = _MASKS.sum(axis=1)


def shapley_contributions(pipeline, x: np.ndarray, background: np.ndarray) -> dict:
    """Return baseline, prediction and per-feature contributions (all in 0-1
    probability units) for one row `x` of raw feature values."""
    n_bg = len(background)

    # For every coalition, build n_bg rows: features in the coalition take the
    # user's value, the rest come from a background patient.
    data = np.where(_MASKS[:, None, :], x[None, None, :], background[None, :, :])
    frame = pd.DataFrame(data.reshape(-1, _N), columns=FEATURE_COLS)
    proba = pipeline.predict_proba(frame)[:, 1].reshape(2**_N, n_bg)
    v = proba.mean(axis=1)  # value of each coalition

    phi = np.zeros(_N)
    for i in range(_N):
        bit = 1 << i
        for m in range(2**_N):
            if not m & bit:
                phi[i] += _WEIGHTS[_POPCOUNT[m]] * (v[m | bit] - v[m])

    return {"baseline": float(v[0]), "prediction": float(v[-1]), "phi": phi}


def explain_prediction(pipeline, features: list, background: np.ndarray, missing: set) -> dict:
    """Build the JSON the frontend draws.

    features   raw values in FEATURE_COLS order
    missing    names of features the user left blank (they were imputed)
    """
    x = np.asarray(features, dtype=float)
    res = shapley_contributions(pipeline, x, background)

    contributions = []
    for name, value, phi in zip(FEATURE_COLS, features, res["phi"]):
        contributions.append(
            {
                "feature": name,
                "label": LABELS[name],
                "value": value,
                "impact_pts": round(float(phi) * 100, 1),  # percentage points
                "direction": "raises" if phi > 0 else "lowers",
                "imputed": name in missing,
            }
        )
    contributions.sort(key=lambda c: abs(c["impact_pts"]), reverse=True)

    return {
        "baseline_percent": round(res["baseline"] * 100, 1),
        "contributions": contributions,
    }
