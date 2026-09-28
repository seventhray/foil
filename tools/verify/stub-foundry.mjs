// Minimal stand-in for the Foundry globals the FOIL DataModels touch, enough to
// instantiate every schema in Node and run prepareDerivedData / migrateData.
class DataField {
  constructor(opts = {}) { this.options = opts; }
  initial() { return this.options.initial; }
  clean(v) { return v; }
}
class StringField extends DataField { getInitial(){ return this.options.initial ?? ""; } }
class NumberField extends DataField { getInitial(){ return this.options.initial ?? 0; } }
class BooleanField extends DataField { getInitial(){ return this.options.initial ?? false; } }
class HTMLField extends StringField {}
class ArrayField extends DataField { constructor(el,o){ super(o); this.element = el; } getInitial(){ return []; } }
class ObjectField extends DataField { getInitial(){ return {}; } }
class SchemaField extends DataField {
  constructor(fields, o){ super(o); this.fields = fields; }
  getInitial(){ const out = {}; for (const [k,v] of Object.entries(this.fields)) out[k] = v.getInitial ? v.getInitial() : undefined; return out; }
}
class FilePathField extends StringField {}

function hydrate(schema, source) {
  const out = {};
  for (const [k, field] of Object.entries(schema)) {
    const src = source?.[k];
    if (field instanceof SchemaField) out[k] = hydrate(field.fields, src ?? {});
    else out[k] = src !== undefined ? src : (field.getInitial ? field.getInitial() : undefined);
  }
  return out;
}

class TypeDataModel {
  static migrateData(source) { return source; }
  constructor(source = {}, ctx = {}) {
    const schema = this.constructor.defineSchema();
    Object.assign(this, hydrate(schema, this.constructor.migrateData(structuredClone(source))));
    Object.defineProperty(this, "parent", { value: ctx.parent, enumerable: false });
  }
}
globalThis.foundry = {
  abstract: { TypeDataModel },
  data: { fields: { StringField, NumberField, BooleanField, HTMLField, ArrayField, ObjectField, SchemaField, FilePathField } }
};
globalThis.CONFIG = { FOIL: {} };
export { TypeDataModel };
