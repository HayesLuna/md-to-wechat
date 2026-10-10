export type MediaPreviewItem = {kind:'image';url:string;title:string} | {kind:'diagram';svg:string;title:string};
export function requestMediaPreview(item:MediaPreviewItem) {
 window.dispatchEvent(new CustomEvent('mojian-preview-media',{detail:item}));
}
