# KFGQPC Uthmanic Hafs Quran Data

- Source dataset: `hafsData_v2-0.json`
- Source SHA-256: `c3f6a913f5fd83d2d8458de8cfeb987b484255514902ae1d01e6837c5c4415b7`
- Official package URL: https://download.qurancomplex.gov.sa/resources_dev/UthmanicHafs_v2-0.zip
- Official developer documentation: https://qurancomplex.gov.sa/en/techquran/dev/
- Auditable mirror: https://github.com/quran-center/quran-meta/blob/682fa9d28607e8a8ec514e5eb33e73ead3b7f909/examples/data-check/data/hafsData_v2-0.json
- Prepared asset: `kfgqpc-hafs-v2.0.json`

The prepared asset retains the complete `aya_text` value for all 6,236 ayat and groups the values by 114 surahs. Descriptive, search, page, and line metadata unused by the application is omitted to reduce APK size. No Quran text normalization or character replacement is performed.

Run the validator and preparation script with:

```text
node scripts/prepare-kfgqpc-hafs.cjs <path-to-hafsData_v2-0.json>
```
