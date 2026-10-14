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
