"""Scrapling content pipeline #3 for the Persian Mlbb bot — Fandom wiki content.

Sources (MediaWiki API via Fetcher, chrome131 impersonation):
  - Patch-note pages: full wikitext (extracts come back empty — pages start
    with templates). Parsed into structured sections: intro, designers note,
    new/revamped hero, hero adjustments (per hero, per skill, with buff/nerf
    type), equipment adjustments (per item), and generic sections.
  - Hero pages: full wikitext, split by section. The Bio subsection holds the
    story prose; the Story infobox holds structured fields (alias, species,
    affiliation, ...). Extracts are empty for hero pages too (infobox first).

Outputs (~/workspace/mlbb-bot/data/):
  - patch-notes-full.json {fetched_at, patches[]}
  - hero-lore.json        {fetched_at, heroes: {mlid: {...}}}

Merge-friendly: existing files are loaded first; a patch/hero that fails
keeps its previous record. Re-running never duplicates records.
No source names or links in display text (roozbeh's rule); patch records
keep a `url` reference field only (same as news.json).
"""
import html as _html
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from scrapling import Fetcher

_ROOT = Path(os.environ.get('REPO_ROOT', '') or Path(__file__).resolve().parent.parent)
OUT_DIR = str(_ROOT / 'data')
NEWS_FILE = f"{OUT_DIR}/news.json"
HERO_FILE = f"{OUT_DIR}/hero-meta-final.json"
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


def load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")


