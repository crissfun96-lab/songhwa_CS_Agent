#!/usr/bin/env python3
"""
Transform Songhwa POS export (Products.csv) into our Google Sheet CSV format.

Reads:  Products.csv (the POS export)
Writes: docs/data/songhwa-menu.csv  (a la carte items)
        docs/data/songhwa-sets.csv  (VM2026 set meals)
        docs/data/songhwa-seed-summary.json  (summary stats for humans)

Usage:
  python3 scripts/seed-from-pos.py /path/to/Products.csv

Filters out expired seasonal categories (Christmas 2024/2025, CNY2025,
Oktoberfest, COUNTDOWN2024). Keeps VM2026, BBQ, A La Carte, Noodles, Lunch
Special, Soup With Rice, addon2026, Drinks, Bagels, Sourdough, etc.

Dine-in prices come from "Tax-Exclusive Price". Ignores Grab/Foodpanda/
Shopee prices (marked up — not what we tell phone customers).
"""

import csv
import json
import re
import sys
from pathlib import Path

# ── Category classification ───────────────────────────────────
# Current/active categories → use
ACTIVE_CATEGORIES = {
    "VM2026",          # current set meals M1-M8
    "BBQ",             # A1-A8 BBQ items
    "A La Carte",      # B1-B10
    "Soup With Rice",  # C1-C13
    "Noodles",         # D1-D7
    "Lunch Special (Main + Soup + Rice + Fruit + Banchan)",  # L1-L14
    "addon2026",       # current add-ons
    "Add on",          # misc add-ons
    "Banchan",         # W01 kimchi takeaway
    "Cream Puff",      # dessert
    "Dessert cake",    # U1-U10
    "Non-alcohol",     # F-series soft drinks
    "Drinks",          # F-series alcoholic bottles
    "Draft Beer",
    "Somaek",
    "Matcha Series",
    "Korean Aloe Series",
    "Pure Fruit Juice",
    "Coffee",
    "Co-branded Coffee",
    "Cocktails",
    "1234 with songhwa",  # weekly daily specials Mon-Thu
    "happy hours",
    "EATIGO SET",
    "Father's day Promo",
    "Sides",           # Korean snacks (churros, cheese ball)
}

# Byond Walls cross-brand items — explicitly excluded per Chris
# Agent should NOT mention these to Songhwa callers
SKIP_BYOND_WALLS_CATEGORIES = {
    "Bagel",
    "NEW Handmade Bagel",
    "BW Pizza Bagel",
    "BW Sourdough",
    "BW Bagel Meal",
    "BW Fruit Tea",
    "Belgian Liege Waffles",
}

# Expired seasonal + Byond Walls — skip entirely
SKIP_CATEGORIES = {
    "Christmas 2024",
    "Christmas 2025",
    "Christmas Special Menu",
    "CNY2025",
    "CNY Exclusive Menu",
    "CNY 2026",
    "COUNTDOWN2024",
    "Oktoberfest",
    "Korean Value Set",  # Q-series old sets, superseded by VM2026
    "",
} | SKIP_BYOND_WALLS_CATEGORIES

# ── Dish category mapping (POS → our schema) ──────────────────
CATEGORY_MAP = {
    "BBQ": "bbq",
    "A La Carte": "stew_soup",  # default, refined below
    "Soup With Rice": "stew_soup",
    "Noodles": "rice_noodles",
    "Lunch Special (Main + Soup + Rice + Fruit + Banchan)": "rice_noodles",
    "addon2026": "add_on",
    "Add on": "add_on",
    "Banchan": "appetizer_side",
    "Cream Puff": "dessert",
    "Dessert cake": "dessert",
    "Non-alcohol": "beverage",
    "Drinks": "beverage",
    "Draft Beer": "beverage",
    "Somaek": "beverage",
    "Matcha Series": "beverage",
    "Korean Aloe Series": "beverage",
    "Pure Fruit Juice": "beverage",
    "Coffee": "beverage",
    "Co-branded Coffee": "beverage",
    "Cocktails": "beverage",
    "Bagel": "appetizer_side",
    "NEW Handmade Bagel": "appetizer_side",
    "BW Pizza Bagel": "appetizer_side",
    "BW Sourdough": "appetizer_side",
    "BW Bagel Meal": "appetizer_side",
    "BW Fruit Tea": "beverage",
    "Belgian Liege Waffles": "dessert",
    "Sides": "appetizer_side",
    "1234 with songhwa": "stew_soup",
    "happy hours": "beverage",
    "EATIGO SET": "add_on",
    "Father's day Promo": "add_on",
}

