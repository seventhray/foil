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
<li>Declare the <strong>Instrument</strong> and the <strong>Technique</strong>: one of the Instrument's built-in Techniques, or one the character has learned.</li>
<li>Name the Attribute it harms. Describe the action; the GM judges whether it fits.</li>
<li>Pick any of the three Skills the Instrument's Primary Attribute allows.</li>
<li>Pay the <strong>Action</strong>, or the <strong>Quick Action</strong> for a Quick-tagged Technique or a Light built-in after a Light Action. A Stress Technique through a Heavy Instrument takes both. A signature takes the Action.</li>
<li>Roll the Skill. The target Opposes with any Skill built on the Attribute under attack, or, against a Technique that deals no Stress, with any Skill built on the Attribute its Condition names. A kit roll that only applies a Condition says which.</li>
<li>If the Oppose beats the roll, the Technique fails. Otherwise it lands, a tie landing at a margin of 0.</li>
</ol>
<p>There is no separate damage roll. The <strong>margin</strong> the Technique won by becomes its Stress.</p>`),

p("Attributes, Potential, and Skills", `
<p>A character has four <strong>Attributes</strong>: Might and Finesse (physical), Wit and Presence (mental). Each is a pool of dice. Every Attribute starts at 2d4; an Origin and a Background add to them (PHB 2.5.0).</p>
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
<p><strong>Training</strong> costs 8 XP, plus 2 for each point the Skill already has. It can't pass the number of dice in the Skill's two pools.</p>
<p>A creature that isn't pushing back has a <strong>Passive Skill</strong> for each Skill: half the Skill's Potential, rounded down. It stands in as the Difficulty.</p>`),

p("Instruments, Types, and Properties", `
<p>An <strong>Instrument</strong> has one Range, one <strong>Primary Attribute</strong>, and a weight class. One that can harm has one <strong>Instrument Type</strong>, and many have <strong>Properties</strong> (PHB 4.1.1). The Primary Attribute sets which three Skills can roll it. No Type or Property adds Stress.</p>
<table><thead><tr><th>Type</th><th>Harms</th></tr></thead><tbody>
<tr><td>Melee</td><td>Might or Finesse</td></tr>
<tr><td>Ranged</td><td>Might or Finesse</td></tr>
<tr><td>Arcane</td><td>Might or Finesse through Kinetic, Wit or Presence through Incorporeal</td></tr>
<tr><td>Sonic</td><td>Wit or Presence. Its Conditions reach each hearer its user chooses within its Range. Its Stress lands on one target.</td></tr>
</tbody></table>
<table><thead><tr><th>Property</th><th>Effect</th></tr></thead><tbody>
<tr><td>Grappling</td><td>It can hold a creature</td></tr>
<tr><td>Guarding</td><td>It guards its user or an ally within its Range</td></tr>
<tr><td>Kinetic, Incorporeal</td><td>What an Arcane Instrument harms. With both, the user picks one for each Technique.</td></tr>
<tr><td>Thrown</td><td>A Melee Instrument with it is thrown out to Range 4</td></tr>
<tr><td>Drawn / Fired</td><td>Reload with the Quick Action / the Action</td></tr>
<tr><td>Immobile</td><td>Fixed in place</td></tr>
<tr><td>Tools</td><td>Its rolls are Trades</td></tr>
</tbody></table>
<p>A Melee, Ranged, or Sonic Instrument has two <strong>built-in Techniques</strong> (PHB 4.1.3). Most pair a Stress Technique with its family's <strong>signature</strong>. A signature costs the Action at any weight. A signature priced over 11 XP costs 1 Strain for each full 8 XP over. The third Skill <strong>backs</strong> Voice: while the Instrument is ready, Voice's Technique on that Skill gets +2 against a target within its Range. An Arcane Instrument has no built-ins.</p>
<p>Every character has three innate Instruments, always ready. <strong>Body</strong> is Might Primary, Light, Melee, Grappling, Range 1: Strike and Grapple, and it backs Threaten. <strong>Voice</strong> is Presence Primary, Light, Sonic, Range 8: Threaten, Deceive, and Persuade, each dealing Stress or applying one of two Conditions. <strong>Mind</strong> is Wit Primary, Light, Range 2: Deduce, Analyze, Intuit.</p>
<p>Light, Medium, and Heavy are weight classes. They set an Instrument's base price (15p, 30p, 45p) and its carried weight (2, 4, 8 lbs). A Heavy Instrument takes both hands. A Stress Technique through it costs the Action and the Quick Action, and its margin doubles before the cap. After an Action through a Light Instrument, the Quick Action can use a Light Instrument's built-in Technique other than a signature.</p>`),

p("Stress, Resistance, and Incapacitation", `
<p>When a Stress Technique lands (PHB 6.7.0):</p>
<ol>
<li>Take the margin, capped at a share of the Instrument's Primary Potential by its weight: <strong>half</strong> for Light, <strong>all</strong> for Medium, and <strong>all</strong> for Heavy after doubling. Only the margin is capped.</li>
<li>Add the Technique's own Effects, such as +1 Stress.</li>
<li>Subtract the target's Resistance, less any Pierce, to a minimum of 0.</li>
</ol>
<p><strong>Resistance</strong> comes in two kinds. Physical covers Might and Finesse. Mental covers Wit and Presence.</p>
<p><strong>Guard</strong> (PHB 6.5.1) costs the Quick Action, through a ready Guarding Instrument. It works on your turn, or when a Technique targets you or an ally within its Range, before the Oppose. For 1 round, the guarded character gets +2 to Oppose, and the Instrument's +N on top. It covers the Attributes the Instrument harms.</p>
<p>An Attribute is <strong>Incapacitated</strong> when its Stress reaches its Potential. It contributes no dice. Incapacitation lifts once healing brings its Stress down to half its Potential or less, rounded down. Stress past a full bar <strong>overflows</strong> onto another Attribute, the defender's choice, and the receiving Attribute's Resistance doesn't reduce it.</p>
<p><strong>Destroyed</strong> is all four Attributes Incapacitated at once. It is permanent, and a choice a side makes.</p>`),

p("Actions and Strain", `
<p>Each round a character gets one <strong>Action</strong> and one <strong>Quick Action</strong>. The Quick Action is spent on your turn or held to use reactively, one use either way. Moving up to 20 feet is free; another 20 costs the Quick Action. Initiative is an Acuity roll.</p>
<p>A learned Technique carries <strong>Strain</strong>: floor((XP - 24) / 8) Stress to its own user, on the Instrument's Primary Attribute, whether it lands or not, ignoring Resistance. A Technique under 32 XP carries none. A built-in Technique carries only the Strain it states.</p>`),

