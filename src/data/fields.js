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
 * The four core Attributes, each a dice pool + Resistance + current Potential.
 * Potential.max is derived (from the pool) and left out of the stored schema.
 */
export function attributeSchema() {
  const die = () => new f.NumberField({ required: true, integer: true, initial: 0, min: 0 });
  return new f.SchemaField({
    dice: new f.SchemaField({
      d4: die(), d6: die(), d8: die(), d10: die(), d12: die(), d20: die()
    }),
    potential: new f.SchemaField({ current: int(8) })
  });
}

/** The six Aptitudes, each carrying Training. */
export function aptitudeSchema() {
  return new f.SchemaField({ training: int(0) });
}

export { f };
