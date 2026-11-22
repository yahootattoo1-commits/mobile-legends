#!/usr/bin/env python3
"""Autonomous 30-minute refresh for Persian MLBB — no agent, no LLM.

Runs every 30 min from GitHub Actions (.github/workflows/refresh.yml) and,
as a fallback, under a systemd user timer on the VM (mlbb-refresh.timer)
via scripts/refresh_auto.sh. Does the WHOLE refresh end-to-end:

  1. Light scrapes every run: scrape_news.py all + scrape_events.py
  2. Patch rebuild: scrape_fandom_content.py patches ONLY when the patch
     top-10 in news.json changed vs patch-notes-full.json
  3. Heavy stats: scrape_matchups_stats.py ONLY when hero-stats.json
     fetched_at is > 20h old
  4. Weekly builds: scrape-mlbbio-builds.js ONLY on Saturday ~11:54 Tehran
     (timer fires :00/:30, so the 11:30 run) and once per ISO week
  5. Translate NEW items via the Worker POST /translate endpoint
     (events, discussion titles, a whole new patch) and merge the results
     into data/fa-content.json — translations NEVER go into source files
  6. Compare all data files against hidden_files/auto-refresh/published/
     and POST ONLY changed files to the Worker KV endpoint (POST /data/*)
  7. /health check, one log line + status JSON, silent on success
  8. After 3 consecutive failed runs, POST /alert — the Worker sends
     roozbeh a short Persian Telegram message (the ONLY notification)

Failure (for the 3-strike counter): a scraper exits non-zero, a KV POST or
its GET verification fails, /health fails, or a new item's translation
fails (the item is left untranslated and retried next run).

Exit code: 0 on success, 1 on failure. Never touches GitHub, never bumps
DATA_VERSION (Worker-served data is no-store), never restarts the VM bot.

Paths are repo-relative by default (REPO_ROOT = the checkout root, derived
from this file's location); on the VM they resolve to the same workspace
paths as before. State (published baseline, runs log/status) lives in
MLBB_STATE_DIR — on the VM the goal's hidden_files dir, on Actions the
runner temp dir (restored from the workflow cache). HMAC key: env
MLBB_DATA_SECRET when set (GitHub Actions), else the VM derivation.
The local forward proxy (127.0.0.1:18080) is VM-only, enabled with
USE_LOCAL_PROXY=1; GitHub runners have direct internet and skip it.
"""
import json
import os
import re
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(os.environ.get('REPO_ROOT', '') or Path(__file__).resolve().parent.parent)
BASE = REPO_ROOT
DATA = BASE / 'data'
SCRIPTS = BASE / 'scripts'
VENV_PY = Path(os.environ.get('MLBB_PYTHON', '') or sys.executable)
STATE_DIR = Path(os.environ.get('MLBB_STATE_DIR', '') or '/home/hatch/workspace/goals/mlbb-telegram-bot-and-persian-mini-app/hidden_files')
PUBLISHED = STATE_DIR / 'auto-refresh' / 'published'
RUNS = STATE_DIR / 'runs'
LOG = RUNS / 'auto-refresh.log'
STATUS = RUNS / 'auto-refresh-status.json'
WORKER_HEALTH = 'https://persian-mlbb-bot.yahootattoo1.workers.dev/health'

TEHRAN = timezone(timedelta(hours=3, minutes=30))
HEAVY_STATS_MAX_AGE_H = 20

# Files compared every run (the cron's 10). builds-full.json joins the compare
# set only when the weekly gate runs.
COMPARE_FILES = ['news.json', 'tierlist.json', 'discussions.json', 'events.json',
                 'channel-news.json',
                 'patch-notes-full.json', 'hero-stats.json', 'matchups.json',
                 'team-comps.json', 'team-comp-guide.json', 'fa-content.json']
# KV allow-list: the 7 refreshable + fa-content + patch-notes-full + builds-full.
# team-comp-guide.json is deliberately NOT postable (not in the allow-list).
POSTABLE = {'news.json', 'tierlist.json', 'discussions.json', 'events.json',
            'channel-news.json',
            'hero-stats.json', 'matchups.json', 'team-comps.json',
            'fa-content.json', 'patch-notes-full.json', 'builds-full.json'}

sys.path.insert(0, str(SCRIPTS))
import kv_client  # noqa: E402  (uses curl + the Cloudflare surrogate via authd)


def now_tehran():
    return datetime.now(TEHRAN)


def log_line(text):
    RUNS.mkdir(parents=True, exist_ok=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write('%s %s\n' % (now_tehran().isoformat(timespec='seconds'), text))


def load_status():
    try:
        return json.loads(STATUS.read_text(encoding='utf-8'))
    except Exception:
        return {'last_run': None, 'last_success': None, 'last_error': None,
                'consecutive_failures': 0, 'last_builds_week': None}


def save_status(st):
    RUNS.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding='utf-8')