p("FOIL and Foil Tokens", `
<p>Four axes describe how a character responds in the moment: <strong>Faith</strong> (Trusting or Mistrusting), <strong>Order</strong> (Methodical or Intuitive), <strong>Individualism</strong> (Individual or Communal), and <strong>Levity</strong> (Light or Grave). Each leans toward one end or stays Neutral (PHB 3.1.0).</p>
<p>Once per scene a player may <strong>invoke</strong> a Habit their character holds. If the table agrees the Habit drives what the character is doing, they earn a <strong>Foil Token</strong>. A character holds at most four.</p>
<p>A Foil Token is spent at will: halve the Stress from one source, rounded down, or reroll any one die right after rolling a Skill. The new result stands.</p>`),

p("Ending a conflict, resting, toil", `
<p>A conflict ends when one side stops contesting it. <strong>Flee</strong>: Disengage and move away; each chaser rolls Prowess against the fleer every round, and the winner moves up to Range 2. <strong>Yield</strong>: stop fighting and accept terms. <strong>Destroy</strong>: keep going until every Attribute is Incapacitated. <strong>Terms</strong>: press for an end with social Conditions.</p>
<p><strong>Rest</strong> removes 1d4 Stress every 2 hours from one Attribute of the character's choice. It starts by eating one ration, which covers up to 8 hours of recovery; without one, the time passes but heals nothing.</p>
<p><strong>Toil</strong> is effort sustained over stretches of about 8 hours, such as travel or labor. Each stretch is one roll for the party: Prowess for heavy work or very difficult terrain, Acuity to find the way or to search, Discipline otherwise. A character whose Passive in that Skill meets the Difficulty succeeds without rolling. A stretch costs 1 Strain on every Attribute, 2 on a failure. Each 2 hours past 8 without a rest adds 1 more. Strain ignores Resistance, and no one can Toil while it would take an Attribute past its Potential. A stretch of travel is a <strong>leg</strong>.</p>
<p><strong>Gathering</strong> (PHB 5.3.3) takes 2 hours and a Trade roll through a gathering Tool: food yields 1 ration plus 1 per 4 points of margin, and a Herbalist's Satchel or Craft Tool finds a batch of material at a Tier the region holds, plus 1 per 8 points of margin.</p>
<p><strong>Mass</strong>: past 4x Might Potential in pounds, every roll takes -1 per extra multiple, and each stretch of Toil adds that much Strain.</p>`),
]},

