"""
app.py
------
Flask backend for the Diabetes Risk Prediction System.

Pages
    GET  /login, /register      accounts (see auth.py)
    GET  /                      BMI + lifestyle inputs -> risk prediction   [login]
    GET  /dashboard             saved assessments and progress over time    [login]
    GET  /models                model comparison                            [public]

API (JSON)
    POST   /api/bmi               height/weight -> BMI + category
    POST   /api/estimate          lifestyle sliders -> estimated glucose & BP
    POST   /api/predict           risk %, health score, explanation, comparison  [login]
    GET    /api/history           all saved assessments of the current user      [login]
    GET    /api/history/<id>      one saved assessment (for PDF report)          [login]
    DELETE /api/history/<id>      delete one assessment                          [login]
    GET    /api/model-comparison  metrics of every trained model

Run:  python3 app.py          (development)
      gunicorn "app:create_app()"   (production, see Dockerfile)
"""

import json
import os
import pickle
import secrets
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, g, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from auth import init_auth, login_required
from db import get_db, init_db
from explain import explain_prediction
from ml_utils import FEATURE_COLS

BASE_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Errors + input validation
# ---------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, message, field=None, status=400):
        super().__init__(message)
        self.message, self.field, self.status = message, field, status


def num(data, key, lo, hi, *, label=None, default=None, integer=False):
    """Read a number from the JSON body and check its range."""
    label = label or key.replace("_", " ").capitalize()
    raw = data.get(key)
    if raw is None or raw == "":
        if default is None:
            raise ApiError(f"{label} is required.", key)
        raw = default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ApiError(f"{label} must be a number.", key)
    if not np.isfinite(value) or not lo <= value <= hi:
        raise ApiError(f"{label} must be between {lo:g} and {hi:g}.", key)
    return int(round(value)) if integer else value


def as_bool(value) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def json_body() -> dict:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("Send a JSON object.")
    return data


# ---------------------------------------------------------------------------
# Domain helpers
# ---------------------------------------------------------------------------
def estimate_glucose(sugar_diet: float, activity: float, family_history: bool, age: int) -> float:
    """Estimate glucose level (mg/dL) from lifestyle sliders instead of a
    direct lab-value entry. sugar_diet & activity are 1-10 scales."""
    base = 90
    base += sugar_diet * 3.2
    base -= activity * 2.1
    base += 12 if family_history else 0
    base += (age - 30) * 0.15 if age > 30 else 0
    return round(float(np.clip(base, 70, 200)), 1)


def estimate_bp(stress: float, salt_intake: float, exercise: float, age: int) -> float:
    """Estimate a blood-pressure proxy from lifestyle sliders."""
    base = 68
    base += stress * 2.0
    base += salt_intake * 1.6
    base -= exercise * 1.3
    base += (age - 30) * 0.25 if age > 30 else 0
    return round(float(np.clip(base, 50, 140)), 1)


def calc_bmi(weight_kg: float, height_cm: float) -> float:
    height_m = height_cm / 100
    return round(weight_kg / (height_m**2), 1)


def bmi_category(bmi: float) -> str:
    if bmi < 18.5:
        return "Underweight"
    if bmi < 25:
        return "Normal"
    if bmi < 30:
        return "Overweight"
    return "Obese"


def risk_level(risk_pct: float) -> str:
    if risk_pct < 30:
        return "low"
    if risk_pct < 50:
        return "moderate"
    return "high"


def health_rating(score: int) -> str:
    if score >= 80:
        return "Optimal"
    if score >= 68:
        return "Good"
    if score >= 50:
        return "Fair"
    return "Needs Attention"


