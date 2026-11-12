import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import create_app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def trained_models():
    """Train once if the model files aren't there yet."""
    if not (ROOT / "models" / "best_model.pkl").exists():
        subprocess.run([sys.executable, "train_model.py"], cwd=ROOT, check=True)


@pytest.fixture
def app(tmp_path):
    return create_app(
        {"TESTING": True, "DATABASE": str(tmp_path / "test.db"), "SECRET_KEY": "test-secret"}
    )


@pytest.fixture
def client(app):
    return app.test_client()


def csrf_from(client, path="/login"):
    html = client.get(path).get_data(as_text=True)
    return re.search(r'name="csrf-token" content="([^"]+)"', html).group(1)


def register(client, email="ada@example.com", password="Sunshine42", name="Ada"):
    return client.post(
        "/register",
        data={"csrf_token": csrf_from(client, "/register"), "name": name, "email": email,
              "password": password, "confirm": password},
    )


def login(client, email="ada@example.com", password="Sunshine42", **extra):
    return client.post(
        "/login",
        data={"csrf_token": csrf_from(client, "/login"), "email": email, "password": password, **extra},
    )


@pytest.fixture
def signed_in(client):
    register(client)
    login(client)
    client.csrf = csrf_from(client, "/")
    return client


SAMPLE = {
    "pregnancies": 2, "glucose": 148, "blood_pressure": 72, "skin_thickness": 0, "insulin": 0,
    "bmi": 33.6, "family_history": True, "age": 50, "activity": 4,
}