# NOTE: Byond Walls categories (Bagel, BW Pizza Bagel, etc.) are in SKIP_CATEGORIES
# so they never reach CATEGORY_MAP. Per Chris: don't mention BW to Songhwa callers.

# ── Helpers ───────────────────────────────────────────────────
def clean_name(raw_name: str) -> tuple[str, str]:
    """Strip code prefix ('A1. ', 'M2.', 'C1.Name') from dish name. Returns (code, clean_name)."""
    # Match "A1. Name", "M2.Name", "BPIZ_A01. Name", "GRAB&FP_C01. Name" etc.
    m = re.match(r"^([A-Z][A-Z0-9_&]*\d+[A-Z]?)\s*\.\s*(.+)$", raw_name.strip())
    if m:
        return m.group(1), m.group(2).strip()
    return "", raw_name.strip()


def has_word(text: str, words: list[str]) -> bool:
    """Word-boundary match — avoids substring false positives like 'gin' in 'original'."""
    pattern = r'\b(' + '|'.join(re.escape(w) for w in words) + r')\b'
    return bool(re.search(pattern, text, re.IGNORECASE))


def generate_id(code: str, name: str) -> str:
    """Generate stable ID: lowercase, slug."""
    base = code.lower() if code else re.sub(r"[^\w]+", "_", name.lower())[:30]
    return base.strip("_")


def infer_allergens(name: str, description: str = "") -> list[str]:
    """Infer allergens from dish name + description using word-boundary matching."""
    text = (name + " " + description)
    allergens = set()

    # Pork — explicit pork words only
    if has_word(text, ["pork", "samgyeopsal", "jeyuk", "gamjatang", "dwaeji", "pepperoni",
                        "salami", "bacon", "ham", "duck", "smoked"]):
        allergens.add("pork")

    # Beef — explicit beef words only (NOT generic "galbi")
    if has_word(text, ["beef", "bulgogi", "beefy", "wusamgyeop", "so-hyeo", "sohyeo",
                        "kkotsal", "ribeye", "sirloin", "yukgaejang", "ttukbaegi",
                        "la galbi", "la-style", "short ribs", "beef tongue"]):
        allergens.add("beef")

    # Chicken
    if has_word(text, ["chicken", "dak", "dakgalbi", "samgyetang", "dakgangjeong", "chicky"]):
        allergens.add("chicken")

    # Fish (finned)
    if has_word(text, ["fish", "mackerel", "godeumgeo", "pollock", "hwangtae"]):
        allergens.add("fish")

    # Seafood (broader)
    if has_word(text, ["seafood", "haemul", "squid", "ojingeo", "prawn", "mussel",
                        "lala", "seaweed", "bokkeum"]) and "jeyuk" not in text.lower():
        # "bokkeum" = stir-fry, contextual, but usually means seafood when combined
        if any(w in text.lower() for w in ["squid", "prawn", "mussel", "lala", "seafood", "haemul", "seaweed"]):
            allergens.add("seafood")

    # Shellfish
    if has_word(text, ["prawn", "mussel", "lala", "squid", "ojingeo", "shellfish"]):
        allergens.add("shellfish")

    # Egg
    if has_word(text, ["egg", "gyeran", "jjim"]) and "kimchi" not in text.lower():
        # "jjim" can be steamed egg OR braised (e.g., gamjatang-jjim = braised pork)
        if has_word(text, ["egg", "gyeran"]) or "steamed egg" in text.lower():
            allergens.add("egg")

    # Dairy
    if has_word(text, ["cheese", "cream", "yogurt", "tiramisu", "mousse", "cheesecake",
                        "milk", "milky", "milkis", "cheezy", "cheezzy", "mozzarella",
                        "alfredo", "bingsu", "matcha", "cappuccino", "latte", "mocha"]):
        allergens.add("dairy")

    # Gluten
    if has_word(text, ["pancake", "pajeon", "noodle", "noodles", "ramen", "ramyeon",
                        "bagel", "bread", "sourdough", "waffle", "waffles", "churros",
                        "bingsu", "japchae", "guksu", "brownie", "cookie", "biscoff",
                        "cake", "biscuit", "crust", "dumpling"]):
        allergens.add("gluten")

    # Peanut
    if has_word(text, ["peanut", "peanuts"]):
        allergens.add("peanut")

    # Korean food defaults: kimchi/bbq/marinated/stew usually have soy + sesame
    if has_word(text, ["kimchi", "jjigae", "bulgogi", "bbq", "banchan", "marinated",
                        "jeyuk", "gamjatang", "stew", "soup", "jiggae", "ramen", "ramyeon",
                        "pancake", "pajeon", "tteokbokki", "galbi", "samgyeopsal"]):
        allergens.add("soy")
        allergens.add("sesame")

    # Alcohol — ONLY beverages / items with explicit alcohol words
    if has_word(text, ["soju", "beer", "makgeolli", "wine", "sake", "whiskey", "vodka",
                        "tequila", "rum", "somaek", "baileys", "kahlua", "alcohol",
                        "alcoholic", "abv", "cocktail", "tower set", "draft",
                        "carlsberg", "heineken", "tiger", "sapporo", "tsingtao",
                        "kronenbourg", "edelweiss", "anglia", "stout", "connors",
                        "somersby", "hwayo"]):
        allergens.add("alcohol")

    return sorted(allergens)


