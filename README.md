# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/xb1jaa/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/xb1jaa/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, dependency-free drop-in replacement for make.fun's own csv-reader
1.0.0. It reads broken CSV files — unclosed quotes, stray carriage returns,
ragged rows, junk after a closing quote, embedded line breaks, a leading
BOM — and returns exactly the answer csv-reader returns: `{columns, rows,
errors}` for each `{text, header}` input.

## How it is fast

Most records hold no quote before their line break, so they are taken whole
with `indexOf` / `slice` / `split` instead of walking character by
character. Only records that hold a quote go through the field-by-field
reader, and that reader jumps from quote to quote with `indexOf` instead of
scanning every character. Quoted fields whose content needs no repair are
sliced out as they stand; only fields holding doubled quotes or line breaks
pay for a repair pass. On the practice set it parses about four times
faster than the house baseline.

## Layout

- `solve.js` — the reader. `run(input)` takes `{text, header}` and returns
  `{columns, rows, errors}`. Dependency-free ES module.
- `main.ts` — the program the harness runs: reads every case from
  `/input/cases.json`, answers each with `run`, writes
  `/output/answers.json`. Turns V8's incremental marking off first, as the
  house baseline does.
- `package.json` — `{"type": "module"}`.

## Run it

```sh
node main.ts
```

Outside a container, `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR` stand in
for `/input` and `/output`.

## License

MIT — see [LICENSE](LICENSE).
