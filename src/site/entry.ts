/** The sign-up and log-in pages. One script: the form's `data-mode` says which. */
import { accounts, nextPage } from './common';
import { StoreError } from './store';

const form = document.getElementById('entry-form') as HTMLFormElement;
const error = document.getElementById('form-error')!;
const login = form.dataset.mode === 'login';
const field = (name: string): HTMLInputElement => form.elements.namedItem(name) as HTMLInputElement;

// Someone already logged in has no business here.
if (accounts.current()) window.location.replace(nextPage());

// Keep "come back to this page afterwards" when switching between the two forms.
const next = new URLSearchParams(window.location.search).get('next');
if (next) {
  const swap = document.getElementById('swap-link') as HTMLAnchorElement;
  swap.href = `${swap.getAttribute('href')}?next=${encodeURIComponent(next)}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  const button = form.querySelector('button')!;
  button.disabled = true;
  try {
    if (login) await accounts.logIn(field('email').value, field('password').value);
    else await accounts.signUp(field('name').value, field('email').value, field('password').value);
    window.location.assign(nextPage());
  } catch (problem) {
    error.textContent = problem instanceof StoreError ? problem.message : 'Something went wrong. Try again.';
    error.hidden = false;
    button.disabled = false;
  }
});