def calc_health_score(
    risk_pct: float,
    bmi: float,
    age: int,
    activity: float = 5.0,
    glucose: float = 100.0,
    blood_pressure: float = 80.0,
    sugar_diet: float = 5.0,
    stress: float = 5.0,
    salt_intake: float = 5.0,
) -> int:
    """Composite metabolic health score out of 100. Evaluates diabetes model
    risk, BMI, fasting glucose, blood pressure, dietary sugar/salt, stress,
    and physical activity."""
    score = 100.0

    # 1. Diabetes model risk penalty (up to -25 pts)
    score -= min(risk_pct * 0.4, 25.0)

    # 2. BMI grading (WHO clinical guidelines)
    if bmi < 18.5:
        score -= 10.0  # underweight
    elif 18.5 <= bmi < 25.0:
        score -= 0.0   # healthy weight
    elif 25.0 <= bmi < 30.0:
        score -= 8.0   # overweight
    elif 30.0 <= bmi < 35.0:
        score -= 18.0  # class 1 obesity
    elif 35.0 <= bmi < 40.0:
        score -= 24.0  # class 2 obesity
    else:
        score -= 30.0  # class 3 severe/morbid obesity

    # 3. Fasting Glucose (ADA clinical guidelines: <100 normal, 100-125 prediabetes, >=126 diabetes)
    if glucose >= 126:
        score -= 22.0
    elif glucose >= 110:
        score -= 12.0
    elif glucose >= 100:
        score -= 7.0   # impaired fasting glucose / prediabetic

    # 4. Diastolic Blood Pressure (AHA guidelines: <80 normal, 80-89 stage 1, >=90 stage 2)
    if blood_pressure >= 90:
        score -= 14.0
    elif blood_pressure >= 80:
        score -= 6.0   # elevated / stage 1

    # 5. Dietary factors (sugar & salt 1-10, 5 is baseline)
    if sugar_diet > 5:
        score -= (sugar_diet - 5) * 1.5  # up to -7.5 pts
    if salt_intake > 5:
        score -= (salt_intake - 5) * 1.0  # up to -5.0 pts

    # 6. Stress level (1-10, 5 is baseline)
    if stress > 5:
        score -= (stress - 5) * 1.2  # up to -6.0 pts

    # 7. Physical activity bonus/penalty (1-10, 5 is baseline)
    score += (activity - 5) * 1.5  # up to +7.5 pts bonus, or -6.0 penalty

    # 8. Age factor (mild baseline biological adjustment)
    if age > 50:
        score -= 3.0
    if age > 65:
        score -= 3.0

    return int(np.clip(round(score), 5, 100))


def pedigree_from_family_history(has_family_history: bool) -> float:
    """The dataset's 'pedigree function' is a continuous score (median ~0.37).
    Without a real pedigree calculation, map the yes/no answer to a typical
    low / high value from the dataset."""
    return 0.7 if has_family_history else 0.25


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------
def load_secret_key(instance_dir: Path) -> str:
    """SECRET_KEY env var wins; otherwise create one once and keep it in the
    instance folder so sessions survive restarts."""
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    path = instance_dir / "secret_key"
    if path.exists():
        return path.read_text().strip()
    # Several gunicorn workers may start at once. Write to a temp file and
    # hard-link it into place: the link is atomic, so exactly one key wins
    # and every worker reads that same key.
    tmp = path.with_name(f"secret_key.{os.getPid()}.tmp")
    tmp.write_text(secrets.token_hex(32))
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    try:
        os.link(tmp, path)
    except FileExistsError:
        pass
    except OSError:  # filesystem without hard links
        if not path.exists():
            os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return path.read_text().strip()


def load_artifacts(models_dir: Path) -> dict:
    try:
        with open(models_dir / "best_model.pkl", "rb") as f:
            best = pickle.load(f)
        with open(models_dir / "model_comparison.json") as f:
            comparison = json.load(f)
        with open(models_dir / "population_stats.json") as f:
            population = json.load(f)
        with open(models_dir / "background.json") as f:
            background = np.array(json.load(f), dtype=float)
    except FileNotFoundError as exc:
        raise SystemExit(
            f"Missing model file ({exc.filename}).\n"
            "Train the models first:  python3 train_model.py"
        )
    return {
        "name": best["name"],
        "pipeline": best["model"],
        "comparison": comparison,
        "population": population,
        "background": background,
    }


