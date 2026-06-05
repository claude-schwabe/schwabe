# schwabe — documentation site

The static marketing/docs site for **schwabe**. Pure HTML + CSS
with a sprinkle of vanilla JS — no build step, no framework, no npm dependencies,
matching the project's dependency-free ethos.

## Files

```
docs/
├── index.html              # the whole site (single page)
├── styles.css              # dark terminal/fire theme
├── main.js                 # copy-to-clipboard (vanilla, optional)
├── README.md               # you are here
└── assets/
    ├── live-tui.png        # the live btop-style burn dashboard (terminal)
    └── nett-hier.png       # the "Nett hier" Baden-Württemberg sticker
```

Open `index.html` directly in a browser to preview locally — it works from the
file system. To preview over HTTP (so the clipboard API works without quirks):

```bash
cd docs && python3 -m http.server 8000   # then visit http://localhost:8000
```

## Publish on GitHub Pages

GitHub Pages serves this site from the `/docs` folder on the `main` branch.

1. Push these files to `main` (the `docs/` folder must be committed).
2. On GitHub, open the repo → **Settings**.
3. In the left sidebar, click **Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Under **Branch**, select **`main`** and the folder **`/docs`**.
6. Click **Save**.

GitHub builds the site within a minute or two. The published URL will be:

**https://claude-schwabe.github.io/schwabe/**

(All links and asset paths in `index.html` are relative, so the site works both at
that subpath and from the file system — no further config needed.)

## ⚠️ Important: private repos need a paid plan

GitHub Pages on a **private** repository requires a **paid plan (GitHub Pro,
Team, or Enterprise)**. This repository is currently private, so to publish the
site you must either:

- **Make the repo public** (Settings → General → Danger Zone → Change visibility), or
- **Upgrade** the account/org to a plan that allows Pages on private repos.

On the free plan with a private repo, the Pages settings will be unavailable or
the build will not publish.

## Notes

- The site links to `https://www.npmjs.com/package/schwabe` and
  `https://github.com/claude-schwabe/schwabe`. Update those if the package or
  repo location changes.
- The optional Google Font is loaded via `<link>`; the site falls back cleanly to
  system monospace/sans fonts if it fails to load (e.g. offline).
- Honors `prefers-reduced-motion` and `prefers-color-scheme: dark`.
