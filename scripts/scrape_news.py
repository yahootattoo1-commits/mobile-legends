"""Scrapling news pipeline for the Persian Mlbb bot.

Sources:
  - mlbb.io (plain Fetcher): hero tier list, discussions
  - Fandom MLBB wiki (MediaWiki API via curl_cffi, chrome131 impersonation):
    recent changes + patch-note pages + extracts

Outputs (~/workspace/mlbb-bot/data/):
  - news.json      {fetched_at, patch_notes[], wiki_recent[], discussions[]}
  - tierlist.json  {fetched_at, month, tiers: {S:[heroes], A:[...], ...}}
"""
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

from scrapling import Fetcher

_ROOT = Path(os.environ.get('REPO_ROOT', '') or Path(__file__).resolve().parent.parent)
OUT_DIR = str(_ROOT / 'data')
FANDOM_API = "https://mobile-legends.fandom.com/api.php"


def fandom_api(params, tries=3):
    """GET the MediaWiki API, return parsed JSON.

    IMPORTANT: read the RAW response body with curl_cffi — NEVER through
    Scrapling's page.html_content. The HTML round-trip re-serializes
    attribute-like text inside JSON strings (e.g. <ref name=Foo> becomes
    <ref name="Foo">), injecting raw quotes that break json.loads.
    """
    from curl_cffi import requests as crequests

    params = dict(params)
    params["format"] = "json"
    params["formatversion"] = 2
    url = FANDOM_API + "?" + urlencode(params)
    last = None
    for i in range(tries):
        try:
            r = crequests.get(
                url, impersonate="chrome131", timeout=30,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                         "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"})
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"Fandom API failed for {params}: {last}")


def fetch(url, **kw):
    return Fetcher.get(url, stealthy_headers=True, **kw)


# ---------------- Fandom: recent changes ----------------
def wiki_recent(limit=15):
    d = fandom_api({
        "action": "query", "list": "recentchanges",
        "rcprop": "title|timestamp|comment",
        "rctype": "edit|new", "rcnamespace": 0, "rclimit": limit,
    })
    out = []
    for c in d.get("query", {}).get("recentchanges", []):
        out.append({
            "title": c.get("title"),
            "timestamp": c.get("timestamp"),
            "comment": (c.get("comment") or "")[:120],
            "url": "https://mobile-legends.fandom.com/wiki/" + (c.get("title") or "").replace(" ", "_"),
        })
    # thumbnails for the edited pages (one batched call; None if no image)
    titles = sorted({r["title"] for r in out if r.get("title")})
    if titles:
        try:
            d2 = fandom_api({
                "action": "query", "prop": "pageimages",
                "piprop": "thumbnail", "pithumbsize": 400,
                "titles": "|".join(titles),
            })
            thumbs = {}
            for pg in d2.get("query", {}).get("pages", []):
                thumbs[pg.get("title")] = (pg.get("thumbnail") or {}).get("source") or None
            for r in out:
                r["image_url"] = thumbs.get(r.get("title"))
        except Exception:
            for r in out:
                r["image_url"] = None
    return out


