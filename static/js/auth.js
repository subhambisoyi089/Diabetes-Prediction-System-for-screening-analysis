/* auth.js - login and register pages */

// Show / hide password
document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
  const input = document.getElementById(btn.dataset.togglePassword);
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
});

// Password strength meter (register page only)
const strength = document.querySelector('.strength');
if (strength) {
  const pw = document.getElementById('password');
  const label = document.querySelector('[data-strength-label]');
  const names = ['At least 8 characters, with a letter and a number.', 'Weak', 'Fair', 'Good', 'Strong'];

  pw.addEventListener('input', () => {
    const v = pw.value;
    let score = 0;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
    if (!(/[A-Za-z]/.test(v) && /\d/.test(v))) score = Math.min(score, 1); // rule: letter + number
    if (!v) score = 0;
    strength.dataset.score = String(score);
    label.textContent = names[score];
  });
}

// Stop double submits
document.querySelectorAll('[data-auth-form]').forEach((form) => {
  form.addEventListener('submit', () => {
    const btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
  });
});

// Back button after a submit: bring the form back to life
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  document.querySelectorAll('[data-auth-form] button[type="submit"]').forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  });
});
