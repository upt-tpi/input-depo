/**
 * SIPANTAI — Sistem Pendataan Depo TPI
 * script.js — Logika utama aplikasi
 *
 * Struktur:
 *  1. Konfigurasi & State
 *  2. Navigasi Tab
 *  3. Geolocation API (Ambil GPS)
 *  4. Upload & Preview Foto
 *  5. Simpan Data → Google Apps Script
 *  6. Muat Data dari Spreadsheet
 *  7. Filter & Render Tabel
 *  8. Peta Leaflet (Peta Sebaran)
 *  9. Utilitas (Toast, Reset, Badge)
 */

// ================================================================
// 1. KONFIGURASI & STATE GLOBAL
// ================================================================

/**
 * GANTI URL INI dengan URL Web App dari Google Apps Script Anda.
 * Cara deploy: Extensions → Apps Script → Deploy → New Deployment → Web App
 */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwSykwtXCNEycb-KOnmVj3d5xzTpNZZ9ZYEOtnYY4xsSVWNWd9vfhJBiNFB8OEvuZRdiw/exec';

// State koordinat GPS yang sudah diambil
let gpsData = { lat: null, lng: null, ready: false };

// Referensi peta Leaflet
let mainMap = null;
let miniMap = null;
let mainMapMarkers = [];

// Data yang sudah dimuat dari spreadsheet
let allData = [];

// Pagination State
let currentPage = 1;
const itemsPerPage = 7;
let filteredData = []; // Data yang sudah difilter dan siap di-paginate


// ================================================================
// 2. NAVIGASI TAB
// ================================================================

/**
 * Berpindah antar tab: 'form', 'map', 'list'
 * @param {string} tabName - nama tab tujuan
 */
function switchTab(tabName) {
  // Sembunyikan semua section
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  // Aktifkan tab yang dipilih
  document.getElementById('tab-' + tabName).classList.add('active');
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

  // Inisialisasi sesuai tab
  if (tabName === 'map') {
    // Sedikit delay agar DOM sudah render sebelum init Leaflet
    setTimeout(initMainMap, 100);
  }

  if (tabName === 'list') {
    muatData();
  }
}


// ================================================================
// 3. GEOLOCATION API — AMBIL KOORDINAT GPS
// ================================================================

/**
 * Mengambil posisi GPS perangkat menggunakan browser Geolocation API.
 * Menampilkan koordinat di form dan mini map.
 */
function ambilLokasi() {
  // Cek apakah browser mendukung Geolocation
  if (!navigator.geolocation) {
    showToast('error', 'Tidak Didukung', 'Browser Anda tidak mendukung Geolocation API.');
    return;
  }

  const btn = document.getElementById('btnGPS');
  const btnText = document.getElementById('btnGPSText');
  const badge = document.getElementById('gpsStatus');

  // Set status: Loading
  btnText.textContent = 'Mengambil lokasi...';
  btn.disabled = true;
  badge.textContent = 'Memproses...';
  badge.className = 'gps-badge gps-loading';

  // Opsi geolocation: akurasi tinggi, timeout 10 detik
  const options = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  };

  navigator.geolocation.getCurrentPosition(
    // Sukses: tampilkan koordinat
    (position) => {
      const lat = position.coords.latitude.toFixed(7);
      const lng = position.coords.longitude.toFixed(7);

      document.getElementById('latitude').value = lat;
      document.getElementById('longitude').value = lng;

      gpsData = { lat: parseFloat(lat), lng: parseFloat(lng), ready: true };

      badge.textContent = '✓ GPS Aktif';
      badge.className = 'gps-badge gps-success';
      btnText.textContent = 'Perbarui Lokasi GPS';
      btn.disabled = false;

      // Tampilkan mini map
      tampilkanMiniMap(gpsData.lat, gpsData.lng);
      showToast('success', 'Lokasi Ditemukan', `Koordinat: ${lat}, ${lng}`);
    },

    // Gagal: tampilkan error
    (error) => {
      const pesan = {
        1: 'Izin lokasi ditolak. Aktifkan di pengaturan browser.',
        2: 'Sinyal GPS tidak tersedia. Coba di tempat terbuka.',
        3: 'Waktu pengambilan GPS habis. Coba lagi.'
      };

      badge.textContent = '✗ Gagal';
      badge.className = 'gps-badge gps-error';
      btnText.textContent = 'Coba Lagi';
      btn.disabled = false;

      showToast('error', 'Gagal Ambil GPS', pesan[error.code] || 'Terjadi kesalahan.');
    },
    options
  );
}

