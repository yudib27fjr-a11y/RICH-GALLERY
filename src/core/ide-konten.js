/* Ide & jadwal konten video (TikTok / Reels) untuk pembuat konten.
   - Bank ide bawaan khusus toko bunga + ide tambahan dari admin.
   - Jadwal mingguan (bawaan Selasa & Jumat): tiap jadwal mendapat 1 ide (bergilir), momen hari besar diutamakan bila sudah dekat.
   - Pemicu: hari H & sehari sebelumnya muncul di pengingat tugas pembuat konten; target = minimal video per minggu + target tayangan per video. */
import { getSettings } from "./db.js";

const T = (judul, kategori, hook, langkah, caption, tag, cari) => ({ judul, kategori, hook, langkah, caption, tag, cari });
export const IDE_BAWAAN = [
  T("Proses bikin buket dari nol (timelapse)", "Behind the scene", "Dari bunga satuan jadi buket kayak gini 😍", ["Shot bunga satuan di meja", "Timelapse merangkai (HP di tripod dari atas)", "Bungkus & ikat pita", "Reveal buket jadi + logo toko"], "Prosesnya bikin tenang 🌸 Mau dibuatin juga? Order lewat WA/DM ya!", "#buketbunga #floristindramayu #prosesbuket #behindthescene #buketwisuda", "proses merangkai buket bunga timelapse"),
  T("Before – after buket custom", "Transformasi", "Request customer: 'yang simple tapi mewah' — hasilnya…", ["Tunjukkan bahan mentah (before)", "Transisi jentik jari / tutup kamera", "Hasil jadi diputar 360°"], "Before vs after 🤍 Kamu tim simple atau tim mewah?", "#beforeafter #buketcustom #florist #buketbunga", "before after bouquet transition"),
  T("Unboxing paket buket ke customer", "Testimoni", "Reaksi customer waktu buketnya datang 🥹", ["Rekam saat serah terima (minta izin)", "Close-up kartu ucapan", "Ekspresi penerima", "Teks: 'makasih sudah percaya Rich Gallery'"], "Momen paling ditunggu: reaksi penerima 💐", "#reaksi #suprise #buketbunga #kado", "reaksi terima buket bunga surprise"),
  T("Tebak harga buket", "Interaktif", "Menurut kamu buket ini harganya berapa? 🤔", ["Tunjukkan 3 buket berbeda", "Beri waktu 3 detik tiap buket (teks 'tebak!')", "Reveal harga satu-satu"], "Tebakan kamu bener nggak? Tulis di komen 👇", "#tebakharga #buketmurah #buketbunga #floristmurah", "tebak harga buket bunga"),
  T("Buket uang: cara melipat & merangkai", "Tutorial", "Cara bikin buket uang biar rapi & nggak rusak uangnya 💸", ["Tunjukkan pecahan uang", "Teknik lipat (close-up tangan)", "Susun di rangka", "Hasil akhir + kisaran jasa"], "Uang tetap aman, tampilannya mewah ✨ Bisa request nominal!", "#buketuang #buketuangmurah #kadowisuda #moneybouquet", "tutorial buket uang lipat"),
  T("1 menit packing pesanan (ASMR)", "ASMR", "ASMR packing buket 🔊", ["Tanpa musik, suara kertas & pita", "Close-up tiap langkah", "Akhiri dengan stiker toko ditempel"], "Satisfying nggak? 🎧", "#asmr #packingorder #florist #buketbunga", "asmr packing bouquet"),
  T("POV: jadi florist sehari", "Storytelling", "POV: kamu kerja di toko bunga 🌷", ["Buka toko pagi", "Cek bunga datang", "Rangkai pesanan", "Antar ke kurir", "Tutup toko"], "Sehari di Rich Gallery 🌸 Mau ikut seharian?", "#pov #dayinmylife #florist #kerjaditokobunga", "pov kerja di toko bunga"),
  T("Arti warna bunga", "Edukasi", "Jangan salah kasih bunga! Ini arti warnanya 🌹", ["Mawar merah = cinta", "Putih = tulus", "Kuning = persahabatan", "Pink = kagum/terima kasih", "Ajak pilih warna untuk orang tersayang"], "Simpan biar nggak salah pilih 💾", "#artibunga #mawar #edukasibunga #buketbunga", "arti warna bunga mawar"),
  T("Rekomendasi buket sesuai budget", "Edukasi", "Budget 50rb, 100rb, 200rb dapat buket apa? 💰", ["Tampilkan buket 50K", "Buket 100K", "Buket 200K+", "Ajak DM untuk custom"], "Ada untuk semua budget 🤍", "#buketmurah #buketbunga #kadomurah #floristindramayu", "buket bunga sesuai budget"),
  T("Kesalahan saat merawat bunga", "Edukasi", "Bunga cepat layu? Mungkin kamu lakukan ini 😱", ["Air tidak diganti", "Kena matahari langsung", "Batang tidak dipotong miring", "Tips: ganti air tiap 2 hari"], "Biar buketnya awet lebih lama 🌿", "#tipsbunga #rawatbunga #bungasegar", "tips merawat bunga potong agar awet"),
  T("Trend transisi outfit → buket", "Trend", "Ikut trend transisi pakai buket 🌸", ["Cari audio yang sedang ramai di TikTok", "Gerakan sesuai beat", "Transisi ke buket di tangan"], "Ikutan trend dulu 😆", "#trend #transisi #buketbunga #fyp", "trend transisi buket bunga"),
  T("Behind the scene pesanan dekorasi", "Behind the scene", "Dari ruangan kosong jadi kayak gini ✨", ["Ruangan kosong", "Proses pasang balon/bunga (timelapse)", "Reveal dekorasi jadi"], "Mau dekor ulang tahun / lamaran? Rich Gallery siap 🎈", "#dekorasi #dekorasiulangtahun #dekorlamaran #balon", "timelapse dekorasi ulang tahun balon"),
  T("Kartu ucapan paling lucu bulan ini", "Hiburan", "Isi kartu ucapan dari customer yang bikin senyum 😂", ["Tampilkan 3 kartu (tanpa nama)", "Reaksi tim", "Ajak tulis ide ucapan di komen"], "Kalian tim romantis atau tim lucu? 💌", "#kartuucapan #ucapanlucu #kado", "kartu ucapan lucu buket"),
  T("Q&A: pertanyaan yang sering ditanya", "Edukasi", "Bisa kirim hari ini? Bisa custom? Kami jawab!", ["Pertanyaan 1: pengiriman", "Pertanyaan 2: custom", "Pertanyaan 3: pembayaran DP", "Ajak tanya di komen"], "Ada pertanyaan lain? Tulis di komen ya 👇", "#faq #florist #buketbunga #orderbuket", "faq toko bunga"),
  T("Satu bunga, 3 gaya bungkus", "Kreatif", "1 jenis bunga bisa jadi 3 gaya beda! 🎀", ["Gaya korea", "Gaya klasik", "Gaya minimalis", "Tanya: suka yang mana?"], "1, 2, atau 3? 🤍", "#buketkorea #wrappingbouquet #buketbunga", "cara bungkus buket gaya korea"),
  T("Rekap pesanan minggu ini", "Showcase", "Pesanan minggu ini di Rich Gallery 📦", ["Kumpulan foto/video buket minggu ini", "Musik ceria, 1 detik per buket", "Akhiri dengan info order"], "Terima kasih yang sudah order minggu ini 🙏", "#rekappesanan #buketbunga #florist", "rekap pesanan buket minggu ini"),
  T("Buket wisuda: ide kado untuk wisudawan", "Momen", "Kado wisuda yang pasti dipajang 🎓", ["Buket bunga + boneka toga", "Buket uang wisuda", "Buket snack", "Info: bisa diantar ke kampus"], "Selamat buat para wisudawan! 🎓 Order dari sekarang ya", "#buketwisuda #kadowisuda #wisuda", "buket wisuda ide kado"),
  T("Customer cerita (testimoni singkat)", "Testimoni", "Kenapa beli buket di Rich Gallery? Ini kata mereka 💬", ["Minta 1–2 customer bicara 5 detik", "Atau tampilkan chat testimoni (sensor nama)", "Tutup dengan logo"], "Terima kasih atas kepercayaannya 🤍", "#testimoni #buketbunga #florist", "testimoni customer toko bunga"),
  T("Bunga baru datang!", "Produk", "Bunga segar baru datang hari ini 🌷", ["Buka box bunga", "Tunjukkan jenis & warna", "Ajak pesan sebelum habis"], "Fresh dari kebun 🌿 Siap dirangkai untuk kamu!", "#bungasegar #freshflowers #florist", "unboxing fresh flowers florist"),
  T("Tantangan: buket dalam 60 detik", "Hiburan", "Bisa nggak bikin buket dalam 60 detik? ⏱️", ["Timer di layar", "Rangkai secepatnya", "Hasil + reaksi"], "Nilai dari 1–10? 😂", "#challenge #60detik #buketbunga", "challenge bikin buket 1 menit"),
];

