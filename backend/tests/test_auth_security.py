from tests.conftest import PASSWORD


def test_login_requires_csrf_token(anon):
    r = anon.c.post("/api/v1/auth/login", json={"email": "rb_officer@test.example", "password": PASSWORD})
    assert r.status_code == 403
    assert r.json()["type"].endswith("/csrf")


def test_password_login_me_and_logout(anon):
    r = anon.post("/auth/login", json={"email": "RB_Officer@test.example", "password": PASSWORD})
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["unit"]["code"] == "RB" and "CASE_OFFICER" in me["roles"]
    assert anon.get("/auth/me").status_code == 200
    assert anon.post("/auth/logout").status_code == 200
    assert anon.get("/auth/me").status_code == 401  # session row revoked server-side


def test_wrong_password_is_generic_and_locks_after_five(anon):
    for _ in range(5):
        r = anon.post("/auth/login", json={"email": "steward@test.example", "password": "nope"})
        assert r.status_code == 401
        assert r.json()["detail"] == "The e-mail or password is incorrect."
    r = anon.post("/auth/login", json={"email": "steward@test.example", "password": PASSWORD})
    assert r.status_code == 423
    unknown = anon.post("/auth/login", json={"email": "nobody@test.example", "password": "x"})
    assert unknown.status_code == 401 and unknown.json()["detail"] == "The e-mail or password is incorrect."


def test_unauthenticated_and_tampered_cookie(anon):
    assert anon.get("/cases").status_code == 401
    anon.c.cookies.set("smv_session", "eyJhbGciOiJIUzI1NiJ9.e30.forged")
    assert anon.get("/cases").status_code == 401


def test_security_headers_and_problem_details(as_user):
    api = as_user("rb_officer")
    r = api.get("/cases/SMV-2099-999999")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/problem+json")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "request_id" in r.json()


def test_role_checks_for_admin_endpoints(as_user):
    assert as_user("rb_officer").get("/admin/users").status_code == 403
    assert as_user("admin").get("/admin/users").status_code == 200
    assert as_user("pgrc_officer").get("/dashboard/summary").status_code == 403
    assert as_user("rb_head").get("/dashboard/summary").status_code == 200
