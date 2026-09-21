# Unfold

Interactive mathematics: homotopies, geometric realizations, carriers, and ambiguity.

**Website:** https://mhebtehaj.github.io/unfold/

## Pages

- `index.html` — homepage
- `homotopy-explorer.html` — homotopies, obstructions, map classes, and homotopy types
- `realization-carrier-explorer.html` — realizations, carriers, building maps, prisms, and cones
- `ambiguity-explorer.html` — ambiguity complexes and query geometry

Each explorer is a standalone HTML file. No installation or build step is required.
The mathematical references are linked inside the explorers.

The homepage is styled by `engine/unfold.css`, the shared stylesheet the explorers
will move onto. Its tiles, brand and footer are generated from the `SITE` list in
`engine/page/shell.js`: to add or change a tile, edit `SITE` and run
`npm run site -- --write`.

## Update the website

Edit the HTML files and commit the changes to `main`. GitHub Pages publishes that
branch automatically. You can also use GitHub's **Add file → Upload files** to
upload revised pages, keeping their filenames the same.

Publishing configuration: **Settings → Pages → Deploy from a branch → main → /(root)**.
The `.nojekyll` file tells GitHub to serve these files directly.

## Local preview

    python3 -m http.server 8000

Then open <http://localhost:8000>. A server is needed rather than opening the file
directly, because ES modules do not load over `file://`.

## Development

    npm install          # playwright, for the baseline and the test runner
    npm test             # the test suite (or open /tests/run.html)
    npm run layers       # engine layering invariants
    npm run site         # check the homepage is in step with SITE
    npm run baseline     # compare the pages against the captured baseline
    npm run parity       # an engine redraw against the shipped drawing, pixel for pixel
    npm run probe        # dump every page's live control surface

`baseline/` records what the site looked like and did before the engine work began —
resolved mark geometry, screenshots in both colour schemes, and every design token
resolved to sRGB. It is the fidelity gate for the rebuild.

See `docs/` for the engine plan and phase notes.
