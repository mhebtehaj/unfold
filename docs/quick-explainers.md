# Quick explanations on Unfold

Live site: https://mhebtehaj.github.io/unfold/

GitHub Pages publishes `main` from the repository root. A small lesson needs no engine integration or build step. Use the shared template and preserve existing explorers.

1. Fetch `origin`. Work from current `origin/main` in an isolated worktree if the checkout contains other work. Do not publish an unrelated development branch.
2. Create a page and homepage link:

   ```sh
   python3 tools/new-explainer.py topic-name "Topic name" --description "What this example helps you see."
   ```

3. Replace the content marker in the generated page. Use `hall-trees-morse.html` as a working example: short background, a concrete example, controls, and precise source links. Separate proved facts from proposed research connections.
4. Existing inline visualizations: keep their editable fragments under `explainers/sources/`. Export each with the installed Visualize skill's `scripts/render.py SOURCE DESTINATION`, saving the standalone output in `explainers/`. Use only its supported standalone state APIs. The page embeds it as:

   ```html
   <div class="example">
     <iframe data-demo src="explainers/example.html" title="Descriptive accessible title"></iframe>
     <p class="caption"><a href="explainers/example.html">Open this example separately</a></p>
   </div>
   ```

   Shared `assets/explainer.js` follows the export's content height. New demonstrations can instead use ordinary standalone HTML/SVG/JS; match the existing page format.
5. Serve locally (`python3 -m http.server 8000`); check controls, console errors, narrow layout, and source claims. Check the actual outcome of the mathematical example. Existing engine tests need not be expanded for an isolated lesson.
6. Review the exact diff, commit only the lesson files and homepage link, then fetch again. Incorporate any newer `origin/main` safely and push without force when publishing is authorized. Never include unrelated research notes or untracked files.
7. Verify the public page and homepage link after deployment. Share the live URL, not merely a commit or local preview.

The helper creates files only; it never commits, pushes, or edits existing lessons. Normal standalone pages remain usable without the helper or the local Visualize installation.
