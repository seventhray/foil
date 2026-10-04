"""tools/verify/validate-bestiary.py

Checks every built creature in the vault against the GMG's creature-building
rules (4.1.0-4.5.1), reading the tier table, the Trait prices, and the Monster
Feat prices from the GMG itself. Not part of run.mjs, since it reads the
Obsidian vault rather than the system. Run it after changing the rules or the
Bestiary: a creature that breaks a stated rule means the creature or the rule
has to change.

    FOIL_BOOKS=/path/to/Foilbound FOIL_CREATURES=/path/to/Campaign/Creatures \\
      python3 tools/verify/validate-bestiary.py
"""
import glob, os, re, sys

BOOKS = os.environ.get("FOIL_BOOKS") or sys.exit("Set FOIL_BOOKS to the folder holding the rulebooks.")
CREATURES = os.environ.get("FOIL_CREATURES") or sys.exit("Set FOIL_CREATURES to the Campaign/Creatures folder.")
GMG = open(sorted(glob.glob(os.path.join(BOOKS, "Foilbound TTRPG Game Master's Guide v*.md")))[-1], encoding="utf-8").read()


def table_after(heading, first_col):
    """Rows of the first table after a heading whose header starts with first_col."""
    i = GMG.index(heading)
    j = GMG.index("| " + first_col, i)
    rows = []
    for line in GMG[j:].split("\n")[2:]:
        if not line.startswith("|"):
            break
        rows.append([c.strip() for c in line.strip("|").split("|")])
    return rows


num = lambda s: int(re.search(r"\d+", s).group(0))
TIERS = {}
for r in table_after("## 4.1.0 Tier", "Tier"):
    TIERS[r[0]] = dict(pot=num(r[1]), health=num(r[3]), res=num(r[4]), train=num(r[5]), allow=num(r[6]), ceil=num(r[7]))
CAPS = {r[0]: num(r[1]) for r in table_after("## 4.3.0 Resistance", "Tier")}
TRAITS = {r[0]: num(r[1]) for r in table_after("## 4.5.0 Feats and Traits", "Trait")}
FEATS = {r[0]: r[1] for r in table_after("### 4.5.1 Monster Feats", "Feat")}
STEP = 2                  # one row of the Target Potential table (GMG 4.2.0)
GRANT_ACTION = 14         # Legendary Action, per use (GMG 4.5.1)

issues, checked = [], 0
for path in sorted(glob.glob(os.path.join(CREATURES, "*.md"))):
    s = open(path, encoding="utf-8").read()
    name = os.path.basename(path)[:-3]
    m = re.search(r"^tier:\s*(\d+)\s*$", s, re.M)
    if not m or m.group(1) not in TIERS or "not yet built" in s:
        continue
    t, T = m.group(1), TIERS[m.group(1)]
    checked += 1
    bad = []
    pots = {k: int(v) for k, v in re.findall(r"^(might|finesse|wit|presence):.*\((\d+)\)", s, re.M)}
    for k, v in pots.items():
        if abs(v - T["pot"]) > 2 * STEP:
            bad.append(f"{k} Potential {v} is more than two steps from {T['pot']} (4.2.0)")
    health = int((re.search(r"\*\*Health\*\*\s*(\d+)", s) or [0, 0])[1])
    if pots and health != sum(pots.values()):
        bad.append(f"Health {health} isn't the sum of its Potentials, {sum(pots.values())}")
    if abs(health - T["health"]) > STEP:
        bad.append(f"Health {health} is more than one step from {T['health']} (4.2.0)")
    train = [int(x) for x in re.findall(r"\+(\d+)", (re.search(r"\*\*Training\*\*([^\n]*)", s) or [0, ""])[1])]
    if any(x != T["train"] for x in train):
        bad.append(f"Training {sorted(set(train))} isn't the tier's +{T['train']} (4.4.0)")
    res = {k: int(v) for k, v in re.findall(r"(physical|mental) ([+-]\d+)", (re.search(r"\*\*Resistance\*\*([^·\n]*)", s) or [0, ""])[1])}
    # Armor, a shield, or a ward is Equipment, outside the budget (4.3.0); the cap still applies.
    equipped = re.search(r"\b(leather|leathers|mail|plate|coat|armou?r|shield|ward)\b", (re.search(r"\*\*Resistance\*\*([^·\n]*)", s) or [0, ""])[1], re.I)
    for k, v in res.items():
        if abs(v) > CAPS[t]:
            bad.append(f"{k} Resistance {v:+d} is past the tier cap +{CAPS[t]} (4.3.0)")
    if not equipped and sum(max(0, v) for v in res.values()) * 8 > T["res"] + 8 * sum(-min(0, v) for v in res.values()):
        bad.append(f"Resistance {res} costs more than the tier's budget {T['res']} (4.3.0)")
    spent = 0
    for line in re.findall(r"^>\s*-\s*\*\*(.+)$", s, re.M):
        item = re.match(r"([^*]+)\*\*(.*)", line)
        iname, rest = item.group(1).strip(), item.group(2)
        xp = re.search(r"(\d+)\s*XP", rest)
        if not xp:
            continue        # Instruments and free built-ins
        xp = int(xp.group(1))
        spent += xp
        base = re.sub(r"\s*\(.*\)$", "", iname)
        if base == "Legendary Action":
            uses = int((re.search(r"(\d+) uses", rest) or [0, 0])[1])
            per_round = 2 if t == "10" else 1
            if xp != GRANT_ACTION * uses:
                bad.append(f"Legendary Action {uses} uses should cost {GRANT_ACTION * uses}, not {xp}")
            if uses > 5 * per_round:
                bad.append(f"Legendary Action {uses} uses is more than {5 * per_round} a conflict can use")
        elif base in TRAITS and xp != TRAITS[base]:
            bad.append(f"Trait {base} costs {TRAITS[base]} (4.5.0), not {xp}")
        elif base in FEATS and FEATS[base].isdigit() and xp != int(FEATS[base]):
            bad.append(f"Feat {base} costs {FEATS[base]} (4.5.1), not {xp}")
        if xp > T["ceil"]:
            bad.append(f"{base} {xp} XP is over the Ceiling {T['ceil']} (4.5.0)")
    if spent > T["allow"] * 1.1:
        bad.append(f"spends {spent} of {T['allow']} Allowance, more than a tenth over the target (4.5.0)")
    if spent < T["allow"] / 2:
        bad.append(f"spends {spent} of {T['allow']} Allowance, leaving most of it unspent (4.5.0)")
    if bad:
        issues.append((int(t), name, bad))

issues.sort()
print(f"{checked - len(issues)} of {checked} built creatures follow the GMG's creature-building rules\n")
for t, name, bad in issues:
    print(f"  Tier {t} {name}")
    for b in bad:
        print(f"    - {b}")
sys.exit(1 if issues else 0)
