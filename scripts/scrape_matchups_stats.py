"""Scrapling content pipeline #2 for the Persian Mlbb bot — mlbb.io data.

Sources (plain Fetcher, static HTML):
  - /en/hero-statistics : full 133-hero table (win/pick/ban rates, role, lane,
    speciality). Default view = ALL ranks, past 7 days. Per-rank tables are
    NOT in the static HTML (loaded client-side) — NOT scraped here.
  - /en/hero/{slug}/counter : per-hero matchup page — "Which heroes counter X?"
    (top 5 with strength + win-rate advantage + a reason sentence),
    "Best Counters" ranked list (counter hero's own win rate) and
    "Rank-dependent counters" notes.
  - /en/team-composition : interactive checker — NO pre-made comps exist on
    the page (no examples/samples/best teams anywhere). What IS scrapable:
    the FAQPage JSON-LD (8 Q&As) + the "How this is worked out" explainer.
    Team comps are therefore DERIVED from hero-statistics (top hero per
    lane by win / pick / ban rate), clearly labelled as derived.

Outputs (~/workspace/mlbb-bot/data/):
  - hero-stats.json   {fetched_at, month, timeframe, rank, heroes[]}
  - matchups.json     {fetched_at, month, heroes: {mlid: {...}}}
  - team-comps.json   {fetched_at, derived_from, comps[]}
  - team-comp-guide.json {fetched_at, how_it_works, faqs[]}

Merge-friendly: existing files are loaded first; a hero whose page fails
keeps its previous record. Re-running never duplicates records.
No source names or links in display text (roozbeh's rule); the only URL
kept is a `url` reference field inside patch-style records — none here.
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from scrapling import Fetcher

_ROOT = Path(os.environ.get('REPO_ROOT', '') or Path(__file__).resolve().parent.parent)
OUT_DIR = str(_ROOT / 'data')
HERO_FILE = f"{OUT_DIR}/hero-meta-final.json"
BASE = "https://mlbb.io/en"

ROLES = ["Tank", "Fighter", "Assassin", "Mage", "Marksman", "Support"]
LANES = ["Exp Lane", "Mid Lane", "Gold Lane", "Roam", "Jungle"]
LANE_SHORT = {"Exp Lane": "exp", "Mid Lane": "mid", "Gold Lane": "gold",
              "Roam": "roam", "Jungle": "jungle"}
SPECIALITIES = ["Push", "Damage", "Crowd Control", "Support", "Charge",
                "Burst", "Guard", "Poke", "Finisher", "Regen", "Initiator",
                "Control", "Chase Magic", "Magic Damage", "Chase", "Magic",
                "Mixed"]


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")


def load_heroes():
    with open(HERO_FILE, encoding="utf-8") as f:
        hf = json.load(f)
    heroes = [h for h in hf.get("data", [])
              if h.get("hero_name") and h["hero_name"] != "None"]
    by_name = {}
    for h in heroes:
        by_name[norm(h["hero_name"])] = h
        by_name[norm(h.get("uid", ""))] = h
    return heroes, by_name


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def fetch(url, tries=2):
    last = None
    for i in range(tries):
        try:
            # timeout: a hung fetch stalled the full 133-page run for hours
            return Fetcher.get(url, stealthy_headers=True, timeout=25)
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def cell_text(c):
    """Full text of a cell (Scrapling .text is empty for nested elements)."""
    import html as _html
    t = re.sub(r"<[^>]+>", " ", c.html_content)
    return re.sub(r"\s+", " ", _html.unescape(t)).strip()


# ---------------- hero statistics table ----------------
def parse_vocab(cell_text, vocab):
    """Scan a cell for known multi-word phrases (longest first)."""
    found, rest = [], cell_text or ""
    for phrase in sorted(vocab, key=len, reverse=True):
        if phrase in rest:
            found.append(phrase)
            rest = rest.replace(phrase, " ", 1)
    rest = re.sub(r"\s+", " ", rest).strip()
    return found, rest


def hero_stats():
    p = fetch(f"{BASE}/hero-statistics")
    rows = p.css("table tbody tr")
    month = ""
    t = p.xpath("//title/text()")
    if t:
        mm = re.search(r"—\s*(\w+\s+\d{4})", t[0].text or "")
        month = mm.group(1) if mm else ""
    out = []
    unmatched = set()
    for idx, row in enumerate(rows, start=1):
        cells = row.css("td")
        if len(cells) < 7:
            continue
        name_a = row.css("td a")
        name = name_a[0].text.strip() if name_a else ""
        slug = ""
        if name_a:
            href = name_a[0].attrib.get("href", "") or ""
            m = re.search(r"/en/hero/([a-z0-9-]+)", href)
            slug = m.group(1) if m else slugify(name)
        else:
            slug = slugify(name)
        texts = [cell_text(c) for c in cells]
        # cells: [rank#, portrait, name, win, pick, ban, role, lane, speciality]
        def rate(cell_i):
            m = re.search(r"(\d+\.\d+)%", texts[cell_i] if cell_i < len(texts) else "")
            num = float(m.group(1)) if m else None
            label = re.sub(r"\d+\.\d+%", "", texts[cell_i] if cell_i < len(texts) else "").strip()
            return num, (label or None)
        win, win_label = rate(3)
        pick, pick_label = rate(4)
        ban, ban_label = rate(5)
        roles, r_rest = parse_vocab(texts[6] if len(texts) > 6 else "", ROLES)
        lanes, l_rest = parse_vocab(texts[7] if len(texts) > 7 else "", LANES)
        specs, s_rest = parse_vocab(texts[8] if len(texts) > 8 else "", SPECIALITIES)
        for u in (r_rest, l_rest, s_rest):
            if u:
                unmatched.add(u)
        out.append({
            "position": idx, "name": name, "slug": slug,
            "win_rate": win, "win_label": win_label,
            "pick_rate": pick, "pick_label": pick_label,
            "ban_rate": ban, "ban_label": ban_label,
            "roles": roles,
            "lanes": [LANE_SHORT.get(x, x) for x in lanes],
            "specialities": specs,
        })
    if unmatched:
        print("  [stats] unmatched cell text:", sorted(unmatched))
    return {"month": month, "timeframe": "Past 7 days", "rank": "ALL",
            "heroes": out}


# ---------------- per-hero matchup (counter) pages ----------------
def hero_slugs():
    """All 133 hero slugs from the sitemap (counter pages)."""
    p = fetch("https://mlbb.io/sitemap-0.xml")
    slugs = sorted(set(re.findall(r"/en/hero/([a-z0-9-]+)/counter", p.html_content)))
    return slugs


def parse_counters_section(html):
    """'Which heroes counter X?' — top-5 list inside <section id='counters'>."""
    m = re.search(r'<section id="counters"[^>]*>(.*?)</section>', html, re.S)
    if not m:
        return []
    sec = m.group(1)
    out = []
    for li in re.findall(r"<li[^>]*>(.*?)</li>", sec, re.S):
        a = re.search(r'href="/en/hero/([a-z0-9-]+)/counter">([^<]+)</a>\s*—\s*([^<]+)</p>', li)
        if not a:
            continue
        slug, name, reason = a.group(1), a.group(2).strip(), a.group(3).strip()
        st = re.search(r'tracking-wider[^>]*>([^<]+)</span>', li)
        adv = re.search(r"([+-]?\d+\.\d+)%<span[^>]*>win rate advantage", li)
        out.append({
            "slug": slug, "name": name,
            "strength": (st.group(1).strip() if st else None),
            "advantage": float(adv.group(1)) if adv else None,
            "reason": re.sub(r"\s+", " ", reason).strip(),
        })
    return out


def parse_best_counters(html):
    """'Best Counters to X' ranked list (counter hero's own win rate)."""
    m = re.search(r"Best Counters to .*?</h2>(.*?)</ol>", html, re.S)
    if not m:
        return []
    sec = m.group(1)
    out = []
    for li in re.findall(r"<li[^>]*>(.*?)</li>", sec, re.S):
        rk = re.search(r"#(\d+)</span>", li)
        # name link points to the hero page (/en/hero/{slug}); the
        # "How to counter" link points to /counter — do NOT match that one
        a = re.search(r'href="/en/hero/([a-z0-9-]+)">([^<]+)</a>', li)
        if not a:
            continue
        wr = re.search(r"(\d+\.\d+)%", li)
        role = re.search(r'<p class="truncate[^>]*>([^<]+)</p>', li)
        badge = re.search(r'<span[^>]*>([▲▼][^<]*)</span>', li)
        out.append({
            "rank": int(rk.group(1)) if rk else None,
            "slug": a.group(1), "name": a.group(2).strip(),
            "role": (role.group(1).strip() if role else None),
            "badge": (badge.group(1).strip() if badge else None),
            "win_rate": float(wr.group(1)) if wr else None,
        })
    return out


def parse_rank_notes(html):
    """'Rank-dependent counters' — short per-hero notes."""
    m = re.search(r"Rank-dependent counters</h3>(.*?)</ul>", html, re.S)
    if not m:
        return []
    sec = m.group(1)
    out = []
    for li in re.findall(r"<li[^>]*>(.*?)</li>", sec, re.S):
        alt = re.search(r'alt="([^"]+)"', li)
        span = re.search(r"<span>(.*?)</span>", li, re.S)
        if not span:
            continue
        text = re.sub(r"<[^>]+>", "", span.group(1))
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) > 400:
            text = text[:400].rsplit(" ", 1)[0] + "…"
        out.append({
            "slug": slugify(alt.group(1)) if alt else None,
            "name": (alt.group(1) if alt else None),
            "text": text,
        })
    return out


