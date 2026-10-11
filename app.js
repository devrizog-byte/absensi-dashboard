/* Dashboard Absensi — logika baca dari Supabase (tanpa build step). */
(function () {
  'use strict';

  var pesanEl = document.getElementById('pesan');

  function tampilPesan(teks, tipe) {
    pesanEl.hidden = false;
    pesanEl.className = 'pesan ' + (tipe || 'peringatan');
    pesanEl.textContent = teks;
  }

  // ---- 1. Konfigurasi -------------------------------------------------
  var cfg = window.KONFIG_DASHBOARD || {};
  var url = (cfg.SUPABASE_URL || '').trim();
  var kunci = (cfg.SUPABASE_ANON_KEY || '').trim();

  document.getElementById('tanggal-hari-ini').textContent =
    new Date().toLocaleDateString('id-ID', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

  if (!url || url.indexOf('ISI_DARI_BOSS') !== -1 ||
      !kunci || kunci.indexOf('ISI_DARI_BOSS') !== -1) {
    tampilPesan(
      'Dashboard belum dikonfigurasi. Buka PANDUAN_SERVER.md lalu isi ' +
      'Project URL dan anon key di file config.js.',
      'peringatan'
    );
    isiKosong();
    return;
  }
  if (!window.supabase) {
    tampilPesan('Pustaka Supabase gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
    isiKosong();
    return;
  }

  var sb = window.supabase.createClient(url, kunci);

  // ---- 2. Filter ------------------------------------------------------
  var elDari = document.getElementById('filter-dari');
  var elSampai = document.getElementById('filter-sampai');
  var elNama = document.getElementById('filter-nama');

  var hariIni = new Date().toISOString().slice(0, 10);
  elDari.value = hariIni;
  elSampai.value = hariIni;

  document.getElementById('tombol-tampil').addEventListener('click', muatSemua);
  var tundaCari = null;
  elNama.addEventListener('input', function () {
    clearTimeout(tundaCari);
    tundaCari = setTimeout(muatSemua, 600);
  });

  muatSemua();

  // ---- 3. Pemuatan data ----------------------------------------------
  function rentangWaktu() {
    var dari = elDari.value || hariIni;
    var sampai = elSampai.value || dari;
    return {
      mulai: new Date(dari + 'T00:00:00').toISOString(),
      selesai: new Date(sampai + 'T23:59:59.999').toISOString()
    };
  }

  function queryDasar() {
    var r = rentangWaktu();
    var q = sb.from('catatan_absensi')
      .select('waktu, jenis, tepat_waktu, status_area, keterangan, ' +
              'karyawan:karyawan_id(nama, jabatan)')
      .gte('waktu', r.mulai)
      .lte('waktu', r.selesai)
      .order('waktu', { ascending: false });
    var cari = elNama.value.trim();
    if (cari) {
      // Join inner agar filter nama bisa dipakai di tabel karyawan.
      q = sb.from('catatan_absensi')
        .select('waktu, jenis, tepat_waktu, status_area, keterangan, ' +
                'karyawan!inner(nama, jabatan)')
        .gte('waktu', r.mulai)
        .lte('waktu', r.selesai)
        .ilike('karyawan.nama', '%' + cari + '%')
        .order('waktu', { ascending: false });
    }
    return q;
  }

  function muatSemua() {
    muatRingkasan();
    muatRiwayat();
  }

  function muatRingkasan() {
    var r = rentangWaktu();
    sb.from('catatan_absensi')
      .select('jenis, tepat_waktu')
      .gte('waktu', r.mulai)
      .lte('waktu', r.selesai)
      .then(function (res) {
        if (res.error) return gagal(res.error);
        var data = res.data || [];
        var hadir = data.filter(function (x) { return x.jenis === 'checkin'; }).length;
        var terlambat = data.filter(function (x) {
          return x.jenis === 'checkin' && x.tepat_waktu === false;
        }).length;
        var izin = data.filter(function (x) { return x.jenis === 'izin'; }).length;
        document.getElementById('ringkas-hadir').textContent = hadir;
        document.getElementById('ringkas-terlambat').textContent = terlambat;
        document.getElementById('ringkas-izin').textContent = izin;
      });
  }

  function muatRiwayat() {
    queryDasar().limit(200).then(function (res) {
      if (res.error) return gagal(res.error);
      var data = res.data || [];
      var tbody = document.getElementById('tabel-riwayat');
      if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="tengah">' +
          'Belum ada data pada periode ini.</td></tr>';
      } else {
        tbody.innerHTML = data.map(barisRiwayat).join('');
      }
      muatRekap(data);
    });
  }

  function muatRekap(data) {
    // Agregasi per karyawan di sisi klien (skala v1 kecil, aman).
    var peta = {};
    data.forEach(function (x) {
      var nama = (x.karyawan && x.karyawan.nama) || '—';
      var jab = (x.karyawan && x.karyawan.jabatan) || '';
      if (!peta[nama]) {
        peta[nama] = { nama: nama, jabatan: jab, hadir: 0, terlambat: 0, izin: 0, lembur: 0 };
      }
      var r = peta[nama];
      if (x.jenis === 'checkin') {
        r.hadir++;
        if (x.tepat_waktu === false) r.terlambat++;
      } else if (x.jenis === 'izin') { r.izin++; }
      else if (x.jenis === 'lembur') { r.lembur++; }
    });
    var daftar = Object.keys(peta).map(function (k) { return peta[k]; });
    var tbody = document.getElementById('tabel-rekap');
    if (!daftar.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="tengah">' +
        'Belum ada data pada periode ini.</td></tr>';
      return;
    }
    tbody.innerHTML = daftar.map(function (r) {
      return '<tr><td><strong>' + aman(r.nama) + '</strong></td>' +
        '<td>' + aman(r.jabatan) + '</td>' +
        '<td>' + r.hadir + '</td>' +
        '<td>' + (r.terlambat ? '<span class="chip chip-merah">' + r.terlambat + '</span>' : '0') + '</td>' +
        '<td>' + r.izin + '</td>' +
        '<td>' + r.lembur + '</td></tr>';
    }).join('');
  }

  // ---- 4. Render & util -----------------------------------------------
  var LABEL_JENIS = { checkin: 'Check-in', checkout: 'Check-out', izin: 'Izin', lembur: 'Lembur' };
  var KELAS_JENIS = { checkin: 'chip-hijau', checkout: 'chip-biru', izin: 'chip-kuning', lembur: 'chip-biru' };

  function barisRiwayat(x) {
    var nama = (x.karyawan && x.karyawan.nama) || '—';
    var waktu = new Date(x.waktu).toLocaleString('id-ID', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    var tepat = x.tepat_waktu === null || x.tepat_waktu === undefined
      ? '<span class="chip chip-abu">—</span>'
      : (x.tepat_waktu
          ? '<span class="chip chip-hijau">Tepat waktu</span>'
          : '<span class="chip chip-merah">Terlambat</span>');
    var area = x.status_area === 'di_dalam'
      ? '<span class="chip chip-hijau">Di dalam area</span>'
      : (x.status_area === 'di_luar'
          ? '<span class="chip chip-merah">Di luar area</span>'
          : '<span class="chip chip-abu">Tak diketahui</span>');
    return '<tr><td>' + waktu + '</td>' +
      '<td><strong>' + aman(nama) + '</strong></td>' +
      '<td><span class="chip ' + (KELAS_JENIS[x.jenis] || 'chip-abu') + '">' +
        (LABEL_JENIS[x.jenis] || aman(x.jenis)) + '</span></td>' +
      '<td>' + tepat + '</td>' +
      '<td>' + area + '</td>' +
      '<td>' + aman(x.keterangan || '') + '</td></tr>';
  }

  function aman(teks) {
    return String(teks).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isiKosong() {
    document.getElementById('ringkas-hadir').textContent = '–';
    document.getElementById('ringkas-terlambat').textContent = '–';
    document.getElementById('ringkas-izin').textContent = '–';
    document.getElementById('tabel-riwayat').innerHTML =
      '<tr><td colspan="6" class="tengah">Menunggu konfigurasi.</td></tr>';
    document.getElementById('tabel-rekap').innerHTML =
      '<tr><td colspan="6" class="tengah">Menunggu konfigurasi.</td></tr>';
  }

  function gagal(err) {
    tampilPesan('Gagal memuat data: ' + (err.message || err) +
      ' — periksa Project URL & anon key di config.js.', 'error');
  }
})();
