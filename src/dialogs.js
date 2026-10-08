/**
 * src/dialogs.js
 * A small form prompt shared by the sheet and the Oppose flow.
 */

export const dialogApi = () => foundry.applications?.api?.DialogV2;
const formData = form => new (foundry.applications?.ux?.FormDataExtended ?? FormDataExtended)(form).object;

/** Ask a question with a small form; resolves to the form's values, or null. */
export async function ask(title, content, label = "OK") {
  const D = dialogApi();
  if (!D) return null;
  return D.prompt({
    window: { title }, content,
    ok: { label, callback: (event, button) => formData(button.form) },
    rejectClose: false
  }).catch(() => null);
}

/** Append a button to a chat card. */
export function addButton(html, label, cls, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  (html.querySelector(".message-content") ?? html).appendChild(btn);
}
