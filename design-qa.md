# Media preview design QA

final result: passed

## Visual target and evidence

- Source visual truth: `/var/folders/gw/pvgpn_vx2vs380_b1g6qk5540000gn/T/codex-clipboard-ed9c75fc-9505-46f3-943f-fef1c4081bb8.png`.
- Implementation: `http://localhost:5174/`, opened in the Codex in-app browser.
- Implementation screenshot: `/tmp/mojian-reference-style-preview.png`.
- Desktop viewport: 1686 × 882 CSS pixels, implementation capture 1686 × 882 pixels at 1× density.
- Source capture: 1686 × 881 pixels. Its original CSS viewport and display density were not supplied; comparison uses the supplied pixel image without stretching. The one-pixel height difference is immaterial to the requested visual treatment.
- State: full-screen preview of a tall registration/login sequence diagram. The implementation uses actual Mermaid rendering and the user's previously requested blue palette; the underlying product and exact diagram text differ from the reference intentionally.
- Full-view evidence: source and implementation images were opened together in the same comparison tool input. Focused inspection: the only visible control is the white X, clearly readable in both full-resolution screenshots; its implementation was measured at 40 × 40px with an 18px icon. No separate crop is needed to judge this simple control. Diagram labels are generated document content, not new preview UI copy.

## Comparison history

1. Earlier preview: pale 90%-opaque background, prominent lower toolbar and hint text (`/tmp/mojian-translucent-preview.png`). Against the new reference these are P1 visual mismatches: the underlying editor competes with the figure and extra controls distract from viewing.
2. Fix: use black at 86% opacity with a 2px backdrop blur, a white image surface, a centered fit with 43px clearance at each side, and a single transparent close control. Remove the persistent toolbar and instructions; retain zoom and pan through input events.
3. Post-fix: `/tmp/mojian-reference-style-preview.png` shows a 355.55 × 796px portrait diagram centered at the reference viewport, comparable to the source's approximately 376 × 792px figure. Width differs due to actual diagram geometry; aspect ratios are preserved.

## Fidelity review

- Fonts and typography: no decorative title or helper copy remains. Diagram text is preserved by the sanitized Mermaid SVG; the close icon uses the existing Lucide X at 18px.
- Spacing and layout: full viewport, centered figure, approximately 43px vertical clearance; no modal card, border, radius or lower toolbar. Close icon sits at the top-right with a 40px clickable area.
- Colors and tokens: dark translucent background matches the supplied reference's contrast treatment. The user-approved blue diagram theme remains in place rather than copying the example's purple/yellow source-specific colors.
- Image quality: real Mermaid SVG is displayed through an isolated blob image, preserves aspect ratio and sharpness, and has a white backing. Local and network images use the same preview surface without recoloring the asset.
- Copy: only the accessible region/close labels and a close-button tooltip remain; no visible feature inventory or instructions obscure the image.
- No remaining actionable P0/P1/P2 findings.

## Interaction verification

- Click previews from the editor and article preview; keyboard activation also works.
- Ctrl + wheel zooms while ordinary wheel scrolls; dragging pans a zoomed image without closing it.
- Keyboard `+`/`-` zooms and `0` restores fit; confirmed in the in-app browser.
- Esc, the close icon and blank-space clicks close the preview. Clicking the image does not close it.
- Closing restores focus/selection and does not change source Markdown or copied HTML.
- Mobile preview tested at 390 × 844 with fit recalculated after resize.
- Browser error/warning logs: none for the verified preview interaction.
- Nine related Playwright tests passed; TypeScript/Vite production build and diff whitespace check passed.

## Remaining scope

- Real-device touch gestures beyond the existing pointer-drag behavior were not separately tested. Pinch zoom is not introduced by this change.
- This QA covers the media preview redesign; it does not claim a fresh full-project regression run.
