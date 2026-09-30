"""tools/verify/validate-bestiary.py

Checks every printed creature against GMG 4.0.0. Not part of run.mjs, since it
reads the Obsidian vault rather than the system. Run it after changing the
framework or the Bestiary, so the rule in the book stays one the creatures
actually follow.

Check every printed creature against the proposed framework, so the rule
being written into the GMG is one the Bestiary actually follows."""
import re, glob, os
D = os.environ.get("FOIL_CREATURES") or exit("Set FOIL_CREATURES to the Campaign/Creatures folder.")
BASE = {"Pest":4,"Minor":6,"Moderate":8,"Serious":10,"Dangerous":12,"Major":20}
RES  = {"Pest":0,"Minor":0,"Moderate":1,"Serious":2,"Dangerous":2,"Major":3,"Legendary":4}
TRN  = {"Pest":0,"Minor":1,"Moderate":1,"Serious":2,"Dangerous":2,"Major":3,"Legendary":4}
TECH = {"Pest":(0,0),"Minor":(0,1),"Moderate":(0,1),"Serious":(0,2),
        "Dangerous":(0,2),"Major":(2,3),"Legendary":(1,3)}
CEIL = {"Pest":0,"Minor":8,"Moderate":12,"Serious":16,"Dangerous":24,"Major":36,"Legendary":48}
ORDER = list(TRN)

issues, ok = [], 0
for f in sorted(glob.glob(f"{D}/*.md")):
    s = open(f).read(); name = os.path.basename(f)[:-3]
    tier = (re.search(r"^tier:\s*(\S+)", s, re.M) or [None,"?"])[1]
    if tier not in ORDER: continue
    pot = {k:int(v) for k,v in re.findall(r"^(might|finesse|wit|presence):\s*\S+\s*\((\d+)\)", s, re.M)}
    hp  = int((re.search(r"\*\*Health\*\*\s*(\d+)", s) or [0,0])[1])
    res = max([int(x) for x in re.findall(r"\+(\d+)", (re.search(r"\*\*Resistance\*\*\s*([^·\n]*)", s) or [0,""])[1])] or [0])
    trn = max([int(x) for x in re.findall(r"\+(\d+)", (re.search(r"\*\*Training\*\*\s*([^\n]*)", s) or [0,""])[1])] or [0])
    xps = [int(x) for x in re.findall(r"^>\s*-\s*\*\*[^*]+\*\*:.*?(\d+)\s*XP", s, re.M)]
    bad = []
    if tier != "Legendary":
        want = BASE[tier]*4
        # A step is 2 Potential (GMG §10.2.0). Steps up and down rarely cancel
        # exactly, so the tier's Health is a centre with a step of give either way.
        if abs(hp - want) > 4: bad.append(f"Health {hp} more than a step off tier baseline {want}")
        # shading: each Attribute within 2 steps (4 Potential) of baseline
        for k,v in pot.items():
            if abs(v - BASE[tier]) > 4: bad.append(f"{k} {v} more than 2 steps off baseline {BASE[tier]}")
    if res > RES[tier] + 1: bad.append(f"Resistance +{res} over tier {RES[tier]} (+1 allowance)")
    if trn > TRN[tier]:     bad.append(f"Training +{trn} over tier {TRN[tier]}")
    lo, hi = TECH[tier]
    if len(xps) > hi: bad.append(f"{len(xps)} Techniques, allowance {lo}-{hi}")
    over = [x for x in xps if x > CEIL[tier]]
    if over: bad.append(f"Technique XP {over} over ceiling {CEIL[tier]}")
    if bad: issues.append((tier, name, bad))
    else: ok += 1

issues.sort(key=lambda r: ORDER.index(r[0]))
print(f"{ok} of {ok+len(issues)} creatures fit the framework as proposed\n")
for tier, name, bad in issues:
    print(f"  {tier:10s} {name}")
    for b in bad: print(f"             - {b}")
