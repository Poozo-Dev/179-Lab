// save.js — put a Blob on the user's device.
// Phones: the share sheet offers "Save Image" / "Save to Files". Desktop: ordinary download.
export async function saveBlob(blob, name, type = 'image/jpeg') {
  const file = new File([blob], name, { type });
  if (navigator.maxTouchPoints > 0 && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; /* otherwise fall through to download */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
