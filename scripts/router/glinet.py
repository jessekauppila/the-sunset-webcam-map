#!/usr/bin/env python3
"""GL.iNet GL-X3000 router CLI — status, signal logging, usage, recovery.

Talks to the GL.iNet 4.x JSON-RPC API (http://192.168.8.1/rpc). Stdlib only,
so it runs unmodified on the kiosk Pi (the jump host on the router's LAN) or
on a laptop joined to the router's wifi.

Credentials: the admin password is read from the GLINET_PASSWORD env var, or
from the file ~/.config/glinet/password (chmod 600). Never hardcode it; the
repo this lives in is public.

Subcommands:
  status   one-shot health dump: SIM, registration, signal, band, public IP
  log      append one reading to a SQLite db (for cron every 5 min)
  report   percentile summary of logged RSRP/SINR — the carrier-decision data
  usage    per-SIM traffic counters from the router
  reboot   reboot the router (requires --yes)
  probe    try candidate API methods and report which exist on this firmware
  raw      call an arbitrary (object, method) for exploration
  login    authenticate only — clean exit code for scripts (rotate-creds.sh)

First session against live hardware: run `probe` once — GL.iNet method names
vary by firmware, and this script has not yet been validated against the
X3000NR (built while the router was offline). `status`/`log` try all known
candidates and parse whatever responds, so they should degrade gracefully.
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import time
import urllib.request
import urllib.error

DEFAULT_HOST = "192.168.8.1"
USERNAME = "root"
PASSWORD_FILE = os.path.expanduser("~/.config/glinet/password")
ENV_FILE = os.path.expanduser("~/.config/sunset/router.env")

# (object, method) pairs seen across GL.iNet 4.x firmwares for cellular state.
STATUS_CANDIDATES = [
    ("modem", "get_status"),
    ("modem", "get_info"),
    ("cellular", "get_status"),
    ("cellular", "get_info"),
    ("cellular", "get_sim_status"),
    ("internet", "get_status"),
    ("network", "get_status"),
    ("system", "get_status"),
]
USAGE_CANDIDATES = [
    ("cellular", "get_traffic_stats"),
    ("modem", "get_traffic_stats"),
    ("traffic", "get_status"),
    ("internet", "get_traffic"),
]
PROBE_EXTRA = [
    ("modem", "send_at_command"),
    ("modem", "at_command"),
    ("system", "get_info"),
    ("wifi", "get_status"),
]

# Fields worth extracting from whatever JSON the firmware returns, keyed by
# the (lowercased) key names GL.iNet uses across versions.
SIGNAL_KEYS = {
    "rsrp": "rsrp", "rsrq": "rsrq", "sinr": "sinr", "rssi": "rssi",
    "band": "band", "cell_id": "cell_id", "cellid": "cell_id",
    "operator": "carrier", "carrier": "carrier", "operator_name": "carrier",
    "register_status": "reg_status", "reg_status": "reg_status",
    "sim_status": "sim_status", "modem_status": "modem_status",
    "sim_num": "sim_slot", "sim_slot": "sim_slot", "iccid": "iccid",
    "imei": "imei", "up": "up", "ip": "ip", "ipv4": "ip",
    "connection_status": "conn_status",
}

ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def md5crypt(password: str, salt: str) -> str:
    """Unix md5crypt ($1$) — GL.iNet's challenge alg 1. Pure python because
    the crypt module is gone in 3.13 and macOS crypt() can't do $1$."""
    pw, s = password.encode(), salt[:8].encode()
    ctx = hashlib.md5(pw + b"$1$" + s)
    alt = hashlib.md5(pw + s + pw).digest()
    for i in range(len(pw)):
        ctx.update(alt[i % 16:i % 16 + 1])
    i = len(pw)
    while i:
        ctx.update(b"\x00" if i & 1 else pw[:1])
        i >>= 1
    final = ctx.digest()
    for i in range(1000):
        c = hashlib.md5()
        c.update(pw if i & 1 else final)
        if i % 3:
            c.update(s)
        if i % 7:
            c.update(pw)
        c.update(final if i & 1 else pw)
        final = c.digest()

    def b64(v, n):
        return "".join(ITOA64[(v >> (6 * k)) & 0x3F] for k in range(n))

    out = "".join(
        b64((final[a] << 16) | (final[b] << 8) | final[c], 4)
        for a, b, c in ((0, 6, 12), (1, 7, 13), (2, 8, 14), (3, 9, 15), (4, 10, 5))
    ) + b64(final[11], 2)
    return "$1$" + salt[:8] + "$" + out


