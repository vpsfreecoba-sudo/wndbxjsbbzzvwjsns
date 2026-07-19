// /api/tiktok-avatar.js
// Serverless function (Vercel) yang mengambil foto profil TikTok terbaru secara
// server-side (browser tidak bisa fetch langsung ke tiktok.com karena diblokir CORS).
// Dipanggil dari client lewat: /api/tiktok-avatar?username=xd_minn

export default async function handler(req, res) {
    const rawUsername = (req.query.username || "xd_minn").toString();
    const username = rawUsername.replace(/[^a-zA-Z0-9._]/g, "");

    if (!username) {
        res.status(400).json({ error: "Username tidak valid" });
        return;
    }

    try {
        const response = await fetch(`https://www.tiktok.com/@${username}`, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9",
            },
        });

        if (!response.ok) {
            throw new Error(`TikTok merespons status ${response.status}`);
        }

        const html = await response.text();

        // Ambil dari meta og:image (paling stabil untuk foto profil publik)
        let avatarUrl = null;
        const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        if (ogMatch) {
            avatarUrl = ogMatch[1].replace(/&amp;/g, "&");
        }

        // Fallback: cari avatarLarger di dalam JSON SIGI_STATE yang di-embed TikTok
        if (!avatarUrl) {
            const jsonMatch = html.match(/"avatarLarger":"(https:[^"]+)"/i);
            if (jsonMatch) {
                avatarUrl = jsonMatch[1].replace(/\\u002F/g, "/").replace(/&amp;/g, "&");
            }
        }

        if (!avatarUrl) {
            throw new Error("Foto profil tidak ditemukan di halaman TikTok");
        }

        // Cache di edge Vercel selama 30 menit supaya tidak membanjiri TikTok
        // dengan request tiap ada pengunjung, tapi tetap "real-time-ish".
        res.setHeader(
            "Cache-Control",
            "s-maxage=1800, stale-while-revalidate=3600"
        );
        res.status(200).json({ avatar: avatarUrl, username });
    } catch (err) {
        res.status(502).json({ error: err.message || "Gagal mengambil foto profil TikTok" });
    }
}
