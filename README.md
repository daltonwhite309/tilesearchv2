# Daltons Tile Search

A client-side React web app for searching uploaded truck pallet data in memory.

## Local development

```powershell
npm install
npm run dev
```

Then open [http://localhost:4173](http://localhost:4173).

## Production build

```powershell
npm run build
npm run preview
```

The app is fully client-side. Uploaded CSV, PDF, and image data stay in browser memory and do not require a Node API server.

## Vercel deployment

1. Push this folder to GitHub.
2. In Vercel, click `Add New...` -> `Project`.
3. Import the GitHub repo.
4. Keep the project root at this folder.
5. Framework preset: `Vite`.
6. Build command: `npm run build`
7. Output directory: `dist`
8. Install command: `npm install`
9. Click `Deploy`.

Vercel will build the app as a static site. No custom server is required.

The app is tuned for one shipment date per upload.

## CSV columns

The upload expects these columns:

- `ship_date`
- `source_page` (optional for CSV, automatic for PDF/image imports)
- `pallet_number`
- `pallet_lp` (optional reference field)
- `order_number`
- `order_type`
- `item_number` (optional)
- `product_description`
- `quantity` + `uom`, or separate quantity columns:
- `cartons_qty`
- `pieces_qty`
- `square_feet_qty`
- `other_qty`

Notes:

- Product description is the default search mode.
- Each upload should contain a single `ship_date`.
- Order numbers can be uploaded as split columns or as a combined value like `18221618 SI`.
- Pallet numbers should be the short actual pallet number when available, such as `14` or `This is pallet: 14`.
- PDF/image imports now use page-based pallet numbers like `P1`, `P2`, `P3` as the primary pallet grouping key.
- `pallet_lp` is kept as a reference field and is not used as the primary pallet grouping key.
- `uom` is the unit of measurement for the quantity, such as `SF`, `CT`, or `PC`.
- PDF/OCR parsing can keep multiple quantities on the same row, such as `5 CT + 7 PC`.
- PDF imports use client-side `pdf.js` text extraction and open an editable review screen before saving.
- OCR and PDF/image parsing rely on browser-loaded libraries from CDNs.

## Sample data

Use [sample-data.csv](./sample-data.csv) if you want a sample CSV for testing.