{
  name: "2 · The Sheets, Field by Field",
  pages: [
p("Character sheet", `
<table><thead><tr><th>Field</th><th>What it is</th></tr></thead><tbody>
<tr><td><strong>Create</strong></td><td>Builds a starting character in one window, following PHB 2.5.0: pick an Origin and a Background and see what each grants, roll Talent one die at a time and watch each die grow, preview the dice, Training, and Resistance, set FOIL traits (pick, roll, or write), and answer the prompts. Adds Body and Voice.</td></tr>
<tr><td><strong>Drag and drop</strong></td><td>Drop any Item from the sidebar or a compendium onto the sheet. A dropped Origin or Background replaces the old one.</td></tr>
<tr><td><strong>Advance</strong></td><td>Spends XP: a die one size the Attribute's Potential, d12 to d20 4 times it as a Transformation (PHB 2.3.1), a new 1d4 2 times it, +1 Training 8 XP plus 2 per point held, or a Technique or Feat at its listed XP.</td></tr>
<tr><td><strong>Attribute Dice</strong></td><td>How many of each die size sit in the pool. The system builds the formula and Potential.</td></tr>
<tr><td><strong>Stress, Potential</strong></td><td>The Stress on the Attribute, beside its Potential. When Stress reaches Potential the Attribute is Incapacitated; it recovers once Stress falls to the amount shown.</td></tr>
<tr><td><strong>Resistance</strong></td><td>Derived from equipped armor and wards, a carried Shield, and Feats, with what granted it.</td></tr>
<tr><td><strong>Skills</strong></td><td>Formula, Training (with its cap), Passive Skill, and roll range. Click to roll.</td></tr>
<tr><td><strong>Foil Tokens</strong></td><td>Earn one on an invoke; <em>Halve Stress</em> spends one.</td></tr>
<tr><td><strong>Rations, Carried</strong></td><td>Rations weigh 2 lbs each. Carried turns red with its roll penalty once over 4x Might Potential.</td></tr>
<tr><td><strong>Location</strong></td><td>Each Instrument and piece of Equipment is equipped, carried, or stored; click its icon to change it. Only equipped gear grants its Resistance or bonus, though a carried Shield does too. Stored gear weighs nothing, and a Heavy Instrument warns when something else is also in hand. Switching to a carried Instrument costs the Quick Action.</td></tr>
<tr><td><strong>Techniques</strong></td><td>Lists every built-in Technique of the character's Instruments, with the Instrument it comes from, above the learned ones. Each learned Technique lists the Instruments it can be used with, equipped ones first; stored ones never count.</td></tr>
<tr><td><strong>FOIL</strong></td><td>A lean and a Habit per axis.</td></tr>
<tr><td><strong>Conditions</strong></td><td>Active Conditions, with rounds and a note.</td></tr>
</tbody></table>
`),

p("Creature sheet", `
<p>A creature uses the same Attributes, Skills, Stress, and Incapacitation. Its own fields: <strong>Tier</strong>, <strong>Behavior</strong> (what it does once an Attribute is Incapacitated, GMG 9.8.0), and a typed <strong>Resistance</strong>. <strong>Total Potential</strong>, the four Potentials summed, shows as GM shorthand. The <strong>Creature Generator</strong> button in the Actors directory (GM only) turns a Threat, a tier, a CR, or a whole d20 stat block (CR, ability scores, AC) into Potentials, dice, Allowance, Ceiling, Training, and a Resistance budget (GMG 9.1.0 to 9.3.0), and creates the creature with them set.</p>`),

p("What the system does for you", `
<p>Foilbound on Foundry stays close to pen and paper. It derives values and rolls dice. Three things are automated:</p>
<ul>
<li><strong>Strain</strong> lands on the Instrument's Primary Attribute when a learned Technique or a signature with Strain is rolled.</li>
<li>A Stress Technique's chat card has a <strong>Stress</strong> button. Enter the target's Oppose and Resistance, and it reports the Stress. Applying it to the target stays manual.</li>
<li><strong>Foil Token</strong> spends: halve one source's Stress from the sheet, or reroll one die from any roll's chat card.</li>
</ul>
<p>It does not roll Opposes, apply Stress to a target, adjudicate Conditions, or move Habits.</p>`),
]},

