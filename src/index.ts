import { Hono } from 'hono'

type Assets = {
    fetch: (req: Request) => Response
}

type Bindings = {
    BASELINK: string
    ASSETS?: Assets
}

const app = new Hono<{ Bindings: Bindings }>()

// --- MD5 (RFC 1321) --------------------------------------------------
// crypto.subtle.digest() does not support MD5, so we compute it ourselves.
function md5(bytes: Uint8Array): string {
    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ]
    const K = new Uint32Array(64)
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32)

    const msg = new Uint8Array(((bytes.length + 8) >> 6) * 64 + 64)
    msg.set(bytes)
    msg[bytes.length] = 0x80
    const bitLen = bytes.length * 8
    const dv = new DataView(msg.buffer)
    // 64-bit little-endian bit length: low 32 bits first, then high 32 bits
    dv.setUint32(msg.length - 8, bitLen >>> 0, true)
    dv.setUint32(msg.length - 4, Math.floor(bitLen / 0x100000000), true)

    let a0 = 0x67452301
    let b0 = 0xefcdab89
    let c0 = 0x98badcfe
    let d0 = 0x10325476
    const M = new Uint32Array(16)

    for (let off = 0; off < msg.length; off += 64) {
        for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true)
        let A = a0, B = b0, C = c0, D = d0
        for (let i = 0; i < 64; i++) {
            let F: number
            let g: number
            if (i < 16) { F = (B & C) | (~B & D); g = i }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
            else { F = C ^ (B | ~D); g = (7 * i) % 16 }
            F = (F + A + K[i] + M[g]) >>> 0
            A = D; D = C; C = B
            B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0
        }
        a0 = (a0 + A) >>> 0
        b0 = (b0 + B) >>> 0
        c0 = (c0 + C) >>> 0
        d0 = (d0 + D) >>> 0
    }
    const hex = (n: number) =>
        [0, 1, 2, 3].map((b) => ((n >>> (b * 8)) & 0xff).toString(16).padStart(2, '0')).join('')
    return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}

// Serves store.db straight from the repo's assets folder,
// falling back to fetching it from BASELINK if needed.
async function loadStoreDb(env: Bindings, origin: string): Promise<ArrayBuffer> {
    if (env.ASSETS) {
        const res = await env.ASSETS.fetch(new Request(`https://${origin}/store.db`))
        if (res.ok) return res.arrayBuffer()
    }
    return fetch(`https://${env.BASELINK}/store.db`).then((r) => r.arrayBuffer())
}
// ---------------------------------------------------------------------

app.onError((_err, c) => {
    return c.json({ error: 'Internal Server Error' }, { status: 500 })
})

// Serve anything else (images, index.html, ...) from the assets folder.
app.notFound(async (c) => {
    if (c.env.ASSETS) {
        const res = await c.env.ASSETS.fetch(new Request(c.req.url))
        if (res.status !== 404) return res
    }
    return c.redirect('https://github.com/Repressoh/Homebrew-Store-Repo')
})

app.get('/store.db', async (c) => {
    const fileData = await loadStoreDb(c.env, new URL(c.req.url).host)

    return c.newResponse(fileData, {
        headers: {
            'Content-Type': 'application/x-sqlite3',
            'Content-Disposition': 'attachment; filename="store.db"',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
    })
})

app.get('/update/homebrew.elf', (c) => {
    return c.redirect('https://github.com/LightningMods/PS4-Store/releases/latest/download/homebrew.elf')
})

app.get('/update/homebrew.elf.sig', (c) => {
    return c.redirect('https://github.com/LightningMods/PS4-Store/releases/latest/download/homebrew.elf.sig')
})

app.get('/update/remote.md5', (c) => {
    return c.redirect('https://github.com/LightningMods/PS4-Store/releases/latest/download/remote.md5')
})

app.get('/api.php', async (c) => {
    const fileData = await loadStoreDb(c.env, new URL(c.req.url).host)
    const md5hash = md5(new Uint8Array(fileData))

    return c.json({ hash: md5hash }, 200, {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
    })
})

export default app
