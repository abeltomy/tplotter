# Graph Plotter Web

This folder contains a static React + Plotly version of the desktop graph plotter.

## Features

- Upload `.csv`, `.xlsx`, or `.xls`
- Switch Excel sheets
- Pick an X column
- Convert time-like X values into `Milliseconds`, `Seconds`, `Minutes`, `Hours`, or `Days`
- Choose datetime reference as `First value`, `Start of day`, or `Start of month`
- Plot multiple Y series
- Assign series to 1, 2, or 3 Y-axes
- Set X and Y min/max ranges
- Change labels, colors, title, grid, and legend

## Local preview

Open `index.html` in a browser.

If the browser blocks local file loading for some CDN assets, run a tiny static server instead:

```powershell
cd webapp
python -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages

1. Create a GitHub repository and push this project.
2. In GitHub, go to `Settings -> Pages`.
3. Under `Build and deployment`, choose `Deploy from a branch`.
4. Select your branch, then choose the `/webapp` folder if your repo UI offers it.
5. If GitHub Pages only allows `/root` or `/docs`, copy this folder to `/docs` or rename `webapp` to `docs`.
6. Save, wait for deployment, and open the published Pages URL.

## Notes

- This version is fully static and runs in the browser, so it works well with GitHub Pages.
- It uses CDN-hosted `React`, `Plotly`, `PapaParse`, and `SheetJS`.