{
  name: "3 · Building Content",
  pages: [
p("The vocabulary", `
<p>Instrument Types, Properties, and Effects are ordinary Items in the <em>FOIL Vocabulary</em> compendiums. Content refers to them by slug, so creating a new one in a world makes it available on every sheet at once.</p>
<ul>
<li><strong>Instrument Type or Property</strong>: whether it is a Type or a Property, its family, what it harms, and flags for Quick, Reload, and Tools.</li>
<li><strong>Property</strong>: a passive Equipment Property, Resistance +N, +N to a Skill, or Aid +N.</li>
<li><strong>Effect</strong>: how it prices, which Types can deliver it, and whether it counts toward the combination premium.</li>
</ul>`),

p("Pricing a Technique", `
<p>A Technique's XP is priced from its Effects (PHB 4.2.1), and the sheet shows the computed price beside the printed one.</p>
<ol>
<li>Sum the Effects. Stress is an Effect at 4 XP.</li>
<li>A Pattern, Selective, or Extend Range is priced by Range and counts as an Effect.</li>
<li>Add 4 XP for every Effect beyond the first. Quick and Upkeep don't count; Upkeep costs a flat 4 XP and Quick 3.</li>
<li>A Technique that aims only at allies or its user, a ward or bonus lasting 1 round or longer, or a Quick trigger costs at least 8 XP.</li>
<li>A Sonic Technique with a Condition adds 8 XP for its reach (PHB 4.2.4).</li>
<li>Strain is floor((XP - 24) / 8), never below 0. A Selective Technique, or a Sonic Technique with a Condition, takes its Strain from its XP less the 8 XP charge.</li>
</ol>
<table><thead><tr><th>Effect</th><th>XP</th></tr></thead><tbody>
<tr><td>Stress</td><td>4</td></tr>
<tr><td>+N (this roll)</td><td>2 x N</td></tr>
<tr><td>+N [Skill or Oppose]</td><td>3 x N, or 6 x N for 1 minute</td></tr>
<tr><td>-N [Oppose]</td><td>4 x N, or 16 x N for 1 minute</td></tr>
<tr><td>-N [target Attribute]</td><td>6 x N, or 24 x N for 1 minute</td></tr>
<tr><td>Pierce N, Resistance +N</td><td>4 x N</td></tr>
<tr><td>Mend Xd4</td><td>10 x X</td></tr>
<tr><td>Remove [Condition]</td><td>the Condition's price</td></tr>
<tr><td>Lingering N</td><td>7 x N</td></tr>
<tr><td>Upkeep / Quick</td><td>4 / 7</td></tr>
<tr><td>Hasten (Action) / (Quick Action)</td><td>14 / 7</td></tr>
<tr><td>Prone / Controlled</td><td>7 / 21</td></tr>
<tr><td>Counter</td><td>12</td></tr>
</tbody></table>
<p>Beam or Wall costs 1 + 2 + ... per rung of the Range ladder (Range 1, 2, 4, 8, 20); a Cone 3x that, a Radius 12x. Selective costs N + (R x N).</p>`),

p("Pricing an Instrument", `
<p>Base price by weight class: Light 15p, Medium 30p, Heavy 45p. Each Property other than Tools and Immobile adds 10p. Reach past the usual Range adds 10p a band (PHB 5.2.2).</p>
<p>A +N bonus adds by the item's size, and grants +N to rolls. A Melee or Ranged Instrument also gets Pierce equal to half the bonus, rounded down. A Guarding Instrument's +N also adds to the Oppose it guards.</p>
<table><thead><tr><th>Bonus</th><th>Small</th><th>Medium</th><th>Large</th></tr></thead><tbody>
<tr><td>+1</td><td>8p</td><td>15p</td><td>30p</td></tr>
<tr><td>+2</td><td>23p</td><td>45p</td><td>90p</td></tr>
<tr><td>+3</td><td>68p</td><td>135p</td><td>270p</td></tr>
<tr><td>+4</td><td>200p</td><td>400p</td><td>800p</td></tr>
<tr><td>+5</td><td>600p</td><td>1200p</td><td>2400p</td></tr>
</tbody></table>`),
]}
];