def sha256crypt(password: str, salt: str, rounds: int = 5000) -> str:
    """SHA-256 crypt ($5$), Drepper's spec — GL.iNet challenge alg 5.
    Verified against the spec test vector (see self-test in the repo)."""
    pw, s = password.encode(), salt[:16].encode()
    B = hashlib.sha256(pw + s + pw).digest()
    A = hashlib.sha256(pw + s)
    cnt = len(pw)
    while cnt > 32:
        A.update(B)
        cnt -= 32
    A.update(B[:cnt])
    i = len(pw)
    while i:
        A.update(B if i & 1 else pw)
        i >>= 1
    A = A.digest()
    DP = hashlib.sha256(pw * len(pw)).digest()
    P = (DP * (len(pw) // 32 + 1))[:len(pw)]
    DS = hashlib.sha256(s * (16 + A[0])).digest()
    S = (DS * (len(s) // 32 + 1))[:len(s)]
    C = A
    for i in range(rounds):
        ctx = hashlib.sha256()
        ctx.update(P if i & 1 else C)
        if i % 3:
            ctx.update(S)
        if i % 7:
            ctx.update(P)
        ctx.update(C if i & 1 else P)
        C = ctx.digest()

    def b64(v, n):
        return "".join(ITOA64[(v >> (6 * k)) & 0x3F] for k in range(n))

    order = ((0, 10, 20), (21, 1, 11), (12, 22, 2), (3, 13, 23), (24, 4, 14),
             (15, 25, 5), (6, 16, 26), (27, 7, 17), (18, 28, 8), (9, 19, 29))
    out = "".join(b64((C[a] << 16) | (C[b] << 8) | C[c], 4) for a, b, c in order)
    out += b64((C[31] << 8) | C[30], 3)
    prefix = f"$5$rounds={rounds}$" if rounds != 5000 else "$5$"
    return prefix + salt[:16] + "$" + out


class GlinetClient:
    def __init__(self, host: str, password: str, timeout: int = 10):
        self.url = f"http://{host}/rpc"
        self.password = password
        self.timeout = timeout
        self.sid = None
        self._id = 0

    def _rpc(self, method, params):
        self._id += 1
        body = json.dumps({"jsonrpc": "2.0", "id": self._id,
                           "method": method, "params": params}).encode()
        req = urllib.request.Request(
            self.url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            reply = json.loads(resp.read().decode())
        if "error" in reply:
            raise RuntimeError(f"rpc {method}: {reply['error']}")
        return reply.get("result", {})

    def login(self):
        ch = self._rpc("challenge", {"username": USERNAME})
        alg, salt, nonce = ch.get("alg"), ch["salt"], ch["nonce"]
        if str(alg) in ("1", "md5"):
            cipher = md5crypt(self.password, salt)
        elif str(alg) == "5":
            cipher = sha256crypt(self.password, salt)
        else:
            try:  # pre-3.13 Linux fallback for other crypt algs (e.g. $6$)
                import crypt
                prefix = {"6": "$6$"}.get(str(alg), "$1$")
                cipher = crypt.crypt(self.password, prefix + salt)
            except ImportError:
                raise RuntimeError(f"unsupported challenge alg {alg!r}")
        digest = hashlib.md5(f"{USERNAME}:{cipher}:{nonce}".encode()).hexdigest()
        res = self._rpc("login", {"username": USERNAME, "hash": digest})
        self.sid = res.get("sid") or res.get("Sid")
        if not self.sid:
            raise RuntimeError(f"login gave no sid: {res}")

    def call(self, obj, method, params=None):
        if not self.sid:
            self.login()
        return self._rpc("call", [self.sid, obj, method, params or {}])


def read_env_file(path=ENV_FILE):
    vals = {}
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    vals[k.strip()] = v
    return vals


def get_password(args):
    pw = (args.password or os.environ.get("GLINET_PASSWORD")
          or read_env_file().get("GLINET_PASSWORD"))
    if not pw and os.path.exists(PASSWORD_FILE):
        with open(PASSWORD_FILE) as f:
            pw = f.read().strip()
    if not pw:
        sys.exit(f"No password: set GLINET_PASSWORD, or {ENV_FILE}, "
                 f"or {PASSWORD_FILE} (chmod 600)")
    return pw


def try_candidates(client, candidates):
    """Call each candidate; return {'obj.method': result} for ones that answer.
    Logs in first (raises on failure) so a bad password is one challenge
    request, not one per candidate — the router rate-limits challenges."""
    if not client.sid:
        client.login()
    results = {}
    for obj, method in candidates:
        try:
            results[f"{obj}.{method}"] = client.call(obj, method)
        except Exception as e:
            results[f"{obj}.{method}"] = {"_error": str(e)}
    return results


def succeeded(res):
    return not (isinstance(res, dict) and "_error" in res)


def extract_signal(results):
    """Recursively pull known signal/SIM fields out of whatever responded."""
    found = {}

    def walk(node):
        if isinstance(node, dict):
            for k, v in node.items():
                std = SIGNAL_KEYS.get(k.lower())
                if std is not None and not isinstance(v, (dict, list)):
                    found.setdefault(std, v)
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for key, res in results.items():
        if isinstance(res, dict) and "_error" not in res:
            walk(res)
    return found


def public_ip_whois(timeout=10):
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=timeout) as r:
            ip = r.read().decode().strip()
    except Exception as e:
        return {"public_ip": None, "whois_org": None, "error": str(e)}
    org = None
    try:
        with urllib.request.urlopen(f"https://rdap.arin.net/registry/ip/{ip}",
                                    timeout=timeout) as r:
            rdap = json.loads(r.read().decode())
        org = rdap.get("name")
    except Exception:
        pass
    return {"public_ip": ip, "whois_org": org}


DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS signal_log (
  ts TEXT NOT NULL,            -- ISO8601 UTC
  ok INTEGER NOT NULL,         -- 1 = router API answered
  reg_status TEXT, sim_status TEXT, sim_slot TEXT, carrier TEXT,
  band TEXT, cell_id TEXT,
  rsrp REAL, rsrq REAL, sinr REAL, rssi REAL,
  public_ip TEXT, whois_org TEXT,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_signal_ts ON signal_log (ts);
"""


def to_float(v):
    if v is None:
        return None
    try:
        return float(str(v).replace("dBm", "").replace("dB", "").strip())
    except ValueError:
        return None


def cmd_status(args, client):
    results = try_candidates(client, STATUS_CANDIDATES)
    sig = extract_signal(results)
    if args.public:
        sig.update(public_ip_whois())
    if args.json:
        print(json.dumps({"parsed": sig, "raw": results}, indent=2))
        return
    if not sig:
        print("No known fields parsed — run `probe` and inspect raw output:")
        print(json.dumps(results, indent=2))
        return
    for k in ("sim_slot", "sim_status", "reg_status", "conn_status", "carrier",
              "band", "cell_id", "rsrp", "rsrq", "sinr", "rssi", "ip",
              "public_ip", "whois_org", "iccid", "imei"):
        if k in sig:
            print(f"{k:12} {sig[k]}")


def cmd_log(args, client_factory):
    row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ok": 0}
    raw = {}
    try:
        client = client_factory()
        raw = try_candidates(client, STATUS_CANDIDATES)
        row.update(extract_signal(raw))
        row["ok"] = int(any(succeeded(v) for v in raw.values()))
    except Exception as e:
        raw = {"_fatal": str(e)}
    row.update(public_ip_whois())

    db = sqlite3.connect(args.db)
    db.executescript(DB_SCHEMA)
    prev = db.execute(
        "SELECT ok, reg_status FROM signal_log ORDER BY ts DESC LIMIT 1").fetchone()
    db.execute(
        "INSERT INTO signal_log (ts, ok, reg_status, sim_status, sim_slot, carrier,"
        " band, cell_id, rsrp, rsrq, sinr, rssi, public_ip, whois_org, raw_json)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (row["ts"], row["ok"], row.get("reg_status"), row.get("sim_status"),
         str(row.get("sim_slot") or ""), row.get("carrier"), str(row.get("band") or ""),
         str(row.get("cell_id") or ""), to_float(row.get("rsrp")),
         to_float(row.get("rsrq")), to_float(row.get("sinr")),
         to_float(row.get("rssi")), row.get("public_ip"), row.get("whois_org"),
         json.dumps(raw)))
    db.commit()

    # Alert only on state transitions so a sustained outage pages once.
    if args.ntfy and prev is not None:
        was_up, now_up = bool(prev[0]), bool(row["ok"])
        if was_up != now_up:
            msg = ("router API back up" if now_up
                   else "router API unreachable — cellular likely down")
            try:
                urllib.request.urlopen(urllib.request.Request(
                    f"https://ntfy.sh/{args.ntfy}", data=msg.encode(),
                    headers={"Title": "GL-X3000 signal-log"}), timeout=10)
            except Exception:
                pass
    print(f"{row['ts']} ok={row['ok']} rsrp={row.get('rsrp')} sinr={row.get('sinr')}"
          f" reg={row.get('reg_status')} whois={row.get('whois_org')}")


def percentile(sorted_vals, p):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def cmd_report(args):
    if not os.path.exists(args.db):
        sys.exit(f"No database at {args.db} — run `log` first (or point --db at it)")
    db = sqlite3.connect(args.db)
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ",
                          time.gmtime(time.time() - args.days * 86400))
    try:
        rows = db.execute(
            "SELECT ok, rsrp, sinr, carrier, whois_org FROM signal_log WHERE ts >= ?",
            (since,)).fetchall()
    except sqlite3.OperationalError:
        sys.exit(f"{args.db} has no signal_log table — run `log` first")
    if not rows:
        print(f"No readings in the last {args.days}d in {args.db}")
        return
    up = [r for r in rows if r[0]]
    print(f"Last {args.days}d: {len(rows)} readings, "
          f"{100 * len(up) / len(rows):.1f}% router-API-reachable")
    for org in sorted({r[4] for r in up if r[4]}):
        print(f"  network: {org} ({sum(1 for r in up if r[4] == org)} readings)")
    # RSRP: good > -95, usable -95..-105, marginal < -110
    # SINR: good > 15, usable 10..15, marginal < 10
    for name, idx, good, marginal in (("rsrp", 1, -95, -110), ("sinr", 2, 15, 10)):
        vals = sorted(r[idx] for r in up if r[idx] is not None)
        if not vals:
            print(f"  {name}: no data")
            continue
        p10, p50, p90 = (percentile(vals, p) for p in (0.1, 0.5, 0.9))
        frac_good = sum(1 for v in vals if v > good) / len(vals)
        frac_bad = (sum(1 for v in vals if v < marginal) / len(vals))
        print(f"  {name}: p10={p10:.1f} median={p50:.1f} p90={p90:.1f} "
              f"| {100 * frac_good:.0f}% good, {100 * frac_bad:.0f}% marginal "
              f"({len(vals)} samples)")


def cmd_usage(args, client):
    results = try_candidates(client, USAGE_CANDIDATES)
    print(json.dumps(results, indent=2))


def cmd_reboot(args, client):
    if not args.yes:
        sys.exit("Refusing without --yes (reboot drops the kiosk + this session's "
                 "path if you're jumping through the Pi's wifi).")
    print(client.call("system", "reboot"))


def cmd_probe(args, client):
    results = try_candidates(
        client, STATUS_CANDIDATES + USAGE_CANDIDATES + PROBE_EXTRA)
    for key, res in results.items():
        err = res.get("_error") if isinstance(res, dict) else None
        print(f"{'MISS' if err else 'OK  '} {key}" + (f"  ({err})" if err else ""))
    ok = {k: v for k, v in results.items()
          if not (isinstance(v, dict) and "_error" in v)}
    if args.json and ok:
        print(json.dumps(ok, indent=2))


def cmd_raw(args, client):
    if args.params == "-":  # stdin keeps secrets out of argv/ps and ssh quoting
        params = json.load(sys.stdin)
    else:
        params = json.loads(args.params) if args.params else {}
    print(json.dumps(client.call(args.object, args.method, params), indent=2))


def cmd_login(args, client):
    try:
        client.login()
    except Exception as e:
        sys.exit(f"login FAILED: {e}")
    print("login ok")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default=DEFAULT_HOST)
    p.add_argument("--password", help="prefer GLINET_PASSWORD env or "
                                      f"{PASSWORD_FILE} over this flag")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("status")
    sp.add_argument("--json", action="store_true")
    sp.add_argument("--public", action="store_true",
                    help="also fetch public IP + whois org (needs working uplink)")

    lp = sub.add_parser("log")
    lp.add_argument("--db", default=os.path.expanduser("~/router/signal.sqlite"))
    lp.add_argument("--ntfy", help="ntfy.sh topic to page on up/down transitions")

    rp = sub.add_parser("report")
    rp.add_argument("--db", default=os.path.expanduser("~/router/signal.sqlite"))
    rp.add_argument("--days", type=int, default=7)

    sub.add_parser("usage")

    bp = sub.add_parser("reboot")
    bp.add_argument("--yes", action="store_true")

    pp = sub.add_parser("probe")
    pp.add_argument("--json", action="store_true")

    wp = sub.add_parser("raw")
    wp.add_argument("object")
    wp.add_argument("method")
    wp.add_argument("params", nargs="?", help="JSON dict of call params, or '-' for stdin")

    sub.add_parser("login")

    args = p.parse_args()

    if args.cmd == "report":
        cmd_report(args)
        return

    factory = lambda: GlinetClient(args.host, get_password(args))
    if args.cmd == "log":
        cmd_log(args, factory)
        return

    client = factory()
    try:
        {"status": cmd_status, "usage": cmd_usage, "reboot": cmd_reboot,
         "probe": cmd_probe, "raw": cmd_raw, "login": cmd_login}[args.cmd](args, client)
    except (RuntimeError, urllib.error.URLError, OSError) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
