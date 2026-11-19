#!/usr/bin/env python3
"""Scrapling events pipeline for the Persian Mlbb bot.

Sources (Fandom MLBB wiki only — mlbb.io has NO event pages: 0 "event"
URLs in its 2,551-URL sitemap; /en/updates is the site/app changelog):
  - Category:Events members (event pages, with dates where the page has them)
  - the "Events" hub page (its "Current Events" bullets + inline event sections)
  - the NEWEST patch note's Events section (the freshest "what is running now")

Output: data/events.json
  {fetched_at, today, events: [{title, start_date, end_date, status,
   image_url, summary, url}]}
  status: current | upcoming | ended | unknown (today = 2026-11-14)
  dates are ISO YYYY-MM-DD or null when the page gives none.
  Display text has no source names; `url` is a reference field only.

Re-running merges by normalized title (no duplicates).

Run: ~/workspace/scrapling/.venv/bin/python scripts/scrape_events.py
"""
import json
import os
import re
import sys
import time
from datetime import date
from pathlib import Path
from urllib.parse import urlencode

from curl_cffi import requests

_ROOT = Path(os.environ.get('REPO_ROOT', '') or Path(__file__).resolve().parent.parent)
OUT_DIR = str(_ROOT / 'data')
PATCHES_FILE = f"{OUT_DIR}/patch-notes-full.json"
FANDOM_API = "https://mobile-legends.fandom.com/api.php"
WIKI = "https://mobile-legends.fandom.com/wiki/"
TODAY = date.today()

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# patch-Events subsections that are NOT events (shops / listings)
NOT_EVENTS = {"shop", "new skins", "free heroes"}


def fandom_api(params, tries=3):
    """Raw curl_cffi JSON (never Scrapling html_content: the HTML round-trip
    injects quotes into <ref name=...> inside JSON strings)."""
    params = dict(params)
    params["format"] = "json"
    params["formatversion"] = 2
    url = FANDOM_API + "?" + urlencode(params)
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, impersonate="chrome131", timeout=30,
                             headers={"User-Agent": UA})
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"Fandom API failed for {params}: {last}")


