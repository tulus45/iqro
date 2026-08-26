# QCF Tajweed V4 runtime source

The complete online Tajweed renderer uses the Quran Foundation QCF Tajweed V4
glyph system:

- Mushaf ID: `19`
- Word field: `code_v2`
- Verification field: `text_qpc_hafs`
- Layout metadata: `page_number` (pages 1 through 604)
- Runtime API: `https://api.quran.com/api/v4/verses/...`
- Page fonts: `https://verses.quran.foundation/fonts/quran/hafs/v4/colrv1/woff2/p{PAGE}.woff2`

The implementation follows the official font-rendering guide:

https://github.com/quran/qf-api-docs/blob/main/docs/tutorials/fonts/font-rendering.md

QCF data and fonts are requested at runtime and are not permanently bundled in
the APK. Verse API requests use `cache: no-store`; page fonts use only the
platform/CDN's transient web cache. This follows Quran Foundation guidance to
avoid shipping stale Quran content:

https://api-docs.quran.com/legal/developer-terms/

Before a verse is displayed with QCF glyphs, its verse key, word structure,
page number, glyph range, and `text_qpc_hafs` reading are checked against the
verified local KFGQPC Hafs text. The page font is then loaded before the glyph
replaces the visible Unicode fallback. If the network, API, browser feature, or
font load is unavailable, the application keeps using its verified local
Unicode Quran text.

Repository-wide verification is available through:

```text
npm run quran:tajweed:qcf-verify
```

Last full source audit: 2026-08-26.
