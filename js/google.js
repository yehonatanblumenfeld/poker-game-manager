// Google's own sign-in button (Google Identity Services).
//
// With it, Google's screen names this site instead of the Supabase server,
// and there is no full-page redirect: Google hands us a signed ID token in a
// popup and Supabase checks it. Any element with [data-gsi] becomes a
// button. Without a client id, or if Google's script can't load, the plain
// button inside it stays and uses the redirect flow instead.

const SCRIPT = 'https://accounts.google.com/gsi/client';

let clientId = '';
let onToken = null;
let loading = null;
let ready = null;
let nonce = '';
let observer = null;

function load() {
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve() : reject(new Error('gsi')));
    s.onerror = () => reject(new Error('gsi'));
    document.head.append(s);
  });
  return loading;
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A fresh nonce per sign-in: Google signs its hash into the token, Supabase
// checks it against the raw value, so a token can't be replayed elsewhere.
async function init() {
  const raw = crypto.getRandomValues(new Uint8Array(16));
  nonce = btoa(String.fromCharCode(...raw)).replace(/[+/=]/g, '');
  window.google.accounts.id.initialize({
    client_id: clientId,
    nonce: await sha256Hex(nonce),
    callback: ({ credential }) => {
      const used = nonce;
      init(); // ready for the next sign-in
      onToken?.(credential, used);
    },
    auto_select: false,
    itp_support: true,
    use_fedcm_for_button: true,
  });
}

function mount(el, locale) {
  if (el.dataset.gsiMounted) return;
  el.dataset.gsiMounted = '1';
  const slot = document.createElement('div');
  slot.className = 'gsi__slot';
  el.append(slot);
  window.google.accounts.id.renderButton(slot, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'rectangular',
    logo_alignment: 'center',
    width: Math.min(400, Math.max(200, Math.round(el.clientWidth || 320))),
    locale,
  });
  el.classList.add('gsi--ready');
}

// Start watching the page for [data-gsi] placeholders. `getLocale` is read
// at render time so the button follows the app's language.
export function startGoogleButton({ id, getLocale, signedIn, onCredential }) {
  if (!id || observer) return;
  clientId = id;
  onToken = onCredential;
  const scan = () => {
    const els = document.querySelectorAll('[data-gsi]:not([data-gsi-mounted])');
    if (!els.length || signedIn()) return;
    ready ||= load().then(init);
    ready
      .then(() => els.forEach((el) => el.isConnected && mount(el, getLocale())))
      .catch(() => {}); // keep the plain button
  };
  observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
}
