/**
 * rules/flow.js
 * How the roll and Oppose flows run. A flow is a generator: it yields one request at a time, [name, ...args], for
 * something only the host can do (ask the player, roll a die, post a card, lower a Potential), and receives the
 * answer. Two drivers carry the requests out:
 *
 *   driveAsync(flow, io)   awaits each io[name](...args). Foundry uses it, where answers come from dialogs.
 *   driveSync(flow, io)    calls each io[name](...args) at once. A SpacetimeDB reducer uses it. A reducer must stay
 *                          synchronous: an error thrown after an await does not roll back the writes before it, so
 *                          nothing here awaits, and a missing choice is thrown as an error that the reducer rolls back.
 */

export async function driveAsync(flow, io) {
  let step = flow.next();
  while (!step.done) {
    const [name, ...args] = step.value;
    if (typeof io[name] !== "function") throw new Error(`the host cannot do "${name}"`);
    let answer;
    try { answer = await io[name](...args); } catch (err) { step = flow.throw(err); continue; }
    step = flow.next(answer);
  }
  return step.value;
}

export function driveSync(flow, io) {
  let step = flow.next();
  while (!step.done) {
    const [name, ...args] = step.value;
    if (typeof io[name] !== "function") throw new Error(`the host cannot do "${name}"`);
    let answer;
    try { answer = io[name](...args); } catch (err) { step = flow.throw(err); continue; }
    step = flow.next(answer);
  }
  return step.value;
}
