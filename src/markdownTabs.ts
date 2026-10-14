// Boundary tabs have structural meaning in Markdown: they can create code
// blocks or be trimmed from headings. Numeric entities keep them as literal
// text on roundtrip. Interior tabs and tabs in code are left untouched.
export function preserveBoundaryTabs(text: string) {
  const encode = (spaces: string) =>
    spaces.replace(/ /g, "&#32;").replace(/\t/g, "&#9;");
  return text
    .replace(/^[ \t]*\t[ \t]*/, encode)
    .replace(/[ \t]*\t[ \t]*$/, encode);
}