def run_cmd(argv, timeout=1500):
    """Returns (rc, stdout, stderr)."""
    try:
        proc = subprocess.run(argv, capture_output=True, text=True,
                              timeout=timeout, cwd=str(BASE))
        return proc.returncode, proc.stdout or '', proc.stderr or ''
    except subprocess.TimeoutExpired:
        return 124, '', 'timeout after %ss' % timeout
    except Exception as e:  # noqa: BLE001
        return 1, '', 'spawn failed: %s' % e


def ensure_local_proxy():
    """VM-only: local auth-bridging proxy on 127.0.0.1:18080 for the stealth
    browser (Chromium CONNECT to the egress proxy is rejected; the egress
    proxy MITMs TLS). Opt-in via USE_LOCAL_PROXY=1 (the systemd wrapper
    sets it); GitHub Actions runners have direct internet and skip it."""
    if os.environ.get('USE_LOCAL_PROXY', '').strip() not in ('1', 'true', 'yes'):
        return True
    try:
        s = socket.create_connection(('127.0.0.1', 18080), timeout=2)
        s.close()
        return True
    except OSError:
        pass
    subprocess.Popen(
        [sys.executable, '/home/hatch/workspace/scrapling/local_proxy.py', '18080'],
        stdout=open('/home/hatch/workspace/scrapling/logs-proxy.out', 'ab'),
        stderr=subprocess.STDOUT, start_new_session=True)
    for _ in range(15):
        try:
            s = socket.create_connection(('127.0.0.1', 18080), timeout=2)
            s.close()
            return True
        except OSError:
            time.sleep(1)
    return False


def _comparable_bytes_from_raw(raw):
    try:
        obj = json.loads(raw.decode('utf-8'))
    except Exception:
        return raw
    if isinstance(obj, dict) and 'fetched_at' in obj:
        obj = {k: v for k, v in obj.items() if k != 'fetched_at'}
        return json.dumps(obj, ensure_ascii=False, sort_keys=True).encode('utf-8')
    return raw


def _comparable_bytes(path):
    """Bytes used for change detection: for JSON files the top-level
    fetched_at is dropped — the scrapers rewrite it with the current time
    on EVERY run, so a byte compare would 'change' the 4 light files every
    30 minutes even when nothing real changed. The POST itself still sends
    the full current file (fresh fetched_at included) when a real change
    exists; published/ keeps the full posted bytes."""
    return _comparable_bytes_from_raw(path.read_bytes())


# Stateful files the run READS as current state (gates, translations,
# compare). On a fresh checkout (GitHub Actions) data/ is the last pushed
# snapshot, which can be days older than live KV — sync them from KV first
# so the run works from live state, and so a failed scraper can never
# regress KV by posting a stale file.
SYNC_FROM_KV = ['fa-content.json', 'patch-notes-full.json', 'builds-full.json',
                'hero-stats.json', 'matchups.json', 'team-comps.json']


def sync_state_from_kv():
    """GET the live KV copies of SYNC_FROM_KV into data/ (valid JSON only).
    Keeps the local file on any GET failure. Returns the number synced."""
    n = 0
    for name in SYNC_FROM_KV:
        try:
            code, body = kv_client.get_file(name)
        except Exception:  # noqa: BLE001
            continue
        if code != 200 or not body:
            continue
        try:
            json.loads(body.decode('utf-8'))
        except Exception:  # noqa: BLE001
            continue
        (DATA / name).write_bytes(body)
        n += 1
    return n


def baseline_bytes(name):
    """Comparable bytes to detect a change against: the local published/
    copy first; on a fresh checkout (no published/ yet) the live KV copy;
    None when neither exists (treat as changed)."""
    pub_file = PUBLISHED / name
    if pub_file.exists():
        return _comparable_bytes(pub_file)
    try:
        code, body = kv_client.get_file(name)
    except Exception:  # noqa: BLE001
        return None
    if code == 200 and body:
        return _comparable_bytes_from_raw(body)
    return None


def baseline_json(name):
    """Parsed baseline JSON (local published/ first, else live KV), or None."""
    pub_file = PUBLISHED / name
    try:
        if pub_file.exists():
            return load_json(pub_file)
    except Exception:  # noqa: BLE001
        pass
    try:
        code, body = kv_client.get_file(name)
        if code == 200 and body:
            return json.loads(body.decode('utf-8'))
    except Exception:  # noqa: BLE001
        pass
    return None


