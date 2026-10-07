import { apiFetch } from '../supabase-api.js';
const apiBase = '../supabase-data';
const sessionKey = 'vicom-session';
const session = getSession();
const artistId = new URLSearchParams(window.location.search).get('id') || session?.userId;
const nameElement = document.querySelector('#artist-name');
const specialtyElement = document.querySelector('#artist-specialty');
const descriptionElement = document.querySelector('#profile-description');
const socialLinkElement = document.querySelector('#artist-social-link');
const avatarElement = document.querySelector('#artist-avatar');
const grid = document.querySelector('#portfolio-grid');
const empty = document.querySelector('#empty-state');
const count = document.querySelector('#work-count');
const toast = document.querySelector('#toast');
const descriptionPanel = document.querySelector('#description-panel');
const descriptionInput = document.querySelector('#description-input');
const socialLinkInput = document.querySelector('#social-link-input');
const formError = document.querySelector('#form-error');
let artist;
let rates = [];
let editingRateId = null;

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || 'null');
  } catch {
    return null;
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

function renderProfile(profile) {
  artist = profile.artist;
  document.title = `ViCom | ${artist.name}`;
  nameElement.textContent = artist.name;
  specialtyElement.textContent = artist.specialty || 'Original commissions';
  descriptionElement.textContent = artist.description || 'Original work made with care, clarity, and a point of view.';
  renderSocialLink(artist.socialLink);
  avatarElement.textContent = artist.name.trim().charAt(0).toUpperCase();

  const artworks = profile.artworks || [];
  rates = profile.rates || [];
  count.textContent = `${artworks.length} ${artworks.length === 1 ? 'piece' : 'pieces'}`;
  grid.innerHTML = artworks.map((work) => `
    <article class="work-card">
      <div class="work-image" style="background-image:url('${work.image}')" data-image="${work.image}" role="button" tabindex="0" aria-label="View ${work.title}"></div>
      <div class="work-meta"><div><h3>${work.title}</h3><p>${work.detail || work.category}</p></div><strong>from ${work.price}</strong></div>
    </article>`).join('');
  empty.hidden = artworks.length > 0;
  renderRates();
}

function renderSocialLink(url) {
  if (url) {
    socialLinkElement.href = url;
    socialLinkElement.textContent = url;
    socialLinkElement.hidden = false;
  } else {
    socialLinkElement.removeAttribute('href');
    socialLinkElement.textContent = '';
    socialLinkElement.hidden = true;
  }
}

async function loadProfile() {
  if (!session?.userId || session.role !== 'artist') {
    window.location.href = '../Account%20functions/auth.html?mode=signin';
    return;
  }
  try {
    const response = await apiFetch(`${apiBase}?action=artist&id=${encodeURIComponent(artistId)}`);
    const profile = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(profile.error || 'Profile unavailable.');
    if (artistId !== session.userId) throw new Error('You can only edit your own profile.');
    renderProfile(profile);
    descriptionInput.value = artist.description || '';
    socialLinkInput.value = artist.socialLink || '';
  } catch (error) {
    nameElement.textContent = 'Profile unavailable';
    empty.hidden = false;
    empty.textContent = error.message;
    document.querySelector('#edit-description').hidden = true;
  }
}

document.querySelector('#edit-description').addEventListener('click', () => {
  descriptionPanel.hidden = false;
  descriptionInput.focus();
});

document.querySelector('#cancel-description').addEventListener('click', () => {
  descriptionPanel.hidden = true;
  formError.textContent = '';
  descriptionInput.value = artist?.description || '';
  socialLinkInput.value = artist?.socialLink || '';
});

document.querySelector('#save-description').addEventListener('click', async () => {
  const description = descriptionInput.value.trim();
  const socialLink = socialLinkInput.value.trim();
  const saveButton = document.querySelector('#save-description');
  formError.textContent = '';
  saveButton.disabled = true;
  try {
    const response = await apiFetch(`${apiBase}?action=update_profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: session.userId,
        email: session.email,
        name: session.name,
        specialty: session.specialty || artist.specialty || '',
        description,
        socialLink,
        password: '',
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not save description.');
    artist.description = result.user.description;
    artist.socialLink = result.user.socialLink;
    descriptionElement.textContent = description || 'Original work made with care, clarity, and a point of view.';
    renderSocialLink(artist.socialLink);
    descriptionPanel.hidden = true;
    showToast('Description updated');
  } catch (error) {
    formError.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

const lightbox = document.querySelector('#lightbox');
const lightboxImage = document.querySelector('#lightbox-image');
function closeLightbox() {
  lightbox.classList.remove('open');
  lightbox.setAttribute('aria-hidden', 'true');
  lightboxImage.style.backgroundImage = '';
}
function openLightbox(image) {
  lightboxImage.style.backgroundImage = `url("${image}")`;
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');
}
grid.addEventListener('click', (event) => {
  const image = event.target.closest('.work-image');
  if (image) openLightbox(image.dataset.image);
});
grid.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.work-image')) {
    event.preventDefault();
    openLightbox(event.target.dataset.image);
  }
});
document.querySelector('#lightbox-close').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && lightbox.classList.contains('open')) closeLightbox();
});

loadProfile();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function renderRates() {
  const ratesGrid = document.querySelector('#rates-grid');
  const ratesEmpty = document.querySelector('#rates-empty');
  ratesEmpty.hidden = rates.length > 0;
  ratesGrid.innerHTML = rates.map((rate) => `
    <article class="rate-card">
      <div class="rate-card-body">
        <p class="rate-card-type">${escapeHtml(rate.type || 'Commission')}</p>
        <p class="rate-card-desc">${escapeHtml(rate.description || '')}</p>
        <span class="rate-card-price">from ₱${Number(rate.price).toLocaleString()}</span>
        <div class="rate-card-actions">
          <button class="rate-card-edit" type="button" data-action="edit" data-id="${escapeHtml(rate.id)}">Edit</button>
          <button class="rate-card-delete" type="button" data-action="delete" data-id="${escapeHtml(rate.id)}">Delete</button>
        </div>
      </div>
    </article>`).join('');
}

function openRateModal(rateId = null) {
  editingRateId = rateId;
  const title = document.querySelector('#rate-modal-title');
  const type = document.querySelector('#rate-type');
  const description = document.querySelector('#rate-description');
  const price = document.querySelector('#rate-price');
  document.querySelector('#rate-error').textContent = '';

  if (rateId) {
    const rate = rates.find((item) => item.id === rateId);
    if (!rate) return;
    title.textContent = 'Edit service';
    type.value = rate.type || 'Portrait';
    description.value = rate.description || '';
    price.value = rate.price;
  } else {
    title.textContent = 'Add a service & rate';
    type.value = 'Portrait';
    description.value = '';
    price.value = '';
  }
  document.querySelector('#rate-modal-overlay').classList.add('open');
  document.querySelector('#rate-modal-overlay').setAttribute('aria-hidden', 'false');
  type.focus();
}

function closeRateModal() {
  document.querySelector('#rate-modal-overlay').classList.remove('open');
  document.querySelector('#rate-modal-overlay').setAttribute('aria-hidden', 'true');
  editingRateId = null;
}

document.querySelector('#rate-save-btn')?.addEventListener('click', async () => {
  const type = document.querySelector('#rate-type').value.trim();
  const description = document.querySelector('#rate-description').value.trim();
  const price = Number(document.querySelector('#rate-price').value);
  const error = document.querySelector('#rate-error');
  const saveButton = document.querySelector('#rate-save-btn');
  error.textContent = '';
  if (!type) { error.textContent = 'Please choose a type of work.'; return; }
  if (!Number.isFinite(price) || price < 1 || price > 10000000) {
    error.textContent = 'Enter a rate between ₱1 and ₱10,000,000.';
    return;
  }

  const isEditing = Boolean(editingRateId);
  saveButton.disabled = true;
  try {
    const response = await apiFetch(`${apiBase}?action=save_artist_rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editingRateId, type, description, price })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save this service.');
    if (isEditing) rates = rates.map((rate) => rate.id === result.rate.id ? result.rate : rate);
    else rates.push(result.rate);
    renderRates();
    closeRateModal();
    showToast(isEditing ? 'Service updated' : 'Service added');
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    saveButton.disabled = false;
  }
});

document.querySelector('#rates-grid')?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const rateId = button.dataset.id;
  if (button.dataset.action === 'edit') {
    openRateModal(rateId);
    return;
  }

  button.disabled = true;
  try {
    const response = await apiFetch(`${apiBase}?action=delete_artist_rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rateId })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not remove this service.');
    rates = rates.filter((rate) => rate.id !== rateId);
    renderRates();
    showToast('Service removed');
  } catch (requestError) {
    showToast(requestError.message);
    button.disabled = false;
  }
});

document.querySelector('#add-rate-btn')?.addEventListener('click', () => openRateModal());
document.querySelector('#rate-modal-close')?.addEventListener('click', closeRateModal);
document.querySelector('#rate-cancel-btn')?.addEventListener('click', closeRateModal);
document.querySelector('#rate-modal-overlay')?.addEventListener('click', (event) => {
  if (event.target.id === 'rate-modal-overlay') closeRateModal();
});