def infer_spice_level(name: str) -> int:
    """Infer spice level from dish name. 0=none, 3=very spicy."""
    text = name.lower()
    if "mala" in text:
        return 3
    if "spicy" in text or "kimchi jjigae" in text or "sundubu" in text:
        return 2
    if "kimchi" in text or "gochu" in text or "bokkeum" in text or "tteokbokki" in text:
        return 2
    if "jeyuk" in text or "gamjatang" in text or "sichuan" in text:
        return 2
    return 0


def infer_tags(name: str, category: str) -> list[str]:
    """Derive searchable tags."""
    text = name.lower()
    tags = set()

    if "bbq" in text or category == "BBQ":
        tags.add("grilled")
        tags.add("bbq")
    if "spicy" in text:
        tags.add("spicy")
    if "set" in text:
        tags.add("set")
    if "lunch" in text:
        tags.add("lunch")
    if "fried" in text:
        tags.add("fried")
    if "cold" in text or "icy" in text:
        tags.add("cold")
    if "hot" in text or "pot" in text or "stone" in text:
        tags.add("hot")
    if "signature" in text or "premium" in text:
        tags.add("premium")
    if "pax" in text:
        tags.add("sharing")
    if "kimchi" in text:
        tags.add("kimchi")
    if "rice" in text:
        tags.add("rice")
    if "noodle" in text or "ramen" in text or "guksu" in text:
        tags.add("noodle")
    if "soup" in text or "jjigae" in text or "stew" in text:
        tags.add("soup")

    return sorted(tags)


# Flag signature + popular dishes — Chris can adjust later
SIGNATURE_IDS = {
    "a1",  # BBQ Pork Belly Samgyeopsal
    "a5",  # LA Galbi
    "a6",  # Premium Beef
    "b1",  # Stone Pot Braised Pork Ribs
    "b6",  # Seafood Pancake
    "b10", # Korean Fried Chicken
    "c1",  # Kimchi Jjigae
    "c3",  # Sundubu Jjigae
    "c5",  # Gamjatang
    "c6",  # Samgyetang
}

POPULAR_IDS = SIGNATURE_IDS | {
    "a3",  # Marinated Chicken
    "a4",  # Marinated Lamb
    "c2",  # Ddenjang Jjigae
    "d3",  # Mul Naengmyeon
    "d4",  # Bibim Naengmyeon
    "l1",  # LA Galbi Lunch Set
}


