"""
auth.py
-------
Everything about accounts:

    GET/POST /register   create an account
    GET/POST /login      sign in (with lockout after repeated failures)
    POST     /logout     sign out

Security measures
    * Passwords are hashed (werkzeug), never stored or logged in plain text
    * CSRF token on every POST/DELETE (forms and fetch() calls)
    * Session is reset on login (prevents session fixation)
    * Same error for "unknown email" and "wrong password"; a dummy hash check
      keeps response time similar so emails can't be probed
    * 5 wrong passwords -> account locked for 5 minutes
    * `next` redirects are restricted to local paths (no open redirect)
    * Cookies are HttpOnly + SameSite=Lax (Secure too when COOKIE_SECURE=1)
"""

import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps
from urllib.parse import urlparse

from flask import (
    Blueprint,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_db

bp = Blueprint("auth", __name__)

MAX_FAILED_ATTEMPTS = 5
LOCK_MINUTES = 5
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")

# Used when the email doesn't exist, so the timing looks the same as a real check.
_DUMMY_HASH = generate_password_hash("not-a-real-password")


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


def csrf_token() -> str:
    if "_csrf" not in session:
        session["_csrf"] = secrets.token_urlsafe(32)
    return session["_csrf"]


def safe_next(target):
    """Only allow redirects to paths on this site."""
    if not target:
        return None
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc or not target.startswith("/"):
        return None
    if target.startswith("//") or "\\" in target:
        return None
    return target


def validate_password(password: str) -> str | None:
    if len(password) < 8:
        return "Use at least 8 characters."
    if len(password) > 128:
        return "Use 128 characters or fewer."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Include at least one letter and one number."
    return None


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            if request.path.startswith("/api/"):
                return jsonify(error="Please sign in to continue."), 401
            target = request.full_path.rstrip("?")
            return redirect(url_for("auth.login", next=target))
        return view(*args, **kwargs)

    return wrapped


# ---------------------------------------------------------------------------
# Hooks (registered by init_auth)
# ---------------------------------------------------------------------------
def _load_user():
    g.user = None
    if request.endpoint == "static":
        return
    user_id = session.get("user_id")
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT id, name, email FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if g.user is None:  # account was deleted
            session.clear()


def _check_csrf():
    if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
        return None
    sent = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token", "")
    expected = session.get("_csrf", "")
    if expected and sent and hmac.compare_digest(sent, expected):
        return None
    if request.path.startswith("/api/"):
        return jsonify(error="Your session expired. Refresh the page and try again."), 400
    flash("Your session expired. Please try again.", "error")
    return redirect(url_for("auth.login"))


def init_auth(app):
    app.register_blueprint(bp)
    app.before_request(_load_user)
    app.before_request(_check_csrf)

    @app.context_processor
    def inject_globals():
        return {"csrf_token": csrf_token, "current_user": g.get("user")}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@bp.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(url_for("index"))

    form, errors = {}, {}
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm", "")
        form = {"name": name, "email": email}

        if not 2 <= len(name) <= 60:
            errors["name"] = "Enter your name (2-60 characters)."
        if len(email) > 254 or not EMAIL_RE.match(email):
            errors["email"] = "Enter a valid email address."
        pw_error = validate_password(password)
        if pw_error:
            errors["password"] = pw_error
        elif password != confirm:
            errors["confirm"] = "Passwords don't match."

        if not errors:
            db = get_db()
            if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                errors["email"] = "An account with this email already exists. Sign in instead."
            else:
                db.execute(
                    "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (name, email, generate_password_hash(password), _iso(_now())),
                )
                db.commit()
                flash("Account created. Sign in to continue.", "success")
                return redirect(url_for("auth.login"))

    return render_template("register.html", form=form, errors=errors), (400 if errors else 200)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("index"))

    next_url = safe_next(request.values.get("next"))
    form, error = {}, None

    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        remember = request.form.get("remember") == "on"
        form = {"email": email}

        db = get_db()
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

        locked_for = None
        if user and user["locked_until"]:
            until = datetime.fromisoformat(user["locked_until"])
            if until > _now():
                locked_for = max(1, int((until - _now()).total_seconds() // 60) + 1)

        password_ok = check_password_hash(user["password_hash"] if user else _DUMMY_HASH, password)

        if locked_for:
            error = f"Too many failed attempts. Try again in {locked_for} min."
        elif user and password_ok:
            db.execute(
                "UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?",
                (user["id"],),
            )
            db.commit()
            session.clear()  # new session -> no fixation
            session["user_id"] = user["id"]
            session.permanent = remember
            csrf_token()
            return redirect(next_url or url_for("index"))
        else:
            error = "Incorrect email or password."
            if user:
                attempts = user["failed_attempts"] + 1
                if attempts >= MAX_FAILED_ATTEMPTS:
                    db.execute(
                        "UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?",
                        (_iso(_now() + timedelta(minutes=LOCK_MINUTES)), user["id"]),
                    )
                    error = f"Too many failed attempts. Try again in {LOCK_MINUTES} min."
                else:
                    db.execute(
                        "UPDATE users SET failed_attempts = ? WHERE id = ?", (attempts, user["id"])
                    )
                db.commit()

    status = 401 if error else 200
    return render_template("login.html", form=form, error=error, next_url=next_url), status


@bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("You're signed out.", "success")
    return redirect(url_for("auth.login"))