# ---------------- wikitext cleaning ----------------
def clean_wiki(raw):
    """Strip templates/links/refs/markup from wikitext -> readable text."""
    s = raw or ""
    s = re.sub(r"<gallery>.*?</gallery>", " ", s, flags=re.S)
    s = re.sub(r"<ref[^>]*>.*?</ref>", " ", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", " ", s)
    s = re.sub(r"<!--.*?-->", " ", s, flags=re.S)
    # templates + links, brace-depth aware
    out, i, n = [], 0, len(s)
    while i < n:
        if s.startswith("{{", i):
            depth, j = 0, i
            while j < n:
                if s.startswith("{{", j):
                    depth += 1
                    j += 2
                elif s.startswith("}}", j):
                    depth -= 1
                    j += 2
                    if depth == 0:
                        break
                else:
                    j += 1
            inner = s[i + 2:j - 2].strip()
            m = re.match(r"^(hi|ai|ii|link)\|(.+)$", inner, re.S)
            if m:
                out.append(m.group(2).split("|")[-1].strip())
            i = j
        elif s.startswith("[[", i):
            j = s.find("]]", i)
            if j == -1:
                out.append(s[i:])
                break
            inner = s[i + 2:j]
            if not inner.startswith("Category:"):
                out.append(inner.split("|")[-1])
            i = j + 2
        else:
            out.append(s[i])
            i += 1
    s = "".join(out)
    # unbalanced leftovers (a nested template whose {{ opened inside a
    # multi-line infobox value that got split) can never be real prose
    s = s.replace("{{", " ").replace("}}", " ")
    s = s.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("'''", "").replace("''", "")
    s = _html.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def clean_line(raw):
    return re.sub(r"\s+", " ", clean_wiki(raw)).strip()


def cap(text, limit):
    """Cap at `limit` chars, cut at the last sentence end before it."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for sep in (". ", "! ", "? ", ".\n", "\n"):
        k = cut.rfind(sep)
        if k > limit * 0.5:
            return cut[:k + 1].strip()
    return cut.rsplit(" ", 1)[0].strip() + "…"


def split_sections(wikitext):
    """Split wikitext into [(level, heading, body)] by == headings."""
    parts = re.split(r"^(={2,4})\s*(.+?)\s*\1\s*$", wikitext, flags=re.M)
    # parts: [pre, eq, heading, body, eq, heading, body, ...]
    out = [("pre", "", parts[0].strip())]
    for i in range(1, len(parts), 3):
        if i + 2 >= len(parts):
            break
        out.append((len(parts[i]), parts[i + 1].strip(), parts[i + 2].strip()))
    return out


def clean_lines(body, cap_each=None):
    """Bullets + paragraphs of a section, cleaned."""
    lines = []
    for ln in body.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("{{") or ln.startswith("[[Category:"):
            continue
        if ln.startswith("{|") or ln.startswith("|-") or ln in ("|}", "|"):
            continue  # wikitable markup
        if ln.startswith("*"):
            ln = ln.lstrip("*").strip()
        ln = clean_line(ln)
        if ln:
            lines.append(ln)
    text = "\n".join(lines)
    return cap(text, cap_each) if cap_each else text


# ---------------- patch notes ----------------
def parse_hero_adjustments(body):
    """Hero blocks, in whichever format the patch page uses:
    (a) {{hi|Name}} {{pci|type}} ... : {{ai|Skill}} {{pci|type}} ... * bullets
    (b) '''Name''' headers + * Skill: change bullets (old pages)
    (c) bare [[Name]] lines + plain 'Skill: change.' lines (oldest pages)
    Returns [{hero, type, note, skills:[{skill, type, changes[]}]}]."""
    if "{{hi|" in body:
        return _parse_hero_template(body)
    if re.search(r"^'''[^']+'''\s*$", body, re.M):
        return _parse_hero_bold(body)
    if re.search(r"^\[\[[^\]]+\]\]\s*$", body, re.M):
        return _parse_hero_links(body)
    return []


def _skill_of(text):
    """'Skill Name: change' -> (skill, change); plain text -> (None, text)."""
    m = re.match(r"^([^:]{2,40}):\s+(.+)$", text)
    if m and not m.group(1).endswith("."):
        return m.group(1).strip(), m.group(2).strip()
    return None, text


def _parse_hero_template(body):
    parts = re.split(r"\{\{hi\|([^}]+)\}\}\s*\{\{pci\|([^}]+)\}\}", body)
    heroes = []
    # parts: [pre, name, type, body, name, type, body, ...]
    for i in range(1, len(parts), 3):
        if i + 2 >= len(parts):
            break
        name, ptype, b = parts[i].strip(), parts[i + 1].strip(), parts[i + 2]
        if not b.strip() or "*" not in b:
            continue  # summary line, not a real block
        skills, note_lines = [], []
        sparts = re.split(r":\s*\{\{ai\|([^}]+)\}\}\s*(?:\{\{pci\|([^}]+)\}\})?", b)
        # sparts: [pre, skill, type, body, skill, type, body, ...]
        if sparts[0].strip():
            for ln in sparts[0].splitlines():
                ln = ln.strip()
                if ln.startswith(":"):
                    ln = clean_line(ln.lstrip(":").strip())
                    if ln:
                        note_lines.append(ln)
        for j in range(1, len(sparts), 3):
            if j + 2 >= len(sparts):
                break
            skill, stype, sbody = sparts[j].strip(), (sparts[j + 1] or "").strip(), sparts[j + 2]
            changes = []
            for ln in sbody.splitlines():
                ln = ln.strip()
                if ln.startswith("*"):
                    ln = clean_line(ln.lstrip("*").strip())
                    if ln:
                        changes.append(ln)
            if skill and (changes or True):
                skills.append({"skill": skill, "type": stype or None,
                               "changes": changes})
        heroes.append({"hero": name, "type": ptype,
                       "note": " ".join(note_lines) or None,
                       "skills": skills})
    return heroes


def _parse_hero_bold(body):
    """'''Name''' headers + '* Skill: change' bullets (old patch pages)."""
    parts = re.split(r"^'''([^']+)'''\s*$", body, flags=re.M)
    heroes, note = [], None
    if parts[0].strip():
        note = clean_lines(parts[0], cap_each=400) or None
    for i in range(1, len(parts), 2):
        if i + 1 >= len(parts):
            break
        name, b = parts[i].strip(), parts[i + 1]
        skills, grouped = [], {}
        for ln in b.splitlines():
            ln = ln.strip()
            if not ln.startswith("*"):
                continue
            ln = clean_line(ln.lstrip("*").strip())
            if not ln:
                continue
            skill, change = _skill_of(ln)
            grouped.setdefault(skill, []).append(change)
        for skill, changes in grouped.items():
            skills.append({"skill": skill, "type": None, "changes": changes})
        if name and skills:
            heroes.append({"hero": name, "type": None,
                           "note": note if not heroes else None,
                           "skills": skills})
    return heroes


def _parse_hero_links(body):
    """Bare [[Name]] lines + plain 'Skill: change.' lines (oldest pages)."""
    parts = re.split(r"^\[\[([^\]]+)\]\]\s*$", body, flags=re.M)
    heroes = []
    for i in range(1, len(parts), 2):
        if i + 1 >= len(parts):
            break
        name, b = parts[i].strip(), parts[i + 1]
        skills, grouped = [], {}
        for ln in b.splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("{{") or ln.startswith("[["):
                continue
            ln = clean_line(ln)
            if not ln:
                continue
            skill, change = _skill_of(ln)
            grouped.setdefault(skill, []).append(change)
        for skill, changes in grouped.items():
            skills.append({"skill": skill, "type": None, "changes": changes})
        if name and skills:
            heroes.append({"hero": name, "type": None,
                           "note": None, "skills": skills})
    return heroes


def parse_equipment_adjustments(body):
    """Item blocks, in whichever format the patch page uses:
    (a) {{ii|Name}} {{pci|type}} ... * '''Group''' ... ** bullets
    (b) numbered list '1. Item Name: change...' (oldest pages)
    Returns [{item, type, note, groups:[{group, type, changes[]}]}]."""
    if "{{ii|" in body:
        return _parse_equipment_template(body)
    if re.search(r"^\d+\.\s+\S", body, re.M):
        return _parse_equipment_numbered(body)
    return []


def _parse_equipment_template(body):
    parts = re.split(r"\{\{ii\|([^}]+)\}\}\s*\{\{pci\|([^}]+)\}\}", body)
    items = []
    for i in range(1, len(parts), 3):
        if i + 2 >= len(parts):
            break
        name, ptype, b = parts[i].strip(), parts[i + 1].strip(), parts[i + 2]
        if not b.strip():
            continue
        groups, note_lines = [], []
        # group headers: * '''Group Name {{pci|type}}'''
        gparts = re.split(r"^\*+\s*'''(.+?)'''", b, flags=re.M)
        if gparts[0].strip():
            for ln in gparts[0].splitlines():
                ln = ln.strip()
                if ln.startswith(":"):
                    ln = clean_line(ln.lstrip(":").strip())
                    if ln:
                        note_lines.append(ln)
        for j in range(1, len(gparts), 2):
            if j + 1 >= len(gparts):
                break
            gname_raw, gbody = gparts[j], gparts[j + 1]
            gtype = None
            gm = re.search(r"\{\{pci\|([^}]+)\}\}", gname_raw)
            if gm:
                gtype = gm.group(1)
            gname = clean_line(gname_raw)
            changes = []
            for ln in gbody.splitlines():
                ln = ln.strip()
                if ln.startswith("*"):
                    ln = clean_line(ln.lstrip("*").strip())
                    if ln:
                        changes.append(ln)
            if gname and changes:
                groups.append({"group": gname, "type": gtype, "changes": changes})
        items.append({"item": name, "type": ptype,
                      "note": " ".join(note_lines) or None,
                      "groups": groups})
    return items


def _parse_equipment_numbered(body):
    """Numbered list '1. Item Name: change...' (oldest patch pages)."""
    items = []
    for ln in body.splitlines():
        ln = ln.strip()
        m = re.match(r"^\d+\.\s+(.+)$", ln)
        if not m:
            continue
        text = clean_line(m.group(1))
        im = re.match(r"^([^:]{2,60}):\s+(.+)$", text)
        if not im:
            continue
        names = [n.strip() for n in re.split(r",\s*|\s+and\s+", im.group(1)) if n.strip()]
        change = im.group(2).strip()
        for nm in names:
            items.append({"item": nm, "type": None, "note": None,
                          "groups": [{"group": None, "type": None,
                                      "changes": [change]}]})
    return items


def _new_hero_record(hero_title, b):
    """One new/revamped hero: feature line + skill headers + bullets."""
    b = b.replace("&nbsp;", " ")
    feature = None
    fm = re.search(r"'''Hero Feature:'''\s*(.+)", b)
    if not fm:
        fm = re.search(r"^Hero Feature:\s*(.+)$", b, re.M)
    if fm:
        feature = clean_line(fm.group(1))
    if not feature:
        # first prose line (e.g. Xavier/Melissa intro sentence)
        first = clean_lines(b).splitlines()
        if first and len(first[0]) >= 20 and not first[0].startswith("["):
            feature = first[0]
    skills = []
    sparts = re.split(r"'''((?:Passive|Special Skill|Skill \d+|Ultimate)[^']*?)'''", b)
    for j in range(1, len(sparts), 2):
        if j + 1 >= len(sparts):
            break
        sname, sbody = clean_line(sparts[j]), sparts[j + 1]
        bullets = []
        for ln in sbody.splitlines():
            ln = ln.strip()
            if ln.startswith("*"):
                ln = clean_line(ln.lstrip("*").strip())
                if ln:
                    bullets.append(ln)
        if sname:
            skills.append({"skill": sname, "changes": bullets})
    # wikitable form: !Skill 1 - {{ai|Name}} headers + | cell text (Xavier/Melissa)
    tskills = []
    hparts = re.split(r"(?m)^!+\s*'{0,3}\s*((?:Passive|Special Skill|Skill \d+|Ultimate)[^\n]*?)\s*$", b)
    for j in range(1, len(hparts), 2):
        if j + 1 >= len(hparts):
            break
        sname, sbody = clean_line(hparts[j]), hparts[j + 1]
        changes = []
        for ln in sbody.splitlines():
            ln = ln.strip()
            if ln.startswith("|-") or ln.startswith("|}") or ln.startswith("!"):
                break
            if ln.startswith("|"):
                ln = ln[1:].strip()
            if ln.startswith("*"):
                ln = ln.lstrip("*").strip()
            ln = clean_line(ln)
            if ln:
                changes.append(ln)
        if sname:
            tskills.append({"skill": sname, "changes": changes})
    if len(tskills) > len(skills):
        skills = tskills
    # hero name: {{hi|...}} in the body, else the last " - " part of the title
    hm = re.search(r"\{\{hi\|([^}]+)\}\}", b)
    hero = hm.group(1) if hm else hero_title.split(" - ")[-1].strip()
    return {"hero": hero, "title": hero_title, "feature": feature, "skills": skills}


def parse_new_hero(body):
    """'I. New & Revamped Hero' — subsections per hero with skill bullets."""
    out = []
    for lvl, heading, b in split_sections(body):
        if lvl == "pre":
            continue
        m = re.match(r"(?:New Hero|Revamped Hero):\s*(.+)$", heading)
        if not m:
            continue
        out.append(_new_hero_record(m.group(1).strip(), b))
    if not out:
        # inline format: [New Hero: {{hi|Chip}}, Phase Technician] + wikitable
        m = re.search(r"\[(?:New Hero|Revamped Hero):\s*(.+?)\]", body)
        if m and re.search(r"'''(?:Passive|Special Skill|Skill \d+|Ultimate)", body):
            out.append(_new_hero_record(clean_line(m.group(1)), body))
    if not out:
        # old-format pages: just cleaned lines
        txt = clean_lines(body, cap_each=2000)
        if txt:
            out.append({"hero": None, "title": None, "feature": None,
                        "skills": [], "text": txt})
    return out


def parse_patch(title, wikitext, by_name):
    secs = split_sections(wikitext)
    pre = secs[0][2] if secs else ""
    # infobox: what's_new + release_date (before the first heading)
    whats_new, release_date = [], None
    ib = re.search(r"\{\{Infobox patch note(.*?)\n\}\}", pre, re.S)
    if ib:
        for ln in ib.group(1).splitlines():
            ln = ln.strip()
            if ln.startswith("|what's_new"):
                continue
            if ln.startswith("#"):
                whats_new.append(clean_line(ln.lstrip("#").strip()))
            rm = re.match(r"\|release_date\s*=\s*(.+)", ln)
            if rm:
                release_date = clean_line(rm.group(1))
    intro = ""
    if pre:
        pre_no_ib = re.sub(r"\{\{Infobox patch note.*?\n\}\}", " ", pre, flags=re.S)
        intro = clean_lines(pre_no_ib, cap_each=800)
    patch = {"title": title, "release_date": release_date,
             "whats_new": whats_new, "intro": intro or None,
             "designers_note": None, "new_heroes": [],
             "hero_adjustments": [], "equipment_adjustments": [],
             "other_sections": []}
    parent = ""
    for lvl, heading, b in secs[1:]:
        h = _html.unescape(heading)
        hl = h.lower()
        if lvl == 2:
            parent = h
        # L3 new/revamped hero subsection ("New Hero: Mask of the Immortal - Suyou")
        hm3 = re.match(r"(?:New Hero|Revamped Hero):\s*(.+)$", h)
        if lvl == 3 and hm3:
            patch["new_heroes"].append(_new_hero_record(hm3.group(1).strip(), b))
        elif "designer" in hl:
            note = clean_lines(b, cap_each=1500)
            if note:
                patch["designers_note"] = (
                    (patch["designers_note"] + "\n" if patch["designers_note"] else "") + note)
        elif lvl == 2 and ("new" in hl or "revamped" in hl) and "hero" in hl:
            # L2 body is often empty — the heroes live in L3 subsections,
            # parsed individually above; parse here only if the body is inline
            if b.strip():
                patch["new_heroes"] = parse_new_hero(b)
        elif "hero adjustment" in hl or "hero balance" in hl:
            ha = parse_hero_adjustments(b)
            for rec in ha:
                hero = by_name.get(norm(rec["hero"]))
                rec["mlid"] = str(hero["mlid"]) if hero else None
            if ha:
                patch["hero_adjustments"].extend(ha)
            else:
                txt = clean_lines(b, cap_each=1500)
                if txt:
                    patch["other_sections"].append({"heading": h, "text": txt})
        elif "equipment" in hl or "gear adjustment" in hl:
            ea = parse_equipment_adjustments(b)
            if ea:
                patch["equipment_adjustments"].extend(ea)
            else:
                txt = clean_lines(b, cap_each=1500)
                if txt:
                    patch["other_sections"].append({"heading": h, "text": txt})
        elif h in ("References",):
            continue
        else:
            txt = clean_lines(b, cap_each=1500)
            if txt:
                head = (parent + " — " + h) if lvl == 3 and parent else h
                patch["other_sections"].append({"heading": head, "text": txt})
    # pages with no parseable sections at all (e.g. Patch Notes 1.3.46):
    # keep the cleaned whole text as one unstructured block
    if (not patch["hero_adjustments"] and not patch["equipment_adjustments"]
            and not patch["new_heroes"] and not patch["other_sections"]
            and not patch["designers_note"]):
        txt = clean_lines(wikitext, cap_each=3000)
        if txt:
            patch["other_sections"].append({"heading": "Patch notes", "text": txt})
    return patch


# ---------------- hero lore ----------------
INFOBOX_FIELDS = ["full_name", "alias", "chinese_name", "birthday", "born",
                  "species", "gender", "title", "occupation", "affiliation",
                  "fighting_style", "weapons", "abilities", "religion",
                  "battles_fought", "height", "weight"]


def parse_infobox(story_body):
    m = re.search(r"\{\{Infobox hero story(.*)", story_body, re.S)
    if not m:
        return {}
    fields, cur = {}, None
    for ln in m.group(1).splitlines():
        s = ln.strip()
        if s.startswith("}}") or s.startswith("=="):
            break
        fm = re.match(r"\|\s*([a-z_]+)\s*=\s*(.*)$", s)
        if fm:
            cur = fm.group(1)
            v = fm.group(2).strip().lstrip("*").strip()
            fields[cur] = [v] if v else []
        elif s.startswith("*") and cur:
            fields.setdefault(cur, []).append(s.lstrip("*").strip())
        elif cur and s and not s.startswith("|"):
            # continuation line of the current field (e.g. inside a <ref>)
            if fields.get(cur):
                fields[cur][-1] += " " + s
            else:
                fields[cur] = [s]
    out = {}
    for k in INFOBOX_FIELDS:
        raw_vals = fields.get(k, [])
        # birthday lives inside the template: {{birthday|9|6}} -> "9/6"
        if k == "birthday" and raw_vals:
            bm = re.search(r"\{\{birthday\|(\d+)\|(\d+)\}\}", " ".join(raw_vals))
            if bm:
                out[k] = f"{bm.group(1)}/{bm.group(2)}"
                continue
        vals = [clean_line(v) for v in raw_vals if clean_line(v)]
        if not vals:
            continue
        out[k] = vals if len(vals) > 1 else vals[0]
    return out


def parse_lore(hero_name, wikitext):
    secs = split_sections(wikitext)
    story_body, bio_body, lore_body = None, None, None
    story_subs, lore_subs = [], []
    in_story, in_lore = False, False
    for lvl, heading, b in secs:
        if lvl == 2:
            in_story = (heading == "Story")
            in_lore = (heading == "Lore")
        if heading == "Story":
            story_body = b
        elif heading == "Bio":
            bio_body = b
        elif heading == "Lore" and lvl == 2:
            lore_body = b
        elif in_story and lvl == 3:
            story_subs.append(b)
        elif in_lore and lvl == 3:
            lore_subs.append(b)
    info = parse_infobox(story_body) if story_body else {}
    bio = None
    if bio_body:
        bio = clean_lines(bio_body)
        # drop any leftover infobox-ish lines
        bio = "\n".join(l for l in bio.splitlines()
                        if not l.startswith("|") and l.strip())
        bio = cap(bio.strip(), 1500)
    if not bio and story_subs:
        # no Bio section (e.g. Gusion): story lives in Story subsections
        bio = cap(clean_lines("\n\n".join(story_subs) or "").strip(), 1500)
    if not bio and story_body:
        # story prose sits directly in the Story section (e.g. Balmond, Masha)
        no_ib = re.sub(r"\{\{Infobox hero story.*?\n\}\}", " ", story_body, flags=re.S)
        txt = clean_lines(no_ib)
        txt = "\n".join(l for l in txt.splitlines()
                        if not l.startswith("|") and l.strip())
        if len(txt) >= 100:
            bio = cap(txt.strip(), 1500)
    if not bio and lore_subs:
        # some heroes use a "Lore" section instead (e.g. Saber)
        bio = cap(clean_lines("\n\n".join(lore_subs) or "").strip(), 1500)
    if not bio and lore_body:
        txt = clean_lines(lore_body)
        txt = "\n".join(l for l in txt.splitlines()
                        if not l.startswith("|") and l.strip())
        if len(txt) >= 100:
            bio = cap(txt.strip(), 1500)
    short = None
    if bio:
        short = cap(bio, 300)
    return {"info": info, "bio": bio or None, "bio_short": short,
            "missing": bio is None}


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    fetched_at = datetime.now(timezone.utc).isoformat()
    with open(HERO_FILE, encoding="utf-8") as f:
        hf = json.load(f)
    heroes = [h for h in hf.get("data", [])
              if h.get("hero_name") and h["hero_name"] != "None"]
    by_name = {norm(h["hero_name"]): h for h in heroes}
    by_name.update({norm(h.get("uid", "")): h for h in heroes})

    if which in ("all", "patches"):
        news = load_json(NEWS_FILE) or {}
        patches_meta = news.get("patch_notes", [])
        prev = load_json(f"{OUT_DIR}/patch-notes-full.json") or {}
        prev_patches = {p["title"]: p for p in prev.get("patches", [])}
        out, failed = [], []
        for pn in patches_meta:
            title = pn["title"]
            try:
                d = fandom_api({"action": "parse", "page": title,
                                "prop": "wikitext"})
                wt = d.get("parse", {}).get("wikitext", "")
                if not wt:
                    raise RuntimeError("empty wikitext")
                rec = parse_patch(title, wt, by_name)
                rec["title_fa"] = pn.get("title_fa")
                rec["updated"] = pn.get("updated")
                rec["url"] = pn.get("url")
                out.append(rec)
                print(f"  {title}: heroes={len(rec['hero_adjustments'])} "
                      f"items={len(rec['equipment_adjustments'])} "
                      f"new={len(rec['new_heroes'])} other={len(rec['other_sections'])}")
            except Exception as e:
                print(f"  FAIL {title}: {e}")
                failed.append(title)
                if title in prev_patches:
                    out.append(prev_patches[title])
            time.sleep(0.5)
        res = {"fetched_at": fetched_at, "patches": out}
        with open(f"{OUT_DIR}/patch-notes-full.json", "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
        n_ha = sum(len(p.get("hero_adjustments", [])) for p in out)
        print(f"patch-notes-full.json: {len(out)} patches, {n_ha} hero adjustments, failed={failed}")

    if which in ("all", "lore"):
        prev = load_json(f"{OUT_DIR}/hero-lore.json") or {}
        prev_heroes = prev.get("heroes", {})
        out, failed, missing = {}, [], []
        only = None
        if "--heroes" in sys.argv:
            only = set(sys.argv[sys.argv.index("--heroes") + 1].split(","))
        for h in heroes:
            name = h["hero_name"]
            mlid = str(h["mlid"])
            if only and mlid not in only and name not in only:
                if mlid in prev_heroes:
                    out[mlid] = prev_heroes[mlid]
                continue
            try:
                d = fandom_api({"action": "parse", "page": name,
                                "prop": "wikitext"})
                wt = d.get("parse", {}).get("wikitext", "")
                if not wt or "missing" in str(d.get("parse", {}).get("pageid")):
                    raise RuntimeError("page missing/empty")
                parsed = parse_lore(name, wt)
                rec = {"mlid": mlid, "name": name, "slug": slugify(name),
                       **parsed}
                out[mlid] = rec
                if parsed["missing"]:
                    missing.append(name)
            except Exception as e:
                print(f"  FAIL {name}: {e}")
                failed.append(name)
                if mlid in prev_heroes:
                    out[mlid] = prev_heroes[mlid]
            time.sleep(0.4)
        res = {"fetched_at": fetched_at, "heroes": out}
        with open(f"{OUT_DIR}/hero-lore.json", "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
        n_bio = sum(1 for r in out.values() if r.get("bio"))
        print(f"hero-lore.json: {len(out)} heroes, {n_bio} with bio, "
              f"missing_bio={missing}, failed={failed}")


if __name__ == "__main__":
    main()
