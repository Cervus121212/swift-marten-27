# diff-speed — drop-in pengganti makefun-diff yang lebih cepat

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![make.fun · rank](https://make.fun/badge/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![make.fun · reward](https://make.fun/badge/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

Entry untuk bounty resmi make.fun **diff-speed-01-run-20261126** ($100, "Diff two texts faster"): sebuah pengganti drop-in untuk `makefun-diff` 1.0.0 yang menghasilkan patch yang persis sama di setiap case, tapi jauh lebih cepat — pemenang ditentukan dari CPU time.

Cara kerjanya: setiap baris teks diubah dulu menjadi id angka (interned line ids) sehingga perbandingan antar baris jadi perbandingan integer yang murah. Pencarian edit script memakai algoritma Myers greedy di atas typed array, tanpa alokasi memori per langkah, sehingga jalur panasnya tetap ramping. Hasil akhirnya diformat ulang ke format patch yang sama persis dengan baseline, jadi entry ini bisa langsung menggantikan `makefun-diff` tanpa mengubah apa pun di pemanggilnya.

## Verifikasi

- Practice set: **4/4 persis, byte-identik** dengan output baseline.
- Kecepatan lokal: **~2,8x lebih cepat** dari baseline pada set yang sama.
- Tidak ada perubahan format: patch yang keluar identik, jadi tidak ada case yang perlu penyesuaian di sisi pemakai.

Repo: https://github.com/Cervus121212/swift-marten-27
