import { apiFetch } from '../supabase-api.js';
const sessionKey = 'vicom-session';
const apiUrl = 'supabase-data';
const modes = {
  signin: { eyebrow: 'Welcome back', title: 'Login to ViCom', description: 'Continue exploring artists and managing your commissions.', submit: 'Login', switch: 'New to ViCom?', switchAction: 'Create an account', switchMode: 'signup' },
  signup: { eyebrow: 'Start creating', title: 'Create your account', description: 'Save artists and turn your next idea into a commission.', submit: 'Create account', switch: 'Already have an account?', switchAction: 'Login', switchMode: 'signin' },
  artist: { eyebrow: 'For independent creatives', title: 'Join as an artist', description: 'Create your artist profile and start receiving commission requests.', submit: 'Create artist profile', switch: 'Already have an account?', switchAction: 'Login', switchMode: 'signin' }
};

let currentMode = new URLSearchParams(window.location.search).get('mode') || 'signin';
if (!modes[currentMode]) currentMode = 'signin';
const form = document.querySelector('#auth-form');
const error = document.querySelector('#form-error');
const toast = document.querySelector('#toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

function setMode(mode) {
  currentMode = mode;
  const copy = modes[mode];
  document.querySelectorAll('.mode-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
  document.querySelector('#form-eyebrow').innerHTML = `<span></span> ${copy.eyebrow}`;
  document.querySelector('#form-title').textContent = copy.title;
  document.querySelector('#form-description').textContent = copy.description;
  document.querySelector('#submit-button').innerHTML = `${copy.submit} <span>↗</span>`;
  document.querySelector('#switch-copy').innerHTML = `${copy.switch} <button type="button" data-mode="${copy.switchMode}">${copy.switchAction}</button>`;
  document.querySelectorAll('.artist-only').forEach((field) => { field.hidden = mode !== 'artist'; });
  document.querySelector('.name-field').hidden = mode === 'signin';
  document.querySelector('#password').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
  error.textContent = '';
  const url = new URL(window.location.href);
  url.searchParams.set('mode', mode);
  window.history.replaceState({}, '', url);
}

function redirectFor(role) {
  window.location.href = role === 'artist' ? '../Artist%20side/index.html' : '../User%20Side/index.html';
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-mode]');
  if (trigger) setMode(trigger.dataset.mode);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  const data = new FormData(form);
  const email = data.get('email').trim().toLowerCase();
  const password = data.get('password');
  if (!email || !password) {
    error.textContent = 'Enter your email and password to continue.';
    return;
  }
  if (currentMode === 'signin') {
    await submitAccount('login', { email, password });
    return;
  }
  const isArtist = currentMode === 'artist';
  const name = (isArtist ? data.get('artistName') : data.get('name')).trim();
  if (!name) {
    error.textContent = isArtist ? 'Add your artist or studio name.' : 'Add your name to create an account.';
    return;
  }
  if (password.length < 6) {
    error.textContent = 'Use a password with at least 6 characters.';
    return;
  }
  await submitAccount('register', { email, password, name, role: isArtist ? 'artist' : 'customer', specialty: isArtist ? data.get('specialty').trim() : '' });
});

async function submitAccount(action, payload) {
  try {
    const response = await apiFetch(`${apiUrl}?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error('Could not connect to Supabase. Check your internet connection and project configuration.');
    }
    if (!response.ok) throw new Error(result.error || 'Account request failed.');
    const user = result.user;
    if (user.emailVerificationSent) {
      showToast('Account created. Check your email to verify it, then log in.');
      return;
    }
    localStorage.setItem(sessionKey, JSON.stringify({
      userId: user.id,
      email: user.email,
      name: user.name,
      specialty: user.specialty || '',
      role: user.role,
    }));
    const successMessage = action === 'login' ? 'Signed in successfully' : 'Account created';
    showToast(successMessage);
    setTimeout(() => redirectFor(user.role), 350);
  } catch (requestError) {
    error.textContent = requestError.message;
  }
}

setMode(currentMode);