/* Momen hari besar (bulan-hari). Ide momen diutamakan bila tanggalnya dalam 14 hari ke depan. */
export const MOMEN = [
  ["01-01", "Tahun baru", "buket tahun baru"], ["02-14", "Valentine", "buket valentine"], ["03-08", "Hari Perempuan Internasional", "buket hari perempuan"],
  ["04-21", "Hari Kartini", "kado hari kartini"], ["05-02", "Hari Pendidikan", "buket guru"], ["07-23", "Hari Anak", "buket snack anak"],
  ["08-17", "HUT RI", "buket merah putih"], ["10-16", "Hari Bos", "buket kado atasan"], ["11-11", "Promo 11.11", "promo buket 11.11"],
  ["11-25", "Hari Guru", "kado hari guru buket"], ["12-12", "Promo 12.12", "promo buket 12.12"], ["12-22", "Hari Ibu", "buket hari ibu"], ["12-25", "Natal", "buket natal"],
];
const ideMomen = (nama, cari) => T(`Konten ${nama}: ide kado & promo`, "Momen", `${nama} sebentar lagi! Sudah siapkan kado? 🎁`,
  ["Tampilkan 3 pilihan buket bertema " + nama, "Info harga / promo khusus", "Ajak order lebih awal (stok terbatas)", "Tutup dengan cara order"],
  `Spesial ${nama} 💐 Order dari sekarang biar nggak kehabisan!`, `#${nama.replace(/[^A-Za-z0-9]/g, "").toLowerCase()} #buketbunga #kado #floristindramayu`, cari);

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const geser = (tgl, n) => { const d = new Date(tgl + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const senin = tgl => { const d = new Date(tgl + "T00:00:00Z"), h = (d.getUTCDay() + 6) % 7; return geser(tgl, -h); };

/** Pengaturan jadwal: hari (1=Senin … 7=Minggu), target tayangan per video, ide tambahan admin. */
export function setelanJadwal(s = getSettings(), minPerMinggu = 2){
  const j = s.jadwal_konten || {};
  const bawaan = [[], [5], [2, 5], [1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5]][Math.min(5, Math.max(1, minPerMinggu))];
  const hari = Array.isArray(j.hari) && j.hari.length ? [...new Set(j.hari.map(Number).filter(h => h >= 1 && h <= 7))].sort() : bawaan;
  const ide = (Array.isArray(j.ide) ? j.ide : []).filter(x => x && x.judul);
  return { hari, target_views: Math.max(0, Number(j.target_views ?? 1000) || 0), jam: /^\d{2}:\d{2}$/.test(j.jam || "") ? j.jam : "10:00", ide };
}
const linkRef = cari => ({
  tiktok: "https://www.tiktok.com/search/video?q=" + encodeURIComponent(cari),
  reels: "https://www.instagram.com/explore/search/keyword/?q=" + encodeURIComponent(cari),
});

/** Rencana konten satu minggu (Senin–Minggu) berisi tanggal tiap jadwal + idenya. `selesai` = jumlah video yang sudah dibuat minggu itu. */
export function rencanaMinggu(tgl, { s = getSettings(), min = 2, selesai = 0 } = {}){
  const J = setelanJadwal(s, min), a = senin(tgl);
  const bank = [...J.ide.map(x => ({ ...x, sendiri: true })), ...IDE_BAWAAN];
  const mingguKe = Math.floor(Date.parse(a + "T00:00:00Z") / (7 * 864e5));
  const slot = J.hari.map((h, i) => {
    const t = geser(a, h - 1);
    // Momen hari besar 0–14 hari setelah tanggal jadwal → ide momen (sekali per momen per minggu)
    const m = MOMEN.map(([md, nama, cari]) => { let d = `${t.slice(0, 4)}-${md}`; if (d < t) d = `${Number(t.slice(0, 4)) + 1}-${md}`; return { d, nama, cari, jarak: (Date.parse(d) - Date.parse(t)) / 864e5 }; })
      .filter(x => x.jarak <= 14).sort((x, y) => x.jarak - y.jarak)[0];
    const ide = m && i === 0 ? { ...ideMomen(m.nama, m.cari), momen: { nama: m.nama, tgl: m.d } } : bank[(mingguKe * J.hari.length + i) % bank.length];
    return { tgl: t, hari: HARI[new Date(t + "T00:00:00Z").getUTCDay()], ide: { ...ide, ref: ide.ref ? { lain: ide.ref, ...linkRef(ide.cari || ide.judul) } : linkRef(ide.cari || ide.judul) }, selesai: i < selesai };
  });
  return { dari: a, sampai: geser(a, 6), slot, target_views: J.target_views, min: Math.max(min, 1), hari: J.hari, jam: J.jam };
}
