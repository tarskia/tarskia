# TAR-45 browser verification

Baseline: tarskia/tarskia main 78576645060bdf6fe89282b407dbf26c5c783b0d. New host: TAR-45. Chrome headless, 1440×900, n8n and supabase curated gallery. JSON files record complete default/expanded node rectangles and camera transforms. PNGs show both states. The recording exercises expansion, collapse, wheel, Ctrl+wheel, pan, double click, zoom limits and keyboard selection.

## React Flow 11 behavior inventory

Explicit mount: nodes not draggable/connectable; no visible-only filtering; no selection elevation; deleteKeyCode null; minZoom .05, maxZoom 2; panOnDrag true; zoomOnScroll and zoomOnPinch true; preventScrolling true; noWheelClassName nowheel; no React Flow edges; custom nodes and edge overlays.

Relevant defaults: left/middle pan; right/ctrl+mouse excluded; noPanClassName nopan; noDragClassName nodrag; selection key Shift; pan activation Space; platform Meta/Control zoom/multiselect; wheel pan disabled; double-click zoom enabled (Shift halves); infinite translate extent; snap disabled; origin [0,0]; fitView disabled; initial camera [0,0,1]; nodes focusable/selectable; selectionOnDrag false/full. Unchanged d3 v3 defaults: clickDistance 0, tapDistance 10, touch delay 500ms, wheel delay 150ms, double-click transition 250ms, touchable detection via maxTouchPoints/ontouchstart.

Wheel delta copied from installed RF11: -deltaY × (deltaMode==1 ? .05 : deltaMode ? 1 : .002) × (ctrlKey and Mac ? 10 : 1). Same gesture zoom bounds and getViewportForBounds arithmetic. Programmatic writes are now synchronous and do not notify user gesture callbacks. Shift inhibits drag while retaining wheel/double-click zoom. An out-and-back gesture now reliably settles.

## Results and limits

Default and expanded node counts and camera transforms match main. Wheel/Ctrl+wheel, pan deltas, double-click and .05/2 limits are compared at the same content-relative pointer position (new host includes the pre-existing one-pixel canvas border; old React Flow mounted inside it). Keyboard Tab+Enter selects and opens the inspector; Escape clears both. Mounted React Profiler test verifies zero node/edge commits over 12 pan moves.

Main entry before: 503.20kB /129.90kB gzip. New host before final small review corrections: 500.74kB /129.71kB gzip; diagram vendor falls227.09→127.39kB (72.06→40.39gzip). Developer debug computation/panel loads on demand. Final build measurements are in the PR.

Matt's physical trackpad/touch feel check and Safari device testing were not performed by automation and remain a manual follow-up. Browser automation checks Ctrl+wheel pinch semantics, not physical device feel.