def create_app(test_config=None) -> Flask:
    instance_dir = BASE_DIR / "instance"
    instance_dir.mkdir(exist_ok=True)

    app = Flask(__name__, instance_path=str(instance_dir))
    app.config.update(
        DATABASE=os.environ.get("DATABASE_PATH", str(instance_dir / "app.db")),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE") == "1",
        PERMANENT_SESSION_LIFETIME=14 * 24 * 3600,  # "remember me" = 14 days
        MAX_CONTENT_LENGTH=64 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    if not app.config.get("SECRET_KEY"):
        app.config["SECRET_KEY"] = load_secret_key(instance_dir)

    init_db(app)
    init_auth(app)
    ml = load_artifacts(BASE_DIR / "models")

    # ---------------- security headers ----------------
    @app.after_request
    def security_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://cdnjs.cloudflare.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com; "
            "img-src 'self' data:; connect-src 'self'; "
            "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        return resp

    # ---------------- errors ----------------
    @app.errorhandler(ApiError)
    def handle_api_error(err):
        return jsonify(error=err.message, field=err.field), err.status

    @app.errorhandler(HTTPException)
    def handle_http_error(err):
        if request.path.startswith("/api/"):
            return jsonify(error=err.description), err.code
        return err

    # ---------------- pages ----------------
    @app.route("/")
    @login_required
    def index():
        return render_template("index.html")

    @app.route("/dashboard")
    @login_required
    def dashboard():
        return render_template("dashboard.html")

    @app.route("/models")
    def models_page():
        return render_template("models.html")

    @app.route("/deploy")
    def deploy_page():
        return render_template("deploy.html")

    # ---------------- API: calculators ----------------
    @app.route("/api/bmi", methods=["POST"])
    def api_bmi():
        data = json_body()
        weight = num(data, "weight_kg", 20, 300, label="Weight")
        height = num(data, "height_cm", 100, 250, label="Height")
        bmi = calc_bmi(weight, height)
        return jsonify({"bmi": bmi, "category": bmi_category(bmi)})

    @app.route("/api/estimate", methods=["POST"])
    def api_estimate():
        data = json_body()
        age = num(data, "age", 18, 100, label="Age", integer=True)
        activity = num(data, "activity", 1, 10, label="Activity")
        glucose = estimate_glucose(
            sugar_diet=num(data, "sugar_diet", 1, 10, label="Sugar intake"),
            activity=activity,
            family_history=as_bool(data.get("family_history", False)),
            age=age,
        )
        bp = estimate_bp(
            stress=num(data, "stress", 1, 10, label="Stress"),
            salt_intake=num(data, "salt_intake", 1, 10, label="Salt intake"),
            exercise=activity,
            age=age,
        )
        return jsonify({"glucose": glucose, "blood_pressure": bp})

    # ---------------- API: prediction ----------------
    @app.route("/api/predict", methods=["POST"])
    @login_required
    def api_predict():
        data = json_body()
        family_history = as_bool(data.get("family_history", False))

        skin = num(data, "skin_thickness", 0, 100, label="Skin thickness", default=0)
        insulin = num(data, "insulin", 0, 900, label="Insulin", default=0)
        if data.get("pedigree") not in (None, ""):
            pedigree = num(data, "pedigree", 0.05, 2.5, label="Pedigree")
        else:
            pedigree = pedigree_from_family_history(family_history)

        features = [
            num(data, "pregnancies", 0, 20, label="Pregnancies", integer=True),
            num(data, "glucose", 40, 400, label="Glucose"),
            num(data, "blood_pressure", 30, 200, label="Blood pressure"),
            skin,
            insulin,
            num(data, "bmi", 10, 70, label="BMI"),
            pedigree,
            num(data, "age", 18, 100, label="Age", integer=True),
        ]
        activity = num(data, "activity", 1, 10, label="Activity", default=5)

        # 0 means "not provided" - the pipeline imputes it. Tell the UI which
        # values were filled in by the model rather than entered by the user.
        missing = {n for n, v in zip(FEATURE_COLS, features) if n in ("SkinThickness", "Insulin") and v == 0}

        pipeline = ml["pipeline"]
        X = pd.DataFrame([features], columns=FEATURE_COLS)
        proba = float(pipeline.predict_proba(X)[0][1])
        risk_pct = round(proba * 100, 1)

        user_values = dict(zip(FEATURE_COLS, features))
        comparison = {
            feat: {
                "you": user_values[feat],
                "non_diabetic_avg": ml["population"]["non_diabetic"][feat]["mean"],
                "diabetic_avg": ml["population"]["diabetic"][feat]["mean"],
            }
            for feat in ["Glucose", "BloodPressure", "BMI", "Age"]
        }

        sugar_diet = num(data, "sugar_diet", 1, 10, label="Sugar intake", default=5)
        stress = num(data, "stress", 1, 10, label="Stress", default=5)
        salt_intake = num(data, "salt_intake", 1, 10, label="Salt intake", default=5)

        health_sc = calc_health_score(
            risk_pct=risk_pct,
            bmi=features[5],
            age=features[7],
            activity=activity,
            glucose=features[1],
            blood_pressure=features[2],
            sugar_diet=sugar_diet,
            stress=stress,
            salt_intake=salt_intake,
        )

        result = {
            "risk_percent": risk_pct,
            "prediction": "High Risk" if proba >= 0.5 else "Low Risk",
            "risk_level": risk_level(risk_pct),
            "model_used": ml["name"],
            "health_score": health_sc,
            "health_rating": health_rating(health_sc),
            "population_comparison": comparison,
            "explanation": explain_prediction(pipeline, features, ml["background"], missing),
        }

        assessment_id, created_at = None, datetime.now(timezone.utc).isoformat(timespec="seconds")
        if as_bool(data.get("save", True)):
            inputs = dict(user_values)
            inputs["activity"] = activity
            inputs["family_history"] = family_history
            inputs["gender"] = str(data.get("gender", "female")).strip()
            for key in ("sugar_diet", "stress", "salt_intake", "height_cm", "weight_kg"):
                try:
                    inputs[key] = float(data[key])
                except (KeyError, TypeError, ValueError):
                    pass
            db = get_db()
            cur = db.execute(
                """INSERT INTO assessments
                   (user_id, created_at, risk_percent, prediction, health_score, bmi,
                    glucose, blood_pressure, age, model_used, inputs, result)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    g.user["id"], created_at, risk_pct, result["prediction"],
                    result["health_score"], features[5], features[1], features[2],
                    features[7], ml["name"], json.dumps(inputs), json.dumps(result),
                ),
            )
            db.commit()
            assessment_id = cur.lastrowid

        return jsonify({**result, "assessment_id": assessment_id, "created_at": created_at})

    # ---------------- API: history ----------------
    @app.route("/api/history")
    @login_required
    def api_history():
        rows = get_db().execute(
            """SELECT id, created_at, risk_percent, prediction, health_score,
                      bmi, glucose, blood_pressure, age
               FROM assessments WHERE user_id = ?
               ORDER BY created_at ASC, id ASC LIMIT 500""",
            (g.user["id"],),
        ).fetchall()
        return jsonify({"assessments": [dict(r) for r in rows], "user": g.user["name"]})

    def _own_assessment(assessment_id: int):
        row = get_db().execute(
            "SELECT * FROM assessments WHERE id = ? AND user_id = ?",
            (assessment_id, g.user["id"]),
        ).fetchone()
        if row is None:
            raise ApiError("Assessment not found.", status=404)
        return row

    @app.route("/api/history/<int:assessment_id>")
    @login_required
    def api_history_detail(assessment_id):
        row = _own_assessment(assessment_id)
        return jsonify(
            {
                "id": row["id"],
                "created_at": row["created_at"],
                "inputs": json.loads(row["inputs"]),
                "result": json.loads(row["result"]),
                "user": g.user["name"],
            }
        )

    @app.route("/api/history/<int:assessment_id>", methods=["DELETE"])
    @login_required
    def api_history_delete(assessment_id):
        _own_assessment(assessment_id)
        db = get_db()
        db.execute("DELETE FROM assessments WHERE id = ?", (assessment_id,))
        db.commit()
        return jsonify(deleted=assessment_id)

    # ---------------- API: models ----------------
    @app.route("/api/model-comparison")
    def api_model_comparison():
        return jsonify(ml["comparison"])

    return app


if __name__ == "__main__":
    create_app().run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", 5000)),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
