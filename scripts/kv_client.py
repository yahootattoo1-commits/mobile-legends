#!/usr/bin/env python3
"""Client for the Persian Mlbb Worker data / translate / alert endpoints.

Auth (same stateless scheme as the Worker):
  VM:   WS  = HMAC-SHA256(key = Cloudflare token surrogate, message = 'persian-mlbb-bot-webhook')
        X-Data-Auth for POST /data/<file>   = HMAC-SHA256(key = WS, message = 'persian-mlbb-bot-data:' + file)
  Actions: MLBB_DATA_SECRET env (the shared DATA_SECRET value, set in the
        repo's Actions secrets AND as DATA_SECRET in the Cloudflare dashboard)
        is used DIRECTLY as the HMAC key, same messages. The Worker accepts
        HMACs keyed by either WEBHOOK_SECRET or DATA_SECRET.
  X-Data-Auth for POST /translate     = HMAC-SHA256(key = KEY, message = 'persian-mlbb-bot-translate')
  X-Data-Auth for POST /alert         = HMAC-SHA256(key = KEY, message = 'persian-mlbb-bot-alert')
All hex. The surrogate is fetched in-process from the authd socket and is
NEVER printed, logged or written to a file; only the derived HMACs travel
(as curl argv, never echoed). MLBB_DATA_SECRET is likewise never printed.

HTTP goes through curl (not urllib: this VM's egress proxy rejects urllib
requests and direct TLS fails). curl picks up the proxy from the environment
(the wrapper script sources /etc/profile.d/hatch-egress.sh first).
On GitHub Actions there is no egress proxy — curl just works directly.

CLI (for manual use; the refresh driver imports the functions):
  kv_client.py post <local-file>...            POST each file to /data/<basename>
  kv_client.py get <name>                      GET /data/<name> to stdout (bytes)
  kv_client.py verify <local-file>...          GET each back (with retries) and compare bytes
  kv_client.py translate <json-file>           POST the JSON payload to /translate, print result JSON
  kv_client.py alert <message>                 POST {message} to /alert
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import time

WORKER = 'https://persian-mlbb-bot.yahootattoo1.workers.dev'
sys.path.insert(0, '/opt/muse/skills/custom-connector-setup/bin')

_CACHED_WS = None


def _ws():
    global _CACHED_WS
    if _CACHED_WS is None:
        from dynamic_credentials import dynamic_credential_entry
        surrogate = str(dynamic_credential_entry('custom.cloudflare', 'access_token')['surrogate']).strip()
        _CACHED_WS = hmac.new(surrogate.encode(), b'persian-mlbb-bot-webhook', hashlib.sha256).hexdigest()
    return _CACHED_WS


def _data_key():
    """HMAC key for /data, /translate, /alert.

    GitHub Actions: MLBB_DATA_SECRET (the shared DATA_SECRET value).
    VM fallback: the derived WEBHOOK_SECRET (WS) from the Cloudflare
    surrogate via authd — unchanged behavior.
    """
    env_key = os.environ.get('MLBB_DATA_SECRET', '').strip()
    if env_key:
        return env_key
    return _ws()


def auth_for(message):
    return hmac.new(_data_key().encode(), message.encode(), hashlib.sha256).hexdigest()


def _curl(method, path, headers=None, data_file=None, timeout=120):
    """Returns (http_status:int, body:bytes). Raises on curl failure/timeout."""
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        out_path = tmp.name
    try:
        cmd = ['curl', '-s', '-o', out_path, '-w', '%{http_code}', '-X', method,
               WORKER + path, '--max-time', str(timeout)]
        for k, v in (headers or {}).items():
            cmd += ['-H', '%s: %s' % (k, v)]
        if data_file:
            cmd += ['--data-binary', '@' + data_file]
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout + 30)
        code_raw = proc.stdout.decode('utf-8', 'replace').strip().splitlines()
        code = int(code_raw[-1]) if code_raw else 0
        with open(out_path, 'rb') as f:
            body = f.read()
        return code, body
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


def post_file(local_path, remote_name=None, timeout=120):
    name = remote_name or os.path.basename(local_path)
    code, body = _curl('POST', '/data/' + name,
                      headers={'X-Data-Auth': auth_for('persian-mlbb-bot-data:' + name),
                               'Content-Type': 'application/json'},
                      data_file=local_path, timeout=timeout)
    return code, body


def get_file(remote_name, timeout=60):
    return _curl('GET', '/data/' + remote_name, timeout=timeout)


def get_file_verified(remote_name, expected_bytes, tries=12, delay=10, timeout=60):
    """GET until the body byte-matches (KV replication lag). Returns True/False."""
    for _ in range(tries):
        try:
            code, body = get_file(remote_name, timeout=timeout)
        except Exception:
            code, body = 0, b''
        if code == 200 and body == expected_bytes:
            return True
        time.sleep(delay)
    return False


def translate(payload, timeout=180):
    """POST payload dict to /translate. Returns (http_status, parsed dict or None)."""
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as tmp:
        json.dump(payload, tmp, ensure_ascii=False)
        tmp_path = tmp.name
    try:
        code, body = _curl('POST', '/translate',
                          headers={'X-Data-Auth': auth_for('persian-mlbb-bot-translate'),
                                   'Content-Type': 'application/json'},
                          data_file=tmp_path, timeout=timeout)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    try:
        return code, json.loads(body.decode('utf-8'))
    except Exception:
        return code, None


def alert(message, timeout=60):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as tmp:
        json.dump({'message': message}, tmp, ensure_ascii=False)
        tmp_path = tmp.name
    try:
        code, body = _curl('POST', '/alert',
                          headers={'X-Data-Auth': auth_for('persian-mlbb-bot-alert'),
                                   'Content-Type': 'application/json'},
                          data_file=tmp_path, timeout=timeout)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    return code, body


def report(payload, timeout=60):
    """POST the run summary to /refresh-report (admin report in Telegram)."""
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as tmp:
        json.dump(payload, tmp, ensure_ascii=False)
        tmp_path = tmp.name
    try:
        code, body = _curl('POST', '/refresh-report',
                          headers={'X-Data-Auth': auth_for('persian-mlbb-bot-refresh-report'),
                                   'Content-Type': 'application/json'},
                          data_file=tmp_path, timeout=timeout)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    return code, body


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip().splitlines()[-8:])
        return 2
    cmd = argv[1]
    if cmd == 'post':
        rc = 0
        for path in argv[2:]:
            code, body = post_file(path)
            print('%s -> %d %s' % (os.path.basename(path), code, body[:80].decode('utf-8', 'replace')))
            if code != 200:
                rc = 1
        return rc
    if cmd == 'get':
        code, body = get_file(argv[2])
        sys.stdout.buffer.write(body)
        return 0 if code == 200 else 1
    if cmd == 'verify':
        rc = 0
        for path in argv[2:]:
            with open(path, 'rb') as f:
                expected = f.read()
            ok = get_file_verified(os.path.basename(path), expected)
            print('%s verified=%s' % (os.path.basename(path), ok))
            if not ok:
                rc = 1
        return rc
    if cmd == 'translate':
        with open(argv[2], encoding='utf-8') as f:
            payload = json.load(f)
        code, out = translate(payload)
        print(json.dumps({'status': code, 'result': out}, ensure_ascii=False))
        return 0 if code == 200 else 1
    if cmd == 'alert':
        code, body = alert(' '.join(argv[2:]))
        print('alert -> %d %s' % (code, body[:120].decode('utf-8', 'replace')))
        return 0 if code == 200 else 1
    print('unknown command: %s' % cmd)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
