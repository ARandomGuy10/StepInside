/** What every page of the website shares: fonts, styles and the header's log-in state. */
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/kalam/latin-400.css';
import { services, type Account } from './store';

export const { accounts, requests } = services();

/** Shows "Log in" or "Your account" in the header and footer. */
export function showAccountState(account: Account | null = accounts.current()): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-auth]')) {
    el.hidden = (el.dataset.auth === 'in') !== !!account;
  }
}

/** A short message at the bottom of the page that goes away by itself. */
export function toast(message: string): void {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  window.setTimeout(() => el.remove(), 4000);
}

/** Sends the visitor to log in first, and back to this page afterwards. */
export function requireAccount(): Account | null {
  const account = accounts.current();
  if (!account) {
    const here = window.location.pathname.split('/').pop() || 'account.html';
    window.location.replace(`signup.html?next=${encodeURIComponent(here)}`);
  }
  return account;
}

/** Where to go after logging in: only ever a page of this site. */
export function nextPage(): string {
  const next = new URLSearchParams(window.location.search).get('next') ?? '';
  return /^[a-z]+\.html$/.test(next) ? next : 'account.html';
}

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

showAccountState();
