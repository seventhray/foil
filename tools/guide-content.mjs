/**
 * tools/guide-content.mjs
 * In-app user guide, seeded into the `guide` JournalEntry compendium by
 * populate-packs.mjs. Written against Foilbound v0.2.0: every number here is
 * the printed one, so this file has to move whenever the books do.
 *
 * Three journals, aimed at three different readers: someone learning the game,
 * someone reading a sheet, and someone authoring new content.
 */

const p = (name, html) => ({ name, html });

export const GUIDE = [
{
  name: "1 · How Foilbound Plays",
  pages: [
p("The one loop", `
<p>Every contest in Foilbound runs the same loop, whether it is a duel, an argument, or a crisis of belief.</p>
<ol>
<li><strong>Declare</strong> the Instrument you are using, and any Technique you know that adds to it.</li>
<li><strong>Pick</strong> which Attribute you are harming. A physical Instrument Type harms <em>Might or Finesse</em>; a Sonic or Incorporeal one harms <em>Wit or Presence</em>. The attacker chooses.</li>
<li><strong>Pay</strong> the Instrument's AP, set by its Weight.</li>
<li><strong>Roll</strong> the Aptitude, plus any roll modifier.</li>
<li><strong>The target Opposes</strong> with any Aptitude built on the Attribute under attack.</li>
<li><strong>If your total is higher</strong>, the difference is the <strong>margin</strong>, and the margin is the damage.</li>
</ol>
<p>The defender wins ties. There is no separate damage roll: the roll that decided whether the Technique landed also decides how hard.</p>`),

p("Attributes, Potential, and Aptitudes", `
<p>A character has four <strong>Attributes</strong>: Might, Finesse, Wit, and Presence. Each is a pool of dice, not a score.</p>
<p><strong>Potential</strong> is the highest total that pool can roll, and it doubles as how much Stress the Attribute can absorb before it gives out. <strong>Health</strong> is all four Potentials added together, which is 36 for a starting character.</p>
<p>Six <strong>Aptitudes</strong> pair the Attributes, using each pair exactly once. To roll one, roll both pools and add that Aptitude's Training.</p>
<table><thead><tr><th>Aptitude</th><th>Attributes</th><th>Represents</th></tr></thead><tbody>
<tr><td>Prowess</td><td>Might + Finesse</td><td>Athletics, martial arts, power</td></tr>
<tr><td>Fortitude</td><td>Might + Wit</td><td>Endurance, willpower, grit</td></tr>
<tr><td>Command</td><td>Might + Presence</td><td>Intimidation, authority, confidence</td></tr>
<tr><td>Acuity</td><td>Finesse + Wit</td><td>Perception, awareness, foresight</td></tr>
<tr><td>Guile</td><td>Finesse + Presence</td><td>Maneuvering, deception, misdirection</td></tr>
<tr><td>Resonance</td><td>Wit + Presence</td><td>Insight, persuasion, connection</td></tr>
</tbody></table>
<p><strong>Training</strong> is a flat bonus to one Aptitude's rolls. It costs 4 XP a point and stops at +4.</p>`),

p("Instruments and Weight", `
<p>An <strong>Instrument</strong> is the platform a Technique is performed through: a blade, a bow, a spell focus, a cruel voice, a pair of hands. It carries one <strong>Weight</strong>, one <strong>Range</strong>, and one or more <strong>Instrument Types</strong>.</p>
<p>Weight sets how much of a landed Technique's margin becomes Stress, and what it costs in AP. There is no minimum: a Technique that barely gets through barely hurts.</p>
<table><thead><tr><th>Weight</th><th>Stress</th><th>A landed Technique deals</th><th>AP</th></tr></thead><tbody>
<tr><td>Light</td><td><strong>0.5x</strong></td><td>half the margin, rounded up</td><td>1</td></tr>
<tr><td>Medium</td><td><strong>1.0x</strong></td><td>the whole margin</td><td>2</td></tr>
<tr><td>Heavy</td><td><strong>1.5x</strong></td><td>the margin plus half again, rounded down, and inherent Pierce 1</td><td>3</td></tr>
</tbody></table>
<p>The longhand is here because this is where Weight is explained. Everywhere else, on a sheet or an Instrument, it is written as the multiplier.</p>
<p>The three come out even over a turn. Light attacks three times for 1 AP each and takes half the margin; Heavy attacks once for 3 AP and takes half again on top. Weight is a choice about rhythm and reach.</p>`),

p("Instrument Types", `
<p>An Instrument Type sets which Aptitude rolls it and what kind of harm it does. Everything else follows from two rules that need no lookup.</p>
<p><strong>Body or mind.</strong> Melee, Ranged, Grappling, and Kinetic harm the body, so they deal their Stress to Might or Finesse. Sonic and Incorporeal harm the mind, so they deal it to Wit or Presence. The attacker picks which of the pair. Nothing physical reaches a mind and nothing spoken or hexed reaches a body, so no pair of Attributes covers everything.</p>
<p><strong>Opposing.</strong> A target Opposes with <em>any Aptitude built on the Attribute under attack</em>. Every Attribute belongs to three of the six Aptitudes, so there are always three answers. Prowess is Might and Finesse together, so Prowess always answers a physical attack; Resonance is Wit and Presence together, so Resonance always answers a mental one.</p>
<p>Which Aptitude rolls a type follows its family: Melee, Grappling, and Parry roll Prowess; Ranged rolls Acuity; each Sonic channel rolls the Aptitude it shares a name with; Arcane channels offer a choice of two; Blocking rolls Fortitude.</p>
<p>Resonance and Fortifying harm nobody, Blocking and Parry defend, and Tool types are never used against a creature at all.</p>`),

p("Techniques, Effects, and Strain", `
<p>Any Instrument delivers its base effect for free. A <strong>Technique</strong> is what a character learns to do on top of that, and it is priced in XP from its <strong>Effects</strong>.</p>
<p>Effect XP sums, plus <strong>4 XP for every effect beyond the first</strong>. Stress never counts toward that total: it is free on any attack-type Instrument and sits outside a Technique's priced effects entirely.</p>
<p>Roll modifiers (the sign-keyed <strong>&pm;N</strong> effect, and the single-roll <strong>+N</strong>) cost <strong>6 XP per point</strong>. Stress modifiers (Pierce, Resistance) cost <strong>4</strong>. A Technique through a Parry, Blocking, or Fortifying Instrument Type costs at least 8 XP whatever its effects sum to.</p>
<p><strong>Strain</strong> is floor(XP / 16) self-Stress on any conflict use, landing on one of the two Attributes rolled, the user's choice. It ignores Resistance. A Technique's Potential gate is 12 + 4 x floor(XP / 16), for anything 12 XP or more: 12-15 XP requires Potential 12, 16-31 requires 16, 32-47 requires 20, 48-63 requires 24.</p>`),

p("Stress, Resistance, and Incapacitation", `
<p><strong>Stress</strong> is a counter on each Attribute, capped at its Potential.</p>
<p><strong>Resistance</strong> comes in two kinds. Physical covers Might and Finesse together; mental covers Wit and Presence together. One suit of armor protects the whole body; one ward steadies the whole mind. A character can carry one of each.</p>
<p>An Attribute is <strong>Incapacitated</strong> when its Stress meets its Potential. It contributes no dice to anything, though it can still be targeted, and further Stress <strong>overflows</strong> to an Attribute with room, the defender's choice, without a second Resistance.</p>
<p>Having any one Attribute Incapacitated usually marks where a conflict is decided. That Attribute fed three of the six Aptitudes, so a third of everything they can roll is gone, and if their attacks were built on it, half their offense went too. The badge on its card is how you see it — there is no separate status layered on top.</p>
<p><strong>Destroyed</strong> is all four at once, and it is permanent. It is a choice a side makes, not the natural end of a fight.</p>`),

p("Ending a conflict", `
<p>A conflict ends when one side stops contesting it, which is almost never the moment every Attribute empties. Once a side has an Attribute Incapacitated, there are three ordinary ways out.</p>
<ul>
<li><strong>Flee.</strong> Spend turns Disengaging and moving away by the shortest route open to you. Oppose normally, start no Techniques. Cornered with nowhere to go, you fight on.</li>
<li><strong>Yield.</strong> Either side may concede at any point. The conflict ends at once, the yielding side takes no further Stress, and the winner states terms.</li>
<li><strong>Destroy.</strong> Keep going until every Attribute is at zero.</li>
</ul>
<p>Creatures carry a <strong>Behavior</strong> Trait saying which they take and when. See the third journal for the full list.</p>`),

p("The FOIL axes", `
<p>Four axes describe how a character meets the world: <strong>Faith</strong> (Mistrusting to Trusting), <strong>Order</strong> (Disordered to Ordered), <strong>Individualism</strong> (Communal to Individual), and <strong>Levity</strong> (Grave to Light). Each runs from -5 to +5.</p>
<p>Once per scene a player may <strong>Invoke</strong> one or more axes on a roll, adding how far each sits from neutral. The bonus applies whether the roll succeeds or not: on a success each invoked axis moves 1 point further toward its held pole, and on a failure each axis moves 1 point back toward neutral instead. Lean on a value for something ordinary and it mostly holds and grows; lean on it for something Daunting and it mostly does not.</p>
<p>An axis at <strong>0</strong> is not a conviction yet and cannot be Invoked. It can be <strong>named</strong>: describe the character acting decisively along one pole, and on a success it moves 1 point that way. Naming is free and adds nothing to the roll.</p>
<p><strong>A GM never moves a value</strong> and has no mechanical move against one. Convictions are tested by what a character tries and what the dice say about it — a failed Invoke shakes one without anyone choosing to. A GM presses on convictions in the fiction alone — a Trusting character is the one who gets lied to — with no roll and no axis change.</p>
<p>A creature or NPC can carry its own axis too, printed as a <strong>Values</strong> line. It works as fiction only, until a player character invokes the same axis against it — a <strong>Contest of Conviction</strong>: both sides add their axis's distance from neutral, and the loser's axis moves 1 point toward neutral, or 2 if the margin was 8 or more. It's the only way a stat block's Values line does anything mechanical.</p>`),
]},

{
  name: "2 · The Sheets, Field by Field",
  pages: [
p("Character sheet", `
<p>Every field, and where its number comes from.</p>
<table><thead><tr><th>Field</th><th>What it is</th></tr></thead><tbody>
<tr><td><strong>Attribute Dice</strong></td><td>How many of each die size sit in that Attribute's pool. You type the counts; the system builds the formula.</td></tr>
<tr><td><strong>Max</strong></td><td>Derived. The highest total the pool can roll, and the Attribute's Stress capacity.</td></tr>
<tr><td><strong>Current</strong></td><td>You track this. It falls as Stress lands. At 0 the Attribute is Incapacitated, and the card says so in a badge across its face.</td></tr>
<tr><td><strong>Physical Resistance</strong></td><td>Derived, covering Might and Finesse. Nothing to type: it is whatever your equipped armor, shields, and Feats grant. The total comes first, then what granted it (<em>6 &nbsp;+2 Tower Shield, +2 Mail, +1 Leather</em>). Hover for the full list if it runs long.</td></tr>
<tr><td><strong>Mental Resistance</strong></td><td>The same for Wit and Presence, from equipped wards and Feats.</td></tr>
<tr><td><strong>Resistance on a creature</strong></td><td>GM-stated rather than granted, so the creature sheet keeps an editable field for each kind.</td></tr>
<tr><td><strong>Training</strong></td><td>Per Aptitude, 0 to 4. Backgrounds and Feats add on top and show as a separate bonus.</td></tr>
<tr><td><strong>Min / Avg / Max</strong></td><td>Derived. What that Aptitude can roll right now, Training included. An Incapacitated Attribute contributes nothing, so the range narrows as a character takes damage.</td></tr>
<tr><td><strong>XP total / unspent</strong></td><td>Total awarded, and what is left after purchases.</td></tr>
<tr><td><strong>FOIL values</strong></td><td>Faith, Order, Individualism, Levity, each -5 to +5.</td></tr>
</tbody></table>
<p>There is no Health field. Health is the four Potentials added together, and reading them is the same information.</p>`),

p("Creature sheet", `
<p>A creature uses the same four Attributes, the same Stress and incapacitation rules, and 3 AP per round. Its own fields:</p>
<table><thead><tr><th>Field</th><th>What it is</th></tr></thead><tbody>
<tr><td><strong>Tier</strong></td><td>A number from 1 to 10 (and up). Sets the starting Attribute die.</td></tr>
<tr><td><strong>Threat</strong></td><td>One line on what it does at the table.</td></tr>
<tr><td><strong>Behavior</strong></td><td>What it does when an Attribute is Incapacitated. Free text so a conditional Trait can name its own bracket, e.g. <em>Territorial [its lair], Craven</em>.</td></tr>
<tr><td><strong>Resistance</strong></td><td>Physical and mental. Typed directly here, unlike a character's, which is derived from what they are wearing.</td></tr>
</tbody></table>
<p>A creature's Training applies only to the Aptitudes its own Techniques use. Its Techniques carry XP costs purely to place them on the pricing scale; NPCs do not spend XP.</p>`),

p("Resting", `
<p>Rest mends <strong>one Attribute at a time</strong>, chosen by the character, at <strong>1d4</strong> a go (PHB §6.10.0). The clock is what differs:</p>
<ul>
<li><strong>Physical Stress</strong>, on Might and Finesse, mends per <strong>hour</strong> of rest.</li>
<li><strong>Mental Stress</strong>, on Wit and Presence, mends per <strong>night</strong>. A night is also eight hours, so an hourly Attribute mends alongside it.</li>
</ul>
<p>Rest alone is slow on purpose. Anything faster is a Technique. The <strong>Mend</strong> effect removes Xd6 Stress from an Attribute outright and works on either kind: through <strong>Fortifying</strong> it is a caster's business (Healing Word, Restoring Light), and through <strong>Resonance</strong> it is talking someone back (Steady, Talk Down). A party with neither waits out the night.</p>
<p>This gives Strain placement teeth. Strain lands on one of the two Attributes rolled, the caster's choice, and every Aptitude except <strong>Resonance</strong> pairs a physical Attribute with a mental one. Put it on the body and an hour clears it; put it on the mind and it is there until morning.</p>
<p>The <strong>Rest</strong> button on the sheet lists whichever Attributes are down, asks which to tend and for how long, applies the right clock for that Attribute's kind, caps at its maximum, and posts what mended.</p>`),

p("What the system does for you", `
<p>Foilbound on Foundry is deliberately close to pen and paper. It computes derived values and rolls dice pools. It does not adjudicate.</p>
<p><strong>It computes:</strong> Potential from a dice pool, Health, incapacitation thresholds, an Aptitude's net Potential, Training and Resistance totals including item bonuses, XP available, and a Technique's XP and Strain from its Effects.</p>
<p><strong>It automates three things.</strong> Rolling a Technique that carries Strain prompts for which Attribute it lands on and applies it. A landed Technique's chat card carries a <strong>Stress</strong> button: click it, enter the target's Oppose total, and it works out the margin, applies the Weight term, adds any rider, and reports the result. And the <strong>Rest</strong> button on both actor sheets asks for hours and whether the rest ran through the night, then mends by kind.</p>
<p><strong>It does not:</strong> roll Opposes for you, apply Stress to a target, move FOIL axes, or track conditions. Those stay at the table, on purpose.</p>`),
]},

{
  name: "3 · Building Content",
  pages: [
p("How the vocabulary fits together", `
<p>The system separates <em>vocabulary</em> from <em>content</em>. Vocabulary items define the words; content items reference them by slug. That means a table can add its own Instrument Type or Effect and everything downstream understands it.</p>
<ul>
<li><strong>Vocabulary packs:</strong> Instrument Types, Qualities, Effects.</li>
<li><strong>Content packs:</strong> Instruments, Techniques, Feats, Equipment, Backgrounds, Ancestries.</li>
</ul>
<p>Every vocabulary item has a <strong>key</strong>, a lowercase slug. Leave it blank and it is generated from the name. Content references that key, so renaming an item is safe but changing its key is not.</p>`),

p("Instrument Type fields", `
<table><thead><tr><th>Field</th><th>What it does</th></tr></thead><tbody>
<tr><td><strong>Key</strong></td><td>The slug Instruments and Techniques reference, e.g. <code>edged</code>.</td></tr>
<tr><td><strong>Casting Aptitude</strong></td><td>Which Aptitude rolls it. Accepts <code>varies</code>, or two separated by a slash for the Arcane channels.</td></tr>
<tr><td><strong>Is a Tool type</strong></td><td>Marks it as a trade type: never used against a creature, always rolled against a Difficulty.</td></tr>
<tr><td><strong>Bonus Stress</strong></td><td>A flat rider added to a landed hit on top of the Weight term. Only Fired has one, at +2.</td></tr>
<tr><td><strong>Harms</strong></td><td><em>Physical</em> (Might or Finesse), <em>mental</em> (Wit or Presence), or neither for support and Tools. The attacker picks which Attribute of the pair.</td></tr>
</tbody></table>
<p>There is no Target field and no Oppose field. Target became this body-or-mind call, and Oppose is derived from the Attribute the attacker aimed at.</p>`),

p("Effect fields and pricing", `
<p>An Effect definition tells the pricing engine how to charge for it.</p>
<table><thead><tr><th>Field</th><th>What it does</th></tr></thead><tbody>
<tr><td><strong>Pricing kind</strong></td><td><code>linear</code> (base + perPoint × magnitude), <code>flat</code>, <code>condition</code>, <code>pattern</code>, <code>selective</code>, <code>extendRange</code>, <code>upkeep</code>, <code>reaction</code>.</td></tr>
<tr><td><strong>base / perPoint</strong></td><td>The two numbers a linear effect prices from. The &pm;N roll modifier is perPoint 6; Pierce and Resistance are 4.</td></tr>
<tr><td><strong>Exempt from premium</strong></td><td>The effect does not count toward the 4 XP per extra effect. Stress, Upkeep, and Reaction are exempt.</td></tr>
<tr><td><strong>Sets floor</strong></td><td>The effect imposes a minimum XP on the whole Technique. Reaction sets 8.</td></tr>
<tr><td><strong>Requires</strong></td><td>Instrument Type slugs this effect can be delivered through. Blank means any.</td></tr>
</tbody></table>
<p>A Technique's XP is the sum of its effects, plus 4 for each effect past the first, raised to any floor. Strain and the Potential gate then derive from that total, so you never set them by hand.</p>`),

p("Behavior Traits", `
<p>A creature's Behavior says what it does when an Attribute is Incapacitated. No roll: the Trait is the rule. Every Trait resolves to one of four behaviors.</p>
<table><thead><tr><th>Behavior</th><th>What it does</th></tr></thead><tbody>
<tr><td><strong>Hold</strong></td><td>Fights on as normal. What a creature with no Trait does.</td></tr>
<tr><td><strong>Flee</strong></td><td>Disengages and moves off each turn. Opposes normally, starts no Techniques. Cornered, it Holds.</td></tr>
<tr><td><strong>Berserk</strong></td><td>Attacks the nearest living thing. Will not Flee or Yield, and fights until Destroyed.</td></tr>
<tr><td><strong>Yield</strong></td><td>The conflict ends for it at once. No further Stress; the winner states terms.</td></tr>
</tbody></table>
<table><thead><tr><th>Trait</th><th>Behavior</th></tr></thead><tbody>
<tr><td><strong>Craven</strong></td><td>Flees when any one Attribute is Incapacitated.</td></tr>
<tr><td><strong>Simpleminded</strong></td><td>Flees if Might or Finesse goes first. Goes Berserk if Wit or Presence goes first.</td></tr>
<tr><td><strong>Disciplined [commander]</strong></td><td>Holds while the named commander is present with no Attribute Incapacitated. Flees when the commander has an Attribute Incapacitated, falls, or leaves.</td></tr>
<tr><td><strong>Pack-Bound [pack]</strong></td><td>Holds while more than half the pack has no Attribute Incapacitated. Flees once that's no longer true for half or more of it.</td></tr>
<tr><td><strong>Opportunist</strong></td><td>Flees when it has an Attribute Incapacitated, or when any ally does, whichever is first.</td></tr>
<tr><td><strong>Territorial [place]</strong></td><td>Inside the named place, Holds even with an Attribute Incapacitated and fights to Destruction rather than leave. Outside it, Flees the moment an Attribute is Incapacitated.</td></tr>
<tr><td><strong>Venal</strong></td><td>Yields the moment an Attribute is Incapacitated, if it has something to bargain with.</td></tr>
<tr><td><strong>Zealous</strong></td><td>Never Flees, never Yields. Goes Berserk the moment an Attribute is Incapacitated.</td></tr>
<tr><td><strong>Mindless</strong></td><td>Cannot Flee, Yield, or be reasoned with. Holds until Destroyed.</td></tr>
<tr><td><strong>Bound [binding]</strong></td><td>Cannot Flee or Yield while the binding holds. Behaves as Craven the moment it ends.</td></tr>
<tr><td><strong>Emboldening</strong></td><td>No behavior of its own tied to Incapacitation. While it has no Attribute Incapacitated, allies within Near Hold regardless of their own Traits.</td></tr>
</tbody></table>
<p>Fill in every bracket; an unfilled one does nothing. A creature may carry several, listed in order, and the first whose condition applies governs.</p>`),

p("Building a creature", `
<p>Six decisions build a creature from nothing (GMG §4.0.0). A creature converted from another system reaches the same place by the same steps.</p>
<p><strong>1. Pick the tier.</strong> It sets a baseline Potential every Attribute starts from; four times that is Health.</p>
<table><thead><tr><th>Tier</th><th>Baseline</th><th>Die</th><th>Health</th><th>Threat</th></tr></thead><tbody>
<tr><td>1</td><td>4</td><td>1d4</td><td>16</td><td>Dangerous only in numbers</td></tr>
<tr><td>2</td><td>6</td><td>1d6</td><td>24</td><td>Appropriate for new characters</td></tr>
<tr><td>3</td><td>8</td><td>1d8</td><td>32</td><td>Near parity with a starting character</td></tr>
<tr><td>4</td><td>10</td><td>1d10</td><td>40</td><td>Genuine threat to starting characters</td></tr>
<tr><td>5</td><td>12</td><td>1d12</td><td>48</td><td>Starting characters should think carefully</td></tr>
<tr><td>6</td><td>16</td><td>2d8</td><td>64</td><td>A hard fight for a seasoned party</td></tr>
<tr><td>7</td><td>20</td><td>1d20</td><td>80</td><td>Likely lethal to the unprepared</td></tr>
<tr><td>8</td><td>24</td><td>2d12</td><td>96</td><td>A real risk even at full strength</td></tr>
<tr><td>9</td><td>28</td><td>1d20+1d8</td><td>112</td><td>Overwhelming without real coordination</td></tr>
<tr><td>10</td><td>34</td><td>1d20+1d8+1d6</td><td>136</td><td>Set-piece; requires coordinated effort</td></tr>
</tbody></table>
<p><strong>2. Shade the spread.</strong> One step is 2 Potential. No Attribute moves more than two steps off the baseline, and finished Health should land within one step of the tier's number.</p>
<p><strong>3 to 6.</strong> Resistance, Training, a Technique allowance, and a Behavior Trait, all by tier:</p>
<table><thead><tr><th>Tier</th><th>Resistance budget</th><th>Training</th><th>Allowance</th><th>Ceiling</th></tr></thead><tbody>
<tr><td>1</td><td>0</td><td>+0</td><td>4 XP</td><td>4 XP</td></tr>
<tr><td>2</td><td>0</td><td>+1</td><td>12 XP</td><td>8 XP</td></tr>
<tr><td>3</td><td>8</td><td>+1</td><td>16 XP</td><td>12 XP</td></tr>
<tr><td>4</td><td>16</td><td>+2</td><td>40 XP</td><td>24 XP</td></tr>
<tr><td>5</td><td>16</td><td>+2</td><td>64 XP</td><td>32 XP</td></tr>
<tr><td>6</td><td>16</td><td>+2</td><td>88 XP</td><td>38 XP</td></tr>
<tr><td>7</td><td>24</td><td>+3</td><td>112 XP</td><td>44 XP</td></tr>
<tr><td>8</td><td>24</td><td>+3</td><td>136 XP</td><td>48 XP</td></tr>
<tr><td>9</td><td>32</td><td>+3</td><td>160 XP</td><td>52 XP</td></tr>
<tr><td>10</td><td>32</td><td>+3, or +4 at the top</td><td>184 XP</td><td>56 XP</td></tr>
</tbody></table>
<p>Resistance is a spendable budget (GMG &sect;4.3.0), not a flat number, and no single value in one scope climbs past the tier's own cap. Training applies only to the Aptitudes the creature's own attacks roll.</p>
<p>The Technique ceiling matters because <strong>Strain applies to creatures too</strong>: floor(XP / 16) self-Stress every conflict use. A creature handed something far past its ceiling spends its own Health faster than the party can. Anything an Instrument does for free stays free, so a creature with a greatsword needs no Technique to swing it.</p>`),

p("Advancement costs", `
<table><thead><tr><th>Purchase</th><th>XP</th></tr></thead><tbody>
<tr><td>Advance one Attribute die one size (d4 up to d12)</td><td>8</td></tr>
<tr><td>Advance a d12 to d20</td><td>36</td></tr>
<tr><td>Add a 1d4 to an Attribute pool</td><td>18</td></tr>
<tr><td>Increase one Aptitude's Training by +1 (max +4)</td><td>4</td></tr>
<tr><td>Learn a Technique or Feat</td><td>its listed cost</td></tr>
</tbody></table>
<p>A GM award of 20 XP for a standard session buys 5 points of Potential, one 12 XP Feat with 8 left over, two die-size advances with 4 left over, or five points of Training.</p>`),
]},
];
