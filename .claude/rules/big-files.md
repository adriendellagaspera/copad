`src/App.svelte` (1202 lines), `src/Settings.svelte` (674 lines) and `src/Editor.svelte`
(585 lines) are the three largest files in the tree — App.svelte alone is room
resolution/wiring, leader election, TURN/ICE, share-dialog data, the local library,
palette actions, and more, per `docs/architecture.md`'s own "Wiring" section.

- Never `Read` one of these without an offset/limit range, or a specific reason the
  task genuinely needs the whole file.
- Orient first: `rg -n '^\s*(export )?(function|class|const \w+ = \(|<script)' src/App.svelte`
  (or the Svelte-aware equivalent) gives the shape without the body.
- To find a symbol, `rg -n '<name>'` then read a bounded range around the hit.
- If a task genuinely needs whole-file comprehension, say so and stop: that's a signal
  the file is doing too much, not that the context should be spent reading it whole.
