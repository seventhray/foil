/**
 * tools/guide-content.mjs
 * In-app user guide, seeded into the `guide` JournalEntry compendium by
 * populate-packs.mjs. Written against Foilbound 0.6.0: every number here is
 * the printed one, and tools/verify/verify-guide.mjs checks them against the
 * books, so this file has to move whenever the books do.
 *
 * Three journals for three readers: someone learning the game, someone
 * reading a sheet, and someone authoring new content.
 */

const p = (name, html) => ({ name, html });

export const GUIDE = [
{
  name: "1 · How Foilbound Plays",
  pages: [
p("Resolving a Technique", `
<p>Every contest runs the same way, whether it is a duel, an argument, or a crisis of belief (PHB 1.4.0, 6.4.0).</p>
<ol>
<li>Declare the <strong>Instrument</strong> and the <strong>Technique</strong>: one of the Instrument's three built-in Techniques, or one the character has learned.</li>
<li>Name the Attribute it harms. Describe the action; the GM judges whether it fits.</li>
<li>Pick any of the three Skills the Instrument's Primary Attribute allows.</li>
<li>Pay the <strong>Action</strong>, or the <strong>Quick Action</strong> if the Technique is Quick.</li>
<li>Roll the Skill. The target Opposes with any Skill built on the Attribute under attack.</li>
<li>If the Oppose beats the roll, the Technique fails. Otherwise it lands, a tie landing at a margin of 0.</li>
</ol>
<p>There is no separate damage roll. The <strong>margin</strong> the Technique won by becomes its Stress.</p>`),

p("Attributes, Potential, and Skills", `
<p>A character has four <strong>Attributes</strong>: Might and Finesse (physical), Wit and Presence (mental). Each is a pool of dice. Every Attribute starts at 2d4; an Ancestry and a Background add to them (PHB 2.5.0).</p>
<p><strong>Potential</strong> is the most that pool can roll. It is also how much Stress the Attribute holds before it is Incapacitated.</p>
<p>Six <strong>Skills</strong> each pair two Attributes. To roll one, roll both pools and add that Skill's Training.</p>
<table><thead><tr><th>Skill</th><th>Attributes</th><th>Represents</th></tr></thead><tbody>
<tr><td>Prowess</td><td>Might + Finesse</td><td>Athletics, martial arts, power</td></tr>
<tr><td>Discipline</td><td>Might + Wit</td><td>Control, resilience, consistency</td></tr>
<tr><td>Assertiveness</td><td>Might + Presence</td><td>Intimidation, command, inspiration, rallying</td></tr>
<tr><td>Acuity</td><td>Finesse + Wit</td><td>Perception, awareness, foresight</td></tr>
<tr><td>Guile</td><td>Finesse + Presence</td><td>Maneuvering, deception, performance, misdirection</td></tr>
<tr><td>Resonance</td><td>Wit + Presence</td><td>Insight, persuasion, connection, encouragement</td></tr>
</tbody></table>
<p><strong>Training</strong> costs 6 XP, plus 2 for each point the Skill already has. It can't pass the number of dice in the Skill's two pools.</p>
<p>A creature that isn't pushing back has a <strong>passive</strong> value in each Skill: the Average of its two Attributes, rounded down, plus Training. It stands in as the Difficulty.</p>`),

p("Instruments and Types", `
<p>An <strong>Instrument</strong> has one Range, one <strong>Primary Attribute</strong>, and one or more <strong>Instrument Types</strong>. The Primary Attribute sets which three Skills can roll it. Every Instrument carries three built-in Techniques, one per Skill, free.</p>
<p>Every character has two innate Instruments. <strong>Body</strong> is Might Primary, Quick, Light, Blunt, Grappling, Close: Strike, Grapple, Menace. <strong>Voice</strong> is Presence Primary, Quick, Light, Sonic, Mid Range: Intimidate, Mislead, Sway.</p>
<table><thead><tr><th>Type</th><th>Type effect</th></tr></thead><tbody>
<tr><td>Edged</td><td>+3 Stress against a physical Attribute. Physical Resistance counts double against Edged, after Pierce</td></tr>
<tr><td>Pointed</td><td>Pierce 1 against physical Resistance, +1 Stress against a physical Attribute</td></tr>
<tr><td>Blunt</td><td>Pierce 3 against physical Resistance</td></tr>
<tr><td>Drawn / Fired</td><td>+2 / +4 Stress; reload with the Quick Action / the Action</td></tr>
<tr><td>Kinetic</td><td>+1 against a physical Attribute, -1 against a mental one</td></tr>
<tr><td>Incorporeal, Sonic</td><td>+1 against a mental Attribute, -1 against a physical one</td></tr>
<tr><td>Quick</td><td>Built-in Techniques may use the Quick Action</td></tr>
<tr><td>Grappling</td><td>Adds no Stress</td></tr>
<tr><td>Blocking</td><td>Its +N applies to Oppose rolls; Guard with it</td></tr>
<tr><td>Immobile</td><td>+2 Stress; fixed in place</td></tr>
</tbody></table>
<p>Light, Medium, and Heavy are weight classes, not Types. They set an Instrument's base price (15p, 30p, 45p) and its carried weight (2, 4, 8 lbs). A Medium Instrument adds 1d6 to a Technique used through it against a target, a Heavy one 2d4, never to an Oppose, support, or a Trade. A Heavy Instrument takes both hands.</p>`),

p("Stress, Resistance, and Incapacitation", `
<p>When a Stress Technique lands (PHB 6.7.0):</p>
<ol>
<li>Take the margin, capped at <strong>half the Potential</strong> of the Instrument's Primary Attribute.</li>
<li>Add one Type's Stress effect, the attacker's choice.</li>
<li>Add the Technique's own bonus.</li>
<li>Subtract the target's Resistance, less any Pierce, to a minimum of 0.</li>
</ol>
<p><strong>Resistance</strong> comes in two kinds. Physical covers Might and Finesse; mental covers Wit and Presence. A creature <strong>Vulnerable</strong> to something has negative Resistance against it, which adds Stress.</p>
<p>An Attribute is <strong>Incapacitated</strong> when its Stress reaches its Potential. It contributes no dice. Incapacitation lifts once healing brings its Stress down to half its Potential or less, rounded down. Stress past a full bar <strong>overflows</strong> onto another Attribute, the defender's choice, and the receiving Attribute's Resistance doesn't reduce it.</p>
<p><strong>Destroyed</strong> is all four Attributes at zero at once. It is permanent, and a choice a side makes.</p>`),

p("Actions and Strain", `
<p>Each round a character gets one <strong>Action</strong> and one <strong>Quick Action</strong>. The Quick Action is spent on your turn or held to use reactively, one use either way. Moving up to 20 feet is free; another 20 costs the Quick Action. Initiative is an Acuity roll.</p>
<p>A learned Technique carries <strong>Strain</strong>: floor(XP / 8) Stress to its own user, on the Instrument's Primary Attribute, whether it lands or not, ignoring Resistance. Built-in Techniques carry none.</p>`),

p("FOIL and Foil Tokens", `
<p>Four axes describe how a character responds in the moment: <strong>Faith</strong> (Trusting or Mistrusting), <strong>Order</strong> (Ordered or Disordered), <strong>Individualism</strong> (Individual or Communal), and <strong>Levity</strong> (Light or Grave). Each leans toward one end, sits deliberately between them, or stays undeclared (PHB 3.1.0).</p>
<p>Once per scene a player may <strong>invoke</strong> a trait their character holds. If the table agrees the trait drives what the character is doing, they earn a <strong>Foil Token</strong>. A character holds at most four.</p>
<p>A Foil Token is spent at will: halve the Stress from one source, rounded down, or reroll any one die right after rolling a Skill. The new result stands.</p>`),

p("Ending a conflict, resting, travel", `
<p>A conflict ends when one side stops contesting it. <strong>Flee</strong>: Disengage and move away; each chaser rolls Prowess against the fleer every round, and the winner moves one range band. <strong>Yield</strong>: stop fighting and accept terms. <strong>Destroy</strong>: keep going until every Attribute is at zero. <strong>Terms</strong>: press for an end with social Conditions.</p>
<p><strong>Rest</strong> removes 1d4 Stress every 2 hours from one Attribute of the character's choice. It eats one ration per 8 hours; without one, the time passes but heals nothing.</p>
<p>A <strong>Travel</strong> leg costs 1 Stress to every Attribute and one ration, and 1 more Stress on a failed roll.</p>
<p><strong>Carrying</strong>: past 4x Might Potential in pounds, every roll takes -1 per extra multiple, and each Travel leg adds that much Stress.</p>`),
]},

{
  name: "2 · The Sheets, Field by Field",
  pages: [
p("Character sheet", `
<table><thead><tr><th>Field</th><th>What it is</th></tr></thead><tbody>
<tr><td><strong>Create</strong></td><td>Builds a starting character in one window, following PHB 2.5.0: pick an Ancestry and a Background and see what each grants, preview the dice, Training, and Resistance, set FOIL traits (pick, roll, or write), and answer the prompts. Adds Body and Voice.</td></tr>
<tr><td><strong>Drag and drop</strong></td><td>Drop any Item from the sidebar or a compendium onto the sheet. A dropped Ancestry or Background replaces the old one.</td></tr>
<tr><td><strong>Advance</strong></td><td>Spends XP: a die one size 8, 12, 16, or 20 XP by its size, d12 to d20 100 XP as a Transformation, which also grants a gift (PHB 2.3.1), a new 1d4 20 XP (at most 4 dice, plus 1 per die at d12 or larger), +1 Training 6 XP plus 2 per point held, or a Technique or Feat at its listed XP.</td></tr>
<tr><td><strong>Attribute Dice</strong></td><td>How many of each die size sit in the pool. The system builds the formula and Potential.</td></tr>
<tr><td><strong>Stress, Potential</strong></td><td>The Stress on the Attribute, beside its Potential. When Stress reaches Potential the Attribute is Incapacitated; it recovers once Stress falls to the amount shown.</td></tr>
<tr><td><strong>Resistance</strong></td><td>Derived from equipped armor, shields, wards, and Feats, with what granted it.</td></tr>
<tr><td><strong>Skills</strong></td><td>Formula, Training (with its cap), passive value, and roll range. Click to roll.</td></tr>
<tr><td><strong>Foil Tokens</strong></td><td>Earn one on an invoke; <em>Halve Stress</em> spends one.</td></tr>
<tr><td><strong>Rations, Carried</strong></td><td>Rations weigh 2 lbs each. Carried turns red with its roll penalty once over 4x Might Potential.</td></tr>
<tr><td><strong>Location</strong></td><td>Each Instrument and piece of Equipment is equipped, carried, or stored; click its icon to change it. Only equipped gear grants its Resistance or bonus, stored gear weighs nothing, and a Heavy Instrument warns when something else is also in hand. Switching to a carried Instrument costs the Quick Action.</td></tr>
<tr><td><strong>Techniques</strong></td><td>Lists every built-in Technique of the character's Instruments, with the Instrument it comes from, above the learned ones. Each learned Technique lists the Instruments it can be used with, equipped ones first; stored ones never count.</td></tr>
<tr><td><strong>FOIL</strong></td><td>A lean and a trait line per axis.</td></tr>
<tr><td><strong>Conditions</strong></td><td>Active Conditions, with rounds and a note.</td></tr>
</tbody></table>
<p>There is no Health field on a character: the four Potentials are the same information.</p>`),

p("Creature sheet", `
<p>A creature uses the same Attributes, Skills, Stress, and Incapacitation. Its own fields: <strong>Tier</strong>, <strong>Behavior</strong> (what it does once an Attribute is Incapacitated, GMG 4.8.0), <strong>Vulnerable</strong>, and a typed <strong>Resistance</strong>. <strong>Health</strong>, the four Potentials summed, shows as GM shorthand.</p>`),

p("What the system does for you", `
<p>Foilbound on Foundry stays close to pen and paper. It derives values and rolls dice. Three things are automated:</p>
<ul>
<li><strong>Strain</strong> lands on the Instrument's Primary Attribute when a learned Technique is rolled.</li>
<li>A Stress Technique's chat card has a <strong>Stress</strong> button. Enter the target's Oppose and Resistance, pick the Type effect, and it reports the Stress. Applying it to the target stays manual.</li>
<li><strong>Foil Token</strong> spends: halve one source's Stress from the sheet, or reroll one die from any roll's chat card.</li>
</ul>
<p>It does not roll Opposes, apply Stress to a target, adjudicate Conditions, or move FOIL traits.</p>`),
]},

{
  name: "3 · Building Content",
  pages: [
p("The vocabulary", `
<p>Instrument Types, Properties, and Effects are ordinary Items in the <em>FOIL Vocabulary</em> compendiums. Content refers to them by slug, so creating a new one in a world makes it available on every sheet at once.</p>
<ul>
<li><strong>Instrument Type</strong>: family, Stress against physical and mental Attributes, Pierce, and flags for Quick, Blocking, Reload, Tool, and Edged's no-bonus-against-Resistance.</li>
<li><strong>Property</strong>: a passive Equipment Property, Resistance +N, +N to a Skill, or Aid +N.</li>
<li><strong>Effect</strong>: how it prices, which Types can deliver it, and whether it counts toward the combination premium.</li>
</ul>`),

p("Pricing a Technique", `
<p>A Technique's XP is priced from its Effects (GMG 5.2.0), and the sheet shows the computed price beside the printed one.</p>
<ol>
<li>Sum the Effects. Stress is an Effect at 4 XP.</li>
<li>A Pattern, Selective, or Extend Range is priced by reach and counts as an Effect.</li>
<li>Add 4 XP for every Effect beyond the first. Quick and Upkeep don't count.</li>
<li>A Fortifying Technique, a ward or bonus until the caster's next turn, or a Quick trigger costs at least 8 XP.</li>
<li>Strain is floor(XP / 8).</li>
</ol>
<table><thead><tr><th>Effect</th><th>XP</th></tr></thead><tbody>
<tr><td>Stress</td><td>4</td></tr>
<tr><td>+N (this roll), &pm;N [Skill or Oppose]</td><td>6 x N</td></tr>
<tr><td>-N [target Attribute]</td><td>18 x N</td></tr>
<tr><td>Pierce N, Resistance +N</td><td>4 x N</td></tr>
<tr><td>Mend Xd4</td><td>16 x X</td></tr>
<tr><td>Lingering N</td><td>8 x N</td></tr>
<tr><td>Upkeep</td><td>4</td></tr>
<tr><td>Counter</td><td>12</td></tr>
</tbody></table>
<p>Beam or Wall reach costs 1 + 2 + ... per band; a Cone 3x that, a Radius 12x. Selective costs N + (R x N).</p>`),

p("Pricing an Instrument", `
<p>Base price by weight class: Light 15p, Medium 30p, Heavy 45p. Each Type adds: Edged, Blunt, Kinetic, Incorporeal, or Fortifying 5p; Pointed 10p; Drawn 25p; Fired 50p. Reach past the usual Range adds 10p a band (PHB 5.2.2).</p>
<p>A +N bonus adds by the item's size, and grants +N to rolls, plus Pierce equal to half the bonus, rounded down, on a Melee or Ranged Instrument. A Blocking-only Instrument's +N applies to Oppose rolls.</p>
<table><thead><tr><th>Bonus</th><th>Small</th><th>Medium</th><th>Large</th></tr></thead><tbody>
<tr><td>+1</td><td>8p</td><td>15p</td><td>30p</td></tr>
<tr><td>+2</td><td>23p</td><td>45p</td><td>90p</td></tr>
<tr><td>+3</td><td>68p</td><td>135p</td><td>270p</td></tr>
<tr><td>+4</td><td>200p</td><td>400p</td><td>800p</td></tr>
<tr><td>+5</td><td>600p</td><td>1200p</td><td>2400p</td></tr>
</tbody></table>
<p>An Arcane Instrument holds one <strong>Focus Gem</strong>, which gives its Techniques a damage type and adds its Tier to one Effect they already carry (PHB 5.2.3).</p>`),
]}
];
