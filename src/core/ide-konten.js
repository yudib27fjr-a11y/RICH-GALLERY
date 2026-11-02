/* Ide & jadwal konten video (TikTok / Reels) untuk pembuat konten.
   - Bank ide bawaan khusus toko bunga + ide tambahan dari admin.
   - Jadwal mingguan (bawaan Selasa & Jumat): tiap jadwal mendapat 1 ide (bergilir), momen hari besar diutamakan bila sudah dekat.
   - Pemicu: hari H & sehari sebelumnya muncul di pengingat tugas pembuat konten; target = minimal video per minggu + target tayangan per video. */
import { getSettings, all } from "./db.js";

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

/* ---- Ide dari katalog Rich Gallery sendiri: tiap kategori yang dijual punya ide khusus + kata kunci TikTok & hashtag Reels yang pas.
   {p} = produk terlaris / contoh di kategori itu, {m} = harga mulai, {d} = daftar 3 harga dari katalog. ---- */
const I = (judul, hook, langkah, caption) => ({ judul, hook, langkah, caption });
const KAT_IDE = {
  "BUKET BUNGA": { cari: "buket bunga aesthetic", tag: "buketbunga", ide: [
    I("Proses bikin {p}", "Bikin {p} pesanan customer hari ini 🌸", ["Bunga & kertas di meja (shot dari atas)", "Timelapse merangkai", "Ikat pita + kartu ucapan", "Reveal {p} diputar pelan"], "{p} 💐 Mulai {m} — order via WA / DM ya!"),
    I("Pilihan buket bunga sesuai budget", "Budget segini dapat buket bunga apa? 💰", ["Tampilkan buket {d}", "Teks harga besar di tiap buket", "Ajak pilih favorit di komen"], "Buket bunga mulai {m} 🌷 Kamu pilih yang mana?")] },
  "BUKET WISUDA": { cari: "buket wisuda", tag: "buketwisuda", ide: [
    I("Ide kado wisuda: {p}", "Kado wisuda yang pasti difoto bareng 🎓", ["Buket di tangan model / manekin bertoga", "Close-up detail (selempang / boneka toga)", "Info: bisa antar ke kampus"], "Selamat para wisudawan 🎓 {p} mulai {m}. Order H-3 biar aman!"),
    I("POV: antar buket wisuda ke kampus", "POV: florist antar pesanan wisuda ke kampus 🛵", ["Packing buket", "Perjalanan (shot singkat)", "Serah terima / reaksi (minta izin)"], "Hari wisuda = hari sibuk kami 🥹 Terima kasih sudah percaya Rich Gallery!")] },
  "BUKET UANG": { cari: "buket uang", tag: "buketuang", ide: [
    I("Proses bikin {p} tanpa merusak uang", "Uangnya aman, nggak dilem! Ini caranya 💸", ["Pecahan uang yang dipakai", "Teknik lipat & jepit (close-up)", "Rangkai di buket", "Reveal + nominal"], "{p} 💸 Bisa isi sendiri atau dari kami. Jasa mulai {m}"),
    I("Buket uang: isi 100rb vs 1 juta", "Bedanya buket uang isi 100rb sama 1 juta 😳", ["Buket isi kecil", "Buket isi besar", "Bandingkan sebelahan"], "Mau isi berapa? Semua bisa custom 💸 #buketuang")] },
  "BUKET SNACK": { cari: "buket snack", tag: "buketsnack", ide: [
    I("Bikin {p} dari jajanan favorit", "Buket snack isinya jajanan kesukaan dia 🍫", ["Jajanan disusun di meja", "Proses rangkai (timelapse)", "Reveal {p}"], "Kado lucu & bisa dimakan 😆 Mulai {m}, isi bisa request!")] },
  "BUKET COSTUME": { cari: "buket custom", tag: "buketcustom", ide: [
    I("Request customer paling unik minggu ini", "Customer request buket kayak gini… bisa nggak ya? 🤔", ["Tunjukkan chat request (sensor nama)", "Proses pengerjaan", "Hasil jadi"], "Request apa pun kami usahakan 🤍 Buket custom mulai {m}")] },
  "BUKET BONEKA": { cari: "buket boneka", tag: "buketboneka", ide: [
    I("{p}: gemesin buat kado", "Buket boneka yang bikin dia senyum terus 🧸", ["Boneka + bunga di meja", "Rangkai", "Reveal + close-up wajah boneka"], "{p} 🧸 Mulai {m}. Cocok buat ulang tahun & anniversary!")] },
  "SINGLE FLOWER": { cari: "single flower bouquet", tag: "singleflower", ide: [
    I("Bunga satuan mulai {m}: kado kecil berarti", "Nggak perlu mahal buat bikin dia senang 🌹", ["1 tangkai mawar dibungkus", "Variasi warna", "Ajak kasih ke orang tersayang"], "Single flower mulai {m} 🌹 Kecil tapi berkesan")] },
  "ROUND BUKET": { cari: "round bouquet", tag: "roundbouquet", ide: [
    I("Round buket: tampilan bulat penuh", "Buket bulat penuh kayak gini favorit banget 😍", ["Shot dari atas (bentuk bulat)", "Putar 360°", "Close-up bunga"], "{p} 💐 Mulai {m}")] },
  "BAG FLOWERS": { cari: "flower bag", tag: "flowerbag", ide: [
    I("Flower bag: bunga dalam tas", "Bunga tapi bentuknya tas! 👜🌸", ["Tas kosong", "Isi bunga satu-satu", "Reveal"], "Flower bag mulai {m} — unik buat kado 👜")] },
  "HOT BALON": { cari: "buket balon", tag: "buketbalon", ide: [
    I("Bikin {p} + tulisan nama", "Balon dengan nama dia + bunga di dalam 🎈", ["Pompa balon (timelapse)", "Tempel stiker nama", "Reveal"], "{p} 🎈 Bisa tulis nama & ucapan. Mulai {m}")] },
  "BLOOM BOX": { cari: "bloom box bunga", tag: "bloombox", ide: [
    I("Unboxing {p}", "Buka box ini pelan-pelan… 🎁", ["Box tertutup", "Buka tutup (slow motion)", "Close-up bunga di dalam"], "{p} 🎁 Mulai {m}. Cocok buat kejutan!")] },
  "SNACK TOWER": { cari: "snack tower", tag: "snacktower", ide: [
    I("Menyusun snack tower setinggi ini", "Snack tower setinggi ini isinya apa aja? 🗼", ["Susun jajanan bertingkat (timelapse)", "Tunjukkan tinggi", "Reveal"], "Snack tower mulai {m} 🗼 Bisa custom isi")] },
  "STANDING UCAPAN": { cari: "standing flower ucapan", tag: "standingflower", ide: [
    I("Standing ucapan untuk acara", "Ucapan selamat yang kelihatan dari jauh ✨", ["Rangka kosong", "Pasang bunga & tulisan (timelapse)", "Hasil di lokasi acara"], "Standing ucapan mulai {m} — grand opening, pernikahan, duka cita")] },
  "STANDING FLOWER": { cari: "standing flower", tag: "standingflower", ide: [
    I("Standing flower dari nol", "Dari rangka kosong jadi standing flower mewah 🌺", ["Rangka", "Rangkai bunga", "Reveal di lokasi"], "{p} 🌺 Mulai {m}")] },
  "SEWA SESERAHAN": { cari: "hantaran seserahan", tag: "seserahan", ide: [
    I("Isi seserahan / hantaran nikah", "Seserahan aesthetic buat hari bahagia 💍", ["Kotak / tray kosong", "Tata isi satu-satu", "Reveal semua tray"], "Sewa seserahan mulai {m} 💍 Tinggal bawa ke acara!")] },
  "MAHAR": { cari: "mahar uang unik", tag: "maharunik", ide: [
    I("Bikin mahar uang bentuk unik", "Mahar uang bisa jadi bentuk kayak gini 💍", ["Uang mahar", "Proses lipat & susun", "Reveal dalam frame / box"], "{p} 💍 Mulai {m}. Bentuk & nominal bisa request")] },
  "BUKET HARI GURU": { cari: "buket hari guru", tag: "hariguru", ide: [
    I("Kado Hari Guru: {p}", "Kado buat guru tersayang 👩‍🏫", ["Buket di meja guru (properti)", "Close-up kartu terima kasih", "Info pesan kolektif kelas"], "Selamat Hari Guru 🤍 {p} mulai {m}. Bisa patungan sekelas!")] },
  "BUKET BAG WISUDA": { cari: "buket wisuda tas", tag: "buketwisuda", ide: [
    I("Buket tas wisuda", "Buket wisuda bentuk tas, beda dari yang lain 🎓", ["Tas buket", "Isi bunga / snack", "Reveal + toga"], "{p} 🎓 Mulai {m}")] },
  "BUKET PROFESI": { cari: "buket profesi", tag: "buketprofesi", ide: [
    I("Buket profesi: dokter, polisi, perawat", "Buket sesuai profesinya! 👩‍⚕️👮", ["Boneka profesi", "Rangkai", "Reveal beberapa profesi"], "{p} mulai {m} — buat yang baru dilantik / lulus profesi")] },
  "VAS BUNGA": { cari: "rangkaian bunga vas", tag: "flowervase", ide: [
    I("Rangkaian bunga di vas untuk meja", "Meja kerja jadi lebih seger 🌼", ["Vas kosong", "Rangkai", "Taruh di meja / ruang tamu"], "{p} 🌼 Mulai {m}. Cocok buat kantor & rumah")] },
  "HAMPERS": { cari: "hampers aesthetic", tag: "hampers", ide: [
    I("Packing hampers pesanan", "Packing hampers yang bikin penerimanya happy 🎁", ["Isi hampers satu-satu", "Tutup & ikat pita", "Reveal"], "Hampers mulai {m} 🎁 Isi bisa request")] },
};
const judulKecil = x => String(x || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/(\d+)k\b/gi, "$1K");
const rpS = n => n >= 1e6 ? (n / 1e6).toLocaleString("id-ID") + " jt" : Math.round(n / 1000) + "rb";
/** Ide dari kategori yang benar-benar dijual toko, urut dari kategori paling laku 60 hari terakhir. */
export function ideToko(){
  let produk = [], laku = [];
  try { produk = all("SELECT kategori, nama, harga FROM products WHERE aktif = 1 AND harga > 0"); } catch { return []; }
  try { laku = all(`SELECT si.kategori, si.nama, SUM(si.qty) n FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.batal_at IS NULL AND s.tgl >= date('now', '-60 day') GROUP BY si.kategori, si.nama ORDER BY n DESC`); } catch {}
  const skor = {}; for (const r of laku) skor[r.kategori] = (skor[r.kategori] || 0) + r.n;
  const kats = Object.keys(KAT_IDE).filter(k => produk.some(p => p.kategori === k)).sort((a, b) => (skor[b] || 0) - (skor[a] || 0));
  const per = kats.map(k => {
    const P = produk.filter(p => p.kategori === k).sort((a, b) => a.harga - b.harga), K = KAT_IDE[k];
    const top = (laku.find(r => r.kategori === k) || {}).nama || P[Math.floor(P.length / 2)].nama;
    const harga = [...new Set(P.map(p => p.harga))], d = [harga[0], harga[Math.floor(harga.length / 2)], harga[harga.length - 1]].filter((v, i, a) => a.indexOf(v) === i);
    const isi = t => String(t).replace(/\{p\}/g, judulKecil(top)).replace(/\{m\}/g, rpS(harga[0])).replace(/\{d\}/g, d.map(rpS).join(", "));
    return K.ide.map(x => ({ judul: isi(x.judul), kategori: judulKecil(k), hook: isi(x.hook), langkah: x.langkah.map(isi), caption: isi(x.caption),
      tag: `#${K.tag} #richgallery #floristindramayu #buketindramayu`, cari: K.cari, rtag: K.tag, katalog: true }));
  });
  // selang-seling: ide pertama tiap kategori (paling laku dulu), lalu ide kedua
  const hasil = []; for (let i = 0; i < 2; i++) for (const L of per) if (L[i]) hasil.push(L[i]);
  hasil.info = Object.fromEntries(kats.map(k => { const P = produk.filter(p => p.kategori === k).sort((a, b) => a.harga - b.harga);
    return [k, { top: judulKecil((laku.find(r => r.kategori === k) || {}).nama || P[Math.floor(P.length / 2)].nama), mulai: rpS(P[0].harga) }]; }));
  hasil.kats = kats;
  return hasil;
}