/**
 * Menampilkan mini peta setelah GPS berhasil diambil.
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 */
function tampilkanMiniMap(lat, lng) {
  const container = document.getElementById('miniMapContainer');
  container.classList.remove('hidden');

  // Hapus instance lama jika ada
  if (miniMap) {
    miniMap.remove();
    miniMap = null;
  }

  // Buat peta baru
  miniMap = L.map('miniMap', { zoomControl: true, attributionControl: false });

  // Layer tile peta (OpenStreetMap)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(miniMap);

  // Marker posisi saat ini
  const marker = L.circleMarker([lat, lng], {
    radius: 10,
    fillColor: '#00d4ff',
    color: '#fff',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.9
  }).addTo(miniMap);

  marker.bindPopup('<strong style="color:#0a1628;">Posisi Anda</strong>').openPopup();
  miniMap.setView([lat, lng], 16);
}


// ================================================================
// 4. UPLOAD & PREVIEW FOTO
// ================================================================

/**
 * Menampilkan preview foto yang dipilih pengguna.
 * @param {Event} event - Event change dari input file
 */
function previewFoto(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Validasi ukuran file (maks 5 MB)
  if (file.size > 5 * 1024 * 1024) {
    showToast('error', 'File Terlalu Besar', 'Ukuran foto maksimal 5 MB.');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('fotoPreview');
    preview.innerHTML = `<img src="${e.target.result}" alt="Preview Foto Depo" />`;
    preview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}


// ================================================================
// 5. SIMPAN DATA → GOOGLE APPS SCRIPT
// ================================================================

/**
 * Validasi semua field wajib, kumpulkan data, kirim ke Google Apps Script.
 */
async function simpanData() {
  // Ambil nilai semua field
  const data = {
    namaTPI: document.getElementById('namaTPI').value.trim(),
    namaDepo: document.getElementById('namaDepo').value.trim(),
    namaPemilik: document.getElementById('namaPemilik').value.trim(),
    nomorHP: document.getElementById('nomorHP').value.trim(),
    jenisUsaha: document.getElementById('jenisUsaha').value,
    alamatDepo: document.getElementById('alamatDepo').value.trim(),
    latitude: document.getElementById('latitude').value,
    longitude: document.getElementById('longitude').value,
    keterangan: document.getElementById('keterangan').value.trim()
  };

  // ---- Validasi Field Wajib ----
  const wajib = [
    { field: 'namaTPI', label: 'Nama TPI' },
    { field: 'namaDepo', label: 'Nama Depo' },
    { field: 'namaPemilik', label: 'Nama Pemilik' },
    { field: 'nomorHP', label: 'Nomor HP' },
    { field: 'jenisUsaha', label: 'Jenis Usaha' },
    { field: 'alamatDepo', label: 'Alamat Depo' }
  ];

  for (const item of wajib) {
    if (!data[item.field]) {
      showToast('error', 'Data Tidak Lengkap', `Field "${item.label}" harus diisi.`);
      document.getElementById(item.field).focus();
      return;
    }
  }

  // ---- Validasi GPS ----
  if (!gpsData.ready) {
    showToast('error', 'GPS Belum Diambil', 'Silakan ambil koordinat GPS terlebih dahulu.');
    return;
  }

  // ---- Generate Link Google Maps ----
  data.linkMaps = `https://maps.google.com/?q=${data.latitude},${data.longitude}`;

  // ---- Tambahkan tanggal input ----
  data.tanggalInput = new Date().toLocaleString('id-ID', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  // ---- Konversi foto ke Base64 (opsional) ----
  const fileInput = document.getElementById('fotoDepo');
  if (fileInput.files.length > 0) {
    data.foto = await fileToBase64(fileInput.files[0]);
  } else {
    data.foto = '';
  }

  // ---- Tampilkan loading overlay ----
  document.getElementById('savingOverlay').classList.remove('hidden');
  document.getElementById('btnSave').disabled = true;

  try {
    // ---- Kirim data ke Google Apps Script ----
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',   // Google Apps Script memerlukan no-cors
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    // Karena no-cors, kita tidak bisa membaca response body.
    // Anggap sukses jika tidak ada error fetch.
    document.getElementById('savingOverlay').classList.add('hidden');
    document.getElementById('btnSave').disabled = false;

    // Simpan juga ke localStorage sebagai fallback/demo
    simpanLokal(data);

    showToast('success', 'Data Tersimpan!', `${data.namaDepo} berhasil didaftarkan.`);
    resetForm();
    updateCounter();

  } catch (err) {
    document.getElementById('savingOverlay').classList.add('hidden');
    document.getElementById('btnSave').disabled = false;

    // Fallback: simpan ke localStorage jika offline/error
    simpanLokal(data);
    showToast('success', 'Tersimpan (Lokal)', 'Data tersimpan di perangkat. Akan disinkronkan saat online.');
    resetForm();
    updateCounter();

    console.warn('Gagal kirim ke Apps Script:', err);
  }
}

/**
 * Menyimpan data ke localStorage sebagai cache lokal / demo mode.
 * @param {Object} data - Objek data depo
 */
function simpanLokal(data) {
  const stored = JSON.parse(localStorage.getItem('depoTPI') || '[]');
  stored.push(data);
  localStorage.setItem('depoTPI', JSON.stringify(stored));
}

/**
 * Konversi File ke Base64 string.
 * @param {File} file
 * @returns {Promise<string>}
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


// ================================================================
// 6. MUAT DATA DARI SPREADSHEET / LOCALSTORAGE
// ================================================================

/**
 * Memuat data dari Google Apps Script.
 * Jika gagal, fallback ke localStorage.
 */
async function muatData() {
  const tbody = document.getElementById('tableBody');
  const loading = document.getElementById('loadingState');
  const empty = document.getElementById('emptyState');

  tbody.innerHTML = '';
  loading.classList.remove('hidden');
  empty.classList.add('hidden');

  try {
    // Coba ambil dari Apps Script (GET request)
    const res = await fetch(APPS_SCRIPT_URL + '?action=get', { mode: 'cors' });
    const json = await res.json();

    allData = json.data || [];
  } catch (err) {
    // Fallback ke localStorage
    allData = JSON.parse(localStorage.getItem('depoTPI') || '[]');
    console.info('Menggunakan data lokal:', allData.length, 'entri');
  }

  loading.classList.add('hidden');
  
  // Set filteredData awal
  filteredData = allData;
  currentPage = 1;
  
  renderTabel();
  updateFilterTPI();
  updateCounter();

  // Perbarui marker di peta jika tab peta sudah terbuka
  if (mainMap) renderMarkers(allData);
}

/**
 * Memperbarui dropdown filter TPI berdasarkan data yang ada.
 */
function updateFilterTPI() {
  const select = document.getElementById('filterTPI');
  const current = select.value;

  // Kumpulkan TPI unik
  const tpiList = [...new Set(allData.map(d => d.namaTPI).filter(Boolean))].sort();

  select.innerHTML = '<option value="">Semua TPI</option>';
  tpiList.forEach(tpi => {
    const opt = document.createElement('option');
    opt.value = tpi;
    opt.textContent = tpi;
    if (tpi === current) opt.selected = true;
    select.appendChild(opt);
  });
}

/**
 * Update angka counter di navbar.
 * Mengambil jumlah data dari spreadsheet via Apps Script (GET).
 * Fallback ke panjang allData jika koneksi gagal.
 */
async function updateCounter() {
  try {
    const res = await fetch(APPS_SCRIPT_URL);
    const json = await res.json();
    const total = json.data ? json.data.length : 0;
    document.getElementById('totalCount').textContent = total;
  } catch (err) {
    // Fallback: pakai data yang sudah dimuat ke allData
    document.getElementById('totalCount').textContent = allData.length;
  }
}


// ================================================================
// 7. FILTER & RENDER TABEL
// ================================================================

function filterData() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const filterTPI = document.getElementById('filterTPI').value;
  const filterJns = document.getElementById('filterJenis').value;

  filteredData = allData.filter(d => {
    const matchSearch = !search ||
      (d.namaDepo || '').toLowerCase().includes(search) ||
      (d.namaPemilik || '').toLowerCase().includes(search) ||
      (d.namaTPI || '').toLowerCase().includes(search) ||
      (d.alamatDepo || '').toLowerCase().includes(search);

    const matchTPI = !filterTPI || d.namaTPI === filterTPI;
    const matchJns = !filterJns || d.jenisUsaha === filterJns;

    return matchSearch && matchTPI && matchJns;
  });

  currentPage = 1; // Reset ke halaman 1 saat filter berubah
  renderTabel();
}

/**
 * Render data ke dalam tabel HTML dengan dukungan pagination.
 */
function renderTabel() {
  const tbody = document.getElementById('tableBody');
  const empty = document.getElementById('emptyState');
  const info = document.getElementById('dataInfo');

  const total = filteredData.length;
  
  if (total === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    info.textContent = 'Menampilkan 0 data';
    renderPagination(0);
    return;
  }

  empty.classList.add('hidden');

  // Kalkulasi slice data untuk halaman aktif
  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const pagedData = filteredData.slice(start, end);
  
  info.textContent = `Menampilkan ${start + 1}–${Math.min(end, total)} dari ${total} data`;

  tbody.innerHTML = pagedData.map((d, i) => {
    const globalIndex = start + i + 1;
    return `
      <tr>
        <td class="muted">${globalIndex}</td>
        <td class="muted">${d.tanggalInput || '-'}</td>
        <td>${escHtml(d.namaTPI || '-')}</td>
        <td><strong>${escHtml(d.namaDepo || '-')}</strong></td>
        <td>${escHtml(d.namaPemilik || '-')}</td>
        <td class="muted">${escHtml(d.nomorHP || '-')}</td>
        <td><span class="jenis-badge ${getBadgeClass(d.jenisUsaha)}">${escHtml(d.jenisUsaha || '-')}</span></td>
        <td class="muted" style="font-family:monospace;font-size:11px;">
          ${d.latitude ? `${d.latitude}, ${d.longitude}` : '-'}
        </td>
        <td>
          ${d.linkFoto
            ? `<a href="${escHtml(d.linkFoto)}" target="_blank" class="btn-maps btn-foto">
                 📷 Foto
               </a>`
            : '<span class="muted" style="font-size:11px;">—</span>'}
        </td>
        <td>
          ${d.latitude ? `
            <a href="https://maps.google.com/?q=${d.latitude},${d.longitude}"
               target="_blank" class="btn-maps">
              📍 Maps
            </a>` : '-'}
        </td>
      </tr>
    `;
  }).join('');
  
  renderPagination(total);
}

/**
 * Render kontrol pagination.
 */
function renderPagination(totalItems) {
  const container = document.getElementById('pagination');
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">‹ Prev</button>`;
  
  // Tampilkan max 5 tombol halaman
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + 4);
  if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
  }

  html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">Next ›</button>`;
  
  container.innerHTML = html;
}