def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def first_prose_paragraph(wt):
    """First real prose line of a wikitext page (headings, tabbers, templates,
    files, tables and list lines skipped)."""
    for ln in (wt or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith(("{{", "[[File:", "[[Category:", "==", "|", ":", "#",
                          "*", "<", "}}")):
            continue
        c = clean_wiki(s)
        if len(c) >= 40:
            return c
    for ln in (wt or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith(("{{", "[[File:", "[[Category:", "==", "|", ":", "#",
                          "*", "<", "}}")):
            continue
        c = clean_wiki(s)
        if len(c) >= 20:
            return c
    return ""


def clean_wiki(raw):
    """Rough wikitext -> plain text (templates, files, links, refs stripped)."""
    t = raw or ""
    t = re.sub(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", " ", t, flags=re.S)
    # keep display text of the common templates: {{ii|Name|Display}} -> Display,
    # {{hi|Name}} / {{ai|Name}} -> Name
    t = re.sub(r"\{\{(?:ii|hi|ai)\|([^{}|]*)\|([^{}]*)\}\}", r"\2", t)
    t = re.sub(r"\{\{(?:ii|hi|ai)\|([^{}]*)\}\}", r"\1", t)
    t = re.sub(r"\{\{[^{}]*\}\}", " ", t)  # one level of templates
    t = re.sub(r"\{\{[^{}]*\}\}", " ", t)
    t = re.sub(r"\[\[File:[^\]]*\]\]", " ", t)
    t = re.sub(r"\[\[[^|\]]*\|([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = t.replace("'''", "").replace("''", "")
    t = t.replace("&nbsp;", " ")
    t = re.sub(r"\s+", " ", t).strip()
    return t


# ---------------- dates ----------------
MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"])}
MON_RE = ("Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
          "Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
          "Dec(?:ember)?")
D1 = re.compile(rf"(\d{{1,2}})(?:st|nd|rd|th)?\s+({MON_RE})\s+(\d{{4}})", re.I)  # 16 January 2022
D2 = re.compile(rf"({MON_RE})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,)?\s+(\d{{4}})", re.I)  # March 5th 2022


def _mon_num(name):
    key = name.lower()
    for full, num in MONTHS.items():
        if full.startswith(key) or key.startswith(full[:3]):
            return num
    return None


def find_dates(text):
    out = []
    for m in D1.finditer(text or ""):
        mn = _mon_num(m.group(2))
        if not mn:
            continue
        try:
            out.append(date(int(m.group(3)), mn, int(m.group(1))))
        except ValueError:
            pass
    for m in D2.finditer(text or ""):
        mn = _mon_num(m.group(1))
        if not mn:
            continue
        try:
            out.append(date(int(m.group(3)), mn, int(m.group(2))))
        except ValueError:
            pass
    return out


def _infobox_date_field(wt):
    """The |date= value of an infobox (single line, cut at next field / }})."""
    m = re.search(r"\|\s*date\s*=\s*(.+)", wt or "")
    if not m:
        return None
    val = m.group(1)
    cut = re.search(r"\n\||\}\}", val)
    if cut:
        val = val[:cut.start()]
    return val.strip()


def dates_from_wikitext(wt):
    """(start, end) from an event page's wikitext, or (None, None)."""
    # 1. infobox |date= field: runs separated by <br>, take the LAST run
    field = _infobox_date_field(wt)
    if field:
        runs = [r for r in re.split(r"<br\s*/?>", field) if r.strip()]
        if runs:
            last_run = re.sub(r"\([^)]*\)", " ", runs[-1])
            parts = re.split(r"\s*[-–—]\s*", last_run.strip())
            ds = find_dates(parts[0])
            de = find_dates(parts[1]) if len(parts) > 1 else []
            if ds:
                start, end = ds[0], (de[0] if de else None)
                if end and end < start:
                    print(f"  WARN inverted range in date field: {field[:80]!r}")
                    end = None
                return start, end
    # 2. prose: earliest full date = start, latest = end
    ds = find_dates(wt)
    if not ds:
        return None, None
    ds = sorted(set(ds))
    return ds[0], (ds[-1] if len(ds) > 1 else None)


def classify(start, end):
    if start and end:
        if end < TODAY:
            return "ended"
        if start <= TODAY <= end:
            return "current"
        if start > TODAY:
            return "upcoming"
        return "unknown"
    if start:
        if start > TODAY:
            return "upcoming"
        if (TODAY - start).days > 180:
            return "ended"
        return "unknown"
    if end:
        return "ended" if end < TODAY else "unknown"
    return "unknown"


def iso(d):
    return d.isoformat() if d else None


# ---------------- main ----------------
def main():
    from datetime import datetime, timezone
    fetched_at = datetime.now(timezone.utc).isoformat()
    events = {}  # norm title -> record

    def add(rec):
        key = norm(rec["title"])
        if not key:
            return
        if key in events:
            # prefer the record with dates / an image
            old = events[key]
            if not old.get("start_date") and rec.get("start_date"):
                old["start_date"], old["end_date"] = rec["start_date"], rec["end_date"]
                old["status"] = rec["status"]
            if not old.get("image_url") and rec.get("image_url"):
                old["image_url"] = rec["image_url"]
            if not old.get("summary") and rec.get("summary"):
                old["summary"] = rec["summary"]
            return
        events[key] = rec

    # 1. Category:Events members
    d = fandom_api({"action": "query", "list": "categorymembers",
                    "cmtitle": "Category:Events", "cmlimit": 500, "cmtype": "page"})
    titles = [m["title"] for m in d.get("query", {}).get("categorymembers", [])]
    titles = [t for t in titles if t != "Events" and not t.startswith("Template:")]
    print(f"category events: {len(titles)} pages")

    # one batched call: extract + thumbnail + wikitext (for dates)
    d2 = fandom_api({
        "action": "query", "prop": "extracts|pageimages|revisions",
        "exintro": 1, "explaintext": 1,
        "piprop": "thumbnail", "pithumbsize": 400,
        "rvprop": "content", "rvslots": "main",
        "titles": "|".join(titles),
    })
    for pg in d2.get("query", {}).get("pages", []):
        t = pg.get("title")
        if not t or "missing" in pg:
            continue
        wt = ""
        revs = pg.get("revisions") or []
        if revs:
            # formatversion=2: slot content is under "content" (not "*")
            main = (revs[0].get("slots") or {}).get("main", {})
            wt = main.get("content") or main.get("*", "") or ""
        start, end = dates_from_wikitext(wt)
        summary = (pg.get("extract") or "").strip()
        if not summary and wt:
            summary = first_prose_paragraph(wt)
        add({
            "title": t,
            "start_date": iso(start), "end_date": iso(end),
            "status": classify(start, end),
            "image_url": (pg.get("thumbnail") or {}).get("source") or None,
            "summary": summary[:300] or None,
            "url": WIKI + t.replace(" ", "_"),
        })
    print(f"  -> {len(events)} category events parsed")

    # 2. "Events" hub page: current-events bullets + inline event sections
    d3 = fandom_api({"action": "parse", "page": "Events", "prop": "wikitext"})
    hub = d3.get("parse", {}).get("wikitext", "")
    # current-events bullets: *[[Name]] + ** sub-bullets as summary
    cur = re.search(r"Current Events in Official Server\}\}(.*?)\{\{Heading\|", hub, re.S)
    hub_files = {}  # event title -> File: name
    if cur:
        block = cur.group(1)
        # top-level bullets only: a line starting with exactly one '*'
        parts = re.split(r"(?m)^\*(?!\*)", block)
        for part in parts[1:]:
            lines = [l for l in part.splitlines() if l.strip()]
            if not lines:
                continue
            name = clean_wiki(lines[0]).lstrip("*").strip()
            summ = " ".join(clean_wiki(l.lstrip("*").strip()) for l in lines[1:])
            if name and len(name) > 2:
                add({"title": name, "start_date": None, "end_date": None,
                     "status": "unknown",
                     "image_url": None, "summary": summ[:300] or None,
                     "url": WIKI + name.replace(" ", "_")})
    # inline sections with [[File:]] images (Trickster's Eve, Double 11, ...)
    for m in re.finditer(r"(?m)^==([^=]+)==\s*\n(.*?)(?=^==|\Z)", hub, re.S):
        name = m.group(1).strip()
        body = m.group(2)
        fm = re.search(r"\[\[File:([^\]|]+)", body)
        if fm:
            hub_files[name] = "File:" + fm.group(1).strip()
        summ = clean_wiki(body)[:300]
        if name and norm(name) not in events:
            add({"title": name, "start_date": None, "end_date": None,
                 "status": "unknown", "image_url": None,
                 "summary": summ or None, "url": WIKI + name.replace(" ", "_")})
    # resolve hub File: images to thumb URLs (one batched call)
    if hub_files:
        d4 = fandom_api({
            "action": "query", "prop": "imageinfo",
            "iiprop": "url", "iiurlwidth": 400,
            "titles": "|".join(sorted(set(hub_files.values()))),
        })
        file_url = {}
        for pg in d4.get("query", {}).get("pages", []):
            ii = (pg.get("imageinfo") or [{}])[0]
            file_url[pg.get("title")] = ii.get("thumburl") or ii.get("url")
        for name, ftitle in hub_files.items():
            if norm(name) in events and file_url.get(ftitle):
                events[norm(name)]["image_url"] = file_url[ftitle]
    print(f"  -> {len(events)} events after hub page")

    # 3. newest patch note's Events section = freshest "running now"
    try:
        with open(PATCHES_FILE, encoding="utf-8") as f:
            patches = json.load(f).get("patches", [])
        if patches:
            newest = patches[0]
            for sec in newest.get("other_sections", []):
                h = sec.get("heading", "")
                if "Events" not in h or " — " not in h:
                    continue
                name = h.split(" — ", 1)[1].strip()
                name = re.sub(r"^[A-Z]\.\s*", "", name)
                if norm(name) in NOT_EVENTS or not name:
                    continue
                if norm(name) in events:
                    continue
                add({"title": name, "start_date": None, "end_date": None,
                     "status": "unknown",
                     "image_url": None,
                     "summary": (sec.get("text") or "").lstrip(": ").strip()[:300] or None,
                     "url": None})
            print(f"  -> {len(events)} events after newest patch ({newest.get('title')})")
    except FileNotFoundError:
        print("  patch-notes-full.json missing, skipping patch events")

    # 4. thumbnail backfill: hub/patch events without an image may still have
    #    their own wiki page — one batched pageimages call over those titles
    need_img = [r["title"] for r in events.values() if not r.get("image_url")]
    if need_img:
        try:
            d5 = fandom_api({
                "action": "query", "prop": "pageimages",
                "piprop": "thumbnail", "pithumbsize": 400,
                "titles": "|".join(need_img),
            })
            for pg in d5.get("query", {}).get("pages", []):
                src = (pg.get("thumbnail") or {}).get("source")
                if src and norm(pg.get("title", "")) in events:
                    events[norm(pg["title"])]["image_url"] = src
        except Exception as e:
            print(f"  thumbnail backfill failed: {e}")

    order = {"current": 0, "upcoming": 1, "unknown": 2, "ended": 3}
    ev_list = sorted(events.values(),
                     key=lambda r: (order[r["status"]], r["start_date"] or "9999"))
    res = {"fetched_at": fetched_at, "today": TODAY.isoformat(), "events": ev_list}
    Path(f"{OUT_DIR}/events.json").write_text(
        json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    counts = {}
    for r in ev_list:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    n_img = sum(1 for r in ev_list if r.get("image_url"))
    n_dates = sum(1 for r in ev_list if r.get("start_date"))
    print(f"events.json: {len(ev_list)} events {counts}, "
          f"with image: {n_img}, with dates: {n_dates}")


if __name__ == "__main__":
    main()