# ---------------- Fandom: patch-note pages ----------------
def patch_note_pages(limit=10):
    """Top patch notes by VERSION: Category:Patch_Notes members, semver
    descending. (Sorting by wiki last-edit time is wrong — it surfaces
    2017-era pages that were recently edited, e.g. Patch Notes 1.1.66.)"""
    d = fandom_api({
        "action": "query", "list": "categorymembers",
        "cmtitle": "Category:Patch_Notes", "cmlimit": 500, "cmtype": "page",
    })
    members = d.get("query", {}).get("categorymembers", [])
    while "continue" in d:  # category past 500 members
        d = fandom_api({
            "action": "query", "list": "categorymembers",
            "cmtitle": "Category:Patch_Notes", "cmlimit": 500, "cmtype": "page",
            **d["continue"],
        })
        members += d.get("query", {}).get("categorymembers", [])
    vers = []
    for m in members:
        t = m.get("title", "")
        mm = re.match(r"^Patch Notes (\d+)\.(\d+)\.(\d+)$", t)
        if mm:
            vers.append((tuple(int(x) for x in mm.groups()), t))
    vers.sort(reverse=True)
    titles = [t for _, t in vers[:limit]]
    if not titles:
        return []
    # Extracts + thumbnail in one batched call (revisions params are illegal
    # with multiple titles, so timestamps come from per-title calls below)
    d2 = fandom_api({
        "action": "query", "prop": "extracts|pageimages",
        "exintro": 1, "explaintext": 1,
        "piprop": "thumbnail", "pithumbsize": 400,
        "titles": "|".join(titles),
    })
    pages = {pg.get("title"): pg for pg in d2.get("query", {}).get("pages", [])}
    out = []
    for t in titles:
        pg = pages.get(t, {})
        ts = None
        try:
            d3 = fandom_api({"action": "query", "prop": "revisions",
                             "rvprop": "timestamp", "rvlimit": 1, "titles": t})
            revs = (d3.get("query", {}).get("pages", [{}])[0].get("revisions") or [])
            ts = revs[0].get("timestamp") if revs else None
        except Exception:
            ts = None  # keep the record; timestamp is informational
        out.append({
            "title": t,
            "url": "https://mobile-legends.fandom.com/wiki/" + t.replace(" ", "_"),
            "updated": ts,
            "summary": (pg.get("extract") or "")[:500],
            # page image (400px thumb); None when the page has no image
            "image_url": (pg.get("thumbnail") or {}).get("source") or None,
        })
    return out


# ---------------- mlbb.io: tier list ----------------
TIER_LABEL_RE = re.compile(r'drop-shadow-md">([SABCD])<')
HERO_LINK_RE = re.compile(r'href="/en/hero/([a-z0-9-]+)"')
HERO_NAME_RE = re.compile(r"<h3[^>]*>([^<]+)</h3>")


def tier_list():
    p = fetch("https://mlbb.io/en/hero-tier")
    html = p.html_content
    t = p.xpath("//title/text()")
    title = t[0].text if t else ""
    month = ""
    if title:
        mm = re.search(r"—\s*(\w+\s+\d{4})", title)
        month = mm.group(1) if mm else ""
    # Tier sections appear in DOM order SS, S, A, B, C, D. SS uses a text
    # heading ("SS TIER"), the others use a big single-letter span.
    labels = [(m.start(), m.group(1)) for m in TIER_LABEL_RE.finditer(html)]
    ss = re.search(r">SS<", html)
    if ss:
        labels.append((ss.start(), "SS"))
    labels.sort()
    tiers = {t: [] for t in ["SS", "S", "A", "B", "C", "D"]}
    seen = set()
    for m in HERO_LINK_RE.finditer(html):
        slug = m.group(1)
        tier = None
        for pos, letter in labels:
            if pos < m.start():
                tier = letter
            else:
                break
        if tier is None or slug in seen:
            continue
        seen.add(slug)
        nm = HERO_NAME_RE.search(html, m.start(), m.start() + 2000)
        name = nm.group(1).strip() if nm else slug
        tiers[tier].append({"slug": slug, "name": name})
    return {"month": month, "tiers": tiers,
            "counts": {t: len(v) for t, v in tiers.items()}}


FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def fa_num(s):
    return str(s).translate(FA_DIGITS)


# ---------------- mlbb.io discussions (STEALTH browser) ----------------
# The forum list is JS-rendered: plain Fetcher sees no threads. The stealth
# browser (Patchright Chromium) needs two things on the VM only:
#  (1) the local forward proxy (local_proxy.py on 127.0.0.1:18080) — Chromium's
#      CONNECT fails against the egress proxy directly, and --proxy-server with
#      credentials is rejected (ERR_NO_SUPPORTED_PROXIES);
#  (2) ignore_https_errors — the egress proxy MITMs TLS with its own CA.
# Both are opt-in via USE_LOCAL_PROXY=1 (the systemd wrapper sets it).
# GitHub Actions runners have direct internet and use neither.
import socket as _socket
import subprocess as _subprocess