/**
 * Berpindah halaman pagination.
 */
function changePage(page) {
  currentPage = page;
  renderTabel();
  // Scroll ke atas tabel
  document.querySelector('.section-header').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Escape HTML untuk mencegah XSS.
 */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Menentukan class CSS badge berdasarkan jenis usaha.
 */
function getBadgeClass(jenis) {
  const map = {
    'Bakul Ikan': 'badge-bakul',
    'Sewa Lahan': 'badge-lahan'
  };
  return map[jenis] || 'badge-es';
}

/**
 * Menentukan warna marker peta berdasarkan jenis usaha.
 */
function getMarkerColor(jenis) {
  const map = {
    'Bakul Ikan': '#ef4444',
    'Sewa Lahan': '#8b5cf6'
  };
  return map[jenis] || '#1e40af';
}


// ================================================================
// 8. PETA LEAFLET — PETA SEBARAN DEPO
// ================================================================

/**
 * Inisialisasi peta utama pada tab Peta Lokasi.
 * Hanya berjalan sekali; setelah itu hanya refresh markers.
 */
function initMainMap() {
  if (mainMap) {
    // Peta sudah ada, perbarui ukuran saja
    mainMap.invalidateSize();
    renderMarkers(allData);
    return;
  }

  // Pusat awal: sekitar pesisir utara Jawa Tengah
  const centerLat = -6.7;
  const centerLng = 110.8;

  mainMap = L.map('mainMap', {
    center: [centerLat, centerLng],
    zoom: 10,
    zoomControl: true,
    attributionControl: true
  });

  // Tile layer OpenStreetMap
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(mainMap);

  // Muat data dan render marker
  muatData().then(() => renderMarkers(allData));
}

/**
 * Render marker pada peta utama dari array data.
 * @param {Array} data - Data depo
 */
function renderMarkers(data) {
  if (!mainMap) return;

  // Hapus semua marker lama
  mainMapMarkers.forEach(m => mainMap.removeLayer(m));
  mainMapMarkers = [];

  // Data yang memiliki koordinat GPS
  const withCoords = data.filter(d => d.latitude && d.longitude);

  withCoords.forEach(d => {
    const lat = parseFloat(d.latitude);
    const lng = parseFloat(d.longitude);
    if (isNaN(lat) || isNaN(lng)) return;

    const color = getMarkerColor(d.jenisUsaha);

    // Custom marker menggunakan divIcon
    const icon = L.divIcon({
      className: '',
      html: `
        <div style="
          width: 14px; height: 14px;
          background: ${color};
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 0 10px ${color}80, 0 2px 8px rgba(0,0,0,0.4);
        "></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -10]
    });

    const marker = L.marker([lat, lng], { icon }).addTo(mainMap);

    // Popup informasi depo
    marker.bindPopup(`
      <div style="min-width:200px">
        <div class="popup-title">${escHtml(d.namaDepo || '')}</div>
        <div class="popup-row">
          <span>TPI</span>
          <strong>${escHtml(d.namaTPI || '-')}</strong>
        </div>
        <div class="popup-row">
          <span>Pemilik</span>
          <strong>${escHtml(d.namaPemilik || '-')}</strong>
        </div>
        <div class="popup-row">
          <span>HP</span>
          <strong>${escHtml(d.nomorHP || '-')}</strong>
        </div>
        <span class="popup-badge">${escHtml(d.jenisUsaha || '')}</span>
        <a href="https://maps.google.com/?q=${lat},${lng}"
           target="_blank" class="popup-link">🗺 Buka di Google Maps</a>
      </div>
    `);

    mainMapMarkers.push(marker);
  });

  // Zoom to fit jika ada marker
  if (mainMapMarkers.length > 0) {
    const group = L.featureGroup(mainMapMarkers);
    mainMap.fitBounds(group.getBounds().pad(0.2));
  }
}


// ================================================================
// 9. UTILITAS
// ================================================================

/**
 * Menampilkan Toast Notification.
 * @param {'success'|'error'} type - Tipe notifikasi
 * @param {string} title - Judul
 * @param {string} msg - Pesan detail
 */
function showToast(type, title, msg) {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toastIcon');
  const ttl = document.getElementById('toastTitle');
  const tmsg = document.getElementById('toastMsg');

  icon.textContent = type === 'success' ? '✓' : '✗';
  ttl.textContent = title;
  tmsg.textContent = msg;
  toast.className = type === 'error' ? 'toast error' : 'toast';

  // Tampilkan
  toast.classList.remove('hidden');

  // Sembunyikan otomatis setelah 4 detik
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => toast.classList.add('hidden'), 4000);
}

/**
 * Reset form input ke kondisi awal.
 */
function resetForm() {
  ['namaDepo', 'namaPemilik', 'nomorHP', 'alamatDepo', 'latitude', 'longitude', 'keterangan']
    .forEach(id => { document.getElementById(id).value = ''; });

  document.getElementById('namaTPI').selectedIndex = 0;
  document.getElementById('jenisUsaha').selectedIndex = 0;
  document.getElementById('fotoDepo').value = '';

  const preview = document.getElementById('fotoPreview');
  preview.innerHTML = '';
  preview.classList.add('hidden');

  const miniContainer = document.getElementById('miniMapContainer');
  miniContainer.classList.add('hidden');

  const badge = document.getElementById('gpsStatus');
  badge.textContent = 'Belum Diambil';
  badge.className = 'gps-badge gps-idle';

  document.getElementById('btnGPSText').textContent = 'Ambil Lokasi GPS';

  gpsData = { lat: null, lng: null, ready: false };

  if (miniMap) {
    miniMap.remove();
    miniMap = null;
  }
}


// ================================================================
// INISIALISASI SAAT HALAMAN DIMUAT
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Muat data langsung dari server saat pertama kali buka
  muatData();
});