# ── Main transformation ───────────────────────────────────────
def transform(products_csv: Path, out_dir: Path) -> dict:
    menu_rows = []
    set_rows = []
    skipped_by_category: dict[str, int] = {}
    stats = {
        "total_pos_rows": 0,
        "menu_items_kept": 0,
        "sets_kept": 0,
        "skipped_expired": 0,
        "categories_kept": set(),
    }

    with products_csv.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        # Skip the second "required/optional" meta row
        next(reader, None)

        for row in reader:
            stats["total_pos_rows"] += 1
            raw_name = (row.get("Product Name") or "").strip()
            category = (row.get("Category") or "").strip()
            price_str = (row.get("Tax-Exclusive Price") or "").strip()
            description = (row.get("Product Description") or "").strip()

            if not raw_name:
                continue

            if category in SKIP_CATEGORIES or category not in ACTIVE_CATEGORIES:
                skipped_by_category[category] = skipped_by_category.get(category, 0) + 1
                stats["skipped_expired"] += 1
                continue

            try:
                price_rm = float(price_str) if price_str else 0.0
            except ValueError:
                price_rm = 0.0

            # Skip 0-price items (free gifts, placeholder entries) unless add-on
            if price_rm == 0 and category not in {"addon2026", "Add on"}:
                continue

            code, clean = clean_name(raw_name)
            item_id = generate_id(code, clean)

            # ── VM2026 sets go to set_rows ────────────────────
            if category == "VM2026":
                # Parse pax range from name
                pax_min, pax_max = 1, 1
                pax_match = re.search(r"\((\d+)\s*-\s*(\d+)\s*pax\)", raw_name, re.IGNORECASE)
                if pax_match:
                    pax_min = int(pax_match.group(1))
                    pax_max = int(pax_match.group(2))
                else:
                    pax_single = re.search(r"\((\d+)\s*pax\)", raw_name, re.IGNORECASE)
                    if pax_single:
                        pax_min = pax_max = int(pax_single.group(1))

                # Infer flags
                flags = []
                if code == "M2":
                    flags.append("best_seller")
                if code == "M1":
                    flags.append("super_value")
                if code == "M4":
                    flags.append("couples_choice")
                if code == "M8":
                    flags.append("budget")

                set_rows.append({
                    "id": code,
                    "code": code,
                    "name": clean,
                    "pax_min": pax_min,
                    "pax_max": pax_max,
                    "price_rm": price_rm,
                    "flags": ";".join(flags),
                    "description_en": description or clean,
                    "description_zh": "",
                    "photo_url": "",
                })
                stats["sets_kept"] += 1
                stats["categories_kept"].add(category)
                continue

            # ── Everything else → menu_rows ───────────────────
            our_category = CATEGORY_MAP.get(category, "appetizer_side")
            tags = infer_tags(clean, category)

            allergens = infer_allergens(clean, description)

            is_signature = item_id in SIGNATURE_IDS
            is_popular = item_id in POPULAR_IDS

            menu_rows.append({
                "id": item_id,
                "code": code,
                "name_en": clean,
                "name_ko": "",
                "name_zh": "",
                "name_bm": "",
                "price_rm": f"{price_rm:.2f}",
                "category": our_category,
                "portion": extract_portion(clean),
                "allergens": ",".join(allergens),
                "spice_level": infer_spice_level(clean),
                "is_signature": "TRUE" if is_signature else "FALSE",
                "is_popular": "TRUE" if is_popular else "FALSE",
                "description_en": description,
                "description_bm": "",
                "description_zh": "",
                "tags": ";".join(tags),
            })
            stats["menu_items_kept"] += 1
            stats["categories_kept"].add(category)

    # ── Write outputs ─────────────────────────────────────────
    menu_fields = [
        "id", "code", "name_en", "name_ko", "name_zh", "name_bm",
        "price_rm", "category", "portion", "allergens", "spice_level",
        "is_signature", "is_popular", "description_en", "description_bm",
        "description_zh", "tags",
    ]
    set_fields = [
        "id", "code", "name", "pax_min", "pax_max", "price_rm",
        "flags", "description_en", "description_zh", "photo_url",
    ]

    menu_path = out_dir / "songhwa-menu.csv"
    with menu_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=menu_fields, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        writer.writerows(menu_rows)

    sets_path = out_dir / "songhwa-sets.csv"
    with sets_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=set_fields, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        writer.writerows(set_rows)

    stats["categories_kept"] = sorted(stats["categories_kept"])

    summary_path = out_dir / "songhwa-seed-summary.json"
    summary = {
        "stats": stats,
        "skipped_by_category": dict(sorted(skipped_by_category.items(), key=lambda x: -x[1])),
        "menu_csv": str(menu_path),
        "sets_csv": str(sets_path),
    }
    summary_path.write_text(json.dumps(summary, indent=2))

    return summary


def extract_portion(name: str) -> str:
    """Pull out portion size from name like 'A1. BBQ Pork Belly - 150G'."""
    m = re.search(r"-\s*(\d+\s*[Gg]|\d+\s*pcs|\d+\s*pax)", name)
    if m:
        return m.group(1).strip()
    return ""


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 seed-from-pos.py /path/to/Products.csv")
        sys.exit(1)

    products_csv = Path(sys.argv[1])
    out_dir = Path(__file__).resolve().parent.parent / "docs" / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    summary = transform(products_csv, out_dir)
    print(json.dumps(summary, indent=2))
