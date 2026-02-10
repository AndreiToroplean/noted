import time
import sys
import requests

BASE = "http://127.0.0.1:8000"

# wait for server
for i in range(20):
    try:
        r = requests.get(BASE + "/docs")
        if r.status_code == 200:
            break
    except Exception:
        pass
    time.sleep(0.5)
else:
    print("Server did not start in time")
    sys.exit(2)

# 1) GET on a Tuesday -> should be 400 (not Monday)
r = requests.get(BASE + "/journal/2026-02-10")
print("GET 2026-02-10 status:", r.status_code, r.text)
if r.status_code != 400:
    print("Expected 400 for non-Monday week")
    sys.exit(1)

# 2) GET empty Monday
r = requests.get(BASE + "/journal/2026-02-09")
print("GET 2026-02-09 status:", r.status_code, r.text)
if r.status_code != 200 or r.json() != {}:
    print("Unexpected response for empty Monday")
    sys.exit(1)

# 3) POST payload
payload = {"note": "Smoke test"}
r = requests.post(BASE + "/journal/2026-02-09", json=payload)
print("POST status:", r.status_code, r.text)
if r.status_code != 200 or r.json().get("ok") is not True:
    print("POST failed")
    sys.exit(1)

# 4) GET again
r = requests.get(BASE + "/journal/2026-02-09")
print("GET after POST status:", r.status_code, r.text)
if r.status_code != 200 or r.json() != payload:
    print("Roundtrip failed")
    sys.exit(1)

print("Smoke tests passed")
sys.exit(0)
