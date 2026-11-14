#!/usr/bin/env python3
"""Real PostgreSQL/Redis API smoke tests. Only run on a disposable CI database."""
import base64
import concurrent.futures
import uuid
import hashlib
import hmac
import json
import os
import re
import struct
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

BASE = os.getenv("XMESH_TEST_URL", "http://127.0.0.1:8080").rstrip("/")
USER = os.getenv("ADMIN_USERNAME", "admin")
PASSWORD = os.environ["ADMIN_PASSWORD"]
VIEWER_PASSWORD = "integration-viewer-secret-password-0123"
NEW_PASSWORD = "integration-new-owner-password-012345"


def api(method, path, payload=None, cookie=None, origin=BASE):
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if origin is not None:
        headers["Origin"] = origin
    if cookie:
        headers["Cookie"] = cookie
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(BASE + "/api/v1" + path, data=data, headers=headers, method=method)
    try:
        response = urlopen(req, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        body = response.read()
        obj = json.loads(body) if body else None
        cookies = response.headers.get_all("Set-Cookie", [])
        token = next((x.split(";", 1)[0] for x in cookies if x.startswith("xmesh_session=")), None)
        return response.status, obj, token


def check(status, expected, label):
    assert status == expected, f"{label}: expected HTTP {expected}, got {status}"
    print("PASS:", label)


def login(user, password, mfa=False):
    status, data, cookie = api("POST", "/auth/login", {"username": user, "password": password})
    check(status, 200, "login " + user)
    if mfa:
        assert data["mfaRequired"] is True and not cookie, "Password login bypassed MFA"
    else:
        assert data["authenticated"] is True and cookie, "Missing session cookie"
    return data, cookie


def totp(secret):
    key = base64.b32decode(secret)
    digest = hmac.new(key, struct.pack(">Q", int(time.time() // 30)), hashlib.sha1).digest()
    offset = digest[-1] & 15
    value = struct.unpack(">I", digest[offset:offset+4])[0] & 0x7fffffff
    return f"{value % 1000000:06d}"




def service_api(method, path, bearer=None, payload=None, idempotency=None, cookie=None, origin=None, if_match=None):
    """Machine-to-machine call: never implicitly send browser Origin or cookies."""
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if bearer is not None:
        headers["Authorization"] = "Bearer " + bearer
    if idempotency is not None:
        headers["Idempotency-Key"] = idempotency
    if if_match is not None:
        headers["If-Match"] = if_match
    if cookie is not None:
        headers["Cookie"] = cookie
    if origin is not None:
        headers["Origin"] = origin
    req = Request(
        BASE + "/api/v1/integrations" + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers=headers,
        method=method,
    )
    try:
        response = urlopen(req, timeout=35)
    except HTTPError as error:
        response = error
    with response:
        body = response.read()
        return response.status, json.loads(body) if body else {}, response.headers


def totp_for_step(secret, step):
    key = base64.b32decode(secret)
    digest = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 15
    value = struct.unpack(">I", digest[offset:offset+4])[0] & 0x7fffffff
    return f"{value % 1000000:06d}"


def next_unused_totp(secret, last_step):
    """Only choose server-accepted adjacent TOTP steps, never reuse a consumed one."""
    while int(time.time() // 30) < last_step:
        time.sleep(min(0.5, max(0.05, last_step * 30 + 0.1 - time.time())))
    step = max(last_step + 1, int(time.time() // 30) + 1)
    return totp_for_step(secret, step), step


def test_scoped_integration_api(owner_cookie, secret, user_id):
    """E2E with real PostgreSQL and Redis; only disposable CI objects."""
    check(service_api("GET", "/capabilities")[0], 401, "service API requires Bearer")
    check(service_api("GET", "/capabilities", bearer="xmni_v1_" + "a" * 64)[0],
          401, "unknown token denied")
    check(service_api("GET", "/users", cookie=owner_cookie)[0],
          403, "browser owner cookie is not a service credential")

    # The user in this test was created earlier by the real administrator API.
    # A finite expiry is required: 'unlimited' cannot silently be converted.
    expiry = (int(time.time()) + 86_400) * 1000
    check(api("PATCH", f"/collections/users/{user_id}",
              {"expireAt": expiry}, owner_cookie)[0], 200,
          "set finite entitlement baseline")
    another_status, another_user, _ = api(
        "POST", "/collections/users",
        {"username": "ci_service_out_of_scope", "limit": 10}, owner_cookie)
    check(another_status, 201, "create out-of-scope identity")
    other_id = another_user["id"]

    # Confirm needs MFA even after a valid owner cookie is issued.
    issuance = {
        "clientName": "ci_telegram_bot",
        "label": "ci_token_one",
        "scopes": ["users:read", "traffic:read", "entitlements:grant", "users:write"],
        "expiresInDays": 2,
        "allUsers": False,
        "allowedUserIds": [user_id],
    }
    check(api("POST", "/integration-tokens", {**issuance, "mfaCode": ""}, owner_cookie)[0],
          401, "token issuance needs a valid one-time owner factor")
    factor, step1 = next_unused_totp(secret, int(time.time() // 30))
    first = {**issuance, "mfaCode": factor}
    status, issued, _ = api("POST", "/integration-tokens", first, owner_cookie)
    check(status, 200, "owner issues bounded service token after MFA")
    token = issued["token"]
    assert token.startswith("xmni_v1_") and len(token) == len("xmni_v1_") + 64
    assert issued["shownOnce"] and issued["tokenId"] > 0
    check(api("POST", "/integration-tokens",
              {**first, "label": "ci_replayed_totp"}, owner_cookie)[0],
          401, "step-up MFA code cannot be reused")

    status, public, _ = service_api("GET", "/capabilities", token)
    check(status, 200, "bearer credentials accepted")
    assert "entitlements:grant" in public["data"]["scopes"]
    check(service_api("GET", "/capabilities", token, cookie=owner_cookie)[0],
          403, "mixed cookie and bearer rejected")
    check(service_api("GET", "/capabilities", token, origin=BASE)[0],
          403, "browser Origin cannot reuse service bearer")

    status, user, headers = service_api("GET", f"/users/{user_id}", token)
    check(status, 200, "scoped service reads permitted user")
    assert headers.get("Cache-Control") == "no-store, private"
    assert user["data"]["id"] == user_id
    projection = json.dumps(user)
    for forbidden in ("xrayId", "trojanPassword", "subscriptionUrl", "ssLegacyPassword"):
        assert forbidden not in projection, f"Secret field leaked: {forbidden}"
    assert user["data"]["expireAtMs"] == expiry
    check(service_api("GET", f"/users/{other_id}", token)[0], 404,
          "object-level access denied without revealing user")
    status, listing, _ = service_api("GET", "/users?limit=1", token)
    check(status, 200, "bounded list of scoped users")
    assert [row["id"] for row in listing["data"]] == [user_id]
    check(service_api("GET", f"/users/{user_id}/subscription", token)[0],
          403, "users:read cannot reveal subscription bearer URL")
    check(service_api("GET", f"/users/{user_id}/traffic", token)[0],
          200, "separate traffic read scope allowed")

    grant_key = str(uuid.uuid4())
    grant = {"days": 30, "sourceReference": "ci-entitlement-a"}
    check(service_api("POST", f"/users/{user_id}/entitlements/grant",
                      token, grant)[0], 400, "idempotency key mandatory")
    def concurrent_call(_):
        return service_api("POST", f"/users/{user_id}/entitlements/grant",
                           token, grant, idempotency=grant_key)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(concurrent_call, range(8)))
    assert all(status == 200 for status, _, _ in results), results
    answers = [body["data"] for _, body, _ in results]
    assert sum(not a["replayed"] for a in answers) == 1, answers
    assert len({a["expireAtMs"] for a in answers}) == 1, answers
    check(service_api("POST", f"/users/{user_id}/entitlements/grant", token,
                      {"days": 31, "sourceReference": "ci-entitlement-a"},
                      grant_key)[0], 409, "same key with different body rejected")
    status, after, _ = service_api("GET", f"/users/{user_id}", token)
    check(status, 200, "verify atomic persisted grant")
    expected_expiry = expiry + 30 * 86_400_000
    assert after["data"]["expireAtMs"] == expected_expiry, after

    key_disable = str(uuid.uuid4())
    check(service_api("POST", f"/users/{user_id}/disable", token,
                      {"reason": "CI access test"}, key_disable)[0],
          200, "scoped disabling works")
    status, disabled, _ = service_api("GET", f"/users/{user_id}", token)
    check(status, 200, "read disabled user")
    assert disabled["data"]["disabled"] is True
    check(service_api("POST", f"/users/{user_id}/enable", token,
                      {"reason": "CI access restoration"}, str(uuid.uuid4()))[0],
          200, "scoped enabling works")
    assert service_api("GET", f"/users/{user_id}", token)[1]["data"]["disabled"] is False

    # Same client, DIFFERENT token: ledger keys must survive credential rotation.
    factor2, step2 = next_unused_totp(secret, step1)
    status, rotated, _ = api("POST", "/integration-tokens", {
        **issuance,
        "label": "ci_rotated_token",
        "mfaCode": factor2
    }, owner_cookie)
    check(status, 200, "issue rotated token for same stable client")
    assert rotated["clientId"] == issued["clientId"]
    token2 = rotated["token"]
    status, previous, _ = service_api("POST",
        f"/users/{user_id}/entitlements/grant", token2, grant, grant_key)
    check(status, 200, "replay after service-token rotation")
    assert previous["data"]["replayed"] is True
    assert previous["data"]["expireAtMs"] == expected_expiry

    factors3, step3 = next_unused_totp(secret, step2)
    check(api("DELETE", f"/integration-tokens/{issued['tokenId']}",
              {"mfaCode": factors3}, owner_cookie)[0],
          200, "owner revokes old token with fresh MFA")
    check(service_api("GET", "/capabilities", token)[0],
          401, "revocation is immediately enforced")
    check(service_api("GET", "/capabilities", token2)[0],
          200, "rotation keeps replacement token valid")
    status, tokens, _ = api("GET", "/integration-tokens", cookie=owner_cookie)
    check(status, 200, "owner sees token metadata")
    assert issued["token"] not in json.dumps(tokens), "Raw token persisted in list!"
    # A scoped token cannot silently become a provisioning key.
    check(service_api("POST", "/users", token2,
                      {"username":"ci_forbidden_create","hold":True,"holdDays":30},
                      str(uuid.uuid4()))[0], 403,
          "bounded existing-user token cannot create users")

    # Creation requires a separate owner-approved, all-users credential AND a
    # dedicated users:create scope, not the broad legacy users:write permission.
    factor4, step4 = next_unused_totp(secret, step3)
    manager_issue = {
        "clientName": "ci_subscription_manager",
        "label": "ci_user_management",
        "scopes": ["users:create", "users:update", "users:read",
                   "quotas:read", "quotas:write", "subscriptions:read",
                   "squads:read", "squads:members:write", "nodes:read",
                   "telegram:read", "telegram:assign"],
        "expiresInDays": 2,
        "allUsers": True,
        "mfaCode": factor4,
    }
    status, manager_issued, _ = api("POST", "/integration-tokens", manager_issue, owner_cookie)
    check(status, 200, "owner issues explicit all-users manager key after MFA")
    manager = manager_issued["token"]

    create_body = {
        "username": "ci_service_managed_user",
        "hold": True,
        "holdDays": 30,
        "limitGb": 1000,
        "cdnLimitGb": 5,
        "telegramId": "1855665674",
    }
    check(service_api("POST", "/users", manager, create_body)[0], 400,
          "user creation must have an idempotency key")
    check(service_api("POST", "/users", manager,
                      {"username": "ci_no_expiry"}, str(uuid.uuid4()))[0], 400,
          "service may not accidentally create an unlimited account")
    check(service_api("POST", "/users", manager,
                      {**create_body, "xrayId":"forged"},
                      str(uuid.uuid4()))[0], 400,
          "client cannot forge an Xray identity")
    create_key = str(uuid.uuid4())
    status, created, _ = service_api("POST", "/users", manager, create_body, create_key)
    check(status, 201, "manager atomically creates held user and subscription")
    created_id = created["data"]["id"]
    assert created_id > 0 and created["data"]["status"] == "ON_HOLD", created
    assert created["data"]["holdDays"] == 30
    assert "xrayId" not in json.dumps(created)
    status, repeated, _ = service_api("POST", "/users", manager, create_body, create_key)
    check(status, 200, "user creation retry is an idempotent replay")
    assert repeated["data"]["id"] == created_id
    assert repeated["meta"]["replayed"] is True
    check(service_api("POST", "/users", manager,
                      {**create_body, "username":"ci_new_duplicate_payload"}, create_key)[0],
          409, "same create key cannot be reused for another payload")
    check(service_api("POST", "/users", manager, create_body, str(uuid.uuid4()))[0],
          409, "different request cannot duplicate a username")

    status, current, current_headers = service_api("GET", f"/users/{created_id}", manager)
    check(status, 200, "new user is visible with database-backed revision")
    rev = current_headers.get("ETag")
    assert rev == f'"{current["data"]["revision"]}"', (rev, current)
    patch_body = {"username": "ci_managed_renamed", "limitGb": 850}
    check(service_api("PATCH", f"/users/{created_id}", manager, patch_body,
                      str(uuid.uuid4()))[0], 428,
          "user patch requires If-Match revision")
    check(service_api("PATCH", f"/users/{created_id}", manager, patch_body,
                      str(uuid.uuid4()), if_match='"1"')[0], 412,
          "stale revision prevents lost updates")
    check(service_api("PATCH", f"/users/{created_id}", manager,
                      {"xrayId": "forged"}, str(uuid.uuid4()), if_match=rev)[0],
          400, "user patch cannot change VPN credentials")
    patch_key = str(uuid.uuid4())
    status, edited, _ = service_api("PATCH", f"/users/{created_id}", manager,
                                    patch_body, patch_key, if_match=rev)
    check(status, 200, "user patch updates only allowed fields")
    assert edited["data"]["username"] == "ci_managed_renamed"
    assert edited["data"]["limitGb"] == 850
    assert edited["data"]["revision"] >= current["data"]["revision"]
    status, replayed_patch, _ = service_api("PATCH", f"/users/{created_id}", manager,
                                            patch_body, patch_key, if_match=rev)
    check(status, 200, "user patch retries are idempotent")
    assert replayed_patch["meta"]["replayed"] is True

    status, quotas, quota_headers = service_api("GET", f"/users/{created_id}/quotas", manager)
    check(status, 200, "read authoritative main, CDN and node quotas")
    assert quotas["data"]["main"]["limitBytes"] == 850_000_000_000
    assert quotas["data"]["cdn"]["limitBytes"] == 5_000_000_000
    assert quota_headers.get("ETag") == f'"{edited["data"]["revision"]}"'
    check(service_api("PATCH", f"/users/{created_id}/quotas", manager,
                      {"cdnUsedBytes":0}, str(uuid.uuid4()),
                      if_match=quota_headers.get("ETag"))[0], 400,
          "service cannot forge CDN traffic")
    quota_key = str(uuid.uuid4())
    quota_body = {"cdnLimitGb": 2.5}
    status, quota_changed, _ = service_api("PATCH", f"/users/{created_id}/quotas",
                                          manager, quota_body, quota_key,
                                          if_match=quota_headers.get("ETag"))
    check(status, 200, "quota policy changes without resetting counters")
    assert quota_changed["data"]["cdn"]["limitBytes"] == 2_500_000_000
    status, _, duplicate_headers = service_api("PATCH", f"/users/{created_id}/quotas",
                                              manager, quota_body, quota_key,
                                              if_match=quota_headers.get("ETag"))
    check(status, 200, "quota policy operation survives duplicate delivery")
    assert duplicate_headers.get("X-Idempotency-Replayed") == "true"
    # Catalog reads never expose raw node addresses, enrollment secrets or Xray config.
    check(service_api("GET", "/squads", token2)[0], 403,
          "legacy scoped token cannot enumerate squad catalog")
    check(service_api("GET", "/nodes", token2)[0], 403,
          "user-only token cannot enumerate node catalog")
    squad_ids = []
    node_ids = []
    for number in range(2):
        status, squad, _ = api("POST", "/collections/squads",
                               {"name": f"ci integration squad {number}", "inb": []},
                               owner_cookie)
        check(status, 201, "owner creates test squad")
        squad_ids.append(squad["id"])
        status, node, _ = api("POST", "/collections/nodes",
                              {"name": f"ci integration node {number}",
                               "addr": f"192.0.2.{211+number}"},
                              owner_cookie)
        check(status, 201, "owner creates test node")
        node_ids.append(node["id"])
    for item in ["/squads", "/nodes"]:
        status, page, _ = service_api("GET", item + "?limit=1", manager)
        check(status, 200, "service catalog cursor first page")
        assert len(page["data"]) == 1 and page["meta"]["nextCursor"], page
        cursor = page["meta"]["nextCursor"]
        status, second, _ = service_api("GET", item + "?limit=1&cursor=" + cursor, manager)
        check(status, 200, "service catalog cursor second page")
        assert len(second["data"]) == 1 and second["data"][0]["id"] != page["data"][0]["id"]
        check(service_api("GET", item + "?cursor=" + cursor + "evil", manager)[0],
              400, "tampered catalog cursor denied")
        other = "/nodes" if item == "/squads" else "/squads"
        check(service_api("GET", other + "?cursor=" + cursor, manager)[0],
              400, "catalog cursor cannot be reused for another resource")

    status, catalog_squad, _ = service_api("GET", f"/squads/{squad_ids[0]}", manager)
    check(status, 200, "service reads a safe squad projection")
    assert catalog_squad["data"]["name"] == "ci integration squad 0"
    assert catalog_squad["data"]["memberCount"] == 0
    assert "inb" not in catalog_squad["data"]
    status, catalog_node, _ = service_api("GET", f"/nodes/{node_ids[0]}", manager)
    check(status, 200, "service reads a safe node projection")
    assert catalog_node["data"]["name"] == "ci integration node 0"
    for forbidden in ["addr", "metricsKey", "profileId", "enrollmentToken",
                      "privateKey", "routing"]:
        assert forbidden not in json.dumps(catalog_node), f"Node detail leaks {forbidden}"

    membership_body = {"userIds":[created_id]}
    membership_path = f"/squads/{squad_ids[0]}/members"
    check(service_api("POST", membership_path, token2, membership_body,
                      str(uuid.uuid4()))[0], 403,
          "token without squads:members:write cannot assign a squad")
    check(service_api("POST", membership_path, manager,
                      {"userIds":[created_id,created_id]},str(uuid.uuid4()))[0], 400,
          "duplicate batch target is rejected")
    check(service_api("POST", membership_path, manager, membership_body)[0], 400,
          "squad membership requires idempotency key")
    add_key = str(uuid.uuid4())
    status, added, _ = service_api("POST", membership_path, manager, membership_body, add_key)
    check(status, 200, "scoped squad assignment succeeds")
    assert added["data"]["changedUserIds"] == [created_id]
    status, replayed, _ = service_api("POST", membership_path, manager, membership_body, add_key)
    check(status, 200, "squad membership replay does not mutate user twice")
    assert replayed["meta"]["replayed"] is True
    check(service_api("POST", membership_path, manager,
                      {"userIds":[other_id]}, add_key)[0], 409,
          "membership idempotency key cannot be reused for another user")
    status, member_squad, _ = service_api("GET", f"/squads/{squad_ids[0]}", manager)
    check(status, 200, "read member count after assignment")
    assert member_squad["data"]["memberCount"] == 1
    status, member_record, _ = service_api("GET", f"/users/{created_id}", manager)
    check(status, 200, "verify squad assignment preserved account fields")
    assert squad_ids[0] in member_record["data"]["squadIds"]
    assert member_record["data"]["cdnLimitGb"] == 2.5

    factor5, step5 = next_unused_totp(secret, step4)
    scoped_issue = {
        "clientName":"ci_squad_limited",
        "label":"ci_squad_user_bound",
        "scopes":["squads:read","squads:members:write","telegram:read","users:read"],
        "allUsers":False,
        "allowedUserIds":[created_id],
        "expiresInDays":2,
        "mfaCode":factor5,
    }
    status, limited, _ = api("POST", "/integration-tokens", scoped_issue, owner_cookie)
    check(status, 200, "owner explicitly scopes membership token to one user")
    limited_token = limited["token"]
    check(service_api("POST", membership_path, limited_token,
                      {"userIds":[other_id]}, str(uuid.uuid4()))[0], 404,
          "member batch cannot touch another user's account")
    status, scoped_squad, _ = service_api("GET", f"/squads/{squad_ids[0]}", limited_token)
    check(status, 200, "member counts respect per-token user visibility")
    assert scoped_squad["data"]["memberCount"] == 1

    status, removed, _ = service_api("DELETE", membership_path, manager,
                                    membership_body, str(uuid.uuid4()))
    check(status, 200, "service removes a squad membership safely")
    assert removed["data"]["changedUserIds"] == [created_id]
    assert service_api("GET", f"/squads/{squad_ids[0]}", manager)[1]["data"]["memberCount"] == 0
    for squad_id in squad_ids:
        check(api("DELETE",f"/collections/squads/{squad_id}",cookie=owner_cookie)[0],
              200, "clean up test squad")
    for node_id in node_ids:
        check(api("DELETE",f"/collections/nodes/{node_id}",cookie=owner_cookie)[0],
              200, "clean up test node")
    # Telegram indexing works for manual panel records and multiple subscriptions
    # owned by the same Telegram user, without leaking credentials or other users.
    telegram_id = "1855665674"
    lookup_path = f"/users/by-telegram/{telegram_id}"
    check(service_api("GET", lookup_path, token2)[0], 403,
          "Telegram lookup needs an explicit telegram:read scope")
    check(service_api("GET", "/users/by-telegram/0001", manager)[0], 400,
          "noncanonical Telegram ID is rejected")
    check(service_api("GET", "/users/by-telegram/-10001", manager)[0], 400,
          "chat ID is not accepted as a Telegram user ID")
    check(service_api("POST", "/users", manager,
                      {**create_body,"username":"ci_invalid_tg","telegramId":"0001"},
                      str(uuid.uuid4()))[0], 400,
          "Telegram ID must be canonical at creation")
    second_body = {**create_body, "username":"ci_second_telegram_subscription"}
    status, second_user, _ = service_api("POST", "/users", manager,
                                        second_body, str(uuid.uuid4()))
    check(status, 201, "multiple VPN accounts may belong to one Telegram ID")
    second_id = second_user["data"]["id"]
    check(api("PATCH", f"/collections/users/{user_id}",
              {"tg":telegram_id}, owner_cookie)[0], 200,
          "owner assigns a legacy user via the existing Telegram field")
    status, telegram_users, _ = service_api("GET", lookup_path, manager)
    check(status, 200, "Telegram lookup finds bot-created and legacy users")
    expected_ids = {created_id, second_id, user_id}
    assert {entry["id"] for entry in telegram_users["data"]} == expected_ids, telegram_users
    assert all("tg" not in user and "xrayId" not in user for user in telegram_users["data"])
    status, paged, _ = service_api("GET", lookup_path + "?limit=1", manager)
    check(status, 200, "Telegram lookup supports bounded cursor paging")
    assert len(paged["data"]) == 1 and paged["meta"]["nextCursor"]
    tampered = paged["meta"]["nextCursor"] + "bad"
    check(service_api("GET", lookup_path + "?cursor=" + tampered, manager)[0],
          400, "Telegram cursor cannot be tampered with")
    check(service_api("GET", "/users/by-telegram/1888555666?cursor=" +
                      paged["meta"]["nextCursor"], manager)[0], 400,
          "Telegram cursor cannot be used for a different Telegram account")
    assert service_api("GET", "/users/by-telegram/123456789", manager)[1]["data"] == []
    status, bounded, _ = service_api("GET", lookup_path, limited_token)
    check(status, 200, "Telegram lookup respects allowedUserIds")
    assert [user["id"] for user in bounded["data"]] == [created_id], bounded

    # Only the exact provisioning integration client may first bind an unlinked
    # account. Even an all-users bot token must not claim a panel-created account.
    status, legacy, legacy_headers = service_api("GET",f"/users/{user_id}",manager)
    check(status, 200, "legacy user revision available")
    check(service_api("PATCH", f"/users/{user_id}/telegram", manager,
                      {"telegramId":"123456789"}, str(uuid.uuid4()),
                      if_match=legacy_headers.get("ETag"))[0],403,
          "bot cannot hijack a manually created subscription")
    status, linked, linked_headers = service_api("GET",f"/users/{created_id}",manager)
    check(status,200,"get current revision before Telegram relink attempt")
    check(service_api("PATCH",f"/users/{created_id}/telegram",manager,
                      {"telegramId":"2222222222"},str(uuid.uuid4()),
                      if_match=linked_headers.get("ETag"))[0],409,
          "service may not overwrite an existing Telegram identity")

    unbound_body = {"username":"ci_service_unbound_tg","hold":True,"holdDays":30}
    status, unbound, _ = service_api("POST","/users",manager,unbound_body,str(uuid.uuid4()))
    check(status,201,"service provisions an account without a Telegram binding")
    unbound_id = unbound["data"]["id"]
    status, account, account_headers = service_api("GET",f"/users/{unbound_id}",manager)
    check(status,200,"read unbound user ETag")
    binding = {"telegramId":"3000000003"}
    binding_path = f"/users/{unbound_id}/telegram"
    check(service_api("PATCH",binding_path,manager,binding,str(uuid.uuid4()))[0],428,
          "Telegram assignment requires If-Match")
    check(service_api("PATCH",binding_path,manager,
                      {"telegramId":"00003"},str(uuid.uuid4()),
                      if_match=account_headers.get("ETag"))[0],400,
          "Telegram assignment validates canonical string ID")
    check(service_api("PATCH",binding_path,limited_token,binding,str(uuid.uuid4()),
                      if_match=account_headers.get("ETag"))[0],403,
          "read-only Telegram scope cannot write bindings")
    bind_key = str(uuid.uuid4())
    status, bound, _ = service_api("PATCH",binding_path,manager,binding,bind_key,
                                   if_match=account_headers.get("ETag"))
    check(status,200,"provisioning client binds its own user to Telegram")
    assert bound["data"]["changed"] is True
    status, bound_replay, _ = service_api("PATCH",binding_path,manager,binding,bind_key,
                                         if_match=account_headers.get("ETag"))
    check(status,200,"binding is idempotent across retries")
    assert bound_replay["meta"]["replayed"] is True
    check(service_api("PATCH",binding_path,manager,
                      {"telegramId":"4000000004"},bind_key,
                      if_match=account_headers.get("ETag"))[0],409,
          "idempotency key cannot be reused to change the Telegram ID")
    status, queried, _ = service_api("GET","/users/by-telegram/3000000003",manager)
    check(status,200,"new binding indexed for lookup")
    assert [item["id"] for item in queried["data"]] == [unbound_id]
    status, updated, updated_headers = service_api("GET", f"/users/{unbound_id}", manager)
    check(status,200,"binding changed database record revision")
    check(service_api("PATCH",binding_path,manager,
                      {"telegramId":"4000000004"},str(uuid.uuid4()),
                      if_match=updated_headers.get("ETag"))[0],409,
          "previous binding cannot be silently replaced by bot")
    print("Integration API Telegram ID lookup, multi-account indexing and safe assignment passed.")

    print("Integration API scoped squad/node catalogs and squad membership passed.")

    print("Integration API user creation, patch, ETags and exact quotas passed.")

    print("Scoped Integration API: RBAC, MFA, rotation, idempotency and BOLA passed.")

def main():
    owner, owner_cookie = login(USER, PASSWORD)
    owner_id = owner["user"]["id"]
    create = {"username": "ci_viewer", "password": VIEWER_PASSWORD, "role": "viewer"}

    check(api("POST", "/admins", create, owner_cookie, origin=None)[0], 403, "missing Origin rejected")
    check(api("POST", "/admins", create, owner_cookie, origin="https://attacker.invalid")[0], 403,
          "foreign Origin rejected")
    status, viewer, _ = api("POST", "/admins", create, owner_cookie)
    check(status, 201, "owner creates viewer")
    viewer_id = viewer["id"]
    _, viewer_cookie = login("ci_viewer", VIEWER_PASSWORD)
    check(api("GET", "/collections/hosts", cookie=viewer_cookie)[0], 403, "viewer denied host configuration")
    check(api("GET", "/collections/users", cookie=viewer_cookie)[0], 200, "viewer can read user overview")
    check(api("GET", "/security/policy", cookie=viewer_cookie)[0], 403, "viewer denied security policy")
    check(api("POST", "/collections/hosts", {"name": "smoke"}, viewer_cookie)[0], 403,
          "viewer cannot write")
    check(api("GET", "/admins", cookie=viewer_cookie)[0], 403, "viewer cannot see administrators")
    status, user, _ = api("POST", "/collections/users",
                          {"username": "ci_viewer_audit", "limit": 10}, owner_cookie)
    check(status, 201, "owner creates viewer protection test user")
    user_id = user["id"]
    assert user.get("xrayId"), "owner must receive original Xray UUID"
    assert user["vmessId"] != user["xrayId"]
    passwords = [user[k] for k in ["trojanPassword", "hysteriaPassword", "masquePassword", "ssLegacyPassword"]]
    assert len(set(passwords)) == 4 and all(len(p) == 64 for p in passwords)
    status, listing, _ = api("GET", "/collections/users", cookie=viewer_cookie)
    check(status, 200, "viewer reads redacted users")
    exposed = next(entry for entry in listing["items"] if entry["id"] == user_id)
    assert exposed["username"] == "ci_viewer_audit"
    assert "xrayId" not in exposed
    assert user["xrayId"] not in json.dumps(listing)
    status, data, _ = api("GET", "/bootstrap", cookie=viewer_cookie)
    check(status, 200, "viewer bootstrap is redacted")
    assert data["collections"]["hosts"] == []
    assert data["collections"]["profiles"] == []
    assert data["settings"].keys() == {"brand"}
    assert user["xrayId"] not in json.dumps(data)
    status, settings, _ = api("GET", "/settings", cookie=viewer_cookie)
    check(status, 200, "viewer settings are restricted")
    assert settings.keys() == {"brand"}
    check(api("GET", f"/users/{user_id}/subscription", cookie=viewer_cookie)[0], 403,
          "viewer denied subscription retrieval")
    check(api("GET", f"/users/{user_id}/client-json", cookie=viewer_cookie)[0], 403,
          "viewer denied client configuration retrieval")
    check(api("GET", "/collections/profiles", cookie=viewer_cookie)[0], 403,
          "viewer denied XRAY STUDIO profiles")
    check(api("GET", "/nodes/1/restart", cookie=viewer_cookie)[0], 403,
          "viewer denied node command history")
    check(api("POST", f"/users/{user_id}/credentials/rotate", cookie=viewer_cookie)[0], 403,
          "viewer forbidden from rotating VPN credentials")
    old_status, old_sub, _ = api("GET", f"/users/{user_id}/subscription", cookie=owner_cookie)
    check(old_status, 200, "read existing subscription token")
    old_token = old_sub["token"]
    status, changed, _ = api("POST", f"/users/{user_id}/credentials/rotate", cookie=owner_cookie)
    check(status, 200, "owner rotates VPN and subscription credentials")
    assert changed["xrayId"] != user["xrayId"] and changed["requiresNodeSync"]
    status, new_sub, _ = api("GET", f"/users/{user_id}/subscription", cookie=owner_cookie)
    check(status, 200, "read regenerated subscription token")
    assert new_sub["token"] != old_token
    status, all_users, _ = api("GET", "/collections/users", cookie=owner_cookie)
    check(status, 200, "rekeyed credentials persisted")
    fresh = next(record for record in all_users["items"] if record["id"] == user_id)
    for field in ["xrayId", "vmessId", "trojanPassword", "hysteriaPassword",
                  "masquePassword", "ssLegacyPassword", "ssPassword", "ssPassword128"]:
        assert fresh[field] != user[field]




    check(api("PATCH", f"/admins/{viewer_id}", {"role": "admin"}, owner_cookie)[0], 200,
          "owner changes role")
    status, old, _ = api("GET", "/auth/session", cookie=viewer_cookie)
    check(status, 200, "old session inspected")
    assert old["authenticated"] is False, "Role update did not revoke session"
    admin, admin_cookie = login("ci_viewer", VIEWER_PASSWORD)
    assert admin["user"]["role"] == "admin"
    # Active hosts require a valid XRAY profile, inbound and node bindings.
    check(api("POST", "/collections/hosts", {"name": "ci smoke"}, admin_cookie)[0], 400,
          "admin cannot create unbound active host")
    check(api("POST", "/collections/hosts", {"name": "ci smoke", "disabled": True}, admin_cookie)[0], 201,
          "admin can create disabled host draft")
    # Positive authorization path: create a real active VLESS host using a
    # valid profile and a node explicitly bound to that same profile.
    profile_config = {
        "inbounds": [{
            "tag": "CI_AUTH_VLESS", "listen": "127.0.0.1", "port": 28352,
            "protocol": "vless", "settings": {"decryption": "none", "clients": []},
            "streamSettings": {"network": "raw", "security": "tls",
                               "tlsSettings": {"serverName": "ci-host.example.com"}}
        }],
        "outbounds": [{"tag": "direct", "protocol": "freedom"}],
        "routing": {"rules": []}
    }
    status, profile, _ = api("POST", "/collections/profiles",
                             {"name": "CI auth host profile", "config": json.dumps(profile_config)},
                             admin_cookie)
    check(status, 201, "admin creates valid XRAY profile")
    profile_id = profile["id"]
    status, node, _ = api("POST", "/collections/nodes",
                          {"name": "CI auth host node", "addr": "192.0.2.251",
                           "profileId": profile_id}, admin_cookie)
    check(status, 201, "admin creates profile-bound node")
    node_id = node["id"]

    # The form and direct API share this server-side validation. A 409 must
    # identify the existing node instead of silently creating a second entry.
    status, duplicate, _ = api("POST", "/collections/nodes",
                               {"name": "CI accidental duplicate", "addr": "192.0.2.251"},
                               admin_cookie)
    check(status, 409, "duplicate Node IPv4 is rejected")
    assert "192.0.2.251" in duplicate["error"] and str(node_id) in duplicate["error"], duplicate
    assert "CI auth host node" in duplicate["error"], duplicate

    status, another, _ = api("POST", "/collections/nodes",
                             {"name": "CI second Node", "addr": "192.0.2.241"},
                             admin_cookie)
    check(status, 201, "a different Node address remains allowed")
    status, duplicate, _ = api("PATCH", f"/collections/nodes/{another['id']}",
                               {"addr": "192.0.2.251"}, admin_cookie)
    check(status, 409, "editing Node address cannot steal another Node IP")
    assert "192.0.2.251" in duplicate["error"] and str(node_id) in duplicate["error"], duplicate
    check(api("PATCH", f"/collections/nodes/{another['id']}",
              {"name": "CI second Node renamed"}, admin_cookie)[0], 200,
          "unrelated Node edits remain allowed")
    check(api("DELETE", f"/collections/nodes/{another['id']}",
              cookie=admin_cookie)[0], 200, "clean up alternate Node")

    # IPv6 text aliases must compare as one IP, not as different strings.
    status, ipv6, _ = api("POST", "/collections/nodes",
                          {"name": "CI IPv6 Node", "addr": "2001:db8::abcd"},
                          admin_cookie)
    check(status, 201, "create canonical IPv6 Node")
    status, duplicate, _ = api("POST", "/collections/nodes",
                               {"name": "CI IPv6 alias", "addr": "2001:0db8:0:0:0:0:0:abcd"},
                               admin_cookie)
    check(status, 409, "IPv6 aliases cannot produce duplicate Nodes")
    check(api("DELETE", f"/collections/nodes/{ipv6['id']}",
              cookie=admin_cookie)[0], 200, "clean up IPv6 Node")

    # Advisory locks must close the race between two simultaneous POST calls.
    from concurrent.futures import ThreadPoolExecutor
    def create_racing_node(index):
        return api("POST", "/collections/nodes",
                   {"name": f"CI competing Node {index}", "addr": "192.0.2.242"},
                   admin_cookie)
    with ThreadPoolExecutor(max_workers=2) as executor:
        attempts = list(executor.map(create_racing_node, (1, 2)))
    assert sorted(attempt[0] for attempt in attempts) == [201, 409], attempts
    winner = next(attempt[1] for attempt in attempts if attempt[0] == 201)
    check(api("DELETE", f"/collections/nodes/{winner['id']}",
              cookie=admin_cookie)[0], 200, "clean up concurrent Node")

    status, host, _ = api("POST", "/collections/hosts",
                          {"name": "ci active host", "profileId": profile_id,
                           "tag": "CI_AUTH_VLESS", "address": "ci-host.example.com",
                           "port": 443, "nodes": [node_id]}, admin_cookie)
    check(status, 201, "admin creates fully bound active host")
    assert host["id"] > 0 and host["profileId"] == profile_id
    assert host["nodes"] == [node_id] and host["tag"] == "CI_AUTH_VLESS"
    # PostgreSQL/Redis + HTTP lifecycle regression: only a real enabled Host
    # may appear in a subscription. Keep the Node assigned and online-looking
    # throughout disabled/deleted Host checks to detect implicit node fallback.
    status, squad, _ = api("POST", "/collections/squads",
                           {"name": "CI authorized Host squad", "inb": ["CI_AUTH_VLESS"]},
                           admin_cookie)
    check(status, 201, "admin creates subscription test squad")
    squad_id = squad["id"]
    check(api("PATCH", f"/collections/users/{user_id}", {"squads": [squad_id]},
              owner_cookie)[0], 200, "assign test inbound to subscription user")

    def assert_client_hosts(expected, label):
        status, feed, _ = api("GET", f"/users/{user_id}/client-json", cookie=owner_cookie)
        check(status, 200, label + " (HTTP)")
        assert isinstance(feed, list) and len(feed) == expected, (
            f"{label}: expected {expected} published Hosts, got {feed}")
        if expected:
            proxy = feed[0]["outbounds"][0]
            assert proxy["settings"]["vnext"][0]["address"] == "ci-host.example.com", (
                "Subscription must use the explicit Host address")
        print("PASS:", label)

    assert_client_hosts(1, "enabled Host publishes one client server")
    # Same bearer URL, real API: HTML for browsers, native JSON for VPN apps.
    # Keep the request on the disposable local API, never the configured public domain.
    # The same personal feed URL must also expose a forced HTML portal for the
    # webpage button. Test real user-scoped headers, never print their token.
    check(api("PATCH", "/settings", {
        "subscriptionDomain": "sub.example.com",
        "subscriptionPath": "/s",
        "subscriptionProfileWebPageEnabled": True,
        "subscriptionProfileWebPageUrl": "",
        "subscriptionSupportUrl": "https://t.me/ci_support"
    }, owner_cookie)[0], 200, "configure portal metadata for API smoke test")
    status, new_sub, _ = api("GET", f"/users/{user_id}/subscription", cookie=owner_cookie)
    check(status, 200, "retrieve personal subscription URL after settings update")
    personal_page = new_sub["url"] + "?view=portal"
    subscription_path = urlsplit(new_sub["url"]).path
    agents = [
        ("Happ/26.7.28 (iPhone; iOS 18)", "xray"),
        ("v2rayNG/1.10 Android", "base64"),
        ("v2rayN/7.7 Windows", "base64"),
        ("Hiddify/2.0", "base64"),
        ("NekoBox/1.0 Android", "links"),
        ("Shadowrocket/2.2", "base64"),
        ("Streisand/1.0", "links"),
        ("Incy/1.0", "links"),
        ("v2rayTun/3.0", "links"),
        ("FlClash/1.0", "mihomo"),
        ("sing-box/1.14", "singbox"),
        ("V2Box/1", "base64"),
        ("Loon/1", "links"),
        ("Stash/1", "mihomo"),
        ("Mihomo Party/1", "mihomo"),
        ("ClashVerge/1", "mihomo"),
    ]
    for agent, wire in [("Mozilla/5.0 (iPhone) AppleWebKit Safari/605.1", "html")] + agents:
        browser = wire == "html"
        req = Request(BASE + subscription_path,
                      headers={"User-Agent": agent, "Accept": "text/html"})
        with urlopen(req, timeout=30) as response:
            check(response.status, 200, "subscription content negotiation")
            content_type = response.headers.get("Content-Type", "")
            if not browser:
                assert response.headers.get("profile-web-page-url") == personal_page, (
                    "Authenticated subscription must advertise the correct personal portal")
                assert response.headers.get("support-url") == "https://t.me/ci_support", (
                    "Support URL must remain separate from the personal webpage")
                assert response.headers.get("profile-title", "").startswith("base64:"), (
                    "Existing profile-title metadata must not change")
            body = response.read()
            if browser:
                assert content_type.startswith("text/html")
                # The live portal must survive older Sub gateways that do
                # not forward external CSS/JS paths. Exercise the real API
                # response, not only the standalone browser fixture.
                assert b'id="subscription-public-assets"' in body
                assert b'body.subscription-public{margin:0' in body
                assert b'window.qrcodegen?.QrCode' in body
                nonces = re.findall(rb'<script nonce="([^"]+)">', body)
                assert len(nonces) == 4 and len(set(nonces)) == 1, (
                    "Public portal must embed four nonce-bound scripts")
                csp = response.headers.get("Content-Security-Policy", "")
                assert "script-src 'nonce-" + nonces[0].decode() + "'" in csp, (
                    "CSP must allow only nonce-authorized embedded scripts")
                assert b'<script src="/subscription-' not in body
                assert b'<link rel="stylesheet" href="/subscription-' not in body
                assert changed["xrayId"].encode() not in body
            elif wire == "xray":
                assert content_type.startswith("application/json")
                feed = json.loads(body)
                assert isinstance(feed, list) and len(feed) == 1
            elif wire == "singbox":
                assert content_type.startswith("application/json")
                profile = json.loads(body)
                assert profile["outbounds"][0]["type"] == "vless"
                assert profile["outbounds"][0]["server"] == "ci-host.example.com"
            elif wire == "mihomo":
                assert content_type.startswith("application/yaml")
                assert b"proxies:" in body and b"proxy-groups:" in body
                assert b'"type":"vless"' in body
            else:
                assert content_type.startswith("text/plain")
                links = base64.b64decode(body) if wire == "base64" else body
                assert links.startswith(b"vless://")
                assert b"@ci-host.example.com:" in links
    # Clicking the webpage icon in Happ must render HTML even if the embedded
    # browser uses Happ/Windows or Happ/iOS User-Agent instead of Mozilla.
    portal_request = Request(
        BASE + subscription_path + "?view=portal",
        headers={"User-Agent": "Happ/26.7.28 (Windows NT 10.0)", "Accept": "*/*"})
    with urlopen(portal_request, timeout=30) as response:
        check(response.status, 200, "Happ profile webpage opens HTML portal")
        assert response.headers["Content-Type"].startswith("text/html")
        assert b'id="subscription-public-assets"' in response.read()

    # Settings affect metadata only; feed still works and the URL is unchanged.
    check(api("PATCH", "/settings",
              {"subscriptionProfileWebPageEnabled": False}, owner_cookie)[0],
          200, "disable personal webpage metadata")
    req = Request(BASE + subscription_path, headers={"User-Agent": "Happ/26.7.28"})
    with urlopen(req, timeout=30) as response:
        assert response.status == 200
        assert response.headers.get("profile-web-page-url") is None
        assert response.headers["Content-Type"].startswith("application/json")
    check(api("PATCH", "/settings", {
        "subscriptionProfileWebPageEnabled": True,
        "subscriptionProfileWebPageUrl": "https://account.example.org/personal"
    }, owner_cookie)[0], 200, "owner sets a custom HTTPS webpage")
    with urlopen(req, timeout=30) as response:
        assert response.headers.get("profile-web-page-url") == (
            "https://account.example.org/personal")
    check(api("PATCH", "/settings", {
        "subscriptionProfileWebPageUrl": "https://account.example.org/\r\nx-inject: yes"
    }, owner_cookie)[0], 400, "reject response header injection in personal webpage")
    check(api("PATCH", "/settings", {
        "subscriptionProfileWebPageUrl": "",
        "subscriptionProfileWebPageEnabled": True
    }, owner_cookie)[0], 200, "restore automatic personal webpage")

    # Explicit format override works even when the User-Agent is a browser.
    for fmt, expected_type in [("xray","application/json"),("links","text/plain"),
                               ("base64","text/plain"),("mihomo","application/yaml"),
                               ("singbox","application/json")]:
        req=Request(BASE + subscription_path + "?format=" + fmt,
                    headers={"User-Agent":"Mozilla/5.0","Accept":"text/html"})
        with urlopen(req,timeout=30) as response:
            assert response.status==200
            assert response.headers["Content-Type"].startswith(expected_type)
    req=Request(BASE + subscription_path + "?format=unknown",
                headers={"User-Agent":"Happ/26.7.28","Accept":"*/*"})
    try:
        urlopen(req,timeout=30)
        raise AssertionError("Invalid format must be rejected")
    except HTTPError as error:
        assert error.code==400
    print("PASS: HTML and native/multi-format content negotiation for eleven VPN agents")

    check(api("PATCH", f"/collections/hosts/{host['id']}",
              {"disabled": True}, admin_cookie)[0], 200,
          "disable Host while Node remains enabled")
    assert_client_hosts(0, "disabled Host does not fall back to live Node")
    check(api("PATCH", f"/collections/hosts/{host['id']}",
              {"disabled": False}, admin_cookie)[0], 200,
          "re-enable explicit Host")
    assert_client_hosts(1, "re-enabled Host publishes again")
    check(api("DELETE", f"/collections/hosts/{host['id']}", cookie=admin_cookie)[0], 200,
          "clean up active host")
    assert_client_hosts(0, "deleted final Host returns 200 with an empty JSON feed")
    check(api("DELETE", f"/collections/squads/{squad_id}", cookie=admin_cookie)[0], 200,
          "clean up subscription test squad")
    check(api("DELETE", f"/collections/nodes/{node_id}", cookie=admin_cookie)[0], 200,
          "clean up active host node")
    check(api("DELETE", f"/collections/profiles/{profile_id}", cookie=admin_cookie)[0], 200,
          "clean up active host profile")
    check(api("GET", "/admins", cookie=admin_cookie)[0], 403, "admin cannot manage administrators")
    check(api("PATCH", f"/admins/{viewer_id}", {"isActive": False}, owner_cookie)[0], 200,
          "owner disables admin")
    check(api("GET", "/bootstrap", cookie=admin_cookie)[0], 401,
          "disabled administrator session revoked")

    status, availability, _ = api("GET", "/auth/mfa/status", cookie=owner_cookie)
    check(status, 200, "MFA status")
    assert availability["available"] and not availability["enabled"], "MFA key not configured in CI"
    status, setup, _ = api("POST", "/auth/mfa/setup", {"password": PASSWORD}, owner_cookie)
    check(status, 200, "MFA setup")
    status, enabled, _ = api("POST", "/auth/mfa/confirm", {"code": totp(setup["secret"])}, owner_cookie)
    check(status, 200, "MFA confirm")
    codes = enabled["recoveryCodes"]
    assert enabled["enabled"] and len(codes) == 10

    pending, _ = login(USER, PASSWORD, mfa=True)
    status, signed_in, mfa_cookie = api(
        "POST", "/auth/mfa/verify", {"challenge": pending["challenge"], "code": codes[0]})
    check(status, 200, "recovery code login")
    assert signed_in["authenticated"] and mfa_cookie
    # maxSessions=1 is the strict default: the new MFA session revokes the
    # previous owner cookie. Critical mutations must use the current session.
    owner_cookie = mfa_cookie
    check(api("POST", "/auth/mfa/verify",
              {"challenge": pending["challenge"], "code": codes[0]})[0], 401,
          "MFA challenge cannot replay")
    another, _ = login(USER, PASSWORD, mfa=True)
    check(api("POST", "/auth/mfa/verify",
              {"challenge": another["challenge"], "code": codes[0]})[0], 401,
          "recovery code cannot replay")

    stale, _ = login(USER, PASSWORD, mfa=True)
    check(api("PATCH", f"/admins/{owner_id}", {"password": NEW_PASSWORD}, owner_cookie)[0], 200,
          "password rotation")
    check(api("POST", "/auth/mfa/verify",
              {"challenge": stale["challenge"], "code": codes[1]})[0], 401,
          "pending challenge revoked after password change")
    check(api("POST", "/auth/login", {"username": USER, "password": PASSWORD})[0], 401,
          "old password invalid")
    fresh, _ = login(USER, NEW_PASSWORD, mfa=True)
    status, _, fresh_cookie = api(
        "POST", "/auth/mfa/verify", {"challenge": fresh["challenge"], "code": codes[1]})
    check(status, 200, "new password plus MFA works")
    test_scoped_integration_api(fresh_cookie, setup["secret"], user_id)
    check(api("PATCH", f"/admins/{owner_id}", {"isActive": False}, fresh_cookie)[0], 400,
          "owner cannot disable own account")
    check(api("DELETE", f"/admins/{owner_id}", cookie=fresh_cookie)[0], 400,
          "owner cannot delete own account")
    print("Real PostgreSQL/Redis RBAC and MFA integration tests passed.")


if __name__ == "__main__":
    main()
