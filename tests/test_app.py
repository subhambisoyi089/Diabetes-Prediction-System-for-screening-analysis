import pytest

from conftest import SAMPLE, csrf_from, login, register


# ---------------------------------------------------------------- auth
def test_home_requires_login(client):
    resp = client.get("/")
    assert resp.status_code == 302
    assert "/login?next=/" in resp.headers["Location"]


def test_register_validation(client):
    assert b"at least 8" in register(client, password="abc1").data.lower()
    assert b"letter and one number" in register(client, password="onlyletters").data
    bad = client.post(
        "/register",
        data={"csrf_token": csrf_from(client, "/register"), "name": "Ada", "email": "ada@example.com",
              "password": "Sunshine42", "confirm": "Different42"},
    )
    assert b"don&#39;t match" in bad.data or b"don't match" in bad.data


def test_register_login_logout(client):
    assert register(client).status_code == 302
    assert register(client).status_code == 400  # duplicate email
    resp = login(client)
    assert resp.status_code == 302 and resp.headers["Location"].endswith("/")
    assert b"Ada" in client.get("/").data
    token = csrf_from(client, "/")
    client.post("/logout", data={"csrf_token": token})
    assert client.get("/").status_code == 302


def test_wrong_password_and_lockout(client):
    register(client)
    for _ in range(4):
        r = login(client, password="wrong-pass1")
        assert b"Incorrect email or password" in r.data
    r = login(client, password="wrong-pass1")  # 5th failure locks the account
    assert b"Too many failed attempts" in r.data
    r = login(client)  # even the right password is refused while locked
    assert b"Too many failed attempts" in r.data


def test_unknown_email_gives_same_message(client):
    r = login(client, email="nobody@example.com")
    assert b"Incorrect email or password" in r.data


@pytest.mark.parametrize("target", ["https://evil.example", "//evil.example", "/\\evil.example"])
def test_open_redirect_blocked(client, target):
    register(client)
    resp = login(client, next=target)
    assert resp.headers["Location"].endswith("/")


def test_next_local_path_allowed(client):
    register(client)
    resp = login(client, next="/dashboard")
    assert resp.headers["Location"].endswith("/dashboard")


def test_csrf_required(signed_in):
    resp = signed_in.post("/api/predict", json=SAMPLE)  # no header
    assert resp.status_code == 400
    assert "session expired" in resp.get_json()["error"].lower()


# ---------------------------------------------------------------- API
def post(client, path, body, **kw):
    return client.post(path, json=body, headers={"X-CSRF-Token": client.csrf}, **kw)


def test_predict_shape_and_explanation_adds_up(signed_in):
    data = post(signed_in, "/api/predict", SAMPLE).get_json()
    assert 0 <= data["risk_percent"] <= 100
    assert data["risk_level"] in ("low", "moderate", "high")
    exp = data["explanation"]
    assert len(exp["contributions"]) == 8
    # Shapley values are additive: baseline + sum(contributions) = prediction
    total = exp["baseline_percent"] + sum(c["impact_pts"] for c in exp["contributions"])
    assert total == pytest.approx(data["risk_percent"], abs=0.6)
    # blank insulin / skin thickness are flagged as estimated
    imputed = {c["feature"] for c in exp["contributions"] if c["imputed"]}
    assert imputed == {"Insulin", "SkinThickness"}


def test_high_glucose_raises_risk_more_than_low(signed_in):
    high = post(signed_in, "/api/predict", {**SAMPLE, "glucose": 190, "save": False}).get_json()
    low = post(signed_in, "/api/predict", {**SAMPLE, "glucose": 85, "save": False}).get_json()
    assert high["risk_percent"] > low["risk_percent"]


@pytest.mark.parametrize(
    "patch, field",
    [({"age": 5}, "age"), ({"glucose": "abc"}, "glucose"), ({"bmi": 400}, "bmi"), ({"glucose": None}, "glucose")],
)
def test_predict_validation(signed_in, patch, field):
    resp = post(signed_in, "/api/predict", {**SAMPLE, **patch})
    assert resp.status_code == 400
    assert resp.get_json()["field"] == field


def test_bmi_and_estimate(signed_in):
    assert post(signed_in, "/api/bmi", {"weight_kg": 70, "height_cm": 175}).get_json() == {
        "bmi": 22.9, "category": "Normal"}
    est = post(signed_in, "/api/estimate", {"age": 40, "sugar_diet": 8, "activity": 2,
                                            "stress": 7, "salt_intake": 6, "family_history": True}).get_json()
    assert 70 <= est["glucose"] <= 200 and 50 <= est["blood_pressure"] <= 140


def test_history_save_read_delete(signed_in):
    saved = post(signed_in, "/api/predict", SAMPLE).get_json()
    post(signed_in, "/api/predict", {**SAMPLE, "save": False})  # not stored
    items = signed_in.get("/api/history").get_json()["assessments"]
    assert [i["id"] for i in items] == [saved["assessment_id"]]

    detail = signed_in.get(f"/api/history/{saved['assessment_id']}").get_json()
    assert detail["result"]["risk_percent"] == saved["risk_percent"]

    resp = signed_in.delete(f"/api/history/{saved['assessment_id']}", headers={"X-CSRF-Token": signed_in.csrf})
    assert resp.status_code == 200
    assert signed_in.get("/api/history").get_json()["assessments"] == []


def test_users_cannot_see_each_others_data(app):
    a, b = app.test_client(), app.test_client()
    register(a, "a@example.com"); login(a, "a@example.com"); a.csrf = csrf_from(a, "/")
    register(b, "b@example.com"); login(b, "b@example.com"); b.csrf = csrf_from(b, "/")

    saved = post(a, "/api/predict", SAMPLE).get_json()
    assert b.get("/api/history").get_json()["assessments"] == []
    assert b.get(f"/api/history/{saved['assessment_id']}").status_code == 404
    assert b.delete(f"/api/history/{saved['assessment_id']}", headers={"X-CSRF-Token": b.csrf}).status_code == 404
    assert len(a.get("/api/history").get_json()["assessments"]) == 1


def test_api_requires_login(client):
    assert client.get("/api/history").status_code == 401


# ---------------------------------------------------------------- public pages
def test_models_page_public(client):
    assert client.get("/models").status_code == 200
    data = client.get("/api/model-comparison").get_json()
    best = data["comparison"][data["best_model"]]
    assert {"accuracy", "recall", "roc_auc", "cv_roc_auc"} <= set(best)


def test_security_headers(client):
    resp = client.get("/login")
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert "default-src 'self'" in resp.headers["Content-Security-Policy"]
