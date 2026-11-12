"""
ml_utils.py
-----------
Shared between train_model.py (training) and app.py (inference).

Everything the model needs at prediction time - zero->missing handling,
imputation and scaling - lives INSIDE the sklearn Pipeline, so the app can
feed raw user input straight in and get the same preprocessing as training.

Keep this file importable: the pickled pipeline references ZeroToNaN by
module path, so app.py must be able to `import ml_utils`.
"""

import numpy as np
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.impute import KNNImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

FEATURE_COLS = [
    "Pregnancies",
    "Glucose",
    "BloodPressure",
    "SkinThickness",
    "Insulin",
    "BMI",
    "DiabetesPedigreeFunction",
    "Age",
]
TARGET_COL = "Outcome"

# In the Pima dataset a 0 in these columns is biologically impossible - it
# means "not measured". We treat those zeros as missing values.
ZERO_AS_MISSING_COLS = ["Glucose", "BloodPressure", "SkinThickness", "Insulin", "BMI"]


class ZeroToNaN(BaseEstimator, TransformerMixin):
    """Replace impossible zeros with NaN so the imputer can fill them."""

    def __init__(self, columns=None):
        self.columns = columns

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        X = X.copy()
        cols = self.columns if self.columns is not None else ZERO_AS_MISSING_COLS
        for col in cols:
            X[col] = X[col].replace(0, np.nan)
        return X


def build_pipeline(model, n_neighbors: int = 5) -> Pipeline:
    """zeros -> NaN  ->  scale  ->  KNN-impute  ->  model.

    Scaling happens BEFORE the KNN imputer on purpose: KNN uses distances,
    and unscaled Insulin (0-846) would drown out every other feature.
    All steps are fitted on training folds only, so there is no data leakage.
    """
    return Pipeline(
        steps=[
            ("zero_to_nan", ZeroToNaN()),
            ("scaler", StandardScaler()),
            ("imputer", KNNImputer(n_neighbors=n_neighbors)),
            ("model", model),
        ]
    )
