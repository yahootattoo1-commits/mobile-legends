# ترجمهٔ فارسی عنوان‌های گفتگوهای mlbb.io (data/discussions.json).
# کلید = عنوان انگلیسی دقیق؛ مقدار = {title_fa}.
# قانون‌ها (مثل بقیهٔ fa-content): نام هیرو/آیتم انگلیسی می‌ماند، هیچ نام منبعی
# نمی‌آید، عنوانی که فقط نام هیرو است همان‌طور انگلیسی می‌ماند (Julian).
# اجرا: python3 tasks/fa/merge_discussions_fa.py  (fa-content.json را درجا به‌روز می‌کند)
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, '..', 'data')

DISCUSSIONS_FA = {
    "Season skin change": {"title_fa": "تغییر اسکین فصل"},
    "MLBB Meta Report: Last Trimester of 2026 (S42: Starward Decade)": {"title_fa": "گزارش متا: سه‌ماههٔ آخر ۲۰۲۶ (فصل ۴۲: دههٔ ستاره‌ای)"},
    "Hero recommendation for me": {"title_fa": "معرفی هیرو برای من"},
    "2026 Sezonunda Solo Rank Kanserinden Kurtulma Rehberi (Tier List + Ufak Tavsiyeler)": {"title_fa": "راهنمای رهایی از رنک سولو در فصل ۲۰۲۶ (تیرلیست + چند نکتهٔ کوچک)"},
    "julian": {"title_fa": "Julian"},
    "Julian": {"title_fa": "Julian"},
    "Invalid report again": {"title_fa": "دوباره گزارش اشتباه"},
    "Too many errors from the staff": {"title_fa": "اشتباه‌های زیاد از سوی عوامل بازی"},
    "When I do network test all ok to go but when I gp to matchmaking, I am unable to join any matches": {"title_fa": "تست شبکه خوبه ولی موقع مچ‌میکینگ نمی‌تونم وارد هیچ مچی بشم"},
    "Lets help.together": {"title_fa": "بیاین با هم کمک کنیم"},
    "karakter": {"title_fa": "کاراکتر"},
    "Cursed Helmet for Tanky Junglers": {"title_fa": "Cursed Helmet برای جانگلرهای تانکی"},
    "Пополнение в клан": {"title_fa": "جذب نیرو برای کلن"},
    "The current state of the meta for Season 42 “Starward Decade” on Patch 2.2.16.": {"title_fa": "وضعیت فعلی متا در فصل ۴۲ «دههٔ ستاره‌ای» در پچ ۲.۲.۱۶"},
    "Pertimbangan Buff Argus": {"title_fa": "بررسی باف Argus"},
    "mabar free": {"title_fa": "هم‌تیمی می‌خوام، آزادم"},
    "🎮 Mobile Legends: Bang Bang (MLBB) Matchmaking Experience Survey": {"title_fa": "🎮 نظرسنجی تجربهٔ مچ‌میکینگ در موبایل لجندز (MLBB)"},
    "Raport": {"title_fa": "گزارش"},
    "Popol and cupa guide help": {"title_fa": "کمک در راهنمای Popol and Kupa"},
    "Classic characters ranked game mode": {"title_fa": "حالت بازی رنک با کاراکترهای کلاسیک"},
}


def main():
    fa_path = os.path.join(DATA, 'fa-content.json')
    disc_path = os.path.join(DATA, 'discussions.json')
    with open(fa_path, encoding='utf-8') as f:
        fa = json.load(f)
    with open(disc_path, encoding='utf-8') as f:
        threads = json.load(f)['threads']
    sec = fa.setdefault('discussions', {})
    missing = []
    for t in threads:
        title = t['title']
        if title not in DISCUSSIONS_FA:
            missing.append(title)
        elif title not in sec:
            sec[title] = DISCUSSIONS_FA[title]
    with open(fa_path, 'w', encoding='utf-8') as f:
        json.dump(fa, f, ensure_ascii=False, indent=1)
    print(f"discussions in fa-content: {len(sec)} / {len(threads)} threads")
    if missing:
        print("MISSING (needs translation):")
        for m in missing:
            print(" -", m)


if __name__ == '__main__':
    main()