def matchup_for(slug, by_name):
    p = fetch(f"{BASE}/hero/{slug}/counter")
    html = p.html_content
    h1 = re.search(r"<h1[^>]*>([^<]+)</h1>", html)
    name = None
    if h1:
        m = re.search(r"How to Counter (.+?) in MLBB", h1.group(1))
        name = m.group(1).strip() if m else None
    if not name:
        return None
    hero = by_name.get(norm(name))
    if not hero:
        return None
    return {
        "mlid": str(hero["mlid"]), "name": hero["hero_name"], "slug": slug,
        "countered_by": parse_counters_section(html),
        "best_counters": parse_best_counters(html),
        "rank_notes": parse_rank_notes(html),
    }


def build_reverse_index(records):
    """For hero X, 'counters' = heroes X beats (X appears in their countered_by)."""
    by_mlid = {r["mlid"]: r for r in records}
    reverse = {r["mlid"]: [] for r in records}
    for r in records:
        for c in r.get("countered_by", []):
            cm = None
            for rec in records:
                if rec["slug"] == c["slug"]:
                    cm = rec
                    break
            if not cm:
                continue
            reverse[cm["mlid"]].append({
                "mlid": r["mlid"], "name": r["name"], "slug": r["slug"],
                "strength": c.get("strength"),
                "advantage": c.get("advantage"),
            })
    for mlid, lst in reverse.items():
        lst.sort(key=lambda x: -(x.get("advantage") or 0))
        by_mlid[mlid]["counters"] = lst
    return by_mlid


