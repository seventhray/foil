/**
 * Hovering a number a sheet reads from system data shows the variable's name, as written after "system.".
 * An input names its own variable (name="system.xp.total"); a readout names it with data-var.
 */
export function annotateVars(root) {
  for (const el of root.querySelectorAll('[name^="system."], [data-var]')) {
    const path = el.dataset.var ?? el.getAttribute("name").slice("system.".length);
    el.dataset.varNote ??= el.dataset.tooltip ?? el.getAttribute("title") ?? "";   // a re-render keeps the element
    el.removeAttribute("title");
    el.dataset.tooltip = el.dataset.varNote ? `${el.dataset.varNote} (${path})` : path;
  }
}
