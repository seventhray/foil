/**
 * src/data/fields.js
 * Shared DataModel field helpers for the FOIL system.
 */

const f = foundry.data.fields;

/** A slug string: lowercase key used to reference a definition in the registry. */
export function slugField(initial = "") {
  return new f.StringField({ required: true, blank: true, initial, trim: true });
}

/** A plain required string with an initial value. */
export function str(initial = "", opts = {}) {
  return new f.StringField({ required: true, blank: true, initial, ...opts });
}

/** A required integer number with an initial value. */
export function int(initial = 0, opts = {}) {
  return new f.NumberField({ required: true, integer: true, initial, ...opts });
}

/** A required boolean. */
export function bool(initial = false) {
  return new f.BooleanField({ initial });
}

/** An array of slug strings (references into the registry). */
export function slugArray() {
  return new f.ArrayField(new f.StringField({ required: true, blank: false, trim: true }));
}

/** Rich-text HTML field for descriptions. */
export function html(initial = "") {
  return new f.HTMLField({ required: true, blank: true, initial });
}

/**
 * One Attribute: a dice pool, its current Potential (lowered as Stress lands),
 * and whether it is Incapacitated. Incapacitation is stored rather than derived:
 * it starts when Stress reaches Potential but only lifts once healing brings
 * Stress down to half Potential (PHB 6.8.1), so the same current value can mean
 * either state depending on which way it was reached.
 */
export function attributeSchema() {
  const die = () => new f.NumberField({ required: true, integer: true, initial: 0, min: 0 });
  return new f.SchemaField({
    dice: new f.SchemaField({
      d4: die(), d6: die(), d8: die(), d10: die(), d12: die(), d20: die()
    }),
    potential: new f.SchemaField({ current: int(4) }),
    incapacitated: bool(false)
  });
}

/** One Skill: its Training. */
export function skillSchema() {
  return new f.SchemaField({ training: int(0) });
}

export { f };