# ---------------- team-comp guide (FAQ) ----------------
def team_comp_guide():
    p = fetch(f"{BASE}/team-composition")
    html = p.html_content
    faqs = []
    m = re.search(r'<script type="application/ld\+json">(\{"@context":"https://schema\.org","@type":"FAQPage".*?)</script>', html, re.S)
    if m:
        try:
            ld = json.loads(m.group(1))
            for q in ld.get("mainEntity", []):
                ans = q.get("acceptedAnswer", {})
                faqs.append({
                    "question": q.get("name", "").strip(),
                    "answer": re.sub(r"\s+", " ", (ans.get("text", "") or "")).strip(),
                })
        except json.JSONDecodeError:
            pass
    # "How this is worked out" explainer paragraphs (visible text)
    text = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    text = re.sub(r"<[^>]+>", "\n", text)
    import html as _html
    text = _html.unescape(text)
    text = "\n".join(l.strip() for l in text.splitlines() if l.strip())
    how = ""
    i = text.find("How this is worked out, and what it cannot see")
    if i >= 0:
        j = text.find("What this does not know", i)
        how = re.sub(r"\s+", " ", text[i:j].replace(
            "How this is worked out, and what it cannot see", "")).strip()
    return {"how_it_works": how, "faqs": faqs}


# ---------------- derived team comps ----------------
def derive_comps(stats):
    heroes = stats["heroes"]
    by_lane = {}
    for h in heroes:
        for lane in h.get("lanes", []):
            by_lane.setdefault(lane, []).append(h)
    comps = []
    specs = [
        ("best_win_rate", "Best win-rate lineup",
         "بهترین ترکیب بر اساس وین‌ریت",
         lambda h: -(h.get("win_rate") or 0)),
        ("most_picked", "Most picked lineup",
         "پرطرفدارترین ترکیب",
         lambda h: -(h.get("pick_rate") or 0)),
        ("most_banned", "Most banned lineup",
         "ترسناک‌ترین ترکیب (بیشترین بن)",
         lambda h: -(h.get("ban_rate") or 0)),
    ]
    for cid, title, title_fa, key in specs:
        picked, lanes = [], ["gold", "exp", "mid", "roam", "jungle"]
        used = set()
        for lane in lanes:
            cands = sorted(by_lane.get(lane, []), key=key)
            for c in cands:
                if c["slug"] not in used:
                    used.add(c["slug"])
                    picked.append({
                        "name": c["name"], "slug": c["slug"], "lane": lane,
                        "win_rate": c.get("win_rate"),
                        "pick_rate": c.get("pick_rate"),
                        "ban_rate": c.get("ban_rate"),
                    })
                    break
        if len(picked) != 5:
            continue
        avg = round(sum(x["win_rate"] or 0 for x in picked) / 5, 2)
        comps.append({
            "id": cid, "title": title, "title_fa": title_fa,
            "heroes": picked, "avg_win_rate": avg,
        })
    return comps