LOCAL_PROXY_URL = "http://127.0.0.1:18080"

USE_LOCAL_PROXY = os.environ.get('USE_LOCAL_PROXY', '').strip() in ('1', 'true', 'yes')

CAT_FA = {
    "Android bug": "باگ اندروید",
    "iPhone/iPad bug": "باگ آیفون/آیپد",
    "Website issue": "مشکل وب‌سایت",
    "Feedback & complaints": "بازخورد و شکایت",
    "General chat": "گفتگوی عمومی",
    "Find teammates": "پیدا کردن هم‌تیمی",
}

MONTHS = {m: i + 1 for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])}


def ensure_local_proxy():
    """VM-only (USE_LOCAL_PROXY=1): auto-start the local forward proxy.
    On GitHub Actions this is a no-op (direct internet, nothing to start)."""
    if not USE_LOCAL_PROXY:
        return True
    try:
        s = _socket.create_connection(("127.0.0.1", 18080), timeout=2)
        s.close()
        return True
    except OSError:
        pass
    _subprocess.Popen(
        [sys.executable, "/home/hatch/workspace/scrapling/local_proxy.py", "18080"],
        stdout=open("/home/hatch/workspace/scrapling/logs-proxy.out", "ab"),
        stderr=_subprocess.STDOUT, start_new_session=True)
    for _ in range(15):
        try:
            s = _socket.create_connection(("127.0.0.1", 18080), timeout=2)
            s.close()
            return True
        except OSError:
            time.sleep(1)
    return False


def _clean_html_text(raw):
    import html as _html
    txt = re.sub(r"<[^>]+>", " ", raw or "")
    return re.sub(r"\s+", " ", _html.unescape(txt)).strip()


def discussions_stealth(limit=20):
    """Fetch the mlbb.io forum list with the stealth browser.

    Returns [{title, category, category_fa, author, date, date_iso,
    views, likes, comments, excerpt}] — NO urls (per roozbeh's rule: no
    source names or links to sources anywhere in the bot/Mini App).
    """
    from scrapling import StealthyFetcher
    fetch_kwargs = dict(headless=True, network_idle=True,
                        disable_resources=True, wait=5000)
    # Force UTC for the browser: mlbb.io renders forum dates in the viewer's
    # local timezone, so an Actions run (TZ=Asia/Tehran) and a VM run (UTC)
    # stamped the SAME threads 3:30 apart — a spurious 'change' every switch,
    # and date_iso labelled 'Z' while holding Tehran wall-clock time.
    os.environ['TZ'] = 'UTC'
    try:
        time.tzset()
    except Exception:  # noqa: BLE001
        pass
    if USE_LOCAL_PROXY:
        if not ensure_local_proxy():
            raise RuntimeError("local proxy (127.0.0.1:18080) could not be started")
        fetch_kwargs["proxy"] = LOCAL_PROXY_URL
        fetch_kwargs["additional_args"] = {"ignore_https_errors": True}
    page = StealthyFetcher.fetch(
        "https://mlbb.io/en/discussions", **fetch_kwargs)
    out = []
    for art in page.css("article")[:limit]:
        h = art.html_content
        text = _clean_html_text(h)
        t = re.search(r"<h2[^>]*>([^<]+)", h)
        title = (t.group(1).strip() if t else "")
        title = re.sub(r"\s*→\s*$", "", title)
        import html as _html
        title = _html.unescape(title)
        cat = re.search(r'data-testid="category-badge".*?<span aria-hidden="true">(.*?)</span>\s*([^<]*)', h, re.S)
        category = _html.unescape((cat.group(2) or "").strip() if cat else "")
        ex = re.search(r'<p class="text-gray-300[^>]*>(.*?)</p>', h, re.S)
        excerpt = _clean_html_text(ex.group(1))[:200] if ex else ""
        # No source names/links in the data (roozbeh's rule): strip any URLs
        # and the site name out of user-written excerpts.
        excerpt = re.sub(r"https?://\S+", "", excerpt)
        excerpt = re.sub(r"mlbb\.io", "the app", excerpt, flags=re.I)
        excerpt = re.sub(r"\s+", " ", excerpt).strip()
        m = re.search(
            r"([A-Za-z0-9_.\-]+) • (\d{1,2}) (\w{3}) (\d{4}), (\d{2}):(\d{2}) • (\d+) views 👍 (\d+) 💬 (\d+)",
            text)
        if not title:
            continue
        item = {"title": title, "category": category,
                "category_fa": CAT_FA.get(category, category),
                "excerpt": excerpt}
        if m:
            day, mon, year, hh, mm = int(m.group(2)), MONTHS.get(m.group(3), 1), int(m.group(4)), m.group(5), m.group(6)
            item.update({
                "author": m.group(1),
                "date": f"{m.group(2)} {m.group(3)} {m.group(4)}, {hh}:{mm}",
                "date_iso": f"{year:04d}-{mon:02d}-{day:02d}T{hh}:{mm}:00Z",
                "views": int(m.group(7)), "likes": int(m.group(8)), "comments": int(m.group(9)),
            })
        out.append(item)
    return out


