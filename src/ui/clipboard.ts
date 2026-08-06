/** Clipboard write, browser-API boundary. `navigator.clipboard` needs a secure
 *  context and user-activation in some browsers; `execCommand('copy')` against a
 *  detached, off-screen textarea is the fallback that still works without either. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the manual fallback */
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  el.remove();
  return ok;
}