def _write_matchups(records, prev_heroes, fetched_at, month):
    """Merge fresh records with previous ones, rebuild the reverse index,
    write matchups.json. Returns the total hero count in the file."""
    have = {r["mlid"] for r in records}
    merged = list(records)
    for mlid, rec in prev_heroes.items():
        if mlid not in have:
            merged.append(rec)
    by_mlid = build_reverse_index(merged)
    out = {"fetched_at": fetched_at, "month": month,
           "heroes": {k: by_mlid[k] for k in sorted(by_mlid, key=lambda x: int(x))}}
    with open(f"{OUT_DIR}/matchups.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    return len(out["heroes"])


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    slugs_arg = None
    if "--slugs" in sys.argv:
        slugs_arg = sys.argv[sys.argv.index("--slugs") + 1].split(",")
    fetched_at = datetime.now(timezone.utc).isoformat()
    heroes, by_name = load_heroes()

    if which in ("all", "stats"):
        st = hero_stats()
        st["fetched_at"] = fetched_at
        with open(f"{OUT_DIR}/hero-stats.json", "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False, indent=1)
        print(f"hero-stats.json: {len(st['heroes'])} heroes, month={st['month']}")
        for h in st["heroes"][:5]:
            print(f"  #{h['position']} {h['name']}: win {h['win_rate']}% pick {h['pick_rate']}% ban {h['ban_rate']}% lanes={h['lanes']} roles={h['roles']}")

    if which in ("all", "guide"):
        g = team_comp_guide()
        g["fetched_at"] = fetched_at
        with open(f"{OUT_DIR}/team-comp-guide.json", "w", encoding="utf-8") as f:
            json.dump(g, f, ensure_ascii=False, indent=1)
        print(f"team-comp-guide.json: {len(g['faqs'])} FAQs, how_it_works={len(g['how_it_works'])} chars")
        for q in g["faqs"][:3]:
            print("  Q:", q["question"][:90])

    if which in ("all", "comps"):
        st = load_json(f"{OUT_DIR}/hero-stats.json")
        if not st:
            print("comps: hero-stats.json missing — run stats first")
        else:
            comps = derive_comps(st)
            out = {"fetched_at": fetched_at,
                   "derived_from": "hero-stats.json (ALL ranks, past 7 days) — top hero per lane",
                   "month": st.get("month"), "comps": comps}
            with open(f"{OUT_DIR}/team-comps.json", "w", encoding="utf-8") as f:
                json.dump(out, f, ensure_ascii=False, indent=1)
            print(f"team-comps.json: {len(comps)} derived lineups")
            for c in comps:
                print(f"  {c['title_fa']}: {', '.join(x['name'] for x in c['heroes'])} (avg win {c['avg_win_rate']}%)")

    if which in ("all", "matchups"):
        prev = load_json(f"{OUT_DIR}/matchups.json") or {}
        prev_heroes = prev.get("heroes", {})
        month = prev.get("month")
        slugs = slugs_arg or hero_slugs()
        print(f"matchups: {len(slugs)} hero pages")
        records, failed = [], []
        for i, slug in enumerate(slugs, start=1):
            try:
                rec = matchup_for(slug, by_name)
                if rec:
                    records.append(rec)
                    month = month or "November 2026"
                else:
                    failed.append(slug)
                    if slug in prev_heroes:
                        pass
            except Exception as e:
                print(f"  FAIL {slug}: {e}")
                failed.append(slug)
            if i % 20 == 0:
                print(f"  ... {i}/{len(slugs)}")
                # checkpoint: keep partial progress even if a later fetch hangs
                _write_matchups(records, prev_heroes, fetched_at, month)
            time.sleep(0.4)
        # keep previous records for heroes that failed this run
        total = _write_matchups(records, prev_heroes, fetched_at, month)
        n_cb = sum(len(r.get("countered_by", [])) for r in records)
        n_ct = sum(len(r.get("counters", [])) for r in records)
        print(f"matchups.json: {total} heroes, {n_cb} countered_by, {n_ct} counters (reverse), failed={failed}")


if __name__ == "__main__":
    main()