def patch_title_fa(title):
    """'Patch Notes 1.9.20' -> 'پچ ۱٫۹٫۲۰' ; 'Patch notes' -> 'یادداشت‌های پچ'."""
    m = re.search(r"(\d+\.\d+\.\d+)", title or "")
    if m:
        return "پچ " + fa_num(m.group(1))
    return "یادداشت‌های پچ"


if __name__ == "__main__":
    import sys
    from datetime import datetime, timezone

    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    fetched_at = datetime.now(timezone.utc).isoformat()
    if which in ("all", "fandom"):
        patches = patch_note_pages(limit=10)
        for pn in patches:
            pn["title_fa"] = patch_title_fa(pn["title"])
        recent = wiki_recent(limit=15)
        news = {"fetched_at": fetched_at, "patch_notes": patches, "wiki_recent": recent}
        with open(f"{OUT_DIR}/news.json", "w", encoding="utf-8") as f:
            json.dump(news, f, ensure_ascii=False, indent=1)
        print(f"news.json: {len(patches)} patch notes, {len(recent)} wiki recent")
        for pn in patches[:5]:
            print("  ", pn.get("updated"), "|", pn["title_fa"], "|", pn["title"])
    if which in ("all", "mlbb"):
        tl = tier_list()
        tl["fetched_at"] = fetched_at
        with open(f"{OUT_DIR}/tierlist.json", "w", encoding="utf-8") as f:
            json.dump(tl, f, ensure_ascii=False, indent=1)
        print("tierlist.json:", tl["month"], tl["counts"])
        for tier in ["SS", "S", "A", "B", "C", "D"]:
            names = [h["name"] for h in tl["tiers"][tier][:6]]
            print(f"  {tier}: {', '.join(names)}")
    if which in ("all", "stealth"):
        ds = discussions_stealth(limit=20)
        disc = {"fetched_at": fetched_at, "threads": ds}
        with open(f"{OUT_DIR}/discussions.json", "w", encoding="utf-8") as f:
            json.dump(disc, f, ensure_ascii=False, indent=1)
        print(f"discussions.json: {len(ds)} threads (stealth browser)")
        for d in ds[:8]:
            print(f"  [{d.get('category_fa')}] {d['title']} — {d.get('author')}, {d.get('date')} • {d.get('views')} views 💬 {d.get('comments')}")
