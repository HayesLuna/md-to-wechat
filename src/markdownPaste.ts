// Prefer structured rich text. Plain-text and plain HTML wrappers may carry
// Markdown source from Typora, which needs the Markdown parser instead.
export function shouldParseMarkdownPaste(text: string, html: string) {
  if (!text) return false;
  if (!html) return true;
  const root = new DOMParser().parseFromString(html, "text/html");
  return !root.querySelector(
    "[data-pm-slice],h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote,pre,code,strong,b,em,i,s,del,a,img",
  );
}

// Typora and GFM exporters use checkbox inputs without Tiptap's data-type
// attributes. Normalize only direct checkboxes belonging to each list item.
export function normalizeTaskClipboardHTML(html: string) {
  if (!/checkbox/i.test(html)) return html;
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const list of Array.from(document.querySelectorAll("ul")).reverse()) {
    const groups: { task: boolean; items: HTMLLIElement[] }[] = [];
    for (const item of Array.from(list.children)) {
      if (item.tagName !== "LI") continue;
      const checkbox = item.querySelector<HTMLInputElement>(
        ':scope > input[type="checkbox"], :scope > label input[type="checkbox"], :scope > p input[type="checkbox"]',
      );
      const task = !!checkbox || item.getAttribute("data-type") === "taskItem";
      if (checkbox) {
        item.setAttribute("data-type", "taskItem");
        item.setAttribute("data-checked", String(checkbox.checked));
        const label = checkbox.closest("label");
        checkbox.remove();
        if (label && !label.textContent?.trim() && !label.children.length) label.remove();
      }
      const previous = groups.at(-1);
      if (previous?.task === task) previous.items.push(item as HTMLLIElement);
      else groups.push({ task, items: [item as HTMLLIElement] });
    }
    if (!groups.some((group) => group.task)) continue;
    if (groups.length === 1) {
      list.setAttribute("data-type", "taskList");
      continue;
    }
    const lists = groups.map((group) => {
      const replacement = list.cloneNode(false) as HTMLUListElement;
      if (group.task) replacement.setAttribute("data-type", "taskList");
      else replacement.removeAttribute("data-type");
      replacement.append(...group.items);
      return replacement;
    });
    list.replaceWith(...lists);
  }
  return document.body.innerHTML;
}