def kv_fetched_at(name):
    """fetched_at of the live KV copy of a file, or '' when unavailable."""
    try:
        code, body = kv_client.get_file(name)
        if code == 200 and body:
            return json.loads(body.decode('utf-8')).get('fetched_at') or ''
    except Exception:  # noqa: BLE001
        pass
    return ''


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def dump_json(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def norm(s):
    return re.sub(r'[^a-z0-9]+', '', str(s or '').lower())


class TranslationError(Exception):
    pass


def translate_with_retry(payload, attempts=2):
    """POST /translate; returns the result dict or raises TranslationError."""
    last = None
    for _ in range(attempts):
        try:
            code, out = kv_client.translate(payload)
        except Exception as e:  # noqa: BLE001
            last = 'transport error: %s' % e
            continue
        if code == 200 and isinstance(out, dict):
            return out
        last = 'HTTP %s: %s' % (code, json.dumps(out, ensure_ascii=False)[:200] if out else 'empty')
    raise TranslationError(last or 'translate failed')


def hero_names_for(*texts):
    """Hero names (Latin) actually mentioned in the given English texts —
    passed as keep_names so the model never transliterates them."""
    joined = ' '.join(str(t) for t in texts if t)
    found = []
    for name in HERO_NAMES:
        if re.search(r'(?<![A-Za-z])' + re.escape(name) + r'(?![A-Za-z])', joined):
            found.append(name)
    return found[:20]


# --- translation of new items (merge targets live in data/fa-content.json) ---

def translate_new_events(fa, events):
    """Returns (translated_count, errors)."""
    fa_events = fa.setdefault('events', {})
    done, errors = 0, []
    for ev in events:
        title = ev.get('title') or ''
        if not title or title in fa_events:
            continue
        try:
            out = translate_with_retry({
                'kind': 'event', 'title': title,
                'summary': ev.get('summary') or '', 'status': ev.get('status') or 'unknown',
                'keep_names': hero_names_for(title, ev.get('summary') or ''),
            })
            fa_events[title] = {'title_fa': out['title_fa'],
                                'summary_fa': out.get('summary_fa') or '',
                                'status_fa': out['status_fa']}
            done += 1
        except TranslationError as e:
            errors.append('event %s: %s' % (title, e))
    return done, errors


def translate_new_discussions(fa, threads):
    fa_disc = fa.setdefault('discussions', {})
    done, errors = 0, []
    for th in threads:
        title = th.get('title') or ''
        if not title or title in fa_disc:
            continue
        try:
            out = translate_with_retry({
                'kind': 'discussion', 'title': title,
                'keep_names': hero_names_for(title),
            })
            fa_disc[title] = {'title_fa': out['title_fa']}
            done += 1
        except TranslationError as e:
            errors.append('discussion %s: %s' % (title, e))
    return done, errors


def translate_patch(title, entry):
    """Full translation of one patch entry (meta + every hero/equipment/
    section part). Returns the fa patch dict or raises TranslationError —
    a partial patch is never merged (retried next run)."""
    keep = hero_names_for(
        title, ' '.join(entry.get('whats_new') or []),
        entry.get('intro') or '', entry.get('designers_note') or '',
        ' '.join(h.get('hero', '') for h in entry.get('new_heroes') or []))
    meta = translate_with_retry({
        'kind': 'patch', 'part': 'meta', 'title': title,
        'whats_new': entry.get('whats_new') or [],
        'intro': entry.get('intro') or '',
        'designers_note': entry.get('designers_note') or '',
        'new_heroes': entry.get('new_heroes') or [],
        'keep_names': keep,
    })
    hero_fa = []
    for adj in entry.get('hero_adjustments') or []:
        out = translate_with_retry({
            'kind': 'patch', 'part': 'hero',
            'hero': adj.get('hero') or '', 'type': adj.get('type') or 'adjust',
            'note': adj.get('note') or '', 'skills': adj.get('skills') or [],
            'keep_names': hero_names_for(
                adj.get('note') or '',
                ' '.join(c for s in adj.get('skills') or [] for c in s.get('changes') or [])),
        })
        out['mlid'] = HERO_MLID.get(norm(adj.get('hero') or ''), '')
        hero_fa.append(out)
    equip_fa = []
    for eq in entry.get('equipment_adjustments') or []:
        out = translate_with_retry({
            'kind': 'patch', 'part': 'equipment',
            'item': eq.get('item') or '', 'type': eq.get('type') or 'adjust',
            'note': eq.get('note'), 'groups': eq.get('groups') or [],
            'keep_names': hero_names_for(
                eq.get('note') or '',
                ' '.join(c for g in eq.get('groups') or [] for c in g.get('changes') or [])),
        })
        equip_fa.append(out)
    sections_fa = []
    for sec in entry.get('other_sections') or []:
        out = translate_with_retry({
            'kind': 'patch', 'part': 'section',
            'heading': sec.get('heading') or '', 'text': sec.get('text') or '',
            'keep_names': hero_names_for(sec.get('heading') or '', sec.get('text') or ''),
        })
        sections_fa.append(out)
    return {'title_fa': meta['title_fa'], 'whats_new_fa': meta['whats_new_fa'],
            'intro_fa': meta['intro_fa'], 'designers_note_fa': meta['designers_note_fa'],
            'new_heroes_fa': meta['new_heroes_fa'],
            'hero_adjustments_fa': hero_fa,
            'equipment_adjustments_fa': equip_fa,
            'other_sections_fa': sections_fa}


def translate_new_patches(fa, patch_entries, wanted_titles):
    """Returns (translated_count, errors). Only patches in the current top-10
    that have no fa entry yet."""
    fa_patches = fa.setdefault('patches', {})
    by_title = {p.get('title'): p for p in patch_entries}
    done, errors = 0, []
    for title in wanted_titles:
        if not title or title in fa_patches or title not in by_title:
            continue
        try:
            fa_patches[title] = translate_patch(title, by_title[title])
            done += 1
        except TranslationError as e:
            errors.append('patch %s: %s' % (title, e))
    return done, errors


# --- Persian descriptions of what actually changed + the posting guard ---
# The admin report must say WHAT was posted (real titles/names), not just a
# filename — and clearly-wrong content must never go live at all.

def _fa_title(fa, section, title):
    """Persian title from fa-content when translated, else the English title."""
    try:
        entry = (fa or {}).get(section, {}).get(title) or {}
        return entry.get('title_fa') or title
    except Exception:  # noqa: BLE001
        return title


def _quoted_titles(titles, fa, section, limit=3):
    """(text, extra) — up to `limit` quoted titles plus how many more."""
    shown = ['«%s»' % _fa_title(fa, section, t) for t in titles[:limit]]
    return '، '.join(shown), max(0, len(titles) - len(shown))


def describe_change(name, old, new, fa):
    """One Persian line saying WHAT changed in a file (real titles/names,
    not the filename). old/new are parsed dicts; old may be None (no baseline).
    Returns '' when nothing describable (caller falls back to the filename)."""
    old = old or {}
    new = new or {}
    if name == 'discussions.json':
        old_map = {t.get('title'): t for t in old.get('threads') or [] if t.get('title')}
        new_t = [t for t in new.get('threads') or [] if t.get('title')]
        added = [t.get('title') for t in new_t if t.get('title') not in old_map]
        if added:
            text, extra = _quoted_titles(added, fa, 'discussions')
            s = '💬 بحث تازه (%d): %s' % (len(added), text)
            if extra:
                s += ' و %d مورد دیگر' % extra
            return s
        if len(new_t) < len(old_map):
            return '💬 بحث‌ها کم شد (%d حذف)' % (len(old_map) - len(new_t))
        # No new/removed titles: say WHAT changed — views, comments, likes,
        # excerpts, or a bumped date — instead of the bare count.
        view_ups = []
        other = []
        for t in new_t:
            o = old_map.get(t.get('title')) or {}
            dv = (t.get('views') or 0) - (o.get('views') or 0)
            if dv > 0:
                view_ups.append((dv, t.get('title'), o.get('views'), t.get('views')))
            dc = (t.get('comments') or 0) - (o.get('comments') or 0)
            dl = (t.get('likes') or 0) - (o.get('likes') or 0)
            bits = []
            if dc:
                bits.append('💬 %s%d' % ('+' if dc > 0 else '', dc))
            if dl:
                bits.append('👍 %s%d' % ('+' if dl > 0 else '', dl))
            if (t.get('excerpt') or '') != (o.get('excerpt') or ''):
                bits.append('متن عوض شد')
            if (t.get('date_iso') or '') != (o.get('date_iso') or ''):
                bits.append('فعالیت تازه')
            if bits:
                other.append('«%s» %s' % (_fa_title(fa, 'discussions', t.get('title')), ' '.join(bits)))
        parts = []
        if view_ups:
            view_ups.sort(reverse=True)
            top = ['«%s» %s→%s' % (_fa_title(fa, 'discussions', title), ov, nv)
                   for _dv, title, ov, nv in view_ups[:3]]
            s = 'بازدید بالا رفت: %s' % '، '.join(top)
            if len(view_ups) > 3:
                s += ' و %d بحث دیگر' % (len(view_ups) - 3)
            parts.append(s)
        if other:
            parts.append('، '.join(other[:2]))
        if parts:
            return '💬 ' + ' — '.join(parts)
        return '💬 بحث‌ها تازه شد (%d مورد)' % len(new_t)
    if name == 'news.json':
        old_p = {p.get('title') for p in old.get('patch_notes') or []}
        added_p = [p.get('title') for p in new.get('patch_notes') or []
                   if p.get('title') and p.get('title') not in old_p]
        old_w = {w.get('title') for w in old.get('wiki_recent') or []}
        added_w = [w.get('title') for w in new.get('wiki_recent') or []
                   if w.get('title') and w.get('title') not in old_w]
        parts = []
        if added_p:
            text, _extra = _quoted_titles(added_p, fa, 'patches', limit=2)
            parts.append('📰 پچ تازه: %s' % text)
        if added_w:
            parts.append('📝 %d تغییر تازه در ویکی: %s' % (len(added_w), '، '.join(added_w[:3])))
        return ' — '.join(parts) if parts else '📰 اخبار تازه شد'
    if name == 'events.json':
        old_map = {e.get('title'): e for e in old.get('events') or [] if e.get('title')}
        new_e = [e for e in new.get('events') or [] if e.get('title')]
        added = [e.get('title') for e in new_e if e.get('title') not in old_map]
        if added:
            text, extra = _quoted_titles(added, fa, 'events')
            s = '🎉 رویداد تازه (%d): %s' % (len(added), text)
            if extra:
                s += ' و %d مورد دیگر' % extra
            return s
        # No new events: describe status/date/summary changes per event.
        _status_fa = {'ended': 'تمام‌شده', 'unknown': 'نامشخص',
                      'active': 'فعال', 'upcoming': 'به‌زودی'}
        changed = []
        for e in new_e:
            o = old_map.get(e.get('title')) or {}
            bits = []
            if (e.get('status') or '') != (o.get('status') or ''):
                bits.append('وضعیت: %s→%s' % (
                    _status_fa.get(o.get('status') or '', o.get('status') or '؟'),
                    _status_fa.get(e.get('status') or '', e.get('status') or '؟')))
            if (e.get('start_date') or '') != (o.get('start_date') or '') \
                    or (e.get('end_date') or '') != (o.get('end_date') or ''):
                bits.append('تاریخ عوض شد')
            if (e.get('summary') or '') != (o.get('summary') or ''):
                bits.append('توضیح عوض شد')
            if bits:
                changed.append('«%s» %s' % (_fa_title(fa, 'events', e.get('title')), '، '.join(bits)))
        if changed:
            return '🎉 رویدادها تازه شد: %s' % '، '.join(changed[:3])
        return '🎉 رویدادها تازه شد (%d مورد)' % len(new_e)
    if name == 'channel-news.json':
        old_ids = {i.get('id') for i in old.get('items') or []}
        new_items = [i for i in new.get('items') or []]
        added = [i for i in new_items if i.get('id') not in old_ids]
        if added:
            titles = ['«%s»' % (i.get('title') or '') for i in added[:3]]
            s = '📰 خبر تازه (%d): %s' % (len(added), '، '.join(titles))
            if len(added) > 3:
                s += ' و %d مورد دیگر' % (len(added) - 3)
            return s
        return '📰 اخبار تازه شد (%d مورد)' % len(new_items)
    if name == 'tierlist.json':
        def tier_map(tl):
            m = {}
            for tier, heroes in ((tl or {}).get('tiers') or {}).items():
                for h in heroes or []:
                    m[h.get('slug') or h.get('name')] = (tier, h.get('name') or h.get('slug'))
            return m
        om, nm = tier_map(old), tier_map(new)
        moves = []
        for slug, (tier, hero_name) in nm.items():
            if slug in om and om[slug][0] != tier:
                moves.append((hero_name, om[slug][0], tier))
        joined = [nm[s][1] for s in nm if s not in om]
        parts = []
        if moves:
            parts.append('🏆 تغییر تیر: %s' % '، '.join('%s از %s به %s' % m for m in moves[:3]))
        if joined:
            parts.append('🆕 هیرو تازه: %s' % '، '.join(joined[:3]))
        if parts:
            return ' — '.join(parts)
        total = sum(len(v or []) for v in (new.get('tiers') or {}).values())
        return '🏆 تیرلیست تازه شد (%d هیرو)' % total
    if name == 'patch-notes-full.json':
        old_t = {p.get('title') for p in old.get('patches') or []}
        added = [p.get('title') for p in new.get('patches') or []
                 if p.get('title') and p.get('title') not in old_t]
        if added:
            text, _extra = _quoted_titles(added, fa, 'patches', limit=2)
            return '📝 پچ تازه: %s' % text
        return '📝 پچ‌ها تازه شد (%d مورد)' % len(new.get('patches') or [])
    if name == 'hero-stats.json':
        return '📊 آمار %d هیرو تازه شد' % len(new.get('heroes') or [])
    if name == 'builds-full.json':
        return '🧱 بیلد %d هیرو تازه شد' % len(new.get('heroes') or {})
    if name == 'matchups.json':
        return '⚔️ کانتر %d هیرو تازه شد' % len(new.get('heroes') or {})
    if name == 'team-comps.json':
        old_ids = {c.get('id') for c in old.get('comps') or []}
        new_comps = [c for c in new.get('comps') or []]
        titles = [c.get('title_fa') or c.get('title') or c.get('id')
                  for c in new_comps if c.get('id') not in old_ids]
        if titles:
            return '👥 ترکیب تازه: %s' % '، '.join('«%s»' % t for t in titles[:2])
        return '👥 ترکیب‌های تیم تازه شد (%d مورد)' % len(new_comps)
    if name == 'fa-content.json':
        return '🌐 ترجمه‌های فارسی تازه شد'
    return ''


def sane_to_post(name, new, old):
    """(ok, reason) — refuse clearly-wrong content so junk never goes live.
    Only blocks on structural breakage or a big count collapse vs baseline;
    a first post (old is None) gets the structural checks only."""
    if not isinstance(new, dict) or not new:
        return False, 'فایل خالی یا خراب است'
    if name == 'discussions.json':
        th = new.get('threads')
        if not isinstance(th, list):
            return False, 'threads ندارد'
        if not th and (old or {}).get('threads'):
            return False, 'بحث‌ها خالی شد'
        if old and len(th) * 2 < len(old.get('threads') or []):
            return False, 'تعداد بحث‌ها نصف شد'
    elif name == 'news.json':
        pn = new.get('patch_notes')
        if not isinstance(pn, list) or not pn:
            return False, 'patch_notes خالی است'
        if old and len(pn) * 2 < len(old.get('patch_notes') or []):
            return False, 'پچ‌ها نصف شد'
    elif name == 'events.json':
        ev = new.get('events')
        if not isinstance(ev, list):
            return False, 'events ندارد'
        if not ev and (old or {}).get('events'):
            return False, 'رویدادها خالی شد'
    elif name == 'channel-news.json':
        it = new.get('items')
        if not isinstance(it, list):
            return False, 'items ندارد'
        if not it and (old or {}).get('items'):
            return False, 'اخبار خالی شد'
        if old and len(it) * 2 < len(old.get('items') or []):
            return False, 'تعداد اخبار نصف شد'
    elif name == 'tierlist.json':
        tiers = new.get('tiers')
        if not isinstance(tiers, dict):
            return False, 'tiers ندارد'
        total = sum(len(v or []) for v in tiers.values())
        if total < 100 or total > 140:
            return False, 'تعداد هیروها غیرعادی است (%d)' % total
    elif name == 'patch-notes-full.json':
        p = new.get('patches')
        if not isinstance(p, list) or not p:
            return False, 'patches خالی است'
        if old and len(p) * 2 < len(old.get('patches') or []):
            return False, 'پچ‌ها نصف شد'
    elif name == 'hero-stats.json':
        hs = new.get('heroes')
        if not isinstance(hs, list):
            return False, 'heroes ندارد'
        if len(hs) < 100:
            return False, 'آمار هیروها ناقص است (%d)' % len(hs)
        if old and len(hs) * 5 < len(old.get('heroes') or []) * 4:
            return False, 'آمار هیروها کم شد'
    elif name == 'builds-full.json':
        h = new.get('heroes')
        if not isinstance(h, dict):
            return False, 'heroes ندارد'
        if len(h) < 100:
            return False, 'بیلدها ناقص است (%d)' % len(h)
    elif name == 'matchups.json':
        h = new.get('heroes')
        if not isinstance(h, dict):
            return False, 'heroes ندارد'
        if len(h) < 100:
            return False, 'کانترها ناقص است (%d)' % len(h)
    elif name == 'team-comps.json':
        c = new.get('comps')
        if not isinstance(c, list) or not c:
            return False, 'comps خالی است'
    elif name == 'fa-content.json':
        for sec in ('lore', 'matchups', 'patches', 'events', 'discussions'):
            old_n = len((old or {}).get(sec) or {})
            new_n = len(new.get(sec) or {})
            if old_n and new_n * 10 < old_n * 9:
                return False, 'ترجمه‌های %s کم شد' % sec
    return True, ''


# --- main run ---

def main():
    global HERO_NAMES, HERO_MLID
    started = now_tehran()
    errors = []
    changed, posted, skipped, blocked, descriptions = [], [], [], [], []
    translated = {'events': 0, 'discussions': 0, 'patches': 0}
    fa = {}
    builds_ran = False
    synced = 0
    status = load_status()

    try:
        heroes = load_json(DATA / 'hero-meta-final.json')['data']
    except Exception as e:  # noqa: BLE001
        errors.append('hero-meta-final.json unreadable: %s' % e)
        heroes = []
    HERO_NAMES = sorted({h.get('hero_name') for h in heroes if h.get('hero_name') and h.get('hero_name') != 'None'},
                        key=len, reverse=True)
    HERO_MLID = {norm(h.get('hero_name')): str(h.get('mlid') or '') for h in heroes}

    # 0. on a fresh checkout, pull live state from KV first (best-effort)
    try:
        synced = sync_state_from_kv()
    except Exception:  # noqa: BLE001
        synced = 0

    # 1. light scrapes (every run)
    if not ensure_local_proxy():
        errors.append('local proxy (127.0.0.1:18080) could not be started')
    rc, out, err = run_cmd([str(VENV_PY), 'scripts/scrape_news.py', 'all'])
    if rc != 0:
        errors.append('scrape_news.py all rc=%s: %s' % (rc, (err or out)[-300:]))
    rc, out, err = run_cmd([str(VENV_PY), 'scripts/scrape_events.py'])
    if rc != 0:
        errors.append('scrape_events.py rc=%s: %s' % (rc, (err or out)[-300:]))

    # 2. patch rebuild only when the top-10 changed
    try:
        news = load_json(DATA / 'news.json')
        pn_full = load_json(DATA / 'patch-notes-full.json')
        top10 = [p.get('title') for p in (news.get('patch_notes') or [])[:10]]
        have10 = [p.get('title') for p in (pn_full.get('patches') or [])[:10]]
        if top10 != have10:
            rc, out, err = run_cmd([str(VENV_PY), 'scripts/scrape_fandom_content.py', 'patches'])
            if rc != 0:
                errors.append('scrape_fandom_content.py patches rc=%s: %s' % (rc, (err or out)[-300:]))
            else:
                pn_full = load_json(DATA / 'patch-notes-full.json')
    except Exception as e:  # noqa: BLE001
        errors.append('patch gate failed: %s' % e)
        news, pn_full = {}, {}

    # 3. heavy stats only when hero-stats.json is > 20h old (live KV age first)
    try:
        fetched = kv_fetched_at('hero-stats.json')
        if not fetched:
            hs = load_json(DATA / 'hero-stats.json')
            fetched = hs.get('fetched_at') or ''
        age_h = None
        try:
            age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(fetched.replace('Z', '+00:00'))).total_seconds() / 3600
        except Exception:  # noqa: BLE001
            age_h = 9999
        if age_h is None or age_h > HEAVY_STATS_MAX_AGE_H:
            rc, out, err = run_cmd([str(VENV_PY), 'scripts/scrape_matchups_stats.py'])
            if rc != 0:
                errors.append('scrape_matchups_stats.py rc=%s: %s' % (rc, (err or out)[-300:]))
    except Exception as e:  # noqa: BLE001
        errors.append('heavy-stats gate failed: %s' % e)

    # 4. weekly builds: Saturday 11:30 run, once per ISO week
    try:
        now = now_tehran()
        iso_week = '%d-W%02d' % now.isocalendar()[:2]
        if now.weekday() == 5 and now.hour == 11 and now.minute >= 30 \
                and status.get('last_builds_week') != iso_week:
            rc, out, err = run_cmd(['node', 'scripts/scrape-mlbbio-builds.js'])
            if rc != 0:
                errors.append('scrape-mlbbio-builds.js rc=%s: %s' % (rc, (err or out)[-300:]))
            else:
                builds_ran = True
                status['last_builds_week'] = iso_week
    except Exception as e:  # noqa: BLE001
        errors.append('builds gate failed: %s' % e)

    # 5. translate NEW items into fa-content.json (never into source files)
    try:
        fa_path = DATA / 'fa-content.json'
        fa = load_json(fa_path)
        fa_before = json.dumps(fa, ensure_ascii=False, sort_keys=True)
        events = load_json(DATA / 'events.json').get('events') or []
        threads = load_json(DATA / 'discussions.json').get('threads') or []
        n, errs = translate_new_events(fa, events)
        translated['events'] = n
        errors += errs
        n, errs = translate_new_discussions(fa, threads)
        translated['discussions'] = n
        errors += errs
        top10 = [p.get('title') for p in (news.get('patch_notes') or [])[:10]]
        n, errs = translate_new_patches(fa, (pn_full.get('patches') or []), top10)
        translated['patches'] = n
        errors += errs
        if json.dumps(fa, ensure_ascii=False, sort_keys=True) != fa_before:
            fa['generated'] = now_tehran().strftime('%Y-%m-%d')
            dump_json(fa_path, fa)
    except Exception as e:  # noqa: BLE001
        errors.append('translation step failed: %s' % e)

    # 6. compare vs published/ and POST only changed files to KV.
    # A file that fails the sanity guard is NEVER posted (and its baseline
    # is not updated, so the next run retries it) — junk must not go live.
    try:
        PUBLISHED.mkdir(parents=True, exist_ok=True)
        # builds-full.json is compared every run (it only changes when the
        # Saturday scrape rewrites it); the weekly gate controls the scrape,
        # not the compare — so the first run also seeds it into KV.
        compare = list(COMPARE_FILES) + ['builds-full.json']
        for name in compare:
            src_file = DATA / name
            if not src_file.exists():
                errors.append('missing data file: %s' % name)
                continue
            pub_file = PUBLISHED / name
            base = baseline_bytes(name)
            if base is not None and base == _comparable_bytes(src_file):
                continue
            changed.append(name)
            try:
                new_obj = load_json(src_file)
            except Exception as e:  # noqa: BLE001
                blocked.append((name, 'فایل تازه خراب است'))
                errors.append('%s: فایل تازه خراب است (%s)' % (name, e))
                continue
            old_obj = baseline_json(name)
            ok_post, why = sane_to_post(name, new_obj, old_obj)
            if not ok_post:
                blocked.append((name, why))
                errors.append('%s: پست نشد — %s' % (name, why))
                continue
            if name in POSTABLE:
                try:
                    code, body = kv_client.post_file(str(src_file))
                except Exception as e:  # noqa: BLE001
                    errors.append('POST %s transport error: %s' % (name, e))
                    continue
                if code != 200:
                    errors.append('POST %s HTTP %s: %s' % (name, code, body[:120].decode('utf-8', 'replace')))
                    continue
                if not kv_client.get_file_verified(name, src_file.read_bytes()):
                    errors.append('KV verify failed for %s (replication lag did not resolve)' % name)
                    continue
                posted.append(name)
                pub_file.write_bytes(src_file.read_bytes())
                descriptions.append(describe_change(name, old_obj, new_obj, fa)
                                    or '📄 %s تازه شد' % name)
            else:
                # team-comp-guide.json: not in the KV allow-list — acknowledge only
                skipped.append(name)
                pub_file.write_bytes(src_file.read_bytes())
    except Exception as e:  # noqa: BLE001
        errors.append('publish step failed: %s' % e)

    # 7. /health check
    try:
        code, body = kv_client._curl('GET', '/health', timeout=30)
        if code != 200 or b'"status":"ok"' not in body:
            errors.append('/health HTTP %s' % code)
    except Exception as e:  # noqa: BLE001
        errors.append('/health failed: %s' % e)

    # 8. status + log + 3-strike alert
    ok = not errors
    status['last_run'] = now_tehran().isoformat(timespec='seconds')
    if ok:
        status['consecutive_failures'] = 0
        status['last_success'] = status['last_run']
        status['last_error'] = None
    else:
        status['consecutive_failures'] = int(status.get('consecutive_failures') or 0) + 1
        status['last_error'] = errors[0][:300]
    save_status(status)

    summary = ('synced=%d changed=%s posted=%s skipped-not-posted=%s builds=%s '
               'translated=%s health=ok' % (
                   synced, ','.join(changed) or '-', ','.join(posted) or '-',
                   ','.join(skipped) or '-', 'yes' if builds_ran else 'no',
                   ','.join('%s:%d' % kv for kv in sorted(translated.items()))))
    if ok:
        log_line('OK %s (started %s)' % (summary, started.isoformat(timespec='seconds')))
    else:
        log_line('FAIL %s errors=%s' % (summary, ' | '.join(errors)[:800]))
        if status['consecutive_failures'] == 3:
            try:
                msg = ('⚠️ بروزرسانی خودکار ربات MLBB سه بار پشت سر هم ناموفق بود. '
                       'آخرین خطا: %s' % errors[0][:200])
                kv_client.alert(msg)
                log_line('ALERT sent to admin (3 consecutive failures)')
            except Exception as e:  # noqa: BLE001
                log_line('ALERT failed: %s' % e)

    # 9. report back to the admin inside Telegram (best-effort, never fails the run)
    reported = False
    try:
        lines = ['🔄 گزارش بروزرسانی — %s' % ('✅ موفق' if ok else '❌ ناموفق')]
        dur = int((now_tehran() - started).total_seconds())
        lines.append('🕐 %s — %s ثانیه' % (started.strftime('%H:%M'), dur))
        if descriptions:
            lines.extend(descriptions)
        if blocked:
            lines.append('⚠️ پست نشد: %s' % '، '.join('%s (%s)' % b for b in blocked))
        if skipped:
            lines.append('📖 فقط در فایل تازه شد (پست نمی‌شود): %s' % '، '.join(skipped))
        tr = ', '.join('%s:%d' % kv for kv in sorted(translated.items()) if kv[1])
        if tr:
            lines.append('🌐 ترجمه: %s' % tr)
        if builds_ran:
            lines.append('🧱 بیلد هفتگی: اجرا شد')
        if errors:
            lines.append('❌ خطا: %s' % errors[0][:200])
        if not changed and not posted and ok:
            lines.append('📭 چیز تازه‌ای نبود.')
        msg = chr(10).join(lines)[:1500]
        code, _body = kv_client.report({'message': msg})
        reported = (code == 200)
    except Exception:  # noqa: BLE001
        reported = False
    log_line('REPORT %s' % ('sent' if reported else 'failed'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