/* Kata kunci pencarian singkat (TikTok) & hashtag (Reels) yang paling pas untuk tiap ide bawaan, urut sama dengan IDE_BAWAAN. */
const REF_BAWAAN = [["proses buket bunga", "bouquettutorial"], ["buket custom before after", "buketcustom"], ["reaksi dapat buket", "surprisebouquet"], ["tebak harga buket", "buketbunga"],
  ["tutorial buket uang", "buketuang"], ["asmr packing buket", "asmrpacking"], ["pov florist", "floristlife"], ["arti warna bunga", "artibunga"], ["buket sesuai budget", "buketmurah"],
  ["cara merawat bunga", "flowercare"], ["transisi buket bunga", "buketbunga"], ["dekorasi ulang tahun", "dekorasiulangtahun"], ["kartu ucapan buket", "kartuucapan"],
  ["florist menjawab", "floristindonesia"], ["wrapping buket korea", "buketkorea"], ["rekap pesanan florist", "floristindonesia"], ["buket wisuda", "buketwisuda"],
  ["testimoni florist", "buketbunga"], ["unboxing bunga segar", "freshflowers"], ["bikin buket 1 menit", "buketbunga"]];
IDE_BAWAAN.forEach((x, i) => { const r = REF_BAWAAN[i]; if (r) { x.cari = r[0]; x.rtag = r[1]; } });

/* Momen hari besar (bulan-hari). Ide momen diutamakan bila tanggalnya dalam 14 hari ke depan. */
export const MOMEN = [
  ["01-01", "Tahun baru", "hampers tahun baru", "HAMPERS"], ["02-14", "Valentine", "buket valentine", "BLOOM BOX"], ["03-08", "Hari Perempuan Internasional", "buket bunga hari perempuan", "BUKET BUNGA"],
  ["04-21", "Hari Kartini", "buket hari kartini", "BUKET BUNGA"], ["05-02", "Hari Pendidikan", "buket guru", "BUKET HARI GURU"], ["07-23", "Hari Anak", "buket snack anak", "BUKET SNACK"],
  ["08-17", "HUT RI", "buket merah putih", "BUKET BUNGA"], ["10-16", "Hari Bos", "bunga meja kantor", "VAS BUNGA"], ["11-11", "Promo 11.11", "promo buket bunga", ""],
  ["11-25", "Hari Guru", "buket hari guru", "BUKET HARI GURU"], ["12-12", "Promo 12.12", "promo buket bunga", ""], ["12-22", "Hari Ibu", "buket hari ibu", "BUKET BUNGA"], ["12-25", "Natal", "hampers natal", "HAMPERS"],
];
/** Ide momen hari besar, memakai produk Rich Gallery yang paling cocok (kategori momen, atau kategori terlaris untuk promo). */
const ideMomen = (nama, cari, kat, toko) => {
  const k = (kat && toko.info && toko.info[kat]) ? kat : (toko.kats || [])[0], inf = (toko.info || {})[k];
  const produk = inf ? inf.top : "buket bunga", mulai = inf ? ` mulai ${inf.mulai}` : "", promo = /promo/i.test(nama);
  return { rtag: nama.replace(/[^a-z0-9]/gi, "").toLowerCase(), ...T(promo ? `${nama}: ${produk} harga spesial` : `${nama}: kado ${produk}`, "Momen",
    promo ? `${nama} di Rich Gallery! ${produk} lagi spesial 🎉` : `${nama} sebentar lagi — kado paling pas: ${produk} 🎁`,
    [`Tampilkan ${produk} (putar 360°)`, promo ? "Teks besar: harga normal dicoret → harga promo" : `Properti / tulisan bertema ${nama}`, "Close-up detail & kartu ucapan", "Akhiri dengan cara order + batas waktu"],
    `${promo ? "Promo" : "Spesial"} ${nama} 💐 ${produk}${mulai}. Order dari sekarang biar nggak kehabisan!`, `#${nama.replace(/[^A-Za-z0-9]/g, "").toLowerCase()} #richgallery #floristindramayu #buketindramayu`, cari) };
};

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
/** Link contoh: TikTok = pencarian kata kunci singkat ide itu; Reels = halaman hashtag Instagram (pencarian kata kunci IG tidak bisa dibuka lewat link). */
const tagDari = ide => ide.rtag || (String(ide.tag || "").match(/#(\w+)/) || [])[1] || String(ide.cari || ide.judul || "buketbunga").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 30);
const linkRef = ide => ({
  tiktok: "https://www.tiktok.com/search?q=" + encodeURIComponent(ide.cari || ide.judul),
  reels: "https://www.instagram.com/explore/tags/" + encodeURIComponent(tagDari(ide)) + "/",
  tiktok_tag: "https://www.tiktok.com/tag/" + encodeURIComponent(tagDari(ide)),
  cari: ide.cari || ide.judul, hashtag: tagDari(ide),
});

/** Rencana konten satu minggu (Senin–Minggu) berisi tanggal tiap jadwal + idenya. `selesai` = jumlah video yang sudah dibuat minggu itu. */
export function rencanaMinggu(tgl, { s = getSettings(), min = 2, selesai = 0 } = {}){
  const J = setelanJadwal(s, min), a = senin(tgl);
  // Ide dari katalog toko diutamakan; ide umum toko bunga hanya dipakai bila katalog masih sedikit.
  const toko = ideToko(), bank = [...J.ide.map(x => ({ ...x, sendiri: true })), ...toko, ...(toko.length >= 10 ? [] : IDE_BAWAAN)];
  const mingguKe = Math.floor(Date.parse(a + "T00:00:00Z") / (7 * 864e5));
  const slot = J.hari.map((h, i) => {
    const t = geser(a, h - 1);
    // Momen hari besar 0–14 hari setelah tanggal jadwal → ide momen (sekali per momen per minggu)
    const m = MOMEN.map(([md, nama, cari, kat]) => { let d = `${t.slice(0, 4)}-${md}`; if (d < t) d = `${Number(t.slice(0, 4)) + 1}-${md}`; return { d, nama, cari, kat, jarak: (Date.parse(d) - Date.parse(t)) / 864e5 }; })
      .filter(x => x.jarak <= 14).sort((x, y) => x.jarak - y.jarak)[0];
    const ide = m && i === 0 ? { ...ideMomen(m.nama, m.cari, m.kat, toko), momen: { nama: m.nama, tgl: m.d } } : bank[(mingguKe * J.hari.length + i) % bank.length];
    return { tgl: t, hari: HARI[new Date(t + "T00:00:00Z").getUTCDay()], ide: { ...ide, ref: ide.ref ? { lain: ide.ref, ...linkRef(ide) } : linkRef(ide) }, selesai: i < selesai };
  });
  return { dari: a, sampai: geser(a, 6), slot, target_views: J.target_views, min: Math.max(min, 1), hari: J.hari, jam: J.jam };
}
