(function () {
  const React = window.React;
  const ReactDOM = window.ReactDOM;
  const { useMemo, useRef, useState } = React;
  const createElement = React.createElement;
  const numberFormatter = new Intl.NumberFormat("en-US");
  const VALID_ORDER_TYPES = ["SI", "S6", "S7", "C8"];
  const VALID_ORDER_TYPE_SET = new Set(VALID_ORDER_TYPES);
  const PDF_WORKER_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const OCR_WORKER_SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@v5.0.0/dist/worker.min.js";
  const OCR_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0";
  const OCR_CORE_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.0.0";
  const OCR_RENDER_SCALE = 3;
  const OCR_ROTATIONS = [0, 90, 180, 270];
  const OCR_MAX_PAGE_CONCURRENCY = 2;
  const OCR_CACHE_STORAGE_KEY = "daltons-tile-search-ocr-cache-v1";
  const PARSER_VERSION = "deterministic-order-slice-v1";
  const OCR_VERSION = "optimized-ocr-v1";
  const OCR_BASELINE_VERSION = "baseline-ocr-v1";
  const LOW_OCR_CONFIDENCE_THRESHOLD = 70;
  const MIN_PDF_TEXT_CHARACTERS = 80;
  const MIN_PDF_TEXT_LINES = 3;
  const EMSER_ROTATION_HINTS = [
    { pattern: /PALLET\s+CONTENT\s+LIST/i, score: 35, label: "Pallet Content List" },
    { pattern: /RELATED\s+SO#?/i, score: 24, label: "Related SO#" },
    { pattern: /REL\s+TYPE/i, score: 18, label: "Rel Type" },
    { pattern: /ITEM\s*#/i, score: 16, label: "Item #" },
    { pattern: /DESCRIPTION/i, score: 16, label: "Description" },
    { pattern: /EMSER\s+TILE/i, score: 14, label: "Emser Tile" },
    { pattern: /THIS\s+IS\s+PALLET/i, score: 12, label: "This is Pallet" },
    { pattern: /PALLET\s+LP/i, score: 10, label: "Pallet LP" }
  ];
  const EMSER_CUSTOMER_NAME_PATTERN =
    /\b(?:HOMES?|CONSTRUCT(?:ION|IO)?|BUILDERS?|CARPET|FLOORING|PROSOURCE|INTERIORS?|CONTRACTING|COMPANY|INC|LLC|LTD)\b/i;
  const PDF_IGNORED_LINE_PATTERN =
    /(ship from|ship to|carrier|tracking|barcode|page\s+\d+|page \d+ of \d+|totals?\b|description\b|cartons?\b|qty\b|quantity\b|order number\b|item number\b|uom\b|related so#?|rel type\b|pallet content list|emser tile)/i;
  const PRODUCT_HINT_PATTERN =
    /\b(?:\d{1,2}X\d{1,2}|tile|porcelain|ceramic|mosaic|beige|white|ivory|gray|grey|graphite|mint|matte|gloss|polished|rectified|board|gout|grout|thinset|trim|membrane|slab|wall|floor|oxford|vidaro|hydroblok|tec|story|schluter)\b/i;
  const UOM_ALIASES = {
    CT: ["CT", "CTN", "CTNS", "CARTON", "CARTONS"],
    PC: ["PC", "PCS", "PIECE", "PIECES"],
    EA: ["EA", "EACH"],
    SF: ["SF", "SQFT", "SQ FT", "S/F", "SQUARE FOOT", "SQUARE FEET"]
  };
  const UOM_LOOKUP = Object.fromEntries(
    Object.entries(UOM_ALIASES).flatMap(([canonicalValue, aliases]) =>
      aliases.map((alias) => [alias, canonicalValue])
    )
  );
  const UOM_REGEX_SOURCE =
    "CARTONS?|CTNS?|CTN|CT|PIECES?|PCS?|PC|EA|EACH|SF|SQFT|SQ\\.?\\s*FT|S\\/F|SQUARE\\s+(?:FOOT|FEET)";
  const QUANTITY_VALUE_REGEX_SOURCE = "\\d[\\d,]*(?:\\.\\d+)?";
  const ORDER_TYPE_NORMALIZATION_LOOKUP = {
    SI: { normalized: "SI", confidence: "high" },
    S6: { normalized: "S6", confidence: "high" },
    S7: { normalized: "S7", confidence: "high" },
    C8: { normalized: "C8", confidence: "high" },
    S1: { normalized: "SI", confidence: "low" },
    SL: { normalized: "SI", confidence: "low" },
    "5I": { normalized: "SI", confidence: "low" },
    SG: { normalized: "S6", confidence: "low" },
    S5: { normalized: "S6", confidence: "low" },
    SS: { normalized: "S6", confidence: "low" },
    "S$": { normalized: "S6", confidence: "low" },
    SB: { normalized: "S6", confidence: "low" }
  };

  const SEARCH_MODES = [
    {
      id: "product",
      label: "Product",
      placeholder: "Search product description"
    },
    {
      id: "order",
      label: "Order",
      placeholder: "Search order number"
    },
    {
      id: "pallet",
      label: "Pallet",
      placeholder: "Search pallet number"
    }
  ];

  const SAMPLE_DATA_CSV = [
    "ship_date,pallet_number,order_number,order_type,product_description,quantity,uom",
    "2026-04-22,14,18221618,SI,OXFORD BEIGE SW 12X24,320,SF",
    "2026-04-22,14,18221618,SI,TEC GROUT,84,PC",
    "2026-04-22,15,18221631,S6,VIDARO MINT GL 2X10,112.5,SF",
    "2026-04-22,15,18221631,S6,HYDROBLOK BOARD,64,PC",
    "2026-04-22,16,18221645,S7,OXFORD BEIGE SW 12X24,256,SF",
    "2026-04-22,16,18221645,S7,TEC THINSET,9,CT",
    "2026-04-22,17,18221652,C8,VIDARO MINT GL 2X10,97.5,SF",
    "2026-04-22,17,18221652,C8,HYDROBLOK BOARD,48,PC",
    "2026-04-22,18,18221702,SI,STORY WHITE MATTE 3X12,189,SF",
    "2026-04-22,18,18221702,SI,TEC GROUT,72,PC",
    "2026-04-22,19,18221718,S7,OXFORD GRAPHITE SW 12X24,304,SF",
    "2026-04-22,19,18221718,S7,SCHLUTER TRIM,36,PC"
  ].join("\n");

  const COLUMN_ALIASES = {
    ship_date: ["ship_date", "ship date", "shipdate"],
    pallet_number: ["pallet_number", "pallet number", "pallet"],
    pallet_lp: ["pallet_lp", "pallet lp", "lp", "lpn", "pallet_lpn"],
    source_page: ["source_page", "source page", "page", "page_number", "page number"],
    order_number: ["order_number", "order number", "order"],
    order_type: ["order_type", "order type", "type"],
    item_number: ["item_number", "item number", "item", "sku", "product code"],
    product_description: ["product_description", "product description", "description", "product"],
    quantity: ["quantity", "qty"],
    uom: ["uom", "unit", "unit of measurement", "unit_of_measurement", "cartons", "carton"],
    cartons_qty: ["cartons_qty", "cartons qty", "ct_qty", "ct qty", "carton_qty", "carton qty"],
    pieces_qty: ["pieces_qty", "pieces qty", "pcs_qty", "pcs qty", "pc_qty", "pc qty", "ea_qty", "ea qty"],
    square_feet_qty: ["square_feet_qty", "square feet qty", "square_foot_qty", "sqft_qty", "sq ft qty", "sf_qty", "sf qty"],
    other_qty: ["other_qty", "other qty"]
  };

  function h(type, props) {
    const children = Array.prototype.slice.call(arguments, 2).flat();
    return createElement(type, props, ...children);
  }

  function safeText(value) {
    return String(value ?? "").trim();
  }

  function safeUpper(value) {
    return safeText(value).toUpperCase();
  }

  function safeLower(value) {
    return safeText(value).toLowerCase();
  }

  function formatDurationMs(durationMs) {
    const normalizedDurationMs = Number(durationMs);
    if (!Number.isFinite(normalizedDurationMs) || normalizedDurationMs <= 0) {
      return "";
    }

    const totalSeconds = Math.max(1, Math.round(normalizedDurationMs / 1000));
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  function loadOcrCacheStore() {
    try {
      if (!window.localStorage) {
        return {};
      }

      const rawCache = window.localStorage.getItem(OCR_CACHE_STORAGE_KEY);
      if (!rawCache) {
        return {};
      }

      const parsedCache = JSON.parse(rawCache);
      return parsedCache && typeof parsedCache === "object" ? parsedCache : {};
    } catch (error) {
      console.error("Unable to read OCR cache", error);
      return {};
    }
  }

  function saveOcrCacheStore(cacheStore) {
    try {
      if (!window.localStorage) {
        return;
      }

      window.localStorage.setItem(OCR_CACHE_STORAGE_KEY, JSON.stringify(cacheStore || {}));
    } catch (error) {
      console.error("Unable to save OCR cache", error);
    }
  }

  function clearOcrCacheStore() {
    try {
      if (window.localStorage) {
        window.localStorage.removeItem(OCR_CACHE_STORAGE_KEY);
      }
    } catch (error) {
      console.error("Unable to clear OCR cache", error);
    }
  }

  function getOcrCacheEntryCount(cacheStore) {
    return Object.keys(cacheStore || {}).length;
  }

  function buildFileCacheSignature(file) {
    return [safeText(file?.name), Number(file?.size || 0), Number(file?.lastModified || 0), safeText(file?.type)].join("|");
  }

  function buildOcrCachePageKey(fileSignature, pageNumber) {
    return `${safeText(fileSignature)}::page::${Number(pageNumber || 0)}`;
  }

  function getCachedOcrPageResult(cacheStore, fileSignature, pageNumber) {
    const cacheKey = buildOcrCachePageKey(fileSignature, pageNumber);
    const cacheEntry = cacheStore && cacheStore[cacheKey] ? cacheStore[cacheKey] : null;
    return cacheEntry && cacheEntry.optimized ? cacheEntry.optimized : cacheEntry;
  }

  function getCachedOcrPageVariant(cacheStore, fileSignature, pageNumber, variant) {
    const cacheKey = buildOcrCachePageKey(fileSignature, pageNumber);
    const cacheEntry = cacheStore && cacheStore[cacheKey] ? cacheStore[cacheKey] : null;
    if (!cacheEntry || typeof cacheEntry !== "object") {
      return null;
    }

    return cacheEntry[safeText(variant) || "optimized"] || null;
  }

  function setCachedOcrPageResult(cacheStore, fileSignature, pageNumber, value, variant) {
    const cacheKey = buildOcrCachePageKey(fileSignature, pageNumber);
    const cacheVariant = safeText(variant) || "optimized";
    const existingEntry = cacheStore[cacheKey] && typeof cacheStore[cacheKey] === "object" ? cacheStore[cacheKey] : {};
    existingEntry[cacheVariant] = {
      text: safeText(value?.text),
      confidence: Number.isFinite(value?.confidence) ? Number(value.confidence) : null,
      selectedRotation: Number.isFinite(value?.selectedRotation) ? Number(value.selectedRotation) : null,
      rotationResults: Array.isArray(value?.rotationResults) ? value.rotationResults : [],
      score: Number.isFinite(value?.score) ? Number(value.score) : 0,
      matchedHints: Array.isArray(value?.matchedHints) ? value.matchedHints : [],
      orderNumbers: Array.isArray(value?.orderNumbers) ? value.orderNumbers : [],
      ocrVersion: safeText(value?.ocrVersion || (cacheVariant === "baseline" ? OCR_BASELINE_VERSION : OCR_VERSION)),
      cachedAt: Date.now()
    };
    cacheStore[cacheKey] = existingEntry;
    saveOcrCacheStore(cacheStore);
    return existingEntry[cacheVariant];
  }

  async function mapWithConcurrency(items, concurrency, mapper) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const limit = Math.max(1, Math.min(Number(concurrency) || 1, normalizedItems.length || 1));
    const results = new Array(normalizedItems.length);
    let nextIndex = 0;

    async function consume(slotIndex) {
      while (nextIndex < normalizedItems.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(normalizedItems[currentIndex], currentIndex, slotIndex);
      }
    }

    await Promise.all(Array.from({ length: limit }, (_, slotIndex) => consume(slotIndex)));
    return results;
  }

  function safeIncludes(value, searchValue) {
    return safeText(value).includes(safeText(searchValue));
  }

  function normalizeText(value) {
    return safeLower(value).replace(/\s+/g, " ").trim();
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function digitsOnly(value) {
    return String(value ?? "").replace(/\D/g, "");
  }

  function buildPagePalletNumber(pageNumber) {
    const normalizedPageNumber = Number(pageNumber);
    return normalizedPageNumber > 0 ? `P${normalizedPageNumber}` : "P?";
  }

  function parseCsv(text) {
    const rows = [];
    let currentRow = [];
    let currentValue = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];

      if (inQuotes) {
        if (character === "\"") {
          if (text[index + 1] === "\"") {
            currentValue += "\"";
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          currentValue += character;
        }
        continue;
      }

      if (character === "\"") {
        inQuotes = true;
        continue;
      }

      if (character === ",") {
        currentRow.push(currentValue);
        currentValue = "";
        continue;
      }

      if (character === "\n") {
        currentRow.push(currentValue);
        rows.push(currentRow);
        currentRow = [];
        currentValue = "";
        continue;
      }

      if (character !== "\r") {
        currentValue += character;
      }
    }

    currentRow.push(currentValue);
    if (currentRow.length > 1 || normalizeText(currentRow[0])) {
      rows.push(currentRow);
    }

    return rows;
  }

  function getHeaderIndex(headers, aliases) {
    for (let index = 0; index < headers.length; index += 1) {
      if (aliases.includes(headers[index])) {
        return index;
      }
    }
    return -1;
  }

  function parseCount(value) {
    const cleaned = safeText(value).replace(/,/g, "");
    if (!cleaned) {
      return 0;
    }

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseOrder(orderNumberValue, orderTypeValue) {
    const rawNumber = safeText(orderNumberValue);
    const orderTypeDetails = getOrderTypeDetails(orderTypeValue);
    const rawType = orderTypeDetails.orderType;
    const combinedMatch = rawNumber.match(/(\d{8})\s*([A-Za-z0-9]{2})?/);
    const orderNumber = combinedMatch ? combinedMatch[1] : digitsOnly(rawNumber).slice(0, 8);
    const combinedType = combinedMatch && combinedMatch[2] ? getOrderTypeDetails(combinedMatch[2]).orderType : "";
    const orderType = rawType || combinedType || "";
    const display = [orderNumber, orderType].filter(Boolean).join(" ");

    return {
      number: orderNumber || rawNumber,
      type: orderType,
      display: display || rawNumber
    };
  }

  function extractPalletNumber(value) {
    const raw = safeText(value);
    const detectedActualPallet = extractPalletIdentifiersFromText(raw)[0];
    const directShortPalletMatch = raw.match(/^\d{1,2}$/);
    const palletMatch =
      directShortPalletMatch ||
      raw.match(/pallet\s*lp\s*#?\s*([A-Za-z0-9-]+)/i) ||
      raw.match(/#\s*([A-Za-z0-9-]+)/);

    if (detectedActualPallet) {
      return safeUpper(detectedActualPallet);
    }

    if (palletMatch) {
      return safeUpper(palletMatch[1]);
    }

    return safeUpper(raw);
  }

  function formatPalletLabel(palletNumber) {
    if (!palletNumber) {
      return "Pallet";
    }

    if (/^P\d+$/i.test(String(palletNumber))) {
      return `Pallet # ${String(palletNumber).replace(/^P/i, "")}`;
    }

    return /^page\s+\d+/i.test(String(palletNumber)) ? String(palletNumber) : `Pallet # ${palletNumber}`;
  }

  function compareShipDates(left, right) {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);

    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return rightTime - leftTime;
    }

    return String(right || "").localeCompare(String(left || ""));
  }

  function comparePalletNumbers(left, right) {
    const leftPageMatch = safeText(left).match(/^P(\d+)$/i);
    const rightPageMatch = safeText(right).match(/^P(\d+)$/i);
    if (leftPageMatch && rightPageMatch) {
      return Number(leftPageMatch[1]) - Number(rightPageMatch[1]);
    }

    const leftNumber = Number(left);
    const rightNumber = Number(right);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }

    return String(left || "").localeCompare(String(right || ""));
  }

  function createRowId(prefix) {
    return `${prefix || "row"}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  }

  function normalizeOrderTypeToken(value) {
    return safeUpper(value).replace(/[^A-Z0-9$]/g, "");
  }

  function getOrderTypeDetails(value) {
    const rawOrderType = normalizeOrderTypeToken(value);
    const directMatch = ORDER_TYPE_NORMALIZATION_LOOKUP[rawOrderType];

    if (directMatch) {
      return {
        rawOrderType,
        orderType: directMatch.normalized,
        confidence: directMatch.confidence,
        isValid: true
      };
    }

    if (/^S[0-9A-Z$]$/.test(rawOrderType) || /^5[0-9A-Z$]$/.test(rawOrderType)) {
      if (/[1IL]$/.test(rawOrderType)) {
        return {
          rawOrderType,
          orderType: "SI",
          confidence: "low",
          isValid: true
        };
      }

      if (/[5678BGS$]$/.test(rawOrderType)) {
        return {
          rawOrderType,
          orderType: rawOrderType.endsWith("7") ? "S7" : "S6",
          confidence: "low",
          isValid: true
        };
      }
    }

    if (/^C8$/.test(rawOrderType)) {
      return {
        rawOrderType,
        orderType: "C8",
        confidence: "high",
        isValid: true
      };
    }

    return {
      rawOrderType,
      orderType: rawOrderType,
      confidence: rawOrderType ? "low" : "low",
      isValid: false
    };
  }

  function normalizeOrderType(value) {
    return getOrderTypeDetails(value).orderType;
  }

  const defaultCandidates = {
    orderNumbers: [],
    orderTypes: [],
    itemNumbers: [],
    descriptions: [],
    quantities: []
  };

  const getDescription = (row) =>
    row?.productDescription ??
    row?.product_description ??
    row?.description ??
    "Needs review";

  const safeCandidates = (result) => result?.candidates ?? defaultCandidates;

  function getSafeDescriptionDetails(result) {
    return {
      productDescription: safeText(getDescription(result)) || "Needs review",
      source: safeText(result?.source) || "missing",
      score: Number.isFinite(result?.score) ? Number(result.score) : 0,
      candidates: Array.isArray(result?.candidates) ? result.candidates : []
    };
  }

  function isNumericText(value) {
    const cleaned = safeText(value).replace(/,/g, "");
    return cleaned !== "" && Number.isFinite(Number(cleaned));
  }

  function hasQuantityValue(value) {
    return isNumericText(value);
  }

  function isPopulatedQuantity(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0;
    }

    return hasQuantityValue(value) && parseCount(value) > 0;
  }

  function serializeCount(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return "";
    }

    return Number.isInteger(numericValue) ? String(numericValue) : String(numericValue).replace(/\.0+$/, "");
  }

  function normalizeUom(value) {
    const normalizedValue = safeUpper(value).replace(/\./g, "");
    return normalizedValue ? UOM_LOOKUP[normalizedValue] || normalizedValue : "";
  }

  function normalizeUomDetectionText(text) {
    return String(text || "")
      .replace(/square\s+(?:foot|feet)/gi, "SQFT")
      .replace(/sq\.?\s*ft/gi, "SQFT")
      .replace(/s\/f/gi, "SF");
  }

  function deriveUomValue(rawUomValue, legacyCartonsValue) {
    const normalizedUom = normalizeUom(rawUomValue);
    if (normalizedUom) {
      return normalizedUom;
    }

    if (isNumericText(legacyCartonsValue)) {
      return "CT";
    }

    return normalizeUom(legacyCartonsValue);
  }

  function getUomPriority(uom) {
    switch (normalizeUom(uom)) {
      case "SF":
        return 0;
      case "PC":
        return 1;
      case "CT":
        return 2;
      case "EA":
        return 3;
      default:
        return 9;
    }
  }

  function detectUomFromText(text) {
    const normalizedText = normalizeUomDetectionText(text);
    const uomMatches = uniqueValues(
      (normalizedText.match(new RegExp(`\\b(?:${UOM_REGEX_SOURCE})\\b`, "gi")) || []).map((match) => normalizeUom(match))
    ).filter(Boolean);

    return uomMatches.sort((left, right) => getUomPriority(left) - getUomPriority(right))[0] || "";
  }

  function formatQuantityWithUom(quantity, uom) {
    const formattedQuantity = formatNumber(quantity);
    return uom ? `${formattedQuantity} ${uom}` : formattedQuantity;
  }

  function mapQuantityToBuckets(quantity, uom) {
    const normalizedUom = normalizeUom(uom);
    const quantityValue = String(quantity || "").trim();
    const quantityBuckets = {
      cartonsQty: "",
      piecesQty: "",
      squareFeetQty: "",
      otherQty: ""
    };

    if (!quantityValue) {
      return quantityBuckets;
    }

    if (normalizedUom === "CT") {
      quantityBuckets.cartonsQty = quantityValue;
    } else if (normalizedUom === "PC" || normalizedUom === "EA") {
      quantityBuckets.piecesQty = quantityValue;
    } else if (normalizedUom === "SF") {
      quantityBuckets.squareFeetQty = quantityValue;
    } else {
      quantityBuckets.otherQty = quantityValue;
    }

    return quantityBuckets;
  }

  function readQuantityBuckets(input, options) {
    const config = options || {};
    const preferNumbers = Boolean(config.preferNumbers);
    const explicitBuckets = {
      cartonsQty: input.cartonsQty ?? input.cartons_qty ?? "",
      piecesQty: input.piecesQty ?? input.pieces_qty ?? "",
      squareFeetQty: input.squareFeetQty ?? input.square_feet_qty ?? input.squareFootQty ?? "",
      otherQty: input.otherQty ?? input.other_qty ?? ""
    };
    const hasExplicitBuckets = Object.values(explicitBuckets).some((value) => normalizeText(value));
    const fallbackBuckets = hasExplicitBuckets
      ? explicitBuckets
      : mapQuantityToBuckets(input.quantity, deriveUomValue(input.uom, input.cartons));

    return Object.fromEntries(
      Object.entries(fallbackBuckets).map(([fieldName, value]) => [
        fieldName,
        preferNumbers ? parseCount(value) : String(value || "").trim()
      ])
    );
  }

  function getPrimaryQuantityPair(quantityBuckets) {
    const orderedPairs = [
      { quantity: quantityBuckets.cartonsQty, uom: "CT" },
      { quantity: quantityBuckets.piecesQty, uom: "PC" },
      { quantity: quantityBuckets.squareFeetQty, uom: "SF" },
      { quantity: quantityBuckets.otherQty, uom: "OTHER" }
    ];

    return orderedPairs.find((entry) => isPopulatedQuantity(entry.quantity)) || {
      quantity: 0,
      uom: ""
    };
  }

  function getQuantityDisplayParts(quantityBuckets) {
    const orderedPairs = [
      { quantity: quantityBuckets.cartonsQty, uom: "CT" },
      { quantity: quantityBuckets.piecesQty, uom: "PC" },
      { quantity: quantityBuckets.squareFeetQty, uom: "SF" },
      { quantity: quantityBuckets.otherQty, uom: "OTHER" }
    ];

    return orderedPairs
      .filter((entry) => isPopulatedQuantity(entry.quantity))
      .map((entry) => formatQuantityWithUom(entry.quantity, entry.uom));
  }

  function buildDisplayQty(quantityBuckets) {
    const displayParts = getQuantityDisplayParts(quantityBuckets);
    return displayParts.length > 0 ? displayParts.join(" + ") : "";
  }

  function buildQuantityTotals(rows) {
    const totals = new Map();

    rows.forEach((row) => {
      [
        ["CT", row.cartonsQty],
        ["PC", row.piecesQty],
        ["SF", row.squareFeetQty],
        ["OTHER", row.otherQty]
      ].forEach(([uom, value]) => {
        const numericValue = parseCount(value);
        if (!isPopulatedQuantity(value)) {
          return;
        }

        totals.set(uom, (totals.get(uom) || 0) + numericValue);
      });
    });

    return Array.from(totals.entries()).map(([uom, total]) => ({
      uom: uom === "UNITS" ? "" : uom,
      total
    }));
  }

  function formatQuantityTotals(totals) {
    const orderedUoms = ["CT", "PC", "SF", "OTHER"];
    return (totals || [])
      .slice()
      .sort((left, right) => orderedUoms.indexOf(left.uom) - orderedUoms.indexOf(right.uom))
      .map((entry) => formatQuantityWithUom(entry.total, entry.uom))
      .join(", ");
  }

  function createAppRow(input, rowIndex) {
    const rawShipDate = safeText(input.shipDate) || "Imported PDF";
    const rawPallet = safeText(input.palletNumber || input.palletId);
    const rawPalletLp = safeText(input.palletLp || input.pallet_lp);
    const rawOrderNumber = safeText(input.orderNumber);
    const orderTypeDetails = getOrderTypeDetails(input.orderType || input.rawOrderType || "");
    const rawOrderType = orderTypeDetails.orderType;
    const rawProduct = safeText(getDescription(input)) || "Needs review";
    const rawItemNumber = safeText(input.itemNumber);
    const sourcePage = Number(input.sourcePage || input.source_page || input.pageNumber || 0);
    const parsedOrder = parseOrder(rawOrderNumber, rawOrderType);
    const palletNumber = extractPalletNumber(rawPallet || (sourcePage ? buildPagePalletNumber(sourcePage) : "UNASSIGNED"));
    const quantityBuckets = readQuantityBuckets(input, { preferNumbers: true });
    const primaryQuantityPair = getPrimaryQuantityPair(quantityBuckets);
    const displayQty = buildDisplayQty(quantityBuckets);

    return {
      id: `${rawShipDate}-${palletNumber}-${parsedOrder.display}-${rawItemNumber}-${rowIndex}`,
      shipDate: rawShipDate,
      sourcePage,
      palletNumber,
      palletLabel: formatPalletLabel(palletNumber),
      palletLp: rawPalletLp,
      orderNumber: parsedOrder.number,
      orderType: parsedOrder.type,
      rawOrderType: orderTypeDetails.rawOrderType,
      orderTypeConfidence: safeText(input.orderTypeConfidence || orderTypeDetails.confidence || "high"),
      orderDisplay: parsedOrder.display,
      itemNumber: rawItemNumber,
      productDescription: rawProduct,
      rawBlock: safeText(input.rawBlock || input.raw_block),
      error: safeText(input.error),
      quantity: parseCount(primaryQuantityPair.quantity),
      uom: primaryQuantityPair.uom === "OTHER" ? "" : primaryQuantityPair.uom,
      cartonsQty: quantityBuckets.cartonsQty,
      piecesQty: quantityBuckets.piecesQty,
      squareFeetQty: quantityBuckets.squareFeetQty,
      otherQty: quantityBuckets.otherQty,
      displayQty,
      searchIndex: {
        product: normalizeText(rawProduct),
        orderText: normalizeText(`${rawOrderNumber} ${parsedOrder.display} ${parsedOrder.type}`),
        orderDigits: digitsOnly(`${rawOrderNumber}${parsedOrder.number}`),
        palletText: normalizeText(`${rawPallet} ${rawPalletLp} ${palletNumber} ${formatPalletLabel(palletNumber)} page ${sourcePage}`),
        quantityText: normalizeText(displayQty)
      }
    };
  }

  function createPreviewRow(input, rowIndex) {
    const rawOcrConfidence = Number(input.ocrConfidence);
    const quantityBuckets = readQuantityBuckets(input);
    const primaryQuantityPair = getPrimaryQuantityPair(quantityBuckets);
    const displayQty = buildDisplayQty(quantityBuckets);
    const sourcePage = Number(input.sourcePage || input.source_page || input.pageNumber || 0);
    const normalizedPalletNumber = safeText(input.palletNumber || input.palletId) || (sourcePage ? buildPagePalletNumber(sourcePage) : "");
    const orderTypeDetails = getOrderTypeDetails(input.orderType || input.rawOrderType || "");
    const previewRow = {
      id: input.id || createRowId(`preview-${rowIndex}`),
      sourcePage,
      pageNumber: Number(input.pageNumber || 0),
      pageLabel: safeText(input.pageLabel || (input.pageNumber ? `Page ${input.pageNumber}` : "")),
      blockId: safeText(input.blockId),
      rawBlock: safeText(input.rawBlock || input.raw_block),
      palletNumber: normalizedPalletNumber,
      palletLp: safeText(input.palletLp || input.pallet_lp),
      orderNumber: digitsOnly(input.orderNumber).slice(0, 8),
      orderType: orderTypeDetails.orderType,
      rawOrderType: safeText(input.rawOrderType || orderTypeDetails.rawOrderType),
      orderTypeConfidence: safeLower(input.orderTypeConfidence || orderTypeDetails.confidence || "high") === "high" ? "high" : "low",
      itemNumber: safeText(input.itemNumber),
      productDescription: safeText(getDescription(input)) || "Needs review",
      quantity: safeText(primaryQuantityPair.quantity || input.quantity || "0"),
      error: safeText(input.error),
      uom: primaryQuantityPair.uom === "OTHER" ? "" : primaryQuantityPair.uom,
      cartonsQty: safeText(quantityBuckets.cartonsQty || "0"),
      piecesQty: safeText(quantityBuckets.piecesQty || "0"),
      squareFeetQty: safeText(quantityBuckets.squareFeetQty || "0"),
      otherQty: safeText(quantityBuckets.otherQty || "0"),
      displayQty,
      confidence: safeLower(input.confidence || "low") === "high" ? "high" : "low",
      confidenceReason: safeText(input.confidenceReason),
      extractionMethod: safeText(input.extractionMethod || "text PDF") || "text PDF",
      ocrConfidence: Number.isFinite(rawOcrConfidence) ? Math.round(rawOcrConfidence) : null
    };

    return applyPreviewReviewState(previewRow);
  }

  function getPreviewRowReviewIssues(row) {
    const reviewIssues = [];
    const quantityBuckets = readQuantityBuckets(row);

    if (!safeText(row.palletNumber)) {
      reviewIssues.push("missing pallet number");
    }

    if (!/^\d{8}$/.test(digitsOnly(row.orderNumber))) {
      reviewIssues.push("order number needs review");
    }

    if (!VALID_ORDER_TYPE_SET.has(normalizeOrderType(row.orderType))) {
      reviewIssues.push("missing order type");
    }

    if (safeLower(row.orderTypeConfidence) === "low") {
      reviewIssues.push("order type OCR-normalized");
    }

    if ((safeText(getDescription(row)) || "Needs review") === "Needs review") {
      reviewIssues.push("description needs review");
    }

    if (!Object.values(quantityBuckets).some((value) => isPopulatedQuantity(value))) {
      reviewIssues.push("missing qty");
    }

    return reviewIssues;
  }

  function applyPreviewReviewState(row) {
    const reviewIssues = getPreviewRowReviewIssues(row);
    const normalizedConfidence = safeLower(row.confidence || "low") === "high" ? "high" : "low";
    const existingReason = safeText(row.confidenceReason);
    const baseReason = existingReason.replace(/\s*Needs review:.*$/i, "").trim();

    if (reviewIssues.length === 0) {
      return {
        ...row,
        confidence: normalizedConfidence,
        confidenceReason: baseReason
      };
    }

    const reviewReason = `Needs review: ${reviewIssues.join(", ")}.`;
    return {
      ...row,
      confidence: "low",
      confidenceReason: baseReason ? `${baseReason} ${reviewReason}` : reviewReason
    };
  }

  function countRowsNeedingReview(rows) {
    return (rows || []).filter((row) => applyPreviewReviewState(row).confidence === "low").length;
  }

  function createBlankPreviewRow(defaultPalletNumber, pageNumber) {
    return createPreviewRow(
      {
        sourcePage: pageNumber || 0,
        pageNumber: pageNumber || 0,
        pageLabel: defaultPalletNumber ? formatPalletLabel(defaultPalletNumber) : pageNumber ? buildPagePalletNumber(pageNumber) : "",
        palletNumber: defaultPalletNumber || "",
        palletLp: "",
        orderNumber: "",
        orderType: "",
        itemNumber: "",
        productDescription: "",
        rawBlock: "",
        cartonsQty: "",
        piecesQty: "",
        squareFeetQty: "",
        otherQty: "",
        confidence: "low",
        confidenceReason: "Manual row added.",
        extractionMethod: "manual",
        ocrConfidence: null
      },
      0
    );
  }

  function validatePreviewRows(previewRows, shipDate) {
    const activeRows = (previewRows || []).filter((row) =>
      [
        row?.palletNumber,
        row?.orderNumber,
        row?.orderType,
        row?.itemNumber,
        getDescription(row),
        row?.cartonsQty,
        row?.piecesQty,
        row?.squareFeetQty,
        row?.otherQty
      ]
        .some((value) => normalizeText(value))
    );

    if (activeRows.length === 0) {
      throw new Error("Add at least one parsed row before saving.");
    }
    const normalizedRows = activeRows.map((row, rowIndex) => {
      const quantityBuckets = readQuantityBuckets(row);
      const normalizedRow = applyPreviewReviewState(
        createPreviewRow(
          {
            id: row.id,
            sourcePage: row.sourcePage,
            pageNumber: row.pageNumber,
            pageLabel: row.pageLabel,
            blockId: row.blockId,
            rawBlock: row.rawBlock,
            palletNumber: safeText(row.palletNumber),
            palletLp: safeText(row.palletLp || row.pallet_lp),
            orderNumber: safeText(row.orderNumber),
            orderType: safeUpper(row.orderType),
            rawOrderType: safeText(row.rawOrderType),
            orderTypeConfidence: safeText(row.orderTypeConfidence),
            itemNumber: safeText(row.itemNumber),
            productDescription: safeText(getDescription(row)) || "Needs review",
            cartonsQty: Number(row.cartonsQty || 0),
            piecesQty: Number(row.piecesQty || 0),
            squareFeetQty: Number(row.squareFeetQty || 0),
            otherQty: Number(row.otherQty || 0),
            confidence: row.confidence,
            confidenceReason: row.confidenceReason,
            extractionMethod: row.extractionMethod,
            ocrConfidence: row.ocrConfidence
          },
          rowIndex
        )
      );

      return {
        previewRow: normalizedRow,
        appRow: createAppRow(
          {
            shipDate: safeText(shipDate) || "Imported PDF",
            sourcePage: normalizedRow.sourcePage,
            palletNumber: normalizedRow.palletNumber,
            palletLp: normalizedRow.palletLp,
            rawBlock: normalizedRow.rawBlock,
            orderNumber: digitsOnly(normalizedRow.orderNumber).slice(0, 8),
            orderType: VALID_ORDER_TYPE_SET.has(normalizeOrderType(normalizedRow.orderType))
              ? normalizeOrderType(normalizedRow.orderType)
              : "",
            rawOrderType: safeText(normalizedRow.rawOrderType),
            orderTypeConfidence: safeText(normalizedRow.orderTypeConfidence),
            itemNumber: normalizedRow.itemNumber,
            productDescription: safeText(getDescription(normalizedRow)) || "Needs review",
            cartonsQty: serializeCount(quantityBuckets.cartonsQty),
            piecesQty: serializeCount(quantityBuckets.piecesQty),
            squareFeetQty: serializeCount(quantityBuckets.squareFeetQty),
            otherQty: serializeCount(quantityBuckets.otherQty)
          },
          rowIndex
        )
      };
    });

    return {
      rows: normalizedRows.map((entry) => entry.appRow),
      normalizedPreviewRows: normalizedRows.map((entry) => entry.previewRow),
      reviewCount: normalizedRows.filter((entry) => entry.previewRow.confidence === "low").length
    };
  }

  function joinPdfLineText(items) {
    let joinedText = "";

    items.forEach((item, index) => {
      if (index === 0) {
        joinedText = item.text;
        return;
      }

      const previousItem = items[index - 1];
      const gap = item.x - (previousItem.x + previousItem.width);
      const shouldAddSpace = gap > 2 || /[A-Za-z0-9)]$/.test(previousItem.text);
      joinedText += `${shouldAddSpace ? " " : ""}${item.text}`;
    });

    return joinedText.replace(/\s+/g, " ").trim();
  }

  function groupPdfItemsIntoLines(items) {
    const tokens = items
      .map((item) => {
        const text = String(item.str || "").replace(/\u00a0/g, " ").trim();
        if (!text) {
          return null;
        }

        const height = Math.abs(item.height || item.transform[3] || 0);
        return {
          text,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width || 0,
          height
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const verticalDifference = Math.abs(right.y - left.y);
        if (verticalDifference > 3) {
          return right.y - left.y;
        }
        return left.x - right.x;
      });

    const lines = [];

    tokens.forEach((token) => {
      const tolerance = Math.max(2.5, token.height * 0.45);
      const matchingLine = lines.find((line) => Math.abs(line.y - token.y) <= tolerance);

      if (!matchingLine) {
        lines.push({
          y: token.y,
          items: [token]
        });
        return;
      }

      matchingLine.items.push(token);
    });

    return lines
      .map((line) => {
        const sortedItems = line.items.sort((left, right) => left.x - right.x);
        return {
          y: line.y,
          items: sortedItems,
          text: joinPdfLineText(sortedItems)
        };
      })
      .sort((left, right) => right.y - left.y);
  }

  function extractShipmentDateFromText(text) {
    const normalizedText = String(text || "");
    const matches = [
      normalizedText.match(/\b(\d{4}-\d{2}-\d{2})\b/),
      normalizedText.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/),
      normalizedText.match(/\b(\d{1,2}-\d{1,2}-\d{2,4})\b/)
    ].filter(Boolean);

    return matches.length > 0 ? matches[0][1] : "";
  }

  function uniqueValues(values) {
    return Array.from(
      new Set(
        (values || [])
          .map((value) => safeText(value))
          .filter(Boolean)
      )
    );
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function extractPalletIdentifiersFromText(text) {
    const normalizedText = String(text || "");
    const palletIdentifiers = [];
    const lines = normalizedText
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const palletPatterns = [
      /\bthis\s+is\s+pallet\b[^0-9]{0,12}(\d{1,2})\b/gi,
      /\bpallet\b(?!\s*(?:lp|lpn)\b)\s*(?:number|no\.?|#)?\s*[:#-]\s*(\d{1,2})\b/gi,
      /\bpallet\b(?!\s*(?:lp|lpn)\b)\s+(?:number|no\.?\s*)?(\d{1,2})\b/gi
    ];

    lines.forEach((line) => {
      if (!/\bpallet\b/i.test(line) || /\bpallet\s*(?:lp|lpn)\b/i.test(line)) {
        return;
      }

      if (/\bpallet\b.*\bof\b/i.test(line) && !/\bthis\s+is\s+pallet\b/i.test(line)) {
        return;
      }

      palletPatterns.forEach((pattern) => {
        pattern.lastIndex = 0;
        let match = pattern.exec(line);
        while (match) {
          const candidate = safeUpper(match[1]);
          if (candidate && !VALID_ORDER_TYPE_SET.has(candidate)) {
            palletIdentifiers.push(candidate);
          }
          match = pattern.exec(line);
        }
      });
    });

    if (palletIdentifiers.length === 0) {
      const fallbackMatch = normalizedText.match(/\bthis\s+is\s+pallet\b[^0-9]{0,12}(\d{1,2})\b/i);
      if (fallbackMatch && fallbackMatch[1]) {
        palletIdentifiers.push(safeUpper(fallbackMatch[1]));
      }
    }

    return uniqueValues(palletIdentifiers);
  }

  function extractPalletFromText(text) {
    return extractPalletIdentifiersFromText(text)[0] || "";
  }

  function extractPalletLpFromText(text) {
    const normalizedText = safeText(text);
    const palletLpPatterns = [
      /pallet\s*lp\s*#?\s*([A-Z0-9-]{3,})/i,
      /\blpn(?:\s*(?:id|number))?\s*(?:#|:)?\s*([A-Z0-9-]{3,})/i,
      /\blp\s*(?:#|:)?\s*([A-Z0-9-]{3,})/i
    ];

    for (const pattern of palletLpPatterns) {
      const match = normalizedText.match(pattern);
      if (match && match[1]) {
        return safeUpper(match[1]);
      }
    }

    return "";
  }

  function looksLikeItemNumber(token) {
    const normalizedToken = String(token || "").trim();
    return normalizedToken.length >= 5 && /\d/.test(normalizedToken);
  }

  function cleanupLooseProductText(text) {
    let cleanedText = String(text || "");
    cleanedText = cleanedText.replace(/\b\d{8}\b/g, " ");
    cleanedText = cleanedText.replace(/\b(?:SI|S6|S7|C8)\b/gi, " ");
    cleanedText = cleanedText.replace(/\bSK\b/gi, " ");
    cleanedText = cleanedText.replace(/\brelated\s+so#?\b/gi, " ");
    cleanedText = cleanedText.replace(/\brel\s+type\b/gi, " ");
    cleanedText = cleanedText.replace(/\b(?:pallet\s+content\s+list|emser\s+tile)\b/gi, " ");
    cleanedText = cleanedText.replace(/pallet(?:\s*(?:id|number|lp|lpn))?\s*(?:#|:)?\s*[A-Z0-9-]+/gi, " ");
    cleanedText = cleanedText.replace(/\blp(?:n)?\s*(?:#|:)?\s*[A-Z0-9-]+/gi, " ");
    cleanedText = cleanedText.replace(/\bsquare\s+(?:foot|feet)\b/gi, " ");
    cleanedText = cleanedText.replace(/\bsq\.?\s*ft\b/gi, " ");
    cleanedText = cleanedText.replace(/\b(?:qty|pick qty|uom|cartons?|ctns?|ctn|ct|pieces?|pcs?|pc|ea|each|sf|sqft|s\/f|item|sku|tracking|carrier|ship from|ship to|total|page)\b/gi, " ");
    return cleanedText.replace(/\s+/g, " ").trim();
  }

  function looksLikeProductDescriptionText(text) {
    const normalizedLine = cleanupLooseProductText(text);
    if (!normalizedLine || PDF_IGNORED_LINE_PATTERN.test(normalizedLine)) {
      return false;
    }

    if (/\b(?:tracking|carrier|ship from|ship to|total|page)\b/i.test(normalizedLine)) {
      return false;
    }

    const letterMatches = normalizedLine.match(/[A-Za-z]/g) || [];
    if (letterMatches.length < 4) {
      return false;
    }

    const uppercaseMatches = normalizedLine.match(/[A-Z]/g) || [];
    const uppercaseRatio = letterMatches.length > 0 ? uppercaseMatches.length / letterMatches.length : 0;
    return PRODUCT_HINT_PATTERN.test(normalizedLine) || uppercaseRatio >= 0.5;
  }

  function detectCandidateProductDescriptions(lines) {
    return uniqueValues(
      lines
        .map((line) => cleanupLooseProductText(line.text))
        .filter((text) => looksLikeProductDescriptionText(text))
    ).slice(0, 10);
  }

  function detectLikelyItemCodes(lines) {
    return uniqueValues(
      (lines || [])
        .flatMap((line) => tokenizeSourceLine(line.text))
        .map((entry) => entry.token)
        .filter((token) => isLikelyItemNumberToken(token) && !isIgnoredEmserTypeToken(token))
    ).slice(0, 20);
  }

  function detectQuantityLookingValues(text) {
    return uniqueValues(String(text || "").match(new RegExp(`\\b${QUANTITY_VALUE_REGEX_SOURCE}\\b`, "g")) || []).slice(0, 20);
  }

  function extractThisIsPalletFromText(text) {
    const match = safeText(text).match(/\bthis\s+is\s+pallet\b[^0-9]{0,12}(\d{1,2})\b/i);
    return match && match[1] ? safeUpper(match[1]) : "";
  }

  function dedupePreviewRows(rows) {
    const seenKeys = new Set();

    return rows.filter((row) => {
      const key = [
        normalizeText(row.palletNumber),
        digitsOnly(row.orderNumber),
        normalizeOrderType(row.orderType),
        normalizeText(row.itemNumber),
        normalizeText(getDescription(row)),
        normalizeText(row.cartonsQty),
        normalizeText(row.piecesQty),
        normalizeText(row.squareFeetQty),
        normalizeText(row.otherQty)
      ].join("|");

      if (!key.replace(/\|/g, "")) {
        return false;
      }

      if (seenKeys.has(key)) {
        return false;
      }

      seenKeys.add(key);
      return true;
    });
  }

  function findNearbyOrderType(lines, lineIndex) {
    const textWindow = lines
      .slice(Math.max(0, lineIndex - 1), Math.min(lines.length, lineIndex + 3))
      .map((line) => line.text)
      .join(" ");
    const typeMatch = textWindow.match(/\b(SI|S6|S7|C8)\b/i);
    return typeMatch ? normalizeOrderType(typeMatch[1]) : "";
  }

  function extractNearestPallet(lines, lineIndex, pageDefaultPallet) {
    for (let offset = 0; offset <= 5; offset += 1) {
      const previousLine = lines[lineIndex - offset];
      if (!previousLine) {
        continue;
      }

      const detectedPallet = extractPalletIdentifiersFromText(previousLine.text)[0];
      if (detectedPallet) {
        return detectedPallet;
      }
    }

    for (let offset = 1; offset <= 2; offset += 1) {
      const nextLine = lines[lineIndex + offset];
      if (!nextLine) {
        continue;
      }

      const detectedPallet = extractPalletIdentifiersFromText(nextLine.text)[0];
      if (detectedPallet) {
        return detectedPallet;
      }
    }

    const nearbyText = lines
      .slice(Math.max(0, lineIndex - 3), Math.min(lines.length, lineIndex + 3))
      .map((line) => line.text)
      .join("\n");

    return extractPalletIdentifiersFromText(nearbyText)[0] || pageDefaultPallet;
  }

  function extractItemNumberFromContext(anchorText, windowText, orderType) {
    const labeledMatch = windowText.match(/\b(?:item|sku|item\s*#|item number|product code)\s*[:#]?\s*([A-Z0-9./_-]{5,})\b/i);
    if (labeledMatch) {
      return labeledMatch[1];
    }

    const tokens = `${anchorText} ${windowText}`.replace(/\s+/g, " ").trim().split(/\s+/);
    const typeIndex = tokens.findIndex((token) => normalizeOrderType(token) === orderType);
    if (typeIndex === -1) {
      return "";
    }

    for (let index = typeIndex + 1; index < Math.min(tokens.length, typeIndex + 5); index += 1) {
      const candidate = tokens[index].replace(/[^A-Za-z0-9./_-]/g, "");
      if (looksLikeItemNumber(candidate) && !/^\d{8}$/.test(candidate)) {
        return candidate;
      }
    }

    return "";
  }

  function extractLabeledQuantity(text, labelExpression) {
    const match = String(text || "").match(labelExpression);
    return match ? match[1] : "";
  }

  function stripTokensForNumericSearch(text, orderNumber, orderType, itemNumber) {
    let cleanedText = String(text || "");

    if (orderNumber) {
      cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(orderNumber)}\\b`, "g"), " ");
    }

    if (orderType) {
      cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(orderType)}\\b`, "gi"), " ");
    }

    if (itemNumber) {
      cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(itemNumber)}\\b`, "g"), " ");
    }

    cleanedText = cleanedText.replace(/pallet(?:\s*(?:id|number|lp|lpn))?\s*(?:#|:)?\s*[A-Z0-9-]+/gi, " ");
    cleanedText = cleanedText.replace(/\blp(?:n)?\s*(?:#|:)?\s*[A-Z0-9-]+/gi, " ");
    cleanedText = cleanedText.replace(/\bsquare\s+(?:foot|feet)\b/gi, " ");
    cleanedText = cleanedText.replace(/\bsq\.?\s*ft\b/gi, " ");
    return cleanedText;
  }

  function collectQuantityCandidates(text) {
    const normalizedText = normalizeUomDetectionText(text);
    const quantityCandidates = [];
    const candidatePatterns = [
      {
        regex: new RegExp(
          `\\b(?:pick\\s*qty|qty|quantity)\\s*[:#]?\\s*(${QUANTITY_VALUE_REGEX_SOURCE})\\s*(${UOM_REGEX_SOURCE})\\b`,
          "gi"
        ),
        quantityIndex: 1,
        uomIndex: 2,
        score: 40
      },
      {
        regex: new RegExp(`\\b(${UOM_REGEX_SOURCE})\\s*[:#]?\\s*(${QUANTITY_VALUE_REGEX_SOURCE})\\b`, "gi"),
        quantityIndex: 2,
        uomIndex: 1,
        score: 30
      },
      {
        regex: new RegExp(`\\b(${QUANTITY_VALUE_REGEX_SOURCE})\\s*(${UOM_REGEX_SOURCE})\\b`, "gi"),
        quantityIndex: 1,
        uomIndex: 2,
        score: 25
      }
    ];

    candidatePatterns.forEach((pattern) => {
      pattern.regex.lastIndex = 0;
      let match = pattern.regex.exec(normalizedText);
      while (match) {
        const quantity = String(match[pattern.quantityIndex] || "").trim();
        const uom = normalizeUom(match[pattern.uomIndex] || "");
        if (quantity && uom) {
          quantityCandidates.push({
            quantity,
            uom,
            quantitySource: "labeled",
            uomSource: "labeled",
            score: pattern.score
          });
        }
        match = pattern.regex.exec(normalizedText);
      }
    });

    return quantityCandidates;
  }

  function selectPreferredQuantityCandidate(candidates) {
    if (!candidates || candidates.length === 0) {
      return null;
    }

    return candidates.slice().sort((left, right) => {
      const priorityDifference = getUomPriority(left.uom) - getUomPriority(right.uom);
      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return parseCount(right.quantity) - parseCount(left.quantity);
    })[0];
  }

  function pickFallbackQuantity(numericTokens, preferredUom) {
    if (!numericTokens || numericTokens.length === 0) {
      return "";
    }

    if (preferredUom === "SF") {
      return numericTokens
        .slice()
        .sort((left, right) => parseCount(right) - parseCount(left))[0];
    }

    return numericTokens[numericTokens.length - 1];
  }

  function assignQuantityCandidateToBuckets(quantityBuckets, quantity, uom) {
    const normalizedUom = normalizeUom(uom);
    const numericQuantity = parseCount(quantity);
    const nextValue = serializeCount(numericQuantity);

    if (!nextValue && numericQuantity !== 0) {
      return quantityBuckets;
    }

    if (normalizedUom === "CT") {
      quantityBuckets.cartonsQty = serializeCount(parseCount(quantityBuckets.cartonsQty) + numericQuantity);
    } else if (normalizedUom === "PC" || normalizedUom === "EA") {
      quantityBuckets.piecesQty = serializeCount(parseCount(quantityBuckets.piecesQty) + numericQuantity);
    } else if (normalizedUom === "SF") {
      quantityBuckets.squareFeetQty = serializeCount(parseCount(quantityBuckets.squareFeetQty) + numericQuantity);
    } else {
      quantityBuckets.otherQty = serializeCount(parseCount(quantityBuckets.otherQty) + numericQuantity);
    }

    return quantityBuckets;
  }

  function extractQuantityAndUomDetails(text, orderNumber, orderType, itemNumber) {
    const quantityCandidates = collectQuantityCandidates(text);
    const uniqueCandidates = [];
    const seenCandidateKeys = new Set();

    quantityCandidates.forEach((candidate) => {
      const candidateKey = `${candidate.quantity}|${candidate.uom}`;
      if (seenCandidateKeys.has(candidateKey)) {
        return;
      }

      seenCandidateKeys.add(candidateKey);
      uniqueCandidates.push(candidate);
    });

    const preferredCandidate = selectPreferredQuantityCandidate(uniqueCandidates);
    const detectedUom = preferredCandidate ? preferredCandidate.uom : detectUomFromText(text);
    const numericSource = stripTokensForNumericSearch(text, orderNumber, orderType, itemNumber);
    const numericTokens = uniqueValues(
      (numericSource.match(new RegExp(`\\b${QUANTITY_VALUE_REGEX_SOURCE}\\b`, "g")) || []).filter(
        (token) => digitsOnly(token).length < 8
      )
    );
    const fallbackQuantity = pickFallbackQuantity(numericTokens, detectedUom);
    const quantityBuckets = uniqueCandidates.reduce(
      (currentBuckets, candidate) => assignQuantityCandidateToBuckets(currentBuckets, candidate.quantity, candidate.uom),
      {
        cartonsQty: "",
        piecesQty: "",
        squareFeetQty: "",
        otherQty: ""
      }
    );

    if (!buildDisplayQty(quantityBuckets) && fallbackQuantity) {
      assignQuantityCandidateToBuckets(quantityBuckets, fallbackQuantity, detectedUom || "OTHER");
    }

    const displayQty = buildDisplayQty(quantityBuckets);
    const hasAnyQuantity = Boolean(displayQty);

    return {
      quantity: preferredCandidate ? preferredCandidate.quantity : fallbackQuantity,
      uom: detectedUom,
      cartonsQty: quantityBuckets.cartonsQty,
      piecesQty: quantityBuckets.piecesQty,
      squareFeetQty: quantityBuckets.squareFeetQty,
      otherQty: quantityBuckets.otherQty,
      displayQty,
      quantitySource: uniqueCandidates.length > 0 ? "labeled" : fallbackQuantity ? "fallback" : "missing",
      uomSource: uniqueCandidates.length > 0 ? "labeled" : detectedUom ? "detected" : "missing",
      hasAnyQuantity
    };
  }

  function extractQuantityAndUom(anchorText, windowText, orderNumber, orderType, itemNumber) {
    return extractQuantityAndUomDetails(windowText || anchorText, orderNumber, orderType, itemNumber);
  }

  function cleanupRowText(text, context) {
    let cleanedText = cleanupLooseProductText(text);

    if (context.orderNumber) {
      cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(context.orderNumber)}\\b`, "g"), " ");
    }

    if (context.orderType) {
      cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(context.orderType)}\\b`, "gi"), " ");
    }

    if (context.itemNumber) {
      cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(context.itemNumber)}\\b`, "g"), " ");
    }

    [context.quantity, context.cartonsQty, context.piecesQty, context.squareFeetQty, context.otherQty].forEach((value) => {
      if (value) {
        cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(String(value))}\\b`, "g"), " ");
      }
    });

    [context.uom, "CT", "PC", "EA", "SF", "OTHER"].forEach((value) => {
      if (value) {
        cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(String(value))}\\b`, "gi"), " ");
      }
    });

    return cleanedText.replace(/\s+/g, " ").trim();
  }

  function extractDescriptionFromContext(lines, lineIndex, context) {
    const descriptionCandidates = [];

    for (let offset = 0; offset < 3; offset += 1) {
      const currentLine = lines[lineIndex + offset];
      if (!currentLine) {
        break;
      }

      if (offset > 0 && /\b\d{8}\b/.test(currentLine.text)) {
        break;
      }

      if (offset > 0 && extractPalletIdentifiersFromText(currentLine.text).length > 0) {
        break;
      }

      const cleanedText = cleanupRowText(currentLine.text, context);
      if (looksLikeProductDescriptionText(cleanedText)) {
        descriptionCandidates.push(cleanedText);
      }
    }

    const description = uniqueValues(descriptionCandidates).join(" ").trim();
    return description || "Needs review";
  }

  function getMeaningfulTextStats(rawText) {
    const normalizedRawText = String(rawText || "");
    return {
      characterCount: normalizedRawText.replace(/\s+/g, "").length,
      lineCount: normalizedRawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length
    };
  }

  function needsOcrForRawText(rawText) {
    const textStats = getMeaningfulTextStats(rawText);
    return (
      textStats.characterCount > 0 &&
      (
        textStats.characterCount < MIN_PDF_TEXT_CHARACTERS ||
        (textStats.characterCount < MIN_PDF_TEXT_CHARACTERS * 2 &&
          textStats.lineCount < MIN_PDF_TEXT_LINES + 2)
      )
    );
  }

  function buildPageWarning(options) {
    const rawText = String(options.rawText || "");
    const pageRows = options.pageRows || [];
    const extractionMethod = options.extractionMethod || "text PDF";
    const needsOcr = Boolean(options.needsOcr);
    const ocrConfidence = Number.isFinite(options.ocrConfidence) ? Math.round(options.ocrConfidence) : null;
    const weakText = rawText ? needsOcrForRawText(rawText) : false;
    const warnings = [];

    if (extractionMethod === "text PDF" && !rawText) {
      warnings.push("This PDF appears image-based and needs OCR. No raw extracted text was found on this page.");
    } else if (extractionMethod === "text PDF" && needsOcr) {
      warnings.push("This PDF appears image-based and needs OCR.");
    } else if (extractionMethod === "OCR" && !rawText) {
      warnings.push("OCR returned very little text from this page. Review manually.");
    } else if (extractionMethod === "OCR" && weakText) {
      warnings.push("OCR returned very little text from this page. Review manually.");
    } else if (extractionMethod === "OCR" && ocrConfidence !== null && ocrConfidence < LOW_OCR_CONFIDENCE_THRESHOLD) {
      warnings.push(`OCR confidence is low on this page (${ocrConfidence}%).`);
    }

    if (rawText && pageRows.length === 0) {
      warnings.push("No confident rows found on this page. Review the raw text and add or edit rows below.");
    } else if (pageRows.some((row) => row?.confidence === "low" || getDescription(row) === "Needs review")) {
      warnings.push("Some rows need review.");
    }

    return warnings.join(" ");
  }

  function buildLinesFromRawText(rawText) {
    return String(rawText || "")
      .split(/\r?\n/)
      .map((line, lineIndex) => ({
        text: String(line || "").trim(),
        y: lineIndex
      }))
      .filter((line) => line.text);
  }

  function findOrderTypeInText(text) {
    const tokens = String(text || "").split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      const orderTypeDetails = getOrderTypeDetails(token);
      if (orderTypeDetails.isValid) {
        return orderTypeDetails.orderType;
      }
    }

    return "";
  }

  function findOrderTypeDetailsInText(text) {
    const tokens = String(text || "").split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      const orderTypeDetails = getOrderTypeDetails(token);
      if (orderTypeDetails.isValid) {
        return orderTypeDetails;
      }
    }

    return {
      rawOrderType: "",
      orderType: "",
      confidence: "low",
      isValid: false
    };
  }

  function findLeadingOrderNumber(text) {
    const normalizedText = String(text || "").trim();
    const orderMatch = normalizedText.match(/\b(\d{8})\b/);

    if (!orderMatch || typeof orderMatch.index !== "number") {
      return null;
    }

    // Real order rows place the 8-digit order near the left edge; later matches are usually continuation noise.
    if (orderMatch.index > 24) {
      return null;
    }

    return {
      orderNumber: orderMatch[1],
      index: orderMatch.index
    };
  }

  function findItemBlockStartMatch(lines, lineIndex) {
    const anchorLine = lines[lineIndex];
    if (!anchorLine) {
      return null;
    }

    const leadingOrder = findLeadingOrderNumber(anchorLine.text);
    if (!leadingOrder) {
      return null;
    }

    const nearbyText = lines
      .slice(lineIndex, Math.min(lines.length, lineIndex + 2))
      .map((line) => line.text)
      .join(" ");
    const orderTypeDetails = findOrderTypeDetailsInText(nearbyText);

    if (!orderTypeDetails.orderType) {
      return null;
    }

    return {
      lineIndex,
      orderNumber: leadingOrder.orderNumber,
      orderType: orderTypeDetails.orderType,
      rawOrderType: orderTypeDetails.rawOrderType,
      orderTypeConfidence: orderTypeDetails.confidence
    };
  }

  function findOrderCandidatesInRawText(rawText) {
    const candidates = [];
    const droppedCandidates = [];
    const normalizedRawText = String(rawText || "");
    const orderRegex = /\b(\d{8})\b/g;
    const nearbyOrderTypeWindow = 140;
    let match = orderRegex.exec(normalizedRawText);

    while (match) {
      const orderNumber = match[1];
      const startIndex = typeof match.index === "number" ? match.index : 0;
      const candidateDetails = classifyOrderNumberCandidate(normalizedRawText, orderNumber, startIndex, {
        contextWindow: nearbyOrderTypeWindow,
        beforeWindow: 32
      });

      if (candidateDetails.accepted && candidateDetails.orderType) {
        candidates.push({
          startIndex,
          orderNumber,
          orderType: candidateDetails.orderType,
          rawOrderType: candidateDetails.rawOrderType,
          orderTypeConfidence: candidateDetails.orderTypeConfidence
        });
      } else {
        droppedCandidates.push({
          orderNumber,
          reason:
            candidateDetails.reason ||
            (candidateDetails.accepted ? "missing nearby order type" : "rejected")
        });
      }

      match = orderRegex.exec(normalizedRawText);
    }

    return {
      candidates,
      droppedCandidates
    };
  }

  function normalizeEmserOrderTypesInText(text) {
    return String(text || "")
      .replace(/\b(?:SS|SG|S5|S\$|SB)\b/g, "S6")
      .replace(/\b(?:S1|SL|5I)\b/g, "SI");
  }

  function isEmserNoiseLine(text) {
    const normalizedLine = safeUpper(text).replace(/\s+/g, " ").trim();
    if (!normalizedLine) {
      return true;
    }

    if (/\b\d{8}\b/.test(normalizedLine)) {
      return false;
    }

    if (/\b(?:THIS IS PALLET|PALLET LP)\b/.test(normalizedLine)) {
      return false;
    }

    return /^(?:EMSER TILE|PALLET CONTENT LIST|RELATED SO#|REL TYPE|SO#|TYPE|LINE #|ITEM #|DESCRIPTION|LOT\/SN|QTY|QTY IN PC|UOM|CARTONS|PAGE \d+(?: OF \d+)?|SHIP FROM|SHIP TO|CARRIER|TRACKING|BARCODE|CUSTOMER|DELIVER TO|SOLD TO|TOTALS?)\b/i.test(normalizedLine);
  }

  function normalizeEmserPageText(rawText) {
    const normalizedText = normalizeEmserOrderTypesInText(
      safeUpper(rawText)
        .replace(/\u00a0/g, " ")
        .replace(/[|]/g, " ")
        .replace(/[ \t]+/g, " ")
    );

    return normalizedText
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .filter((line) => !isEmserNoiseLine(line))
      .join("\n")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function getOrderNumberPrefix(orderNumber) {
    const normalizedOrderNumber = safeText(orderNumber);
    return /^\d{8}$/.test(normalizedOrderNumber) ? normalizedOrderNumber.slice(0, 2) : "";
  }

  function buildOrderPrefixProfile(candidates) {
    const prefixCounts = new Map();

    (candidates || []).forEach((candidate) => {
      const prefix = getOrderNumberPrefix(candidate?.orderNumber);
      if (!prefix) {
        return;
      }

      prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
    });

    const prefixEntries = Array.from(prefixCounts.entries())
      .map(([prefix, count]) => ({
        prefix,
        count
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return Number(left.prefix) - Number(right.prefix);
      });

    const maxCount = prefixEntries.length > 0 ? prefixEntries[0].count : 0;
    const repeatedPrefixes = prefixEntries.filter((entry) => entry.count >= 2).map((entry) => entry.prefix);
    const dominantPrefixes = repeatedPrefixes.length > 0
      ? repeatedPrefixes
      : prefixEntries.filter((entry) => entry.count === maxCount).map((entry) => entry.prefix);
    const dominantNumericPrefixes = dominantPrefixes.map((prefix) => Number(prefix)).filter(Number.isFinite);
    const rangeMin = dominantNumericPrefixes.length > 0 ? Math.min(...dominantNumericPrefixes) : null;
    const rangeMax = dominantNumericPrefixes.length > 0 ? Math.max(...dominantNumericPrefixes) : null;

    return {
      prefixEntries,
      maxCount,
      dominantPrefixes,
      rangeMin,
      rangeMax
    };
  }

  function getOrderPrefixAssessment(orderNumber, prefixProfile) {
    const prefix = getOrderNumberPrefix(orderNumber);
    const prefixEntry = (prefixProfile?.prefixEntries || []).find((entry) => entry.prefix === prefix);
    const prefixCount = prefixEntry ? prefixEntry.count : 0;
    const numericPrefix = Number(prefix);
    const hasRepeatedPrefix = prefixCount >= 2;
    const inDominantRange =
      Number.isFinite(numericPrefix) &&
      Number.isFinite(prefixProfile?.rangeMin) &&
      Number.isFinite(prefixProfile?.rangeMax) &&
      numericPrefix >= prefixProfile.rangeMin - 1 &&
      numericPrefix <= prefixProfile.rangeMax + 1;
    const likely = hasRepeatedPrefix || inDominantRange || (prefixProfile?.prefixEntries || []).length <= 1;
    const confidence = likely ? "high" : "low";
    const reason = likely
      ? hasRepeatedPrefix
        ? `prefix ${prefix} appears ${prefixCount} times`
        : inDominantRange
          ? `prefix ${prefix} is near dominant range`
          : "single-prefix page"
      : `prefix ${prefix} is an outlier`;

    return {
      prefix,
      prefixCount,
      likely,
      confidence,
      reason
    };
  }

  function classifyOrderNumberCandidate(rawText, orderNumber, startIndex, options) {
    const normalizedText = String(rawText || "");
    const candidateOptions = options || {};
    const contextWindow = Number(candidateOptions.contextWindow || 100);
    const afterText = normalizedText.slice(startIndex, Math.min(normalizedText.length, startIndex + contextWindow));
    const orderTypeDetails = findOrderTypeDetailsInText(afterText);
    const normalizedOrderNumber = safeText(orderNumber);
    const rejectionReasons = [];

    if (!/^[1-79]\d{7}$/.test(normalizedOrderNumber)) {
      rejectionReasons.push("starts with 0 or 8");
    }

    const accepted = rejectionReasons.length === 0;
    const confidence = orderTypeDetails.orderType ? orderTypeDetails.confidence : "low";

    return {
      orderNumber: normalizedOrderNumber,
      prefix: getOrderNumberPrefix(normalizedOrderNumber),
      startIndex,
      rawOrderType: orderTypeDetails.rawOrderType,
      orderType: orderTypeDetails.orderType,
      orderTypeConfidence: orderTypeDetails.confidence,
      accepted,
      confidence,
      reason: accepted ? (orderTypeDetails.orderType ? "" : "order type needs review") : rejectionReasons[0] || "rejected",
      reasons: rejectionReasons,
      context: afterText.trim()
    };
  }

  function buildDeterministicEmserBlocks(rawText, pageNumber, pagePalletLp) {
    const normalizedText = normalizeEmserPageText(rawText);
    const orderMatches = Array.from(normalizedText.matchAll(/\b(\d{8})\b/g));
    const orderCandidateDebug = orderMatches.map((match) =>
      classifyOrderNumberCandidate(normalizedText, match[1], typeof match.index === "number" ? match.index : 0, {
        contextWindow: 100,
        beforeWindow: 40
      })
    );
    const acceptedCandidates = orderCandidateDebug.filter((candidate) => candidate.accepted);
    const rejectedCandidates = orderCandidateDebug.filter((candidate) => !candidate.accepted);
    const prefixProfile = buildOrderPrefixProfile(acceptedCandidates);

    acceptedCandidates.forEach((candidate) => {
      const prefixAssessment = getOrderPrefixAssessment(candidate.orderNumber, prefixProfile);
      candidate.prefix = prefixAssessment.prefix;
      candidate.prefixCount = prefixAssessment.prefixCount;
      candidate.prefixConfidence = prefixAssessment.confidence;
      candidate.prefixReason = prefixAssessment.reason;
      candidate.possibleFalsePositive = prefixAssessment.confidence === "low";
      candidate.confidence = prefixAssessment.confidence === "low" || !candidate.orderType ? "low" : candidate.confidence;
    });

    const orderNumbersFound = orderCandidateDebug.map((candidate) => candidate.orderNumber);
    const blocks = acceptedCandidates.map((candidate, index) => {
      const startIndex = candidate.startIndex;
      const nextCandidate = acceptedCandidates[index + 1];
      const blockRawText = normalizedText
        .slice(startIndex, nextCandidate ? nextCandidate.startIndex : normalizedText.length)
        .trim();
      const blockOrderTypeDetails = findOrderTypeDetailsInText(blockRawText);
      candidate.endIndex = nextCandidate ? nextCandidate.startIndex - 1 : normalizedText.length - 1;
      candidate.rowSliceText = blockRawText;
      candidate.rawOrderType = blockOrderTypeDetails.rawOrderType;
      candidate.orderType = blockOrderTypeDetails.orderType;
      candidate.orderTypeConfidence = blockOrderTypeDetails.orderType ? blockOrderTypeDetails.confidence : "low";
      candidate.detectedOrderType = blockOrderTypeDetails.orderType || "Needs review";
      candidate.reason = blockOrderTypeDetails.orderType
        ? candidate.prefixReason || candidate.reason
        : [candidate.prefixReason, "order type needs review"].filter(Boolean).join("; ");
      candidate.confidence =
        candidate.prefixConfidence === "low" || !blockOrderTypeDetails.orderType
          ? "low"
          : candidate.confidence;

      return {
        id: createRowId(`emser-block-${pageNumber}-${index + 1}`),
        blockNumber: index + 1,
        pageNumber,
        palletNumber: buildPagePalletNumber(pageNumber),
        palletLp: extractPalletLpFromText(rawText) || pagePalletLp || "",
        startLineIndex: startIndex,
        endLineIndex: candidate.endIndex,
        orderNumber: candidate.orderNumber,
        orderType: blockOrderTypeDetails.orderType,
        rawOrderType: blockOrderTypeDetails.rawOrderType,
        orderTypeConfidence: blockOrderTypeDetails.orderType ? blockOrderTypeDetails.confidence : "low",
        orderNumberPrefix: candidate.prefix,
        orderNumberPrefixCount: candidate.prefixCount,
        orderNumberPrefixConfidence: candidate.prefixConfidence,
        orderNumberPrefixReason: candidate.prefixReason,
        possibleFalsePositive: candidate.possibleFalsePositive,
        lines: buildLinesFromRawText(blockRawText),
        rawText: blockRawText
      };
    });

    rejectedCandidates.forEach((candidate) => {
      candidate.endIndex = candidate.startIndex;
      candidate.rowSliceText = "";
      candidate.detectedOrderType = "Needs review";
    });

    return {
      normalizedText,
      orderNumbersFound,
      acceptedOrderNumbers: acceptedCandidates.map((candidate) => candidate.orderNumber),
      rejectedOrderNumbers: rejectedCandidates.map((candidate) => candidate.orderNumber),
      lowConfidenceOutliers: acceptedCandidates
        .filter((candidate) => candidate.possibleFalsePositive)
        .map((candidate) => candidate.orderNumber),
      prefixFrequency: prefixProfile.prefixEntries,
      orderCandidateDebug,
      blocks,
      missingOrderNumbers: rejectedCandidates.map((candidate) => candidate.orderNumber),
      droppedCandidates: rejectedCandidates.map((candidate) => ({
        orderNumber: candidate.orderNumber,
        reason: candidate.reason || "rejected",
        confidence: candidate.confidence
      }))
    };
  }

  function buildItemBlocksFromOrderCandidates(rawText, pageNumber, candidates, pagePalletLp, blockIdPrefix) {
    const normalizedRawText = String(rawText || "").trim();
    const itemBlocks = [];

    candidates.forEach((candidate, index) => {
      const nextCandidate = candidates[index + 1];
      const blockRawText = normalizedRawText
        .slice(candidate.startIndex, nextCandidate ? nextCandidate.startIndex : normalizedRawText.length)
        .trim();
      const blockLines = buildLinesFromRawText(blockRawText);

      itemBlocks.push({
        id: createRowId(`${blockIdPrefix || "block"}-${pageNumber}-${index + 1}`),
        blockNumber: index + 1,
        pageNumber,
        palletNumber: buildPagePalletNumber(pageNumber),
        palletLp: extractPalletLpFromText(blockRawText) || pagePalletLp || extractPalletLpFromText(normalizedRawText),
        startLineIndex: candidate.startIndex,
        endLineIndex: nextCandidate ? nextCandidate.startIndex - 1 : normalizedRawText.length - 1,
        orderNumber: candidate.orderNumber,
        orderType: candidate.orderType,
        rawOrderType: candidate.rawOrderType || candidate.orderType,
        orderTypeConfidence: candidate.orderTypeConfidence || "high",
        lines: blockLines,
        rawText: blockRawText
      });
    });

    return itemBlocks;
  }

  function splitBlockByEmbeddedOrderStarts(block) {
    const blockRawText = safeText(block?.rawText);
    if (!blockRawText) {
      return {
        blocks: block ? [block] : [],
        orderStartsFound: 0,
        droppedCandidates: []
      };
    }

    const { candidates, droppedCandidates } = findOrderCandidatesInRawText(blockRawText);
    if (candidates.length <= 1) {
      return {
        blocks: block ? [block] : [],
        orderStartsFound: candidates.length || (block?.orderNumber && block?.orderType ? 1 : 0),
        droppedCandidates
      };
    }

    const splitBlocks = buildItemBlocksFromOrderCandidates(
      blockRawText,
      block.pageNumber,
      candidates,
      block.palletLp || "",
      `sub-block-${block.pageNumber}`
    ).map((subBlock) => ({
      ...subBlock,
      parentBlockId: block.id,
      palletNumber: block.palletNumber || subBlock.palletNumber,
      palletLp: block.palletLp || subBlock.palletLp || "",
      sourceBlockNumber: block.blockNumber
    }));

    return {
      blocks: splitBlocks,
      orderStartsFound: candidates.length,
      droppedCandidates
    };
  }

  function expandItemBlocksByOrderStarts(itemBlocks) {
    const expandedBlocks = [];
    const droppedCandidates = [];
    let orderStartsFound = 0;

    (itemBlocks || []).forEach((block) => {
      const splitResult = splitBlockByEmbeddedOrderStarts(block);
      orderStartsFound += splitResult.orderStartsFound;

      if (Array.isArray(splitResult.droppedCandidates) && splitResult.droppedCandidates.length > 0) {
        splitResult.droppedCandidates.forEach((candidate) => {
          droppedCandidates.push({
            ...candidate,
            blockNumber: block.blockNumber
          });
        });
      }

      (splitResult.blocks || []).forEach((nextBlock) => {
        expandedBlocks.push(nextBlock);
      });
    });

    const normalizedBlocks = expandedBlocks.map((block, index) => ({
      ...block,
      id: createRowId(`block-${block.pageNumber}-${index + 1}`),
      blockNumber: index + 1
    }));

    normalizedBlocks.orderStartsFound = orderStartsFound;
    normalizedBlocks.droppedCandidates = droppedCandidates;

    return normalizedBlocks;
  }

  function splitPageIntoItemBlocks(lines, pageNumber) {
    const rawText = lines.map((line) => line.text).join("\n").trim();
    const { candidates, droppedCandidates } = findOrderCandidatesInRawText(rawText);
    const itemBlocks = buildItemBlocksFromOrderCandidates(
      rawText,
      pageNumber,
      candidates,
      extractPalletLpFromText(rawText),
      "block"
    );

    itemBlocks.orderCandidatesCount = candidates.length;
    itemBlocks.droppedCandidates = droppedCandidates;

    return itemBlocks;
  }

  function buildFallbackBlocksFromOrderNumbers(lines, pageNumber, pagePalletLp) {
    const fallbackBlocks = [];
    const rawText = lines.map((line) => line.text).join("\n").trim();
    const orderMatches = Array.from(rawText.matchAll(/\b(\d{8})\b/g));

    orderMatches.forEach((match, index) => {
      const orderNumber = match[1];
      const startIndex = typeof match.index === "number" ? match.index : 0;
      const nextMatch = orderMatches[index + 1];
      const blockRawText = rawText
        .slice(startIndex, nextMatch && typeof nextMatch.index === "number" ? nextMatch.index : rawText.length)
        .trim();
      const blockLines = buildLinesFromRawText(blockRawText);

      fallbackBlocks.push({
        id: createRowId(`fallback-block-${pageNumber}-${index + 1}`),
        blockNumber: index + 1,
        pageNumber,
        palletNumber: buildPagePalletNumber(pageNumber),
        palletLp: extractPalletLpFromText(blockRawText) || pagePalletLp || "",
        startLineIndex: startIndex,
        endLineIndex: nextMatch && typeof nextMatch.index === "number" ? nextMatch.index - 1 : rawText.length - 1,
        orderNumber,
        orderType: findOrderTypeDetailsInText(blockRawText).orderType,
        rawOrderType: findOrderTypeDetailsInText(blockRawText).rawOrderType,
        orderTypeConfidence: findOrderTypeDetailsInText(blockRawText).confidence,
        lines: blockLines,
        rawText: blockRawText
      });
    });

    return fallbackBlocks;
  }

  function buildFallbackPreviewRows(lines, pageNumber, defaultPalletLabel, extractionDetails) {
    const fallbackBlocks = buildFallbackBlocksFromOrderNumbers(lines, pageNumber, extractionDetails.pagePalletLp);
    return fallbackBlocks.map((block) => {
      const builtPreview = buildPreviewRowFromBlock(block, defaultPalletLabel, extractionDetails);
      return {
        row: applyPreviewReviewState({
          ...builtPreview.row,
          confidence: "low",
          confidenceReason: builtPreview.row.orderNumber
            ? `Low confidence: created from OCR order number fallback for ${builtPreview.row.orderNumber}.`
            : "Low confidence: created from OCR order number fallback."
        }),
        debugBlock: builtPreview.debugBlock
      };
    });
  }

  function sanitizeBlockToken(token) {
    return String(token || "")
      .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9./_-]+$/g, "")
      .trim()
      .toUpperCase();
  }

  function isLikelySizeToken(token) {
    return /^\d{1,2}X\d{1,2}(?:X\d{1,2})?$/i.test(String(token || "").trim());
  }

  function isLikelyItemNumberToken(token) {
    const cleanedToken = sanitizeBlockToken(token);
    if (!cleanedToken || cleanedToken.length < 5) {
      return false;
    }

    if (/^\d{8}$/.test(cleanedToken) || /^\d+$/.test(cleanedToken)) {
      return false;
    }

    if (VALID_ORDER_TYPE_SET.has(cleanedToken) || isLikelySizeToken(cleanedToken)) {
      return false;
    }

    if (/^(?:QTY|QUANTITY|CARTONS?|CTNS?|CTN|EA|SF|PC|PALLET|PAGE|TOTAL)$/i.test(cleanedToken)) {
      return false;
    }

    return /^[A-Z0-9./_-]+$/.test(cleanedToken) && /\d/.test(cleanedToken);
  }

  function tokenizeBlockText(text) {
    return String(text || "")
      .split(/\s+/)
      .map(sanitizeBlockToken)
      .filter(Boolean);
  }

  function tokenizeSourceLine(text) {
    return String(text || "")
      .split(/\s+/)
      .map((token, tokenIndex) => ({
        raw: String(token || "").trim(),
        token: sanitizeBlockToken(token),
        tokenIndex
      }))
      .filter((entry) => entry.token);
  }

  function tokenizeBlockLines(blockLines) {
    return (blockLines || []).flatMap((line, lineIndex) =>
      tokenizeSourceLine(line.text).map((entry) => ({
        ...entry,
        lineIndex,
        sourceText: line.text
      }))
    );
  }

  function isIgnoredEmserTypeToken(token) {
    return sanitizeBlockToken(token) === "SK";
  }

  function looksLikeCustomerNameText(text) {
    const normalizedText = safeText(text);
    if (!normalizedText) {
      return false;
    }

    if (/\d/.test(normalizedText) || PRODUCT_HINT_PATTERN.test(normalizedText) || isLikelySizeToken(normalizedText)) {
      return false;
    }

    const words = normalizedText.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 6) {
      return false;
    }

    const uppercaseWords = words.filter((word) => /^[A-Z&'.-]+$/.test(word)).length;
    const uppercaseRatio = words.length > 0 ? uppercaseWords / words.length : 0;

    return uppercaseRatio >= 0.8 && (EMSER_CUSTOMER_NAME_PATTERN.test(normalizedText) || words.length >= 3);
  }

  function isShortLineNumberToken(token) {
    return /^\d{1,4}$/.test(sanitizeBlockToken(token));
  }

  function isBlockNumericValueToken(token) {
    return new RegExp(`^${QUANTITY_VALUE_REGEX_SOURCE}$`).test(String(token || "").replace(/,/g, ""));
  }

  function buildQuantityDetailsFromFields(fields) {
    const normalizedUom = normalizeUom(fields.uom);
    const quantityBuckets = {
      cartonsQty: serializeCount(fields.cartons || 0),
      piecesQty: serializeCount(fields.pieces || 0),
      squareFeetQty: "",
      otherQty: ""
    };

    if (normalizedUom === "SF" && fields.qty) {
      quantityBuckets.squareFeetQty = serializeCount(fields.qty);
    } else if (!normalizedUom && fields.qty) {
      quantityBuckets.otherQty = serializeCount(fields.qty);
    }

    if (normalizedUom === "CT" && !isPopulatedQuantity(quantityBuckets.cartonsQty) && fields.qty) {
      quantityBuckets.cartonsQty = serializeCount(fields.qty);
    }

    if ((normalizedUom === "PC" || normalizedUom === "EA") && !isPopulatedQuantity(quantityBuckets.piecesQty) && fields.qty) {
      quantityBuckets.piecesQty = serializeCount(fields.qty);
    }

    if (normalizedUom && !buildDisplayQty(quantityBuckets) && fields.qty) {
      assignQuantityCandidateToBuckets(quantityBuckets, fields.qty, normalizedUom);
    }

    const displayQty = buildDisplayQty(quantityBuckets);

    return {
      quantity: serializeCount(fields.qty || 0),
      uom: normalizedUom,
      cartonsQty: quantityBuckets.cartonsQty,
      piecesQty: quantityBuckets.piecesQty,
      squareFeetQty: quantityBuckets.squareFeetQty,
      otherQty: quantityBuckets.otherQty,
      displayQty,
      quantitySource: fields.qtySource || (fields.qty ? "emser-columns" : "missing"),
      uomSource: normalizedUom ? fields.uomSource || "emser-columns" : "missing",
      hasAnyQuantity: Boolean(displayQty)
    };
  }

  function trimEmserDescriptionTail(text) {
    const normalizedText = safeText(text);
    if (!normalizedText) {
      return "";
    }

    const quantityMatch = normalizedText.match(
      new RegExp(`\\b${QUANTITY_VALUE_REGEX_SOURCE}\\s*(?:${UOM_REGEX_SOURCE})\\b`, "i")
    );

    if (!quantityMatch || typeof quantityMatch.index !== "number") {
      return normalizedText;
    }

    let trimmedText = normalizedText.slice(0, quantityMatch.index).trim();
    const trimmedTokens = trimmedText.split(/\s+/).filter(Boolean);
    const trailingToken = trimmedTokens[trimmedTokens.length - 1];

    if (
      trailingToken &&
      isLikelyItemNumberToken(trailingToken) &&
      !PRODUCT_HINT_PATTERN.test(trailingToken) &&
      !isLikelySizeToken(trailingToken)
    ) {
      trimmedTokens.pop();
      trimmedText = trimmedTokens.join(" ").trim();
    }

    return trimmedText;
  }

  function extractStructuredEmserDescription(blockLines, itemNumberDetails, context) {
    if (!itemNumberDetails || !itemNumberDetails.itemNumber) {
      return null;
    }

    const descriptionParts = [];

    blockLines.forEach((line, lineIndex) => {
      let lineText = String(line.text || "");
      if (looksLikeCustomerNameText(lineText)) {
        return;
      }

      if (lineIndex === itemNumberDetails.lineIndex) {
        const tokens = tokenizeSourceLine(lineText);
        const itemTokenIndex = tokens.findIndex((entry) => entry.token === itemNumberDetails.itemNumber);
        if (itemTokenIndex !== -1) {
          const trailingText = tokens
            .slice(itemTokenIndex + 1)
            .map((entry) => entry.raw)
            .join(" ");
          lineText = trailingText;
        }
      }

      const trimmedLine = trimEmserDescriptionTail(lineText);
      const cleanedCandidate = cleanupDescriptionCandidate(trimmedLine, context);
      if (!cleanedCandidate || looksLikeCustomerNameText(cleanedCandidate)) {
        return;
      }

      if (looksLikeProductDescriptionText(cleanedCandidate) || /\s/.test(cleanedCandidate)) {
        descriptionParts.push(cleanedCandidate);
      }
    });

    const mergedDescription = uniqueValues(descriptionParts).join(" ").replace(/\s+/g, " ").trim();
    if (!mergedDescription) {
      return {
        productDescription: "Needs review",
        source: "missing",
        score: 0,
        candidates: []
      };
    }

    if (isLikelyItemNumberToken(mergedDescription) || !isHumanReadableDescriptionCandidate(mergedDescription, itemNumberDetails.itemNumber)) {
      return {
        productDescription: "Needs review",
        source: "guessed",
        score: 0,
        candidates: uniqueValues(descriptionParts).slice(0, 5)
      };
    }

    return {
      productDescription: mergedDescription,
      source: "detected",
      score: scoreDescriptionCandidate(mergedDescription),
      candidates: uniqueValues(descriptionParts).slice(0, 5)
    };
  }

  function decodeEmserRowBlock(block) {
    const tokenEntries = tokenizeBlockLines(block.lines).filter((entry) => !looksLikeCustomerNameText(entry.sourceText));
    const orderEntryIndex = tokenEntries.findIndex((entry) => /^\d{8}$/.test(entry.token));
    const orderTypeEntryIndex = tokenEntries.findIndex(
      (entry, index) => index > orderEntryIndex && VALID_ORDER_TYPE_SET.has(normalizeOrderType(entry.token))
    );
    const salesOrderEntryIndex = tokenEntries.findIndex(
      (entry, index) => index > orderTypeEntryIndex && /^\d{8}$/.test(entry.token)
    );
    const ignoredTypeEntryIndex = tokenEntries.findIndex(
      (entry, index) => index > Math.max(orderTypeEntryIndex, salesOrderEntryIndex) && isIgnoredEmserTypeToken(entry.token)
    );
    const lineNumberEntryIndex = tokenEntries.findIndex(
      (entry, index) => index > Math.max(ignoredTypeEntryIndex, salesOrderEntryIndex, orderTypeEntryIndex) && isShortLineNumberToken(entry.token)
    );
    const uomEntryIndex = (() => {
      for (let index = tokenEntries.length - 1; index >= 0; index -= 1) {
        if (normalizeUom(tokenEntries[index].token)) {
          return index;
        }
      }
      return -1;
    })();
    const qtyEntryIndex = (() => {
      if (uomEntryIndex === -1) {
        return -1;
      }
      for (let index = uomEntryIndex - 1; index >= 0; index -= 1) {
        if (isBlockNumericValueToken(tokenEntries[index].token) && !/^\d{8}$/.test(tokenEntries[index].token)) {
          return index;
        }
      }
      return -1;
    })();
    const cartonsEntryIndex = (() => {
      if (uomEntryIndex === -1) {
        return -1;
      }
      for (let index = uomEntryIndex + 1; index < tokenEntries.length; index += 1) {
        if (isBlockNumericValueToken(tokenEntries[index].token) && !/^\d{8}$/.test(tokenEntries[index].token)) {
          return index;
        }
      }
      return -1;
    })();
    const piecesEntryIndex = (() => {
      if (cartonsEntryIndex === -1) {
        return -1;
      }
      for (let index = cartonsEntryIndex + 1; index < tokenEntries.length; index += 1) {
        if (isBlockNumericValueToken(tokenEntries[index].token) && !/^\d{8}$/.test(tokenEntries[index].token)) {
          return index;
        }
      }
      return -1;
    })();
    const itemEntryIndex = tokenEntries.findIndex((entry, index) => {
      if (!isLikelyItemNumberToken(entry.token) || isIgnoredEmserTypeToken(entry.token)) {
        return false;
      }

      if (index <= Math.max(lineNumberEntryIndex, ignoredTypeEntryIndex, salesOrderEntryIndex, orderTypeEntryIndex)) {
        return false;
      }

      if (uomEntryIndex !== -1 && index >= uomEntryIndex) {
        return false;
      }

      return true;
    });

    const itemNumber = itemEntryIndex !== -1 ? tokenEntries[itemEntryIndex].token : "";
    const qtyValue = qtyEntryIndex !== -1 ? parseCount(tokenEntries[qtyEntryIndex].token) : 0;
    const cartonsValue = cartonsEntryIndex !== -1 ? parseCount(tokenEntries[cartonsEntryIndex].token) : 0;
    const piecesValue = piecesEntryIndex !== -1 ? parseCount(tokenEntries[piecesEntryIndex].token) : 0;
    const uomValue = uomEntryIndex !== -1 ? normalizeUom(tokenEntries[uomEntryIndex].token) : "";
    const quantityDetails = buildQuantityDetailsFromFields({
      qty: qtyValue,
      qtySource: qtyEntryIndex !== -1 ? "emser-columns" : "missing",
      uom: uomValue,
      uomSource: uomEntryIndex !== -1 ? "emser-columns" : "missing",
      cartons: cartonsValue,
      pieces: piecesValue
    });
    const itemNumberDetails = {
      itemNumber,
      source: itemNumber ? "emser-column" : "missing",
      score: itemNumber ? 10 : 0,
      lineIndex: itemEntryIndex !== -1 ? tokenEntries[itemEntryIndex].lineIndex : -1,
      tokenIndex: itemEntryIndex
    };
    const descriptionContext = {
      orderNumber: block.orderNumber,
      orderType: block.orderType,
      itemNumber,
      quantity: quantityDetails.quantity,
      uom: quantityDetails.uom,
      cartonsQty: quantityDetails.cartonsQty,
      piecesQty: quantityDetails.piecesQty,
      squareFeetQty: quantityDetails.squareFeetQty,
      otherQty: quantityDetails.otherQty
    };
    const descriptionDetails = getSafeDescriptionDetails(
      extractStructuredEmserDescription(block.lines, itemNumberDetails, descriptionContext)
    );

    return {
      itemNumberDetails,
      descriptionDetails,
      countDetails: quantityDetails,
      rows: [],
      candidates: {
        orderNumbers: [block.orderNumber].filter(Boolean),
        orderTypes: [block.orderType].filter(Boolean),
        itemNumbers: itemNumber ? [itemNumber] : [],
        descriptions: descriptionDetails.candidates,
        quantities: [quantityDetails.displayQty || quantityDetails.quantity].filter(Boolean)
      },
      errors: [],
      debug: {
        detectedTokens: tokenEntries.map((entry) => entry.token),
        chosenOrderNumber: block.orderNumber,
        chosenOrderType: block.orderType,
        chosenItemNumber: itemNumber,
        chosenDescription: getDescription(descriptionDetails),
        chosenQty: quantityDetails.quantity,
        chosenUom: quantityDetails.uom,
        chosenCartons: quantityDetails.cartonsQty,
        chosenPieces: quantityDetails.piecesQty
      }
    };
  }

  function scoreItemNumberCandidate(token) {
    const cleanedToken = sanitizeBlockToken(token);
    if (!isLikelyItemNumberToken(cleanedToken)) {
      return -1;
    }

    let score = 0;
    if (/[A-Z]/.test(cleanedToken) && /\d/.test(cleanedToken)) {
      score += 4;
    }
    if (/[./_-]/.test(cleanedToken)) {
      score += 1;
    }
    if (cleanedToken.length >= 8) {
      score += 1;
    }

    return score;
  }

  function extractItemNumberFromBlock(blockText, orderNumber, orderType) {
    const directStructuredMatch = String(blockText || "").match(
      /\b\d{8}\b\s+\b(?:SI|S6|S7|C8)\b(?:\s+\d{8})?\s+\b[A-Z]{2}\b\s+\d{1,4}\s+([A-Z0-9./_-]{5,})\b/i
    );

    if (directStructuredMatch) {
      const directItemNumber = sanitizeBlockToken(directStructuredMatch[1]);
      if (isLikelyItemNumberToken(directItemNumber) && !isIgnoredEmserTypeToken(directItemNumber)) {
        return {
          itemNumber: directItemNumber,
          source: "emser-structured",
          score: 10,
          lineIndex: 0,
          tokenIndex: -1
        };
      }
    }

    const labeledMatch = String(blockText || "").match(
      /\b(?:item|sku|item\s*#|item number|product code)\s*[:#]?\s*([A-Z0-9./_-]{5,})\b/i
    );

    if (labeledMatch) {
      const labeledItemNumber = sanitizeBlockToken(labeledMatch[1]);
      if (isLikelyItemNumberToken(labeledItemNumber)) {
        return {
          itemNumber: labeledItemNumber,
          source: "labeled",
          score: 8,
          lineIndex: 0,
          tokenIndex: -1
        };
      }
    }

    let bestCandidate = null;

    buildLinesFromRawText(blockText).forEach((line, lineIndex) => {
      const tokens = tokenizeSourceLine(line.text);
      const orderIndex = tokens.findIndex((entry) => entry.token === sanitizeBlockToken(orderNumber));
      const typeIndex = tokens.findIndex(
        (entry, tokenIndex) => tokenIndex >= Math.max(orderIndex, 0) && normalizeOrderType(entry.token) === orderType
      );

      tokens.forEach((entry, tokenIndex) => {
        const token = entry.token;
        const baseScore = scoreItemNumberCandidate(token);
        if (baseScore < 0 || isIgnoredEmserTypeToken(token)) {
          return;
        }

        const previousToken = tokenIndex > 0 ? tokens[tokenIndex - 1].token : "";
        const secondPreviousToken = tokenIndex > 1 ? tokens[tokenIndex - 2].token : "";
        const isAfterOrderType = typeIndex !== -1 && tokenIndex > typeIndex;
        const precededByLineNumber = /^\d{1,4}$/.test(previousToken);
        const precededByIgnoredType = isIgnoredEmserTypeToken(previousToken) || isIgnoredEmserTypeToken(secondPreviousToken);
        const distancePenalty = typeIndex === -1 || !isAfterOrderType ? 0 : Math.max(0, tokenIndex - typeIndex - 6);
        const score =
          baseScore +
          (isAfterOrderType ? 2 : 0) +
          (precededByLineNumber ? 3 : 0) +
          (precededByIgnoredType ? 3 : 0) -
          distancePenalty;

        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = {
            itemNumber: token,
            source: precededByIgnoredType || precededByLineNumber ? "emser-token" : isAfterOrderType ? "ordered-token" : "token",
            score,
            lineIndex,
            tokenIndex
          };
        }
      });
    });

    return bestCandidate || { itemNumber: "", source: "missing", score: 0, lineIndex: -1, tokenIndex: -1 };
  }

  function cleanupDescriptionCandidate(text, context) {
    let cleanedText = String(text || "");

    cleanedText = cleanedText.replace(
      /\b(?:description|desc|item|sku|item\s*#|item number|product code|pick qty|qty|quantity|uom|cartons?|ctns?|ctn|ct|pieces?|pcs?|pc|ea|each|sf|sqft|s\/f|sq\.?\s*ft|square\s+(?:foot|feet))\b\s*[:#]?/gi,
      " "
    );
    cleanedText = cleanedText.replace(/\|/g, " ");

    if (context.orderNumber) {
      cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(context.orderNumber)}\\b`, "g"), " ");
    }

    if (context.orderType) {
      cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(context.orderType)}\\b`, "gi"), " ");
    }

    if (context.itemNumber) {
      cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(context.itemNumber)}\\b`, "g"), " ");
    }

    [context.quantity, context.cartonsQty, context.piecesQty, context.squareFeetQty, context.otherQty].forEach((value) => {
      if (value) {
        cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(String(value))}\\b`, "g"), " ");
      }
    });

    [context.uom, "CT", "PC", "EA", "SF", "OTHER"].forEach((value) => {
      if (value) {
        cleanedText = cleanedText.replace(new RegExp(`\\b${escapeRegExp(String(value))}\\b`, "gi"), " ");
      }
    });

    cleanedText = cleanupLooseProductText(cleanedText);
    cleanedText = cleanedText.replace(new RegExp(`\\b${QUANTITY_VALUE_REGEX_SOURCE}\\b`, "g"), " ");
    return cleanedText.replace(/\s+/g, " ").trim();
  }

  function isHumanReadableDescriptionCandidate(text, itemNumber) {
    const normalizedText = String(text || "").trim();
    if (!normalizedText || normalizedText === sanitizeBlockToken(itemNumber)) {
      return false;
    }

    if (!/\s/.test(normalizedText) || !/[A-Za-z]/.test(normalizedText)) {
      return false;
    }

    if (PDF_IGNORED_LINE_PATTERN.test(normalizedText)) {
      return false;
    }

    const tokens = normalizedText.split(/\s+/);
    const humanTokens = tokens.filter(
      (token) => /[A-Za-z]/.test(token) && !isLikelyItemNumberToken(token) && !/^\d+$/.test(token)
    );

    if (humanTokens.length < 2) {
      return false;
    }

    return looksLikeProductDescriptionText(normalizedText) || /\b\d{1,2}X\d{1,2}(?:X\d{1,2})?\b/i.test(normalizedText);
  }

  function isDescriptionContinuationText(text, itemNumber) {
    const normalizedText = String(text || "").trim();
    if (!normalizedText || normalizedText === sanitizeBlockToken(itemNumber)) {
      return false;
    }

    if (PDF_IGNORED_LINE_PATTERN.test(normalizedText)) {
      return false;
    }

    if (isLikelyItemNumberToken(normalizedText)) {
      return false;
    }

    if (new RegExp(`^${QUANTITY_VALUE_REGEX_SOURCE}$`).test(normalizedText)) {
      return false;
    }

    return (
      /\b\d{1,2}X\d{1,2}(?:X\d{1,2})?\b/i.test(normalizedText) ||
      (/[A-Za-z]/.test(normalizedText) && normalizedText.split(/\s+/).length <= 6)
    );
  }

  function scoreDescriptionCandidate(text) {
    const normalizedText = String(text || "").trim();
    if (!normalizedText) {
      return 0;
    }

    let score = 0;

    if (looksLikeProductDescriptionText(normalizedText)) {
      score += 3;
    }

    if (PRODUCT_HINT_PATTERN.test(normalizedText)) {
      score += 3;
    }

    if (/\b\d{1,2}X\d{1,2}(?:X\d{1,2})?\b/i.test(normalizedText)) {
      score += 2;
    }

    if (normalizedText.split(/\s+/).length >= 2) {
      score += 1;
    }

    if (/\b(?:qty|uom|cartons?|ctns?|ct|pieces?|pcs?|ea|sf|sqft|s\/f|square\s+(?:foot|feet)|pc|pallet|page|total|tracking|carrier|ship)\b/i.test(normalizedText)) {
      score -= 4;
    }

    return score;
  }

  function extractDescriptionFromBlock(blockLines, context) {
    const descriptionParts = [];
    const pendingDescriptionParts = [];

    function pushUniquePart(parts, value) {
      const normalizedValue = normalizeText(value);
      if (!parts.some((part) => normalizeText(part) === normalizedValue)) {
        parts.push(value);
      }
    }

    blockLines.forEach((line) => {
      const cleanedCandidate = cleanupDescriptionCandidate(line.text, context);
      if (!cleanedCandidate) {
        return;
      }

      const isPrimaryDescription = isHumanReadableDescriptionCandidate(cleanedCandidate, context.itemNumber);
      const isContinuation = isDescriptionContinuationText(cleanedCandidate, context.itemNumber);

      if (isPrimaryDescription) {
        if (pendingDescriptionParts.length > 0 && descriptionParts.length === 0) {
          pendingDescriptionParts.forEach((part) => pushUniquePart(descriptionParts, part));
        }
        pushUniquePart(descriptionParts, cleanedCandidate);
        return;
      }

      if (!isContinuation) {
        return;
      }

      if (descriptionParts.length > 0) {
        pushUniquePart(descriptionParts, cleanedCandidate);
      } else {
        pushUniquePart(pendingDescriptionParts, cleanedCandidate);
      }
    });

    if (descriptionParts.length === 0 && pendingDescriptionParts.length > 0) {
      pendingDescriptionParts.forEach((part) => pushUniquePart(descriptionParts, part));
    }

    const mergedDescription = descriptionParts.join(" ").replace(/\s+/g, " ").trim();
    const mergedScore = scoreDescriptionCandidate(mergedDescription);
    const bestCandidate = mergedDescription
      ? {
          text: mergedDescription,
          score: mergedScore
        }
      : null;

    return {
      productDescription: bestCandidate ? bestCandidate.text : "Needs review",
      source: bestCandidate && bestCandidate.score >= 5 ? "detected" : bestCandidate ? "guessed" : "missing",
      score: bestCandidate ? bestCandidate.score : 0,
      candidates: descriptionParts.slice(0, 5)
    };
  }

  function extractQuantityAndUomFromBlock(blockText, orderNumber, orderType, itemNumber) {
    return extractQuantityAndUomDetails(blockText, orderNumber, orderType, itemNumber);
  }

  function buildConfidenceDetails(block, itemNumberDetails, descriptionDetails, countDetails, extractionDetails) {
    const safeDescriptionDetails = getSafeDescriptionDetails(descriptionDetails);
    const confidenceIssues = [];
    const extractionMethod = extractionDetails && extractionDetails.extractionMethod ? extractionDetails.extractionMethod : "text PDF";
    const ocrConfidence =
      extractionDetails && Number.isFinite(extractionDetails.ocrConfidence)
        ? Math.round(extractionDetails.ocrConfidence)
        : null;
    const orderType = safeText(block?.orderType);
    const rawOrderType = safeText(block?.rawOrderType);
    const orderTypeConfidence = safeLower(block?.orderTypeConfidence || "high");
    const prefixConfidence = safeLower(block?.orderNumberPrefixConfidence || "high");
    const prefixReason = safeText(block?.orderNumberPrefixReason);
    const hasAllCoreFields = Boolean(
      safeText(block?.orderNumber) &&
      orderType &&
      itemNumberDetails.itemNumber &&
      getDescription(safeDescriptionDetails) !== "Needs review" &&
      countDetails.hasAnyQuantity
    );

    if (!orderType) {
      confidenceIssues.push("missing order type");
    } else if (orderTypeConfidence === "low" && rawOrderType) {
      confidenceIssues.push(`order type normalized from ${rawOrderType}`);
    }

    if (prefixConfidence === "low" && prefixReason) {
      confidenceIssues.push(prefixReason);
    }

    if (!itemNumberDetails.itemNumber) {
      confidenceIssues.push("missing item number");
    }

    if (getDescription(safeDescriptionDetails) === "Needs review") {
      confidenceIssues.push("description needs review");
    } else if (safeDescriptionDetails.source !== "detected") {
      confidenceIssues.push("description guessed");
    }

    if (!countDetails.hasAnyQuantity) {
      confidenceIssues.push("missing qty");
    } else if (countDetails.quantitySource === "fallback") {
      confidenceIssues.push("qty guessed from block numbers");
    }

    if (!countDetails.uom) {
      confidenceIssues.push("missing UOM");
    } else if (countDetails.uomSource !== "labeled") {
      confidenceIssues.push("UOM guessed");
    }

    if (extractionMethod === "OCR" && ocrConfidence !== null && ocrConfidence < LOW_OCR_CONFIDENCE_THRESHOLD) {
      confidenceIssues.push(`OCR confidence ${ocrConfidence}%`);
    }

    const confidence = hasAllCoreFields && confidenceIssues.length === 0 ? "high" : "low";

    return {
      confidence,
      confidenceReason:
        confidence === "high"
          ? extractionMethod === "OCR" && ocrConfidence !== null
            ? `Order, type, item, description, and qty were found in the same block. OCR confidence ${ocrConfidence}%.`
            : "Order, type, item, description, and qty were found in the same block."
          : confidenceIssues.length > 0
            ? `Low confidence: ${confidenceIssues.join(", ")}.`
            : "Low confidence: review this block."
    };
  }

  function createFallbackDecodedFields(block, error) {
    const errorMessage = error instanceof Error ? error.message : "Decoder failed";
    return {
      itemNumberDetails: {
        itemNumber: "",
        source: "missing",
        score: 0,
        lineIndex: -1,
        tokenIndex: -1
      },
      descriptionDetails: getSafeDescriptionDetails(null),
      countDetails: {
        quantity: "0",
        uom: "",
        cartonsQty: "0",
        piecesQty: "0",
        squareFeetQty: "0",
        otherQty: "0",
        displayQty: "",
        quantitySource: "missing",
        uomSource: "missing",
        hasAnyQuantity: false
      },
      debug: {
        detectedTokens: tokenizeBlockText(block?.rawText),
        chosenOrderNumber: block?.orderNumber || "",
        chosenOrderType: block?.orderType || "",
        chosenRawOrderType: block?.rawOrderType || "",
        chosenOrderTypeConfidence: block?.orderTypeConfidence || "low",
        chosenItemNumber: "",
        chosenDescription: "Needs review",
        chosenQty: "",
        chosenUom: "",
        chosenCartons: "0",
        chosenPieces: "0"
      },
      errors: [errorMessage]
    };
  }

  function createParseFailedPreviewBlock(block, defaultPalletLabel, extractionDetails, error) {
    const errorMessage = error instanceof Error ? error.message : "parse_failed";
    const previewRow = createPreviewRow(
      {
        id: createRowId(`pdf-failed-${block.pageNumber}-${block.blockNumber}`),
        blockId: block.id,
        rawBlock: block.rawText,
        sourcePage: block.pageNumber,
        pageNumber: block.pageNumber,
        pageLabel: formatPalletLabel(defaultPalletLabel),
        palletNumber: defaultPalletLabel,
        palletLp: block.palletLp || extractionDetails.pagePalletLp || "",
        orderNumber: block.orderNumber || "",
        orderType: block.orderType || "",
        rawOrderType: block.rawOrderType || block.orderType || "",
        orderTypeConfidence: block.orderTypeConfidence || "low",
        orderNumberPrefix: block.orderNumberPrefix || "",
        orderNumberPrefixCount: block.orderNumberPrefixCount || 0,
        orderNumberPrefixConfidence: block.orderNumberPrefixConfidence || "low",
        orderNumberPrefixReason: block.orderNumberPrefixReason || "",
        itemNumber: "",
        productDescription: "Needs review",
        cartonsQty: "0",
        piecesQty: "0",
        squareFeetQty: "0",
        otherQty: "0",
        confidence: "low",
        confidenceReason: `Low confidence: parse_failed. ${errorMessage}`,
        extractionMethod: extractionDetails.extractionMethod,
        ocrConfidence: extractionDetails.ocrConfidence,
        error: "parse_failed"
      },
      block.blockNumber
    );

    return {
      row: previewRow,
      debugBlock: {
        id: block.id,
        label: `Block ${block.blockNumber}`,
        rawText: block.rawText,
        extractionMethod: extractionDetails.extractionMethod,
        ocrConfidence:
          Number.isFinite(extractionDetails.ocrConfidence) ? Math.round(extractionDetails.ocrConfidence) : null,
        confidence: "low",
        confidenceReason: `Low confidence: parse_failed. ${errorMessage}`,
        detections: {
          orderNumbers: [block.orderNumber].filter(Boolean),
          orderTypes: [block.orderType].filter(Boolean),
          rawOrderType: block.rawOrderType || "",
          orderTypeConfidence: block.orderTypeConfidence || "low",
          orderNumberPrefix: block.orderNumberPrefix || "",
          orderNumberPrefixCount: block.orderNumberPrefixCount || 0,
          orderNumberPrefixConfidence: block.orderNumberPrefixConfidence || "low",
          orderNumberPrefixReason: block.orderNumberPrefixReason || "",
          palletIdentifiers: [defaultPalletLabel].filter(Boolean),
          palletLp: block.palletLp || extractionDetails.pagePalletLp || "",
          itemNumber: "",
          itemNumberSource: "missing",
          itemNumberLineIndex: -1,
          itemNumberTokenIndex: -1,
          rawBlock: block.rawText,
          quantity: "0",
          quantitySource: "missing",
          uom: "",
          uomSource: "missing",
          cartonsQty: "0",
          piecesQty: "0",
          squareFeetQty: "0",
          otherQty: "0",
          displayQty: "",
          candidateProductDescriptions: [],
          productDescription: "Needs review",
          fieldAssignments: {
            orderNumber: block.orderNumber || "",
            orderType: block.orderType || "Needs review",
            rawOrderType: block.rawOrderType || "",
            orderTypeConfidence: block.orderTypeConfidence || "low",
            orderTypeSource: block.orderType ? "detected" : "missing",
            orderPrefix: block.orderNumberPrefix || "",
            orderPrefixCount: block.orderNumberPrefixCount || 0,
            orderPrefixConfidence: block.orderNumberPrefixConfidence || "low",
            itemNumber: "",
            productDescription: "Needs review",
            productDescriptionSource: "missing",
            quantities: "",
            qty: "",
            uom: "",
            cartons: "0",
            pieces: "0",
            qtySource: "missing"
          },
          detectedTokens: tokenizeBlockText(block.rawText),
          decoderCandidates: defaultCandidates,
          chosenFields: {
            detectedTokens: tokenizeBlockText(block.rawText),
            chosenOrderNumber: block.orderNumber || "",
            chosenOrderType: block.orderType || "",
            chosenRawOrderType: block.rawOrderType || "",
            chosenOrderTypeConfidence: block.orderTypeConfidence || "low",
            chosenItemNumber: "",
            chosenDescription: "Needs review",
            chosenQty: "",
            chosenUom: "",
            chosenCartons: "0",
            chosenPieces: "0"
          }
        }
      }
    };
  }

  function buildPreviewRowFromBlock(block, defaultPalletLabel, extractionDetails) {
    const pageIsEmserFormat = Boolean(extractionDetails && extractionDetails.isEmserFormat);
    let emserDecodedFields = null;

    if (pageIsEmserFormat) {
      try {
        emserDecodedFields = decodeEmserRowBlock(block) ?? {
          rows: [],
          candidates: defaultCandidates,
          errors: ["Decoder returned null"],
          ...createFallbackDecodedFields(block)
        };
      } catch (error) {
        console.error("Row block decode failed", error, block);
        emserDecodedFields = {
          rows: [],
          candidates: defaultCandidates,
          ...createFallbackDecodedFields(block, error)
        };
      }
    }

    let itemNumberDetails;
    try {
      itemNumberDetails = emserDecodedFields
        ? emserDecodedFields.itemNumberDetails
        : extractItemNumberFromBlock(block.rawText, block.orderNumber, block.orderType);
    } catch (error) {
      console.error("Item number decode failed", error, block);
      itemNumberDetails = createFallbackDecodedFields(block, error).itemNumberDetails;
    }
    if (isIgnoredEmserTypeToken(itemNumberDetails.itemNumber)) {
      itemNumberDetails.itemNumber = "";
      itemNumberDetails.source = "invalid-sk";
      itemNumberDetails.score = 0;
    }
    let countDetails;
    try {
      countDetails = emserDecodedFields
        ? emserDecodedFields.countDetails
        : extractQuantityAndUomFromBlock(
            block.rawText,
            block.orderNumber,
            block.orderType,
            itemNumberDetails.itemNumber
          ) || createFallbackDecodedFields(block).countDetails;
    } catch (error) {
      console.error("Quantity decode failed", error, block);
      countDetails = createFallbackDecodedFields(block, error).countDetails;
    }
    const descriptionContext = {
      orderNumber: block.orderNumber,
      orderType: block.orderType,
      itemNumber: itemNumberDetails.itemNumber,
      quantity: countDetails.quantity,
      uom: countDetails.uom,
      cartonsQty: countDetails.cartonsQty,
      piecesQty: countDetails.piecesQty,
      squareFeetQty: countDetails.squareFeetQty,
      otherQty: countDetails.otherQty
    };
    let descriptionDetails;
    try {
      descriptionDetails = getSafeDescriptionDetails(
        emserDecodedFields
          ? emserDecodedFields.descriptionDetails
          : extractDescriptionFromBlock(block.lines, descriptionContext)
      );
    } catch (error) {
      console.error("Description decode failed", error, block);
      descriptionDetails = getSafeDescriptionDetails(null);
    }
    const detectedPalletIdentifiers = uniqueValues([defaultPalletLabel]);
    const detectedPalletLp = block.palletLp || extractPalletLpFromText(block.rawText) || extractionDetails.pagePalletLp || "";
    const confidenceDetails = buildConfidenceDetails(
      block,
      itemNumberDetails,
      descriptionDetails,
      countDetails,
      extractionDetails
    );
    const typeSource = block.orderType
      ? block.orderTypeConfidence === "low"
        ? "ocr-normalized"
        : "detected"
      : "missing";
    const previewRow = createPreviewRow(
      {
        id: createRowId(`pdf-${block.pageNumber}-${block.blockNumber}`),
        blockId: block.id,
        rawBlock: block.rawText,
        sourcePage: block.pageNumber,
        pageNumber: block.pageNumber,
        pageLabel: formatPalletLabel(defaultPalletLabel),
        palletNumber: defaultPalletLabel,
        palletLp: detectedPalletLp,
        orderNumber: block.orderNumber,
        orderType: block.orderType,
        rawOrderType: block.rawOrderType || block.orderType,
        orderTypeConfidence: block.orderTypeConfidence || "high",
        orderNumberPrefix: block.orderNumberPrefix || "",
        orderNumberPrefixCount: block.orderNumberPrefixCount || 0,
        orderNumberPrefixConfidence: block.orderNumberPrefixConfidence || "high",
        orderNumberPrefixReason: block.orderNumberPrefixReason || "",
        itemNumber: itemNumberDetails.itemNumber,
        productDescription: getDescription(descriptionDetails),
        quantity: countDetails.quantity || "0",
        uom: countDetails.uom,
        cartonsQty: countDetails.cartonsQty || "0",
        piecesQty: countDetails.piecesQty || "0",
        squareFeetQty: countDetails.squareFeetQty || "0",
        otherQty: countDetails.otherQty || "0",
        displayQty: countDetails.displayQty || "",
        confidence: confidenceDetails.confidence,
        confidenceReason:
          emserDecodedFields && Array.isArray(emserDecodedFields.errors) && emserDecodedFields.errors.length > 0
            ? `${confidenceDetails.confidenceReason} Decoder note: ${emserDecodedFields.errors.join(", ")}.`
            : confidenceDetails.confidenceReason,
        extractionMethod: extractionDetails.extractionMethod,
        ocrConfidence: extractionDetails.ocrConfidence
      },
      block.blockNumber
    );

    return {
      row: previewRow,
      debugBlock: {
        id: block.id,
        label: `Block ${block.blockNumber}`,
        rawText: block.rawText,
        extractionMethod: extractionDetails.extractionMethod,
        ocrConfidence:
          Number.isFinite(extractionDetails.ocrConfidence) ? Math.round(extractionDetails.ocrConfidence) : null,
        confidence: confidenceDetails.confidence,
        confidenceReason: confidenceDetails.confidenceReason,
        detections: {
          orderNumbers: [block.orderNumber].filter(Boolean),
          orderTypes: [block.orderType].filter(Boolean),
          rawOrderType: block.rawOrderType || "",
          orderTypeConfidence: block.orderTypeConfidence || "high",
          orderNumberPrefix: block.orderNumberPrefix || "",
          orderNumberPrefixCount: block.orderNumberPrefixCount || 0,
          orderNumberPrefixConfidence: block.orderNumberPrefixConfidence || "high",
          orderNumberPrefixReason: block.orderNumberPrefixReason || "",
          palletIdentifiers: detectedPalletIdentifiers,
          palletLp: detectedPalletLp,
          itemNumber: itemNumberDetails.itemNumber,
          itemNumberSource: itemNumberDetails.source,
          itemNumberLineIndex: itemNumberDetails.lineIndex,
          itemNumberTokenIndex: itemNumberDetails.tokenIndex,
          rawBlock: block.rawText,
          quantity: countDetails.quantity,
          quantitySource: countDetails.quantitySource,
          uom: countDetails.uom,
          uomSource: countDetails.uomSource,
          cartonsQty: countDetails.cartonsQty,
          piecesQty: countDetails.piecesQty,
          squareFeetQty: countDetails.squareFeetQty,
          otherQty: countDetails.otherQty,
          displayQty: countDetails.displayQty,
          candidateProductDescriptions: Array.isArray(descriptionDetails?.candidates) ? descriptionDetails.candidates : [],
          productDescription: getDescription(descriptionDetails),
          fieldAssignments: {
            orderNumber: block.orderNumber,
            orderType: block.orderType || "Needs review",
            rawOrderType: block.rawOrderType || "",
            orderTypeConfidence: block.orderTypeConfidence || "high",
            orderTypeSource: typeSource,
            orderPrefix: block.orderNumberPrefix || "",
            orderPrefixCount: block.orderNumberPrefixCount || 0,
            orderPrefixConfidence: block.orderNumberPrefixConfidence || "high",
            itemNumber: itemNumberDetails.itemNumber,
            productDescription: getDescription(descriptionDetails),
            productDescriptionSource: descriptionDetails.source || "missing",
            quantities: countDetails.displayQty || "",
            qty: countDetails.quantity || "",
            uom: countDetails.uom || "",
            cartons: countDetails.cartonsQty || "0",
            pieces: countDetails.piecesQty || "0",
            qtySource: countDetails.quantitySource || "missing"
          },
          detectedTokens: emserDecodedFields ? emserDecodedFields.debug.detectedTokens : tokenizeBlockText(block.rawText),
          decoderCandidates: safeCandidates(emserDecodedFields),
          chosenFields: emserDecodedFields
            ? emserDecodedFields.debug
            : {
                detectedTokens: tokenizeBlockText(block.rawText),
                chosenOrderNumber: block.orderNumber,
                chosenOrderType: block.orderType,
                chosenRawOrderType: block.rawOrderType || "",
                chosenOrderTypeConfidence: block.orderTypeConfidence || "high",
                chosenItemNumber: itemNumberDetails.itemNumber,
                chosenDescription: getDescription(descriptionDetails),
                chosenQty: countDetails.quantity,
                chosenUom: countDetails.uom,
                chosenCartons: countDetails.cartonsQty,
                chosenPieces: countDetails.piecesQty
              }
        }
      }
    };
  }

  function buildPreviewRowsFromPage(lines, pageNumber, options) {
    const pageOptions = options || {};
    const rawText = lines.map((line) => line.text).join("\n").trim();
    const extractionMethod = pageOptions.extractionMethod || "text PDF";
    const ocrConfidence = Number.isFinite(pageOptions.ocrConfidence) ? Math.round(pageOptions.ocrConfidence) : null;
    const selectedRotation = Number.isFinite(pageOptions.selectedRotation) ? Number(pageOptions.selectedRotation) : null;
    const ocrRotations = Array.isArray(pageOptions.ocrRotations) ? pageOptions.ocrRotations : [];
    const isEmserFormat = isEmserPalletText(rawText);
    const detectedPalletIdentifiers = extractPalletIdentifiersFromText(rawText);
    const pagePalletNumber = buildPagePalletNumber(pageNumber);
    const pagePalletLp = extractPalletLpFromText(rawText);
    const defaultPalletLabel = detectedPalletIdentifiers[0] || pagePalletNumber;
    const emserPageData = isEmserFormat ? buildDeterministicEmserBlocks(rawText, pageNumber, pagePalletLp) : null;
    const parsingRawText = emserPageData ? emserPageData.normalizedText : rawText;
    const detectedOrderNumbers = emserPageData
      ? emserPageData.orderNumbersFound.slice()
      : uniqueValues(rawText.match(/\b\d{8}\b/g) || []);
    const detectedOrderTypes = uniqueValues(
      ((emserPageData ? parsingRawText : rawText).match(/\b(?:SI|S6|S7|C8)\b/gi) || []).map((value) => safeUpper(value))
    );
    const detectedItemBlocks = emserPageData ? emserPageData.blocks : splitPageIntoItemBlocks(lines, pageNumber);
    const itemBlocks = expandItemBlocksByOrderStarts(detectedItemBlocks);
    const ocrTextStats = getMeaningfulTextStats(rawText);
    const orderStartsFound = Number(
      emserPageData ? emserPageData.orderNumbersFound.length : itemBlocks.orderStartsFound || itemBlocks.length || 0
    );
    const droppedRows = Array.isArray(itemBlocks.droppedCandidates)
      ? itemBlocks.droppedCandidates
      : emserPageData && Array.isArray(emserPageData.droppedCandidates)
        ? emserPageData.droppedCandidates
        : Array.isArray(detectedItemBlocks.droppedCandidates)
        ? detectedItemBlocks.droppedCandidates
        : [];
    const orderCandidatesFound = Number(emserPageData ? emserPageData.orderNumbersFound.length : detectedItemBlocks.orderCandidatesCount || orderStartsFound || itemBlocks.length || 0);
    let parsedBlocks = [];
    const blockExtractionDetails = {
      extractionMethod,
      ocrConfidence,
      pagePalletLp,
      isEmserFormat
    };

    itemBlocks.forEach((block) => {
      try {
        const parsedBlock = buildPreviewRowFromBlock(block, defaultPalletLabel, blockExtractionDetails);
        if (parsedBlock) {
          parsedBlocks.push(parsedBlock);
        } else {
          parsedBlocks.push(createParseFailedPreviewBlock(block, defaultPalletLabel, blockExtractionDetails, "parse_failed"));
        }
      } catch (error) {
        console.error("Preview row creation failed", error, block);
        parsedBlocks.push(createParseFailedPreviewBlock(block, defaultPalletLabel, blockExtractionDetails, error));
      }
    });

    if (!emserPageData && parsedBlocks.length === 0 && detectedOrderNumbers.length > 0) {
      parsedBlocks = buildFallbackPreviewRows(lines, pageNumber, defaultPalletLabel, {
        extractionMethod,
        ocrConfidence,
        pagePalletLp,
        isEmserFormat
      });
    }

    const candidateProductDescriptions = uniqueValues(
      parsedBlocks
        .flatMap((block) => block.debugBlock.detections.candidateProductDescriptions)
        .concat(detectCandidateProductDescriptions(lines))
    ).slice(0, 10);
    const pageRows = parsedBlocks.map((block) => block.row);
    const createdOrderNumbers = pageRows.map((row) => digitsOnly(row?.orderNumber).slice(0, 8)).filter(Boolean);
    const missingOrderNumbers = emserPageData
      ? emserPageData.rejectedOrderNumbers.slice()
      : detectedOrderNumbers.filter((orderNumber, index) => createdOrderNumbers[index] !== orderNumber);

    const needsOcr = extractionMethod === "text PDF" && needsOcrForRawText(rawText);
    const pageWarning = buildPageWarning({
      rawText,
      pageRows,
      needsOcr,
      extractionMethod,
      ocrConfidence
    });

    return {
      pageNumber,
      pageLabel: formatPalletLabel(defaultPalletLabel),
      defaultPalletLabel,
      palletLp: pagePalletLp,
      parserVersion: PARSER_VERSION,
      ocrVersion: extractionMethod === "OCR" ? OCR_VERSION : extractionMethod,
      rawText,
      needsOcr,
      extractionMethod,
      ocrConfidence,
      selectedRotation,
      ocrRotations,
      rowBlocksDetected: itemBlocks.length,
      orderStartsFound,
      rowsCreatedFromOrderStarts: parsedBlocks.length,
      rowsCreated: pageRows.length,
      finalRowsDisplayed: pageRows.length,
      ocrTextLength: ocrTextStats.characterCount,
      orderCandidatesFound,
      orderNumbersFound: detectedOrderNumbers,
      acceptedOrderNumbers: emserPageData ? emserPageData.acceptedOrderNumbers : createdOrderNumbers,
      rejectedOrderNumbers: emserPageData ? emserPageData.rejectedOrderNumbers : [],
      lowConfidenceOutliers: emserPageData ? emserPageData.lowConfidenceOutliers : [],
      prefixFrequency: emserPageData ? emserPageData.prefixFrequency : [],
      orderCandidateDebug: emserPageData ? emserPageData.orderCandidateDebug : [],
      missingOrderNumbers,
      normalizedText: emserPageData ? parsingRawText : "",
      droppedRows,
      warning: pageWarning,
      blocks: parsedBlocks.map((block) => block.debugBlock),
      detections: {
        orderNumbers: uniqueValues(detectedOrderNumbers),
        orderTypes: detectedOrderTypes,
        palletIdentifiers: uniqueValues([defaultPalletLabel].concat(detectedPalletIdentifiers)),
        palletLp: pagePalletLp,
        candidateProductDescriptions,
        format: isEmserFormat ? "Emser" : ""
      },
      rows: pageRows
    };
  }

  function parseRawTextPage(rawText) {
    const normalizedRawText = String(rawText || "").replace(/\r\n/g, "\n").trim();
    const parsedPage = buildPreviewRowsFromPage(buildLinesFromRawText(normalizedRawText), 1, {
      extractionMethod: "raw text"
    });

    return {
      sourceName: "Raw Text Test",
      shipDate: extractShipmentDateFromText(normalizedRawText) || "Raw Text Test",
      ocrWarning: "",
      ocrPagesCount: 0,
      textPagesCount: 0,
      pages: [parsedPage]
    };
  }

  function rebuildImportFromCachedPages(importData) {
    const sourceImport = importData || {};
    const rebuiltPages = (sourceImport.pages || []).map((page) => {
      const pageRawText = safeText(page?.rawText);
      if (!pageRawText) {
        return createImportPage(page?.pageNumber || 0, {
          ...page,
          rows: Array.isArray(page?.rows) ? page.rows : []
        });
      }

      const rebuiltPage = buildPreviewRowsFromPage(buildLinesFromRawText(pageRawText), page.pageNumber, {
        extractionMethod: page.extractionMethod || "OCR",
        ocrConfidence: page.ocrConfidence,
        selectedRotation: page.selectedRotation,
        ocrRotations: Array.isArray(page.ocrRotations) ? page.ocrRotations : []
      });

      return {
        ...rebuiltPage,
        palletLp: safeText(page?.palletLp) || rebuiltPage.palletLp
      };
    });

    const pagesWithRawText = rebuiltPages.filter((page) => normalizeText(page.rawText));
    const ocrPages = rebuiltPages.filter((page) => page.extractionMethod === "OCR");
    const totalRows = rebuiltPages.reduce((count, page) => count + (Array.isArray(page.rows) ? page.rows.length : 0), 0);

    return {
      ...sourceImport,
      ocrWarning:
        totalRows === 0
          ? "0 rows found."
          : safeText(sourceImport.ocrWarning),
      ocrPagesCount: ocrPages.length,
      textPagesCount: pagesWithRawText.length - ocrPages.length < 0 ? 0 : pagesWithRawText.length - ocrPages.length,
      pages: rebuiltPages
    };
  }

  function attachPageDebugVersions(page, ocrVersion, comparisonDebug) {
    return {
      ...page,
      parserVersion: PARSER_VERSION,
      ocrVersion: safeText(ocrVersion),
      comparisonDebug: comparisonDebug || null
    };
  }

  function buildOcrComparisonDebug(baselinePage, optimizedPage, chosenPage, droppedRows) {
    return {
      parserVersion: PARSER_VERSION,
      baselineOcrVersion: OCR_BASELINE_VERSION,
      optimizedOcrVersion: OCR_VERSION,
      chosenOcrVersion:
        chosenPage && safeText(chosenPage.ocrVersion)
          ? safeText(chosenPage.ocrVersion)
          : optimizedPage && chosenPage === optimizedPage
            ? OCR_VERSION
            : OCR_BASELINE_VERSION,
      rawOcrTextLength: chosenPage ? Number(chosenPage.ocrTextLength || 0) : 0,
      baselineRawOcrTextLength: baselinePage ? Number(baselinePage.ocrTextLength || 0) : 0,
      optimizedRawOcrTextLength: optimizedPage ? Number(optimizedPage.ocrTextLength || 0) : 0,
      acceptedOrderNumbersBeforeOptimization: baselinePage?.acceptedOrderNumbers || [],
      acceptedOrderNumbersAfterOptimization: optimizedPage?.acceptedOrderNumbers || [],
      rowsCreated: Number(chosenPage?.rows?.length || 0),
      baselineRowsCreated: Number(baselinePage?.rows?.length || 0),
      optimizedRowsCreated: Number(optimizedPage?.rows?.length || 0),
      droppedRows: Array.isArray(droppedRows) ? droppedRows : [],
      dropReasons: Array.isArray(droppedRows) ? droppedRows.map((row) => row.reason).filter(Boolean) : [],
      usedFallback: Boolean(baselinePage && optimizedPage && Number(optimizedPage?.rows?.length || 0) < Number(baselinePage?.rows?.length || 0))
    };
  }

  function createImportPage(pageNumber, overrides) {
    const pageOverrides = overrides || {};
    const defaultPalletLabel = pageOverrides.defaultPalletLabel || buildPagePalletNumber(pageNumber);
    return {
      sourceName: safeText(pageOverrides.sourceName),
      pageNumber,
      pageLabel: pageOverrides.pageLabel || formatPalletLabel(defaultPalletLabel),
      defaultPalletLabel,
      palletLp: safeText(pageOverrides.palletLp),
      rawText: safeText(pageOverrides.rawText),
      needsOcr: Boolean(pageOverrides.needsOcr),
      extractionMethod: safeText(pageOverrides.extractionMethod || "OCR") || "OCR",
      ocrConfidence: Number.isFinite(pageOverrides.ocrConfidence) ? Math.round(pageOverrides.ocrConfidence) : null,
      selectedRotation: Number.isFinite(pageOverrides.selectedRotation) ? Number(pageOverrides.selectedRotation) : null,
      ocrRotations: Array.isArray(pageOverrides.ocrRotations) ? pageOverrides.ocrRotations : [],
      parserVersion: safeText(pageOverrides.parserVersion || PARSER_VERSION),
      ocrVersion: safeText(pageOverrides.ocrVersion || ""),
      orderStartsFound: Number(pageOverrides.orderStartsFound || 0),
      rowsCreatedFromOrderStarts: Number(pageOverrides.rowsCreatedFromOrderStarts || 0),
      finalRowsDisplayed: Number(pageOverrides.finalRowsDisplayed || 0),
      orderNumbersFound: Array.isArray(pageOverrides.orderNumbersFound) ? pageOverrides.orderNumbersFound : [],
      acceptedOrderNumbers: Array.isArray(pageOverrides.acceptedOrderNumbers) ? pageOverrides.acceptedOrderNumbers : [],
      rejectedOrderNumbers: Array.isArray(pageOverrides.rejectedOrderNumbers) ? pageOverrides.rejectedOrderNumbers : [],
      lowConfidenceOutliers: Array.isArray(pageOverrides.lowConfidenceOutliers) ? pageOverrides.lowConfidenceOutliers : [],
      prefixFrequency: Array.isArray(pageOverrides.prefixFrequency) ? pageOverrides.prefixFrequency : [],
      orderCandidateDebug: Array.isArray(pageOverrides.orderCandidateDebug) ? pageOverrides.orderCandidateDebug : [],
      missingOrderNumbers: Array.isArray(pageOverrides.missingOrderNumbers) ? pageOverrides.missingOrderNumbers : [],
      normalizedText: safeText(pageOverrides.normalizedText),
      cacheHit: Boolean(pageOverrides.cacheHit),
      comparisonDebug: pageOverrides.comparisonDebug || null,
      warning: safeText(pageOverrides.warning),
      blocks: Array.isArray(pageOverrides.blocks) ? pageOverrides.blocks : [],
      detections: {
        orderNumbers: [],
        orderTypes: [],
        palletIdentifiers: [defaultPalletLabel],
        palletLp: safeText(pageOverrides.palletLp),
        candidateProductDescriptions: [],
        format: safeText(pageOverrides.format)
      },
      rows: Array.isArray(pageOverrides.rows) ? pageOverrides.rows : []
    };
  }

  function createImportErrorResult(sourceName, errorMessage, options) {
    const errorOptions = options || {};
    const pages = Array.isArray(errorOptions.pages) && errorOptions.pages.length > 0
      ? errorOptions.pages
      : [
          createImportPage(1, {
            extractionMethod: "OCR",
            warning: safeText(errorMessage) || "Import failed."
          })
        ];

    return {
      sourceName: safeText(sourceName) || "Import",
      sourceSignature: safeText(errorOptions.sourceSignature),
      debugMode: Boolean(errorOptions.debugMode),
      shipDate: safeText(errorOptions.shipDate) || "Import failed",
      ocrWarning: "",
      ocrPagesCount: Number(errorOptions.ocrPagesCount || 0),
      textPagesCount: Number(errorOptions.textPagesCount || 0),
      importError: safeText(errorMessage) || "Import failed.",
      pages
    };
  }

  function getPdfLibrary() {
    const pdfLibrary = window.pdfjsLib;
    if (!pdfLibrary) {
      throw new Error("PDF parsing library did not load. Refresh the page and try again.");
    }

    pdfLibrary.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    return pdfLibrary;
  }

  function getOcrLibrary() {
    const ocrLibrary = window.Tesseract;
    if (!ocrLibrary || typeof ocrLibrary.createWorker !== "function") {
      throw new Error("OCR library did not load. Refresh the page and try again.");
    }

    return ocrLibrary;
  }

  async function createOcrWorker() {
    const ocrLibrary = getOcrLibrary();
    return ocrLibrary.createWorker("eng", 1, {
      workerPath: OCR_WORKER_SRC,
      langPath: OCR_LANG_PATH,
      corePath: OCR_CORE_PATH
    });
  }

  function normalizeRecognizedText(text) {
    return String(text || "").replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
  }

  function isEmserPalletText(text) {
    const normalizedText = safeUpper(text);
    return normalizedText.includes("PALLET CONTENT LIST") || normalizedText.includes("EMSER TILE");
  }

  function scoreOcrRotationText(text, confidence) {
    const normalizedText = normalizeRecognizedText(text);
    const matchedHints = EMSER_ROTATION_HINTS.filter((entry) => entry.pattern.test(normalizedText)).map((entry) => entry.label);
    const hintScore = EMSER_ROTATION_HINTS.reduce(
      (totalScore, entry) => totalScore + (entry.pattern.test(normalizedText) ? entry.score : 0),
      0
    );
    const orderNumbers = uniqueValues(normalizedText.match(/\b\d{8}\b/g) || []);
    const orderScore = Math.min(orderNumbers.length, 6) * 10;
    const lineStats = getMeaningfulTextStats(normalizedText);
    const confidenceScore = Number.isFinite(confidence) ? Math.round(confidence / 8) : 0;
    const textScore = Math.min(Math.floor(lineStats.lineCount / 2), 12);

    return {
      score: hintScore + orderScore + confidenceScore + textScore,
      matchedHints,
      orderCount: orderNumbers.length,
      orderNumbers
    };
  }

  function shouldAcceptRotationShortcut(rotationResult) {
    if (!rotationResult) {
      return false;
    }

    return (
      Number(rotationResult.score || 0) >= 60 &&
      (
        Number(rotationResult.orderCount || 0) >= 2 ||
        (Array.isArray(rotationResult.matchedHints) && rotationResult.matchedHints.length >= 2) ||
        Number(rotationResult.confidence || 0) >= 82
      )
    );
  }

  function createRotatedCanvas(sourceCanvas, rotation) {
    if (rotation % 360 === 0) {
      return sourceCanvas;
    }

    const rotatedCanvas = document.createElement("canvas");
    const rotatedContext = rotatedCanvas.getContext("2d", { alpha: false });

    if (!rotatedContext) {
      throw new Error("Unable to create a rotated OCR canvas.");
    }

    const normalizedRotation = ((rotation % 360) + 360) % 360;
    const quarterTurn = normalizedRotation === 90 || normalizedRotation === 270;

    rotatedCanvas.width = quarterTurn ? sourceCanvas.height : sourceCanvas.width;
    rotatedCanvas.height = quarterTurn ? sourceCanvas.width : sourceCanvas.height;

    rotatedContext.save();
    rotatedContext.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
    rotatedContext.rotate((normalizedRotation * Math.PI) / 180);
    rotatedContext.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
    rotatedContext.restore();

    return rotatedCanvas;
  }

  function prepareCanvasForOcr(sourceCanvas, scaleMultiplier) {
    const normalizedScale = Math.max(1, Number(scaleMultiplier) || 1);
    const preparedCanvas = document.createElement("canvas");
    const preparedContext = preparedCanvas.getContext("2d", { alpha: false, willReadFrequently: true });

    if (!preparedContext) {
      throw new Error("Unable to create an OCR preparation canvas.");
    }

    preparedCanvas.width = Math.max(1, Math.round(sourceCanvas.width * normalizedScale));
    preparedCanvas.height = Math.max(1, Math.round(sourceCanvas.height * normalizedScale));
    preparedContext.fillStyle = "#ffffff";
    preparedContext.fillRect(0, 0, preparedCanvas.width, preparedCanvas.height);
    preparedContext.imageSmoothingEnabled = true;
    preparedContext.filter = "grayscale(100%) contrast(185%) brightness(112%)";
    preparedContext.drawImage(sourceCanvas, 0, 0, preparedCanvas.width, preparedCanvas.height);
    preparedContext.filter = "none";

    const imageData = preparedContext.getImageData(0, 0, preparedCanvas.width, preparedCanvas.height);
    const pixels = imageData.data;

    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      const contrasted = Math.max(0, Math.min(255, (luminance - 128) * 1.35 + 128));
      const sharpened = contrasted > 168 ? 255 : contrasted < 112 ? 0 : contrasted;

      pixels[index] = sharpened;
      pixels[index + 1] = sharpened;
      pixels[index + 2] = sharpened;
      pixels[index + 3] = 255;
    }

    preparedContext.putImageData(imageData, 0, 0);
    return preparedCanvas;
  }

  async function renderPdfPageToCanvas(page, scale) {
    const viewport = page.getViewport({ scale: scale || OCR_RENDER_SCALE });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    if (!context) {
      throw new Error("Unable to create a PDF render canvas for OCR.");
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    return canvas;
  }

  async function recognizeCanvasWithOcr(worker, canvas, progressLabel, onProgress) {
    if (typeof onProgress === "function") {
      onProgress(`${progressLabel}: running OCR...`);
    }

    const result = await worker.recognize(canvas);
    const text = normalizeRecognizedText(result && result.data ? result.data.text : "");
    const confidence = result && result.data && Number.isFinite(Number(result.data.confidence))
      ? Math.round(Number(result.data.confidence))
      : null;

    return {
      text,
      confidence
    };
  }

  async function recognizeCanvasAtRotations(worker, sourceCanvas, progressLabel, onProgress, options) {
    const recognitionOptions = options || {};
    const debugMode = Boolean(recognitionOptions.debugMode);
    const preprocessCanvas = recognitionOptions.preprocess !== false;
    const allowShortcut = recognitionOptions.allowShortcut !== false;
    const preferredRotation = Number.isFinite(recognitionOptions.preferredRotation)
      ? ((Number(recognitionOptions.preferredRotation) % 360) + 360) % 360
      : null;
    const orderedRotations = uniqueValues(
      [preferredRotation].concat(OCR_ROTATIONS).filter((rotation) => Number.isFinite(rotation))
    );
    const rotationResults = [];

    for (const rotation of orderedRotations) {
      const rotatedCanvas = createRotatedCanvas(sourceCanvas, rotation);
      const canvas = preprocessCanvas ? prepareCanvasForOcr(rotatedCanvas, 1) : rotatedCanvas;
      const ocrResult = await recognizeCanvasWithOcr(
        worker,
        canvas,
        `${progressLabel} (${rotation}°)`,
        onProgress
      );
      const rotationScore = scoreOcrRotationText(ocrResult.text, ocrResult.confidence);

      rotationResults.push({
        rotation,
        text: ocrResult.text,
        confidence: ocrResult.confidence,
        score: rotationScore.score,
        matchedHints: rotationScore.matchedHints,
        orderCount: rotationScore.orderCount,
        orderNumbers: rotationScore.orderNumbers
      });

      if (!debugMode && allowShortcut && shouldAcceptRotationShortcut(rotationResults[rotationResults.length - 1])) {
        break;
      }
    }

    rotationResults.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.orderCount !== left.orderCount) {
        return right.orderCount - left.orderCount;
      }
      if ((right.confidence || 0) !== (left.confidence || 0)) {
        return (right.confidence || 0) - (left.confidence || 0);
      }
      return getMeaningfulTextStats(right.text).characterCount - getMeaningfulTextStats(left.text).characterCount;
    });

    const bestResult = rotationResults[0] || {
      rotation: 0,
      text: "",
      confidence: null,
      score: 0,
      matchedHints: [],
      orderCount: 0,
      orderNumbers: []
    };

    return {
      rotationResults: rotationResults.map((entry) => ({
        rotation: entry.rotation,
        confidence: entry.confidence,
        score: entry.score,
        matchedHints: entry.matchedHints,
        orderCount: entry.orderCount,
        selected: entry.rotation === bestResult.rotation
      })),
      selectedRotation: bestResult.rotation,
      text: bestResult.text,
      confidence: bestResult.confidence,
      score: bestResult.score,
      matchedHints: bestResult.matchedHints,
      orderNumbers: bestResult.orderNumbers
    };
  }

  function getFileType(file) {
    return String((file && file.type) || "").toLowerCase();
  }

  function isHeicFile(file) {
    const extension = getFileExtension(file && file.name);
    const fileType = getFileType(file);
    return extension === "heic" || extension === "heif" || fileType === "image/heic" || fileType === "image/heif";
  }

  async function normalizeImageFileForOcr(file) {
    if (!isHeicFile(file)) {
      return file;
    }

    if (typeof window.heic2any !== "function") {
      throw new Error("HEIC conversion is not available in this browser.");
    }

    const convertedBlob = await window.heic2any({
      blob: file,
      toType: "image/png"
    });

    return Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
  }

  async function renderImageBlobToCanvas(blob) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    if (!context) {
      throw new Error("Unable to create an image render canvas for OCR.");
    }

    if (typeof window.createImageBitmap === "function") {
      const bitmap = await window.createImageBitmap(blob);
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      context.drawImage(bitmap, 0, 0);
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }
      return canvas;
    }

    const objectUrl = URL.createObjectURL(blob);

    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Unable to decode the uploaded image."));
        element.src = objectUrl;
      });

      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      context.drawImage(image, 0, 0);
      return canvas;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function parseShipmentPdf(file, onProgress, options) {
    const pdfLibrary = getPdfLibrary();
    const parseOptions = options || {};
    const debugMode = Boolean(parseOptions.debugMode);
    const cacheStore = parseOptions.cacheStore || loadOcrCacheStore();
    const fileSignature = buildFileCacheSignature(file);
    const fileBuffer = await file.arrayBuffer();
    const pdfDocument = await pdfLibrary.getDocument({ data: fileBuffer }).promise;
    const totalPages = pdfDocument.numPages;
    const pages = new Array(totalPages);
    let detectedShipmentDate = "";
    let importError = "";
    const workerPool = new Array(Math.min(OCR_MAX_PAGE_CONCURRENCY, Math.max(1, totalPages))).fill(null);
    const sharedRotationState = {
      preferredRotation: null
    };
    const startedAt = Date.now();
    let completedPages = 0;

    async function getWorker(slotIndex) {
      if (!workerPool[slotIndex]) {
        if (typeof onProgress === "function") {
          onProgress({
            message: "Starting OCR...",
            currentPage: completedPages + 1,
            totalPages
          });
        }
        workerPool[slotIndex] = await createOcrWorker();
      }

      return workerPool[slotIndex];
    }

    try {
      const pageIndexes = Array.from({ length: totalPages }, (_, index) => index + 1);

      await mapWithConcurrency(pageIndexes, OCR_MAX_PAGE_CONCURRENCY, async (pageIndex, _pageOffset, slotIndex) => {
        const startedCount = completedPages + 1;
        if (typeof onProgress === "function") {
          onProgress({
            message: `Processing page ${pageIndex} of ${totalPages}`,
            currentPage: startedCount,
            totalPages,
            completedPages
          });
        }

        try {
          const page = await pdfDocument.getPage(pageIndex);
          const textContent = await page.getTextContent();
          const textLines = groupPdfItemsIntoLines(textContent.items);
          const textParsedPage = buildPreviewRowsFromPage(textLines, pageIndex, {
            extractionMethod: "text PDF"
          });
          let parsedPage = textParsedPage;

          if (!normalizeText(textParsedPage.rawText) || textParsedPage.needsOcr) {
            const cachedOptimizedOcr = getCachedOcrPageVariant(cacheStore, fileSignature, pageIndex, "optimized");
            const cachedBaselineOcr = getCachedOcrPageVariant(cacheStore, fileSignature, pageIndex, "baseline");

            let optimizedOcrResult = cachedOptimizedOcr && cachedOptimizedOcr.text ? cachedOptimizedOcr : null;
            let baselineOcrResult = cachedBaselineOcr && cachedBaselineOcr.text ? cachedBaselineOcr : null;
            let ocrWorker = null;
            let pageCanvas = null;

            if (!optimizedOcrResult) {
              ocrWorker = ocrWorker || await getWorker(slotIndex);
              pageCanvas = pageCanvas || await renderPdfPageToCanvas(page, OCR_RENDER_SCALE);
              optimizedOcrResult = await recognizeCanvasAtRotations(
                ocrWorker,
                pageCanvas,
                `OCR page ${pageIndex} of ${totalPages}`,
                onProgress,
                {
                  debugMode,
                  preferredRotation: sharedRotationState.preferredRotation,
                  preprocess: true,
                  allowShortcut: true
                }
              );
              optimizedOcrResult = setCachedOcrPageResult(
                cacheStore,
                fileSignature,
                pageIndex,
                {
                  ...optimizedOcrResult,
                  ocrVersion: OCR_VERSION
                },
                "optimized"
              );
            }

            if (!baselineOcrResult) {
              ocrWorker = ocrWorker || await getWorker(slotIndex);
              pageCanvas = pageCanvas || await renderPdfPageToCanvas(page, OCR_RENDER_SCALE);
              baselineOcrResult = await recognizeCanvasAtRotations(
                ocrWorker,
                pageCanvas,
                `OCR baseline page ${pageIndex} of ${totalPages}`,
                onProgress,
                {
                  debugMode: true,
                  preprocess: false,
                  allowShortcut: false
                }
              );
              baselineOcrResult = setCachedOcrPageResult(
                cacheStore,
                fileSignature,
                pageIndex,
                {
                  ...baselineOcrResult,
                  ocrVersion: OCR_BASELINE_VERSION
                },
                "baseline"
              );
            }

            const optimizedPage = attachPageDebugVersions(
              buildPreviewRowsFromPage(buildLinesFromRawText(optimizedOcrResult.text), pageIndex, {
                extractionMethod: "OCR",
                ocrConfidence: optimizedOcrResult.confidence,
                selectedRotation: optimizedOcrResult.selectedRotation,
                ocrRotations: Array.isArray(optimizedOcrResult.rotationResults) ? optimizedOcrResult.rotationResults : []
              }),
              OCR_VERSION
            );
            const baselinePage = attachPageDebugVersions(
              buildPreviewRowsFromPage(buildLinesFromRawText(baselineOcrResult.text), pageIndex, {
                extractionMethod: "OCR",
                ocrConfidence: baselineOcrResult.confidence,
                selectedRotation: baselineOcrResult.selectedRotation,
                ocrRotations: Array.isArray(baselineOcrResult.rotationResults) ? baselineOcrResult.rotationResults : []
              }),
              OCR_BASELINE_VERSION
            );

            const useBaselinePage = baselinePage.rows.length > optimizedPage.rows.length;
            parsedPage = useBaselinePage ? baselinePage : optimizedPage;
            parsedPage.cacheHit = Boolean(
              (useBaselinePage ? cachedBaselineOcr : cachedOptimizedOcr) &&
              (useBaselinePage ? cachedBaselineOcr.text : cachedOptimizedOcr.text)
            );
            parsedPage.comparisonDebug = buildOcrComparisonDebug(
              baselinePage,
              optimizedPage,
              parsedPage,
              parsedPage.droppedRows
            );

            if (Number.isFinite(optimizedOcrResult?.selectedRotation)) {
              sharedRotationState.preferredRotation = optimizedOcrResult.selectedRotation;
            }
          }

          if (!detectedShipmentDate && parsedPage.rawText) {
            detectedShipmentDate = extractShipmentDateFromText(parsedPage.rawText);
          }

          pages[pageIndex - 1] = parsedPage;
        } catch (pageError) {
          const message = pageError instanceof Error ? pageError.message : `Unable to parse page ${pageIndex}.`;
          console.error(`PDF import page ${pageIndex} failed`, pageError);
          importError = importError || message;
          pages[pageIndex - 1] = createImportPage(pageIndex, {
            sourceName: file.name,
            extractionMethod: "OCR",
            warning: `Page ${pageIndex} failed to parse. ${message}`
          });
        } finally {
          completedPages += 1;
          const elapsedMs = Date.now() - startedAt;
          const averageMs = completedPages > 0 ? elapsedMs / completedPages : 0;
          const remainingPages = Math.max(0, totalPages - completedPages);

          if (typeof onProgress === "function") {
            onProgress({
              message:
                completedPages >= totalPages
                  ? `Processing page ${totalPages} of ${totalPages}`
                  : `Processing page ${Math.min(totalPages, completedPages + 1)} of ${totalPages}`,
              currentPage: Math.min(totalPages, completedPages + 1),
              totalPages,
              completedPages,
              etaMs: remainingPages > 0 ? averageMs * remainingPages : 0
            });
          }
        }
      });
    } finally {
      for (const worker of workerPool) {
        if (worker) {
          await worker.terminate();
        }
      }
    }

    const pagesWithRawText = pages.filter((page) => normalizeText(page.rawText));
    const ocrPages = pages.filter((page) => page.extractionMethod === "OCR");
    const lowConfidenceOcrPages = ocrPages.filter(
      (page) => page.ocrConfidence !== null && page.ocrConfidence < LOW_OCR_CONFIDENCE_THRESHOLD
    );

    const totalRows = pages.reduce((count, page) => count + (Array.isArray(page.rows) ? page.rows.length : 0), 0);
    const warningParts = [];

    if (pagesWithRawText.length === 0) {
      warningParts.push("This PDF appears image-based and OCR returned very little text.");
    }

    if (lowConfidenceOcrPages.length > 0) {
      warningParts.push(
        `OCR confidence is low on ${lowConfidenceOcrPages.length} page${lowConfidenceOcrPages.length === 1 ? "" : "s"}. Review highlighted rows carefully.`
      );
    }

    if (totalRows === 0) {
      warningParts.push("0 rows found.");
    }

    return {
      sourceName: file.name,
      sourceSignature: fileSignature,
      debugMode,
      shipDate: detectedShipmentDate || "Imported PDF",
      ocrWarning: warningParts.join(" ").trim(),
      ocrPagesCount: ocrPages.length,
      textPagesCount: pages.length - ocrPages.length,
      importError,
      pages
    };
  }

  async function parseImageFile(file, onProgress, options) {
    const parseOptions = options || {};
    const debugMode = Boolean(parseOptions.debugMode);
    const cacheStore = parseOptions.cacheStore || loadOcrCacheStore();
    const fileSignature = buildFileCacheSignature(file);
    if (typeof onProgress === "function") {
      onProgress({
        message: "Preparing image for OCR...",
        currentPage: 1,
        totalPages: 1,
        completedPages: 0
      });
    }

    let ocrWorker = null;

    try {
      const cachedOptimizedOcr = getCachedOcrPageVariant(cacheStore, fileSignature, 1, "optimized");
      const cachedBaselineOcr = getCachedOcrPageVariant(cacheStore, fileSignature, 1, "baseline");
      let optimizedOcrResult = cachedOptimizedOcr && cachedOptimizedOcr.text ? cachedOptimizedOcr : null;
      let baselineOcrResult = cachedBaselineOcr && cachedBaselineOcr.text ? cachedBaselineOcr : null;
      let imageCanvas = null;

      if (!optimizedOcrResult || !baselineOcrResult) {
        const normalizedImageBlob = await normalizeImageFileForOcr(file);
        imageCanvas = await renderImageBlobToCanvas(normalizedImageBlob);
        ocrWorker = await createOcrWorker();
      }

      if (!optimizedOcrResult) {
        optimizedOcrResult = await recognizeCanvasAtRotations(ocrWorker, imageCanvas, "OCR image", onProgress, {
          debugMode,
          preprocess: true,
          allowShortcut: true
        });
        optimizedOcrResult = setCachedOcrPageResult(
          cacheStore,
          fileSignature,
          1,
          {
            ...optimizedOcrResult,
            ocrVersion: OCR_VERSION
          },
          "optimized"
        );
      }

      if (!baselineOcrResult) {
        baselineOcrResult = await recognizeCanvasAtRotations(ocrWorker, imageCanvas, "OCR baseline image", onProgress, {
          debugMode: true,
          preprocess: false,
          allowShortcut: false
        });
        baselineOcrResult = setCachedOcrPageResult(
          cacheStore,
          fileSignature,
          1,
          {
            ...baselineOcrResult,
            ocrVersion: OCR_BASELINE_VERSION
          },
          "baseline"
        );
      }

      const optimizedPage = attachPageDebugVersions(
        buildPreviewRowsFromPage(buildLinesFromRawText(optimizedOcrResult.text), 1, {
          extractionMethod: "OCR",
          ocrConfidence: optimizedOcrResult.confidence,
          selectedRotation: optimizedOcrResult.selectedRotation,
          ocrRotations: optimizedOcrResult.rotationResults
        }),
        OCR_VERSION
      );
      const baselinePage = attachPageDebugVersions(
        buildPreviewRowsFromPage(buildLinesFromRawText(baselineOcrResult.text), 1, {
          extractionMethod: "OCR",
          ocrConfidence: baselineOcrResult.confidence,
          selectedRotation: baselineOcrResult.selectedRotation,
          ocrRotations: baselineOcrResult.rotationResults
        }),
        OCR_BASELINE_VERSION
      );
      const useBaselinePage = baselinePage.rows.length > optimizedPage.rows.length;
      const parsedPage = useBaselinePage ? baselinePage : optimizedPage;
      parsedPage.cacheHit = Boolean(
        (useBaselinePage ? cachedBaselineOcr : cachedOptimizedOcr) &&
        (useBaselinePage ? cachedBaselineOcr.text : cachedOptimizedOcr.text)
      );
      parsedPage.comparisonDebug = buildOcrComparisonDebug(
        baselinePage,
        optimizedPage,
        parsedPage,
        parsedPage.droppedRows
      );
      const detectedShipmentDate = extractShipmentDateFromText(parsedPage.rawText);
      const warningParts = [];

      if (parsedPage.ocrConfidence !== null && parsedPage.ocrConfidence < LOW_OCR_CONFIDENCE_THRESHOLD) {
        warningParts.push("OCR confidence is low on this image. Review highlighted rows carefully.");
      }

      if (parsedPage.rows.length === 0) {
        warningParts.push("0 rows found.");
      }

      return {
        sourceName: file.name,
        sourceSignature: fileSignature,
        debugMode,
        shipDate: detectedShipmentDate || "Imported Image",
        ocrWarning: warningParts.join(" ").trim(),
        ocrPagesCount: 1,
        textPagesCount: 0,
        importError: "",
        pages: [parsedPage]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to import image.";
      console.error("Image import failed", error);
      return createImportErrorResult(file.name, message, {
        sourceSignature: fileSignature,
        debugMode,
        shipDate: "Imported Image",
        ocrPagesCount: 1,
        pages: [
          createImportPage(1, {
            sourceName: file.name,
            extractionMethod: "OCR",
            warning: message
          })
        ]
      });
    } finally {
      if (ocrWorker) {
        await ocrWorker.terminate();
      }
    }
  }

  function mapCsvRows(text) {
    const parsedRows = parseCsv(text);
    if (parsedRows.length <= 1) {
      return [];
    }

    const headerRow = parsedRows[0].map(normalizeHeader);
    const columnIndexes = Object.fromEntries(
      Object.entries(COLUMN_ALIASES).map(([columnName, aliases]) => [
        columnName,
        getHeaderIndex(headerRow, aliases.map(normalizeHeader))
      ])
    );

    const hasLegacyQuantityColumns = columnIndexes.quantity !== -1 && columnIndexes.uom !== -1;
    const hasBucketQuantityColumns =
      columnIndexes.cartons_qty !== -1 ||
      columnIndexes.pieces_qty !== -1 ||
      columnIndexes.square_feet_qty !== -1 ||
      columnIndexes.other_qty !== -1;
    const requiredColumns = ["ship_date", "pallet_number", "order_number", "product_description"];

    const missingColumns = requiredColumns.filter((columnName) => columnIndexes[columnName] === -1);
    if (missingColumns.length > 0) {
      throw new Error(`Missing required columns: ${missingColumns.join(", ")}`);
    }

    if (!hasLegacyQuantityColumns && !hasBucketQuantityColumns) {
      throw new Error("Missing required quantity columns. Use quantity + uom or cartons_qty / pieces_qty / square_feet_qty / other_qty.");
    }

    return parsedRows
      .slice(1)
      .filter((row) => row.some((cell) => normalizeText(cell)))
      .map((row, rowIndex) =>
        createAppRow(
          {
            shipDate: safeText(row[columnIndexes.ship_date]),
            sourcePage: columnIndexes.source_page === -1 ? 0 : Number(row[columnIndexes.source_page] || 0),
            palletNumber: safeText(row[columnIndexes.pallet_number]),
            palletLp: columnIndexes.pallet_lp === -1 ? "" : safeText(row[columnIndexes.pallet_lp]),
            orderNumber: safeText(row[columnIndexes.order_number]),
            orderType: columnIndexes.order_type === -1 ? "" : safeText(row[columnIndexes.order_type]),
            itemNumber: columnIndexes.item_number === -1 ? "" : safeText(row[columnIndexes.item_number]),
            productDescription: safeText(row[columnIndexes.product_description]),
            quantity: columnIndexes.quantity === -1 ? "" : row[columnIndexes.quantity],
            uom: columnIndexes.uom === -1 ? "" : row[columnIndexes.uom],
            cartonsQty: columnIndexes.cartons_qty === -1 ? "" : row[columnIndexes.cartons_qty],
            piecesQty: columnIndexes.pieces_qty === -1 ? "" : row[columnIndexes.pieces_qty],
            squareFeetQty: columnIndexes.square_feet_qty === -1 ? "" : row[columnIndexes.square_feet_qty],
            otherQty: columnIndexes.other_qty === -1 ? "" : row[columnIndexes.other_qty]
          },
          rowIndex
        )
      );
  }

  function groupRowsByPallet(rows) {
    const grouped = new Map();

    rows.forEach((row) => {
      const sourceGroupKey = row.sourcePage ? `page-${row.sourcePage}` : row.palletNumber;
      const groupKey = `${row.shipDate}__${sourceGroupKey}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          key: groupKey,
          shipDate: row.shipDate,
          sourcePage: row.sourcePage || 0,
          palletNumber: row.palletNumber,
          palletLabel: row.palletLabel,
          palletLp: row.palletLp,
          rows: []
        });
      }
      const currentGroup = grouped.get(groupKey);
      currentGroup.rows.push(row);
      if (!currentGroup.palletLp && row.palletLp) {
        currentGroup.palletLp = row.palletLp;
      }
    });

    return Array.from(grouped.values())
      .map((group) => {
        const uniqueOrders = Array.from(new Set(group.rows.map((row) => row.orderDisplay))).sort();
        const quantityTotals = buildQuantityTotals(group.rows);
        const sortedRows = group.rows.slice().sort((left, right) => {
          const orderCompare = left.orderDisplay.localeCompare(right.orderDisplay);
          if (orderCompare !== 0) {
            return orderCompare;
          }
          return getDescription(left).localeCompare(getDescription(right));
        });

        return {
          ...group,
          rows: sortedRows,
          orders: uniqueOrders,
          palletLp: group.palletLp || sortedRows.find((row) => row.palletLp)?.palletLp || "",
          quantityTotals
        };
      })
      .sort((left, right) => {
        const shipDateCompare = compareShipDates(left.shipDate, right.shipDate);
        if (shipDateCompare !== 0) {
          return shipDateCompare;
        }
        if (left.sourcePage && right.sourcePage) {
          return left.sourcePage - right.sourcePage;
        }
        return comparePalletNumbers(left.palletNumber, right.palletNumber);
      });
  }

  function buildSearchResults(rows, mode, query) {
    const trimmedQuery = safeText(query);
    if (!trimmedQuery) {
      return {
        groups: [],
        lineCount: 0,
        palletCount: 0
      };
    }

    const normalizedQuery = normalizeText(trimmedQuery);
    const queryDigits = digitsOnly(trimmedQuery);

    const matchedRows = rows.filter((row) => {
      if (mode === "product") {
        return safeIncludes(row.searchIndex.product, normalizedQuery);
      }

      if (mode === "order") {
        const textMatch = safeIncludes(row.searchIndex.orderText, normalizedQuery);
        const digitMatch = queryDigits ? safeIncludes(row.searchIndex.orderDigits, queryDigits) : false;
        return textMatch || digitMatch;
      }

      const palletTextMatch = safeIncludes(row.searchIndex.palletText, normalizedQuery);
      const palletDigitMatch = queryDigits ? safeIncludes(digitsOnly(row.palletNumber), queryDigits) : false;
      return palletTextMatch || palletDigitMatch;
    });

    const groups = groupRowsByPallet(matchedRows);

    return {
      groups,
      lineCount: matchedRows.length,
      palletCount: groups.length
    };
  }

  function buildExamples(rows) {
    const products = [];
    const orders = [];
    const pallets = [];

    rows.forEach((row) => {
      const description = safeText(getDescription(row));
      if (description && description !== "Needs review" && !products.includes(description)) {
        products.push(description);
      }
      if (row.orderDisplay && !orders.includes(row.orderDisplay)) {
        orders.push(row.orderDisplay);
      }
      if (row.palletNumber && !pallets.includes(row.palletNumber)) {
        pallets.push(row.palletNumber);
      }
    });

    return {
      product: products.slice(0, 3),
      order: orders.slice(0, 3),
      pallet: pallets.slice(0, 3)
    };
  }

  function validateSingleShipment(rows) {
    const shipDates = Array.from(new Set(rows.map((row) => row.shipDate))).filter(Boolean);
    if (shipDates.length > 1) {
      throw new Error(
        `This app expects a single ship date per upload. Found ${shipDates.length} ship dates: ${shipDates.join(", ")}.`
      );
    }
    return rows;
  }

  function parseShipmentCsv(text) {
    return validateSingleShipment(mapCsvRows(text));
  }

  function getFileExtension(fileName) {
    const fileNameParts = String(fileName || "").toLowerCase().split(".");
    return fileNameParts.length > 1 ? fileNameParts[fileNameParts.length - 1] : "";
  }

  function isPdfFile(file) {
    return file.type === "application/pdf" || getFileExtension(file.name) === "pdf";
  }

  function isImageFile(file) {
    const extension = getFileExtension(file && file.name);
    const fileType = getFileType(file);

    return (
      fileType.startsWith("image/") ||
      ["jpg", "jpeg", "png", "webp", "bmp", "gif", "heic", "heif"].includes(extension)
    );
  }

  function formatNumber(value) {
    return numberFormatter.format(value || 0);
  }

  function SummaryCard(props) {
    return h(
      "div",
      { className: "summary-card" },
      h("span", { className: "summary-label" }, props.label),
      h("strong", { className: "summary-value" }, props.value)
    );
  }

  function ExampleButton(props) {
    return h(
      "button",
      {
        className: "example-button",
        type: "button",
        onClick: props.onClick
      },
      props.value
    );
  }

  function ResultRow(props) {
    const { row } = props;

    return h(
      "div",
      { className: "result-row" },
      h(
        "div",
        { className: "result-row-main" },
        h("strong", { className: "product-name" }, getDescription(row)),
        h(
          "div",
          { className: "result-row-meta" },
          h("span", { className: "badge badge-soft" }, row.orderDisplay || row.orderNumber || "Order"),
          row.orderType ? h("span", { className: "badge" }, row.orderType) : null,
          row.itemNumber ? h("span", { className: "detail-pill" }, row.itemNumber) : null
        )
      ),
      h(
        "div",
        { className: "result-row-stats" },
        h("span", null, row.displayQty || formatQuantityWithUom(row.quantity, row.uom))
      )
    );
  }

  function ResultCard(props) {
    const { group, index, mode } = props;
    const cardTitle =
      mode === "order"
        ? `${group.palletLabel}`
        : mode === "product"
          ? `${group.palletLabel}`
          : `${group.palletLabel}`;

    return h(
      "article",
      {
        className: "result-card",
        style: { animationDelay: `${index * 60}ms` }
      },
      h(
        "div",
        { className: "result-card-top" },
        h(
          "div",
          null,
          h("span", { className: "eyebrow" }, group.shipDate),
          h("h3", { className: "result-card-title" }, cardTitle),
          group.sourcePage
            ? h("div", { className: "muted-text" }, `Source page ${group.sourcePage}${group.palletLp ? ` • LP ${group.palletLp}` : ""}`)
            : group.palletLp
              ? h("div", { className: "muted-text" }, `LP ${group.palletLp}`)
              : null
        ),
        h(
          "div",
          { className: "result-card-summary" },
          h("span", { className: "summary-pill" }, `${group.rows.length} lines`),
          h("span", { className: "summary-pill" }, `${group.orders.length} orders`)
        )
      ),
      h(
        "div",
        { className: "tag-row" },
        group.orders.map((order) => h("span", { className: "tag", key: order }, order))
      ),
      h(
        "div",
        { className: "result-list" },
        group.rows.map((row) => h(ResultRow, { key: row.id, row }))
      ),
      h(
        "div",
        { className: "result-card-footer" },
        h("span", null, `${formatQuantityTotals(group.quantityTotals)} total`)
      )
    );
  }

  function GuidanceState(props) {
    return h(
      "section",
      { className: "empty-state" },
      h("h2", null, props.title),
      props.description ? h("p", null, props.description) : null,
      props.children
    );
  }

  function ProductHeader(props) {
    return h(
      "header",
      { className: "product-header" },
      h(
        "div",
        { className: "product-header-inner" },
        h(
          "div",
          { className: "product-header-copy" },
          props.kicker ? h("span", { className: "product-header-kicker" }, props.kicker) : null,
          h("h1", { className: "product-header-title" }, "PalletSearch"),
          props.subtitle ? h("p", { className: "product-header-subtitle" }, props.subtitle) : null
        )
      )
    );
  }

  function LandingPage(props) {
    return h(
      "div",
      { className: "landing-page-shell" },
      h(ProductHeader, {
        kicker: "Warehouse receiving",
        subtitle: "Upload a shipment file to begin."
      }),
      h(
        "section",
        { className: "landing-page" },
        h(
          "div",
          { className: "landing-content" },
          h(
            "label",
            { className: "upload-button landing-upload-button", htmlFor: "csv-upload" },
            props.isParsingPdf ? "Processing..." : "Upload CSV, PDF, or Image"
          ),
          h(
            "button",
            {
              className: "secondary-button landing-clear-button",
              type: "button",
              onClick: props.onClear
            },
            "Clear Data"
          ),
          h(
            "div",
            { className: "action-row landing-action-row" },
            h(
              "button",
              {
                className: props.debugMode ? "secondary-button" : "secondary-button secondary-button-muted",
                type: "button",
                onClick: props.onToggleDebugMode
              },
              props.debugMode ? "Debug On" : "Debug Off"
            ),
            h(
              "button",
              {
                className: "secondary-button secondary-button-muted",
                type: "button",
                onClick: props.onClearOcrCache
              },
              "Clear OCR Cache"
            ),
            props.cacheCount ? h("span", { className: "summary-pill" }, `${props.cacheCount} cached`) : null
          )
        )
      )
    );
  }

  function groupResultRowsByOrder(rows) {
    const groupedRows = new Map();

    (rows || []).forEach((row) => {
      const orderKey = safeUpper(row.orderDisplay || row.orderNumber) || "ORDER";
      if (!groupedRows.has(orderKey)) {
        groupedRows.set(orderKey, []);
      }
      groupedRows.get(orderKey).push(row);
    });

    return Array.from(groupedRows.entries()).map(([orderLabel, orderRows]) => ({
      orderLabel,
      rows: orderRows
    }));
  }

  function getResultCardTitle(group, mode, query) {
    if (mode === "pallet") {
      return formatPalletLabel(group.palletNumber);
    }

    if (mode === "order") {
      const orderLabel =
        safeUpper(group.orders[0]) ||
        safeUpper(query) ||
        (group.rows[0] ? safeUpper(group.rows[0].orderDisplay || group.rows[0].orderNumber) : "");
      return `Order ${orderLabel}`.trim();
    }

    if (mode === "product") {
      return formatPalletLabel(group.palletNumber || "Unknown");
    }

    const uniqueProducts = uniqueValues((group.rows || []).map((row) => getDescription(row)));
    if (uniqueProducts.length === 1) {
      return uniqueProducts[0];
    }

    const matchingProduct = (group.rows || []).find(
      (row) => normalizeText(getDescription(row)) === normalizeText(query)
    );
    return matchingProduct ? getDescription(matchingProduct) : safeText(query) || uniqueProducts[0] || "Product";
  }

  function getResultCardContext(group, mode) {
    const contextParts = [];

    if (mode !== "pallet" && group.palletNumber) {
      contextParts.push(formatPalletLabel(group.palletNumber));
    }

    if (group.sourcePage) {
      contextParts.push(`Source page ${group.sourcePage}`);
    }

    if (group.palletLp) {
      contextParts.push(`LP ${group.palletLp}`);
    }

    return contextParts.join(" | ");
  }

  function ResultRow(props) {
    const { row, showProductName } = props;

    return h(
      "div",
      { className: "result-row" },
      h(
        "div",
        { className: "result-row-main" },
        showProductName ? h("div", { className: "product-name" }, getDescription(row)) : null,
        row.itemNumber
          ? h(
              "div",
              { className: "result-row-meta result-item-meta" },
              h("span", { className: "muted-text" }, `Item ${row.itemNumber}`)
            )
          : null
      ),
      h(
        "div",
        { className: "result-row-stats" },
        h("span", null, row.displayQty || formatQuantityWithUom(row.quantity, row.uom))
      )
    );
  }

  function ResultCard(props) {
    const { group, index, mode, query } = props;
    const cardTitle = getResultCardTitle(group, mode, query);
    const cardContext = getResultCardContext(group, mode);
    const orderGroups = groupResultRowsByOrder(group.rows);
    const uniqueProducts = uniqueValues(group.rows.map((row) => getDescription(row)));
    const hideRepeatedProductName =
      mode === "product" &&
      uniqueProducts.length === 1 &&
      normalizeText(uniqueProducts[0]) === normalizeText(cardTitle);

    return h(
      "article",
      {
        className: "result-card",
        style: { animationDelay: `${index * 60}ms` }
      },
      h(
        "div",
        { className: "result-card-top" },
        h(
          "div",
          null,
          h("span", { className: "eyebrow" }, group.shipDate),
          h("h3", { className: "result-card-title" }, cardTitle),
          cardContext ? h("div", { className: "muted-text result-card-context" }, cardContext) : null
        ),
        h(
          "div",
          { className: "result-card-summary" },
          h("span", { className: "summary-pill" }, `${group.rows.length} lines`),
          h("span", { className: "summary-pill" }, `${group.orders.length} orders`)
        )
      ),
      h(
        "div",
        { className: "result-list" },
        orderGroups.map((orderGroup) =>
          h(
            "section",
            { className: "result-order-group", key: `${group.key}-${orderGroup.orderLabel}` },
            mode !== "order"
              ? h("div", { className: "result-order-label" }, orderGroup.orderLabel)
              : null,
            orderGroup.rows.map((row) =>
              h(ResultRow, {
                key: row.id,
                row,
                showProductName: !(hideRepeatedProductName && orderGroup.rows.length === group.rows.length)
              })
            )
          )
        )
      ),
      h(
        "div",
        { className: "result-card-footer" },
        h("span", null, `${formatQuantityTotals(group.quantityTotals)} total`)
      )
    );
  }

  function PalletBrowserCard(props) {
    const { group, onSelect } = props;
    const palletTitle = formatPalletLabel(group.palletNumber || "Unknown");

    return h(
      "button",
      {
        type: "button",
        className: "pallet-browser-card",
        onClick: () => onSelect(group.palletNumber)
      },
      h("div", { className: "pallet-browser-title" }, palletTitle),
      h(
        "div",
        { className: "pallet-browser-meta" },
        h("span", null, `${group.rows.length} lines`),
        h("span", null, `${group.orders.length} orders`)
      ),
      group.palletLp ? h("div", { className: "pallet-browser-reference" }, `LP ${group.palletLp}`) : null
    );
  }

  function flattenPendingImportRows(pendingImport) {
    return pendingImport ? pendingImport.pages.flatMap((page) => page.rows) : [];
  }

  function groupPreviewRowsByPallet(rows, fallbackPalletLabel) {
    const groupedRows = new Map();

    rows.forEach((row) => {
      const palletKey = row.sourcePage ? `page-${row.sourcePage}` : safeText(row.palletNumber) || fallbackPalletLabel;
      if (!groupedRows.has(palletKey)) {
        groupedRows.set(palletKey, {
          palletKey,
          palletNumber: safeText(row.palletNumber) || fallbackPalletLabel,
          palletLp: safeText(row.palletLp || row.pallet_lp),
          rows: []
        });
      }
      const currentGroup = groupedRows.get(palletKey);
      currentGroup.rows.push(row);
      if (!currentGroup.palletLp && safeText(row.palletLp || row.pallet_lp)) {
        currentGroup.palletLp = safeText(row.palletLp || row.pallet_lp);
      }
    });

    return Array.from(groupedRows.values()).map((group) => ({
      palletKey: group.palletKey,
      palletLabel: formatPalletLabel(group.palletNumber),
      palletLp: group.palletLp,
      rows: group.rows
    }));
  }

  function renderDebugValueList(values, emptyLabel) {
    if (!values || values.length === 0) {
      return h("span", { className: "muted-text" }, emptyLabel);
    }

    return h(
      "div",
      { className: "debug-pill-row" },
      values.map((value) => h("span", { className: "summary-pill", key: value }, value))
    );
  }

  function renderConfidencePill(confidence, reason, key) {
    const normalizedConfidence = safeLower(confidence || "low") === "high" ? "high" : "low";
    return h(
      "span",
      {
        key: key || normalizedConfidence,
        className:
          normalizedConfidence === "high"
            ? "preview-meta-text preview-meta-text-strong"
            : "preview-meta-text preview-meta-text-alert",
        title: reason || ""
      },
      normalizedConfidence === "high" ? "High confidence" : "Low confidence"
    );
  }

  function renderExtractionMethodPill(extractionMethod, key) {
    return h(
      "span",
      {
        key: key || extractionMethod,
        className: "preview-meta-text"
      },
      extractionMethod || "text PDF"
    );
  }

  function renderOcrConfidencePill(ocrConfidence, extractionMethod, key) {
    if (extractionMethod !== "OCR" || !Number.isFinite(ocrConfidence)) {
      return null;
    }

    return h(
      "span",
      {
        key: key || `ocr-${ocrConfidence}`,
        className:
          ocrConfidence < LOW_OCR_CONFIDENCE_THRESHOLD
            ? "preview-meta-text preview-meta-text-alert"
            : "preview-meta-text preview-meta-text-strong"
      },
      `OCR ${ocrConfidence}%`
    );
  }

  function renderReviewMetaItem(label, value, key) {
    return h(
      "span",
      {
        key,
        className: "review-meta-item"
      },
      h("span", { className: "review-meta-label" }, `${label}:`),
      " ",
      value
    );
  }

  function ImportPreview(props) {
    const { importData, onAddRow, onCancel, onDeleteRow, onFieldChange, onReparse, onSave } = props;
    const allPreviewRows = flattenPendingImportRows(importData);
    const totalRows = allPreviewRows.length;
    const reviewRowCount = countRowsNeedingReview(allPreviewRows);

    return h(
      "section",
      { className: "preview-card" },
      h(
        "div",
        { className: "preview-header" },
        h("h2", { className: "results-title" }, "Review Import"),
                h(
                  "div",
                  { className: "action-row" },
          h(
            "button",
            {
              className: "secondary-button",
              type: "button",
              onClick: onAddRow
            },
            "Add Row"
          ),
          h(
            "button",
            {
              className: "secondary-button secondary-button-muted",
              type: "button",
              onClick: onReparse
            },
            "Re-run Parser"
          ),
          h(
            "button",
            {
              className: "secondary-button secondary-button-muted",
              type: "button",
              onClick: onCancel
            },
            "Cancel"
          ),
          h(
            "button",
            {
              className: "upload-button",
              type: "button",
              onClick: onSave
            },
            "Save Import"
          )
        )
      ),
      h(
        "div",
        { className: "status-row" },
        h("span", { className: "summary-pill" }, importData.sourceName),
        h("span", { className: "summary-pill" }, importData.shipDate || "Imported PDF"),
        h("span", { className: "summary-pill" }, `${importData.pages.length} pages`),
        h("span", { className: "summary-pill" }, `${totalRows} rows`),
        reviewRowCount ? h("span", { className: "summary-pill" }, `${reviewRowCount} need review`) : null,
        importData.textPagesCount ? h("span", { className: "summary-pill" }, `${importData.textPagesCount} text`) : null,
        importData.ocrPagesCount ? h("span", { className: "summary-pill" }, `${importData.ocrPagesCount} OCR`) : null
      ),
      reviewRowCount
        ? h(
            "div",
            { className: "message-banner warning" },
            h("p", { className: "muted-text" }, `${reviewRowCount} row${reviewRowCount === 1 ? "" : "s"} need review before or after saving.`)
          )
        : null,
      importData.ocrWarning
        ? h(
            "div",
            { className: "message-banner warning" },
            h("p", { className: "muted-text" }, importData.ocrWarning)
          )
        : null,
      importData.importError
        ? h(
            "div",
            { className: "message-banner error" },
            h("p", { className: "muted-text" }, importData.importError)
          )
        : null,
      h(
        "div",
        { className: "page-preview-list" },
        importData.pages.map((page) =>
          h(
            "section",
            { className: "page-preview-section", key: page.pageNumber },
            h(
              "div",
              { className: "page-preview-header" },
              h(
                "div",
                { className: "page-preview-title" },
                h("h3", { className: "page-preview-heading" }, page.pageLabel),
                h(
                  "div",
                  { className: "review-meta-row" },
                  renderReviewMetaItem("Rows", `${page.rows.length}`, `${page.pageNumber}-rows`),
                  renderReviewMetaItem("Method", renderExtractionMethodPill(page.extractionMethod, `${page.pageNumber}-method`), `${page.pageNumber}-method-item`),
                  page.ocrConfidence !== null && page.extractionMethod === "OCR"
                    ? renderReviewMetaItem(
                        "OCR",
                        renderOcrConfidencePill(page.ocrConfidence, page.extractionMethod, `${page.pageNumber}-ocr`),
                        `${page.pageNumber}-ocr-item`
                      )
                    : null,
                  page.extractionMethod === "OCR" && page.selectedRotation !== null
                    ? renderReviewMetaItem("Rotation", `${page.selectedRotation}°`, `${page.pageNumber}-rotation-item`)
                    : null
                )
              ),
              h(
                "button",
                {
                  className: "secondary-button",
                  type: "button",
                  onClick: () => onAddRow(page.pageNumber)
                },
                "Add Row"
              )
            ),
            page.warning
              ? h(
                  "div",
                  { className: "message-banner warning" },
                  h("p", { className: "muted-text" }, page.warning)
                )
              : null,
            h(
              "div",
              { className: "simple-review-meta" },
              h(
                "div",
                { className: "review-meta-row review-meta-row-compact" },
                renderReviewMetaItem("Pallet", formatPalletLabel(page.defaultPalletLabel), `page-${page.pageNumber}-pallet`),
                renderReviewMetaItem("Source", `${page.pageNumber}`, `page-${page.pageNumber}-source`),
                page.palletLp ? renderReviewMetaItem("LP", page.palletLp, `page-${page.pageNumber}-lp`) : null,
                renderReviewMetaItem("OCR text length", `${page.ocrTextLength || 0}`, `page-${page.pageNumber}-ocr-text-length`),
                renderReviewMetaItem("Order starts found", `${page.orderStartsFound || 0}`, `page-${page.pageNumber}-order-starts`),
                renderReviewMetaItem(
                  "Rows created from order starts",
                  `${page.rowsCreatedFromOrderStarts || page.rows.length}`,
                  `page-${page.pageNumber}-rows-created-inline`
                ),
                renderReviewMetaItem(
                  "Final rows displayed",
                  `${page.finalRowsDisplayed || page.rows.length}`,
                  `page-${page.pageNumber}-rows-inline`
                ),
                renderReviewMetaItem(
                  "Missing order numbers",
                  `${(page.missingOrderNumbers || []).length}`,
                  `page-${page.pageNumber}-missing-orders`
                ),
                renderReviewMetaItem(
                  "Accepted rows",
                  `${(page.acceptedOrderNumbers || []).length}`,
                  `page-${page.pageNumber}-accepted-orders`
                ),
                renderReviewMetaItem(
                  "Rejected numbers",
                  `${(page.rejectedOrderNumbers || []).length}`,
                  `page-${page.pageNumber}-rejected-orders`
                ),
                renderReviewMetaItem(
                  "Prefix outliers",
                  `${(page.lowConfidenceOutliers || []).length}`,
                  `page-${page.pageNumber}-prefix-outliers`
                ),
                renderReviewMetaItem("Dropped rows", `${(page.droppedRows || []).length}`, `page-${page.pageNumber}-dropped-rows`),
                renderReviewMetaItem(
                  "Method",
                  renderExtractionMethodPill(page.extractionMethod, `page-method-inline-${page.pageNumber}`),
                  `page-${page.pageNumber}-method-inline`
                ),
                page.ocrConfidence !== null && page.extractionMethod === "OCR"
                  ? renderReviewMetaItem(
                      "OCR",
                      renderOcrConfidencePill(page.ocrConfidence, page.extractionMethod, `page-ocr-inline-${page.pageNumber}`),
                      `page-${page.pageNumber}-ocr-inline`
                    )
                  : null,
                page.extractionMethod === "OCR" && page.selectedRotation !== null
                  ? renderReviewMetaItem("Rotation", `${page.selectedRotation}°`, `page-${page.pageNumber}-rotation-inline`)
                  : null,
                importData.debugMode && page.parserVersion
                  ? renderReviewMetaItem("Parser", page.parserVersion, `page-${page.pageNumber}-parser-version`)
                  : null,
                importData.debugMode && page.ocrVersion
                  ? renderReviewMetaItem("OCR Ver", page.ocrVersion, `page-${page.pageNumber}-ocr-version`)
                  : null,
                page.detections && page.detections.format
                  ? renderReviewMetaItem("Format", page.detections.format, `page-${page.pageNumber}-format-inline`)
                  : null
              )
            ),
            importData.debugMode && page.comparisonDebug
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h("summary", { className: "simple-review-summary" }, "Show OCR comparison"),
                  h(
                    "div",
                    { className: "block-debug-list" },
                    h(
                      "div",
                      { className: "block-debug-card" },
                      h(
                        "div",
                        { className: "review-meta-row review-meta-row-compact" },
                        renderReviewMetaItem("Chosen OCR", page.comparisonDebug.chosenOcrVersion || "", `page-${page.pageNumber}-chosen-ocr`),
                        renderReviewMetaItem("Raw OCR text length", `${page.comparisonDebug.rawOcrTextLength || 0}`, `page-${page.pageNumber}-comparison-text-length`),
                        renderReviewMetaItem("Rows created", `${page.comparisonDebug.rowsCreated || 0}`, `page-${page.pageNumber}-comparison-rows`)
                      ),
                      h(
                        "div",
                        { className: "review-meta-row review-meta-row-compact" },
                        renderReviewMetaItem(
                          "Accepted before optimization",
                          (page.comparisonDebug.acceptedOrderNumbersBeforeOptimization || []).join(", ") || "None",
                          `page-${page.pageNumber}-accepted-before-optimization`
                        ),
                        renderReviewMetaItem(
                          "Accepted after optimization",
                          (page.comparisonDebug.acceptedOrderNumbersAfterOptimization || []).join(", ") || "None",
                          `page-${page.pageNumber}-accepted-after-optimization`
                        )
                      ),
                      page.comparisonDebug.dropReasons && page.comparisonDebug.dropReasons.length > 0
                        ? h("div", { className: "muted-text block-debug-reason" }, page.comparisonDebug.dropReasons.join("; "))
                        : null
                    )
                  )
                )
              : null,
            importData.debugMode && page.orderNumbersFound && page.orderNumbersFound.length > 0
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h("summary", { className: "simple-review-summary" }, "Show all 8-digit numbers found"),
                  h("div", { className: "block-debug-card" }, (page.orderNumbersFound || []).join(", "))
                )
              : null,
            importData.debugMode && page.acceptedOrderNumbers && page.acceptedOrderNumbers.length > 0
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h("summary", { className: "simple-review-summary" }, "Show accepted order rows"),
                  h("div", { className: "block-debug-card" }, (page.acceptedOrderNumbers || []).join(", "))
                )
              : null,
            importData.debugMode && page.prefixFrequency && page.prefixFrequency.length > 0
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h("summary", { className: "simple-review-summary" }, "Show prefix frequency"),
                  h(
                    "div",
                    { className: "block-debug-card" },
                    page.prefixFrequency.map((entry) => `${entry.prefix}:${entry.count}`).join(", ")
                  )
                )
              : null,
            importData.debugMode && page.lowConfidenceOutliers && page.lowConfidenceOutliers.length > 0
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h("summary", { className: "simple-review-summary" }, "Show low-confidence prefix outliers"),
                  h("div", { className: "block-debug-card" }, (page.lowConfidenceOutliers || []).join(", "))
                )
              : null,
            importData.debugMode && page.rejectedOrderNumbers && page.rejectedOrderNumbers.length > 0
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h("summary", { className: "simple-review-summary" }, "Show rejected 8-digit numbers"),
                  h("div", { className: "block-debug-card" }, (page.rejectedOrderNumbers || []).join(", "))
                )
              : null,
            importData.debugMode && page.missingOrderNumbers && page.missingOrderNumbers.length > 0
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h("summary", { className: "simple-review-summary" }, "Show missing order numbers"),
                  h("div", { className: "block-debug-card" }, (page.missingOrderNumbers || []).join(", "))
                )
              : null,
            importData.debugMode && page.orderCandidateDebug && page.orderCandidateDebug.length > 0
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h("summary", { className: "simple-review-summary" }, "Show order-number debug"),
                  h(
                    "div",
                    { className: "block-debug-list" },
                    page.orderCandidateDebug.map((candidate, candidateIndex) =>
                      h(
                        "div",
                        { className: "block-debug-card", key: `page-${page.pageNumber}-candidate-${candidateIndex}` },
                        h(
                          "div",
                          { className: "review-meta-row review-meta-row-compact" },
                          renderReviewMetaItem("Number", candidate.orderNumber || "", `page-${page.pageNumber}-candidate-number-${candidateIndex}`),
                          renderReviewMetaItem("Status", candidate.accepted ? "accepted" : "rejected", `page-${page.pageNumber}-candidate-status-${candidateIndex}`),
                          renderReviewMetaItem(
                            "Type",
                            candidate.detectedOrderType || candidate.orderType || "Needs review",
                            `page-${page.pageNumber}-candidate-type-${candidateIndex}`
                          ),
                          candidate.rawOrderType ? renderReviewMetaItem("Raw type", candidate.rawOrderType, `page-${page.pageNumber}-candidate-raw-type-${candidateIndex}`) : null,
                          renderReviewMetaItem("Confidence", candidate.confidence || "low", `page-${page.pageNumber}-candidate-confidence-${candidateIndex}`),
                          candidate.prefix ? renderReviewMetaItem("Prefix", candidate.prefix, `page-${page.pageNumber}-candidate-prefix-${candidateIndex}`) : null,
                          candidate.prefixCount ? renderReviewMetaItem("Prefix count", `${candidate.prefixCount}`, `page-${page.pageNumber}-candidate-prefix-count-${candidateIndex}`) : null,
                          renderReviewMetaItem("Start", `${candidate.startIndex ?? ""}`, `page-${page.pageNumber}-candidate-start-${candidateIndex}`),
                          renderReviewMetaItem("End", `${candidate.endIndex ?? ""}`, `page-${page.pageNumber}-candidate-end-${candidateIndex}`)
                        ),
                        candidate.rowSliceText
                          ? h("pre", { className: "debug-raw-text simple-review-raw-text" }, candidate.rowSliceText)
                          : null,
                        candidate.reason
                          ? h("div", { className: "muted-text block-debug-reason" }, candidate.reason)
                          : null
                      )
                    )
                  )
                )
              : null,
            importData.debugMode && page.droppedRows && page.droppedRows.length > 0
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h("summary", { className: "simple-review-summary" }, "Show dropped rows"),
                  h(
                    "div",
                    { className: "block-debug-list" },
                    page.droppedRows.map((droppedRow, droppedIndex) =>
                      h(
                        "div",
                        { className: "block-debug-card", key: `page-${page.pageNumber}-dropped-${droppedIndex}` },
                        h(
                          "div",
                          { className: "review-meta-row review-meta-row-compact" },
                          renderReviewMetaItem("Order", droppedRow.orderNumber || "", `page-${page.pageNumber}-dropped-order-${droppedIndex}`),
                          renderReviewMetaItem("Reason", droppedRow.reason || "dropped", `page-${page.pageNumber}-dropped-reason-${droppedIndex}`)
                        )
                      )
                    )
                  )
                )
              : null,
            importData.debugMode && page.extractionMethod === "OCR" && page.ocrRotations && page.ocrRotations.length > 0
              ? h(
                  "div",
                  { className: "review-meta-row review-meta-row-compact review-meta-row-rotations" },
                  page.ocrRotations.map((rotationResult) =>
                    h(
                      "span",
                      {
                        key: `page-${page.pageNumber}-rotation-${rotationResult.rotation}`,
                        className: rotationResult.selected
                          ? "review-rotation-chip review-rotation-chip-selected"
                          : "review-rotation-chip"
                      },
                      `${rotationResult.rotation}° `,
                      Number.isFinite(rotationResult.confidence) ? `${rotationResult.confidence}%` : "n/a"
                    )
                  )
                )
              : null,
            page.rows.length === 0
              ? h("p", { className: "muted-text simple-review-copy" }, "No parsed rows yet. Use Add Row to enter one manually.")
              : null,
            h(
              "div",
              { className: "page-pallet-groups" },
              groupPreviewRowsByPallet(page.rows, page.defaultPalletLabel).map((group) =>
                h(
                  "div",
                  { className: "page-pallet-group", key: `${page.pageNumber}-${group.palletKey}` },
                  h(
                    "div",
                    { className: "page-pallet-heading" },
                    h("h4", { className: "page-pallet-title" }, group.palletLabel),
                    group.palletLp ? h("div", { className: "page-pallet-reference" }, `LP ${group.palletLp}`) : null
                  ),
                  h(
                    "div",
                    { className: "preview-table-wrap" },
                    h(
                      "table",
                      { className: "preview-table" },
                      h(
                        "thead",
                        null,
                        h(
                          "tr",
                          null,
                          h("th", null, "Pallet"),
                          h("th", null, "Order"),
                          h("th", null, "Type"),
                          h("th", null, "Item"),
                          h("th", null, "Description"),
                          h("th", null, "CT"),
                          h("th", null, "PC"),
                          h("th", null, "SF"),
                          h("th", null, "Other"),
                          h("th", null, "Confidence"),
                          h("th", null, "")
                        )
                      ),
                      h(
                        "tbody",
                        null,
                        group.rows.map((row) =>
                          h(
                            React.Fragment,
                            { key: row.id },
                            h(
                              "tr",
                              {
                                className: row.confidence === "low" ? "preview-row-low-confidence" : ""
                              },
                              h(
                                "td",
                                null,
                                h("input", {
                                  className: "table-input",
                                  value: row.palletNumber,
                                  onChange: (event) => onFieldChange(row.id, "palletNumber", event.target.value)
                                })
                              ),
                              h(
                                "td",
                                null,
                                h("input", {
                                  className: "table-input",
                                  value: row.orderNumber,
                                  maxLength: 8,
                                  onChange: (event) => onFieldChange(row.id, "orderNumber", event.target.value)
                                })
                              ),
                              h(
                                "td",
                                null,
                                h(
                                  "select",
                                  {
                                    className: "table-input table-select",
                                    value: row.orderType,
                                    onChange: (event) => onFieldChange(row.id, "orderType", event.target.value)
                                  },
                                  h("option", { value: "" }, ""),
                                  VALID_ORDER_TYPES.map((orderType) =>
                                    h("option", { key: orderType, value: orderType }, orderType)
                                  )
                                )
                              ),
                              h(
                                "td",
                                null,
                                h("input", {
                                  className: "table-input",
                                  value: row.itemNumber,
                                  onChange: (event) => onFieldChange(row.id, "itemNumber", event.target.value)
                                })
                              ),
                              h(
                                "td",
                                null,
                                h("input", {
                                  className: "table-input",
                                  value: getDescription(row),
                                  onChange: (event) => onFieldChange(row.id, "productDescription", event.target.value)
                                })
                              ),
                              h(
                                "td",
                                null,
                                h("input", {
                                  className: "table-input table-number-input",
                                  value: row.cartonsQty,
                                  onChange: (event) => onFieldChange(row.id, "cartonsQty", event.target.value)
                                })
                              ),
                              h(
                                "td",
                                null,
                                h("input", {
                                  className: "table-input table-number-input",
                                  value: row.piecesQty,
                                  onChange: (event) => onFieldChange(row.id, "piecesQty", event.target.value)
                                })
                              ),
                              h(
                                "td",
                                null,
                                h("input", {
                                  className: "table-input table-number-input",
                                  value: row.squareFeetQty,
                                  onChange: (event) => onFieldChange(row.id, "squareFeetQty", event.target.value)
                                })
                              ),
                              h(
                                "td",
                                null,
                                h("input", {
                                  className: "table-input table-number-input",
                                  value: row.otherQty,
                                  onChange: (event) => onFieldChange(row.id, "otherQty", event.target.value)
                                })
                              ),
                              h(
                                "td",
                                { className: "preview-confidence-cell" },
                                h(
                                  "div",
                                  { className: "preview-confidence-stack" },
                                  row.displayQty ? h("span", { className: "preview-meta-text" }, row.displayQty) : null,
                                  renderConfidencePill(row.confidence, row.confidenceReason, `${row.id}-row-confidence`),
                                  renderOcrConfidencePill(row.ocrConfidence, row.extractionMethod, `${row.id}-row-ocr`)
                                )
                              ),
                              h(
                                "td",
                                { className: "preview-table-action" },
                                h(
                                  "button",
                                  {
                                    className: "secondary-button secondary-button-muted preview-remove-button",
                                    type: "button",
                                    onClick: () => onDeleteRow(row.id)
                                  },
                                  "Remove"
                                )
                              )
                            ),
                            row.confidence === "low" && safeText(row.rawBlock)
                              ? h(
                                  "tr",
                                  { className: "preview-row-raw-block" },
                                  h(
                                    "td",
                                    { colSpan: 11 },
                                    h(
                                      "details",
                                      { className: "preview-row-raw-details" },
                                      h("summary", { className: "simple-review-summary" }, "Show raw block"),
                                      h("pre", { className: "debug-raw-text simple-review-raw-text" }, row.rawBlock)
                                    )
                                  )
                                )
                              : null
                          )
                        )
                      )
                    )
                  )
                )
              )
            ),
            page.rawText
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h(
                    "summary",
                    { className: "simple-review-summary" },
                    page.extractionMethod === "OCR" ? "Show OCR text" : "Show extracted text"
                  ),
                  h("pre", { className: "debug-raw-text simple-review-raw-text" }, page.rawText)
                )
              : null,
            importData.debugMode && page.blocks && page.blocks.length > 0
              ? h(
                  "details",
                  { className: "simple-review-details" },
                  h("summary", { className: "simple-review-summary" }, "Show detected row blocks"),
                  h(
                    "div",
                    { className: "block-debug-list" },
                    page.blocks.map((block) =>
                      h(
                        "div",
                        { className: "block-debug-card", key: block.id },
                        h(
                          "div",
                          { className: "block-debug-header" },
                          h("strong", null, block.label),
                          block.confidence
                            ? renderConfidencePill(block.confidence, block.confidenceReason, `${block.id}-debug-confidence`)
                            : null
                        ),
                        h(
                          "div",
                          { className: "review-meta-row review-meta-row-compact" },
                          renderReviewMetaItem("Order", block.detections.fieldAssignments.orderNumber || "", `${block.id}-order`),
                          renderReviewMetaItem("Type", block.detections.fieldAssignments.orderType || "", `${block.id}-type`),
                          block.detections.fieldAssignments.rawOrderType
                            ? renderReviewMetaItem("Raw type", block.detections.fieldAssignments.rawOrderType, `${block.id}-raw-type`)
                            : null,
                          block.detections.fieldAssignments.orderTypeConfidence
                            ? renderReviewMetaItem(
                                "Type confidence",
                                block.detections.fieldAssignments.orderTypeConfidence,
                                `${block.id}-type-confidence`
                              )
                            : null,
                          block.detections.fieldAssignments.orderTypeSource
                            ? renderReviewMetaItem("Type source", block.detections.fieldAssignments.orderTypeSource, `${block.id}-type-source`)
                            : null,
                          renderReviewMetaItem("Item", block.detections.fieldAssignments.itemNumber || "", `${block.id}-item`),
                          renderReviewMetaItem("Qty", block.detections.fieldAssignments.quantities || "", `${block.id}-qty`)
                        ),
                        h(
                          "div",
                          { className: "review-meta-row review-meta-row-compact" },
                          renderReviewMetaItem(
                            "Description",
                            getDescription(block?.detections?.fieldAssignments),
                            `${block.id}-description`
                          ),
                          block.detections.itemNumberSource
                            ? renderReviewMetaItem("Item source", block.detections.itemNumberSource, `${block.id}-item-source`)
                            : null,
                          block.detections.fieldAssignments.productDescriptionSource
                            ? renderReviewMetaItem(
                                "Description source",
                                block.detections.fieldAssignments.productDescriptionSource,
                                `${block.id}-description-source`
                              )
                            : null,
                          block.detections.quantitySource
                            ? renderReviewMetaItem("Qty source", block.detections.quantitySource, `${block.id}-qty-source`)
                            : null
                        ),
                        h(
                          "div",
                          { className: "review-meta-row review-meta-row-compact" },
                          renderReviewMetaItem(
                            "Tokens",
                            (block.detections.detectedTokens || []).join(" "),
                            `${block.id}-tokens`
                          )
                        ),
                        block.confidenceReason
                          ? h("div", { className: "muted-text block-debug-reason" }, block.confidenceReason)
                          : null,
                        h("pre", { className: "debug-raw-text simple-review-raw-text" }, block.rawText)
                      )
                    )
                  )
                )
              : null
          )
        )
      )
    );
  }

  function PageDebugPanel(props) {
    const { page, debugMode } = props;

    return h(
      "section",
      { className: "debug-page-card" },
      h(
        "div",
        { className: "debug-page-header" },
        h("h4", { className: "debug-page-title" }, page.pageLabel),
        h(
          "div",
          { className: "review-meta-row review-meta-row-compact" },
          renderReviewMetaItem("Method", page.extractionMethod || "text PDF", `debug-${page.pageNumber}-method`),
          page.ocrConfidence !== null && page.extractionMethod === "OCR"
            ? renderReviewMetaItem("OCR", `${page.ocrConfidence}%`, `debug-${page.pageNumber}-ocr`)
            : null,
          page.extractionMethod === "OCR" && page.selectedRotation !== null
            ? renderReviewMetaItem("Rotation", `${page.selectedRotation}°`, `debug-${page.pageNumber}-rotation`)
            : null,
          page.parserVersion ? renderReviewMetaItem("Parser", page.parserVersion, `debug-${page.pageNumber}-parser`) : null,
          page.ocrVersion ? renderReviewMetaItem("OCR Ver", page.ocrVersion, `debug-${page.pageNumber}-ocr-version`) : null
        )
      ),
      h(
        "div",
        { className: "review-meta-row review-meta-row-compact" },
        renderReviewMetaItem("OCR text length", `${page.ocrTextLength || 0}`, `debug-${page.pageNumber}-text-length`),
        renderReviewMetaItem("Order starts found", `${page.orderStartsFound || 0}`, `debug-${page.pageNumber}-order-starts`),
        renderReviewMetaItem("Rows created", `${page.rowsCreatedFromOrderStarts || page.rows.length}`, `debug-${page.pageNumber}-rows-created`),
        renderReviewMetaItem("Final rows", `${page.finalRowsDisplayed || page.rows.length}`, `debug-${page.pageNumber}-final-rows`),
        renderReviewMetaItem("Dropped", `${(page.droppedRows || []).length}`, `debug-${page.pageNumber}-dropped`)
      ),
      page.rawText
        ? h(
            "details",
            { className: "simple-review-details", open: true },
            h(
              "summary",
              { className: "simple-review-summary" },
              page.extractionMethod === "OCR" ? "Show OCR text" : "Show extracted text"
            ),
            h("pre", { className: "debug-raw-text simple-review-raw-text" }, page.rawText)
          )
        : null,
      page.comparisonDebug
        ? h(
            "details",
            { className: "simple-review-details" },
            h("summary", { className: "simple-review-summary" }, "Show OCR comparison"),
            h(
              "div",
              { className: "block-debug-list" },
              h(
                "div",
                { className: "block-debug-card" },
                h(
                  "div",
                  { className: "review-meta-row review-meta-row-compact" },
                  renderReviewMetaItem("Chosen OCR", page.comparisonDebug.chosenOcrVersion || "", `debug-${page.pageNumber}-chosen-ocr`),
                  renderReviewMetaItem("Raw OCR text length", `${page.comparisonDebug.rawOcrTextLength || 0}`, `debug-${page.pageNumber}-comparison-length`),
                  renderReviewMetaItem("Rows created", `${page.comparisonDebug.rowsCreated || 0}`, `debug-${page.pageNumber}-comparison-rows`)
                ),
                h(
                  "div",
                  { className: "review-meta-row review-meta-row-compact" },
                  renderReviewMetaItem(
                    "Accepted before optimization",
                    (page.comparisonDebug.acceptedOrderNumbersBeforeOptimization || []).join(", ") || "None",
                    `debug-${page.pageNumber}-accepted-before`
                  ),
                  renderReviewMetaItem(
                    "Accepted after optimization",
                    (page.comparisonDebug.acceptedOrderNumbersAfterOptimization || []).join(", ") || "None",
                    `debug-${page.pageNumber}-accepted-after`
                  )
                ),
                page.comparisonDebug.dropReasons && page.comparisonDebug.dropReasons.length > 0
                  ? h("div", { className: "muted-text block-debug-reason" }, page.comparisonDebug.dropReasons.join("; "))
                  : null
              )
            )
          )
        : null,
      debugMode && page.orderNumbersFound && page.orderNumbersFound.length > 0
        ? h(
            "details",
            { className: "simple-review-details" },
            h("summary", { className: "simple-review-summary" }, "Show all 8-digit numbers found"),
            h("div", { className: "block-debug-card" }, (page.orderNumbersFound || []).join(", "))
          )
        : null,
      debugMode && page.acceptedOrderNumbers && page.acceptedOrderNumbers.length > 0
        ? h(
            "details",
            { className: "simple-review-details" },
            h("summary", { className: "simple-review-summary" }, "Show accepted order rows"),
            h("div", { className: "block-debug-card" }, (page.acceptedOrderNumbers || []).join(", "))
          )
        : null,
      debugMode && page.rejectedOrderNumbers && page.rejectedOrderNumbers.length > 0
        ? h(
            "details",
            { className: "simple-review-details" },
            h("summary", { className: "simple-review-summary" }, "Show rejected 8-digit numbers"),
            h("div", { className: "block-debug-card" }, (page.rejectedOrderNumbers || []).join(", "))
          )
        : null,
      debugMode && page.droppedRows && page.droppedRows.length > 0
        ? h(
            "details",
            { className: "simple-review-details" },
            h("summary", { className: "simple-review-summary" }, "Show dropped rows"),
            h(
              "div",
              { className: "block-debug-list" },
              page.droppedRows.map((droppedRow, droppedIndex) =>
                h(
                  "div",
                  { className: "block-debug-card", key: `debug-${page.pageNumber}-dropped-${droppedIndex}` },
                  h(
                    "div",
                    { className: "review-meta-row review-meta-row-compact" },
                    renderReviewMetaItem("Order", droppedRow.orderNumber || "", `debug-${page.pageNumber}-dropped-order-${droppedIndex}`),
                    renderReviewMetaItem("Reason", droppedRow.reason || "dropped", `debug-${page.pageNumber}-dropped-reason-${droppedIndex}`)
                  )
                )
              )
            )
          )
        : null,
      debugMode && page.orderCandidateDebug && page.orderCandidateDebug.length > 0
        ? h(
            "details",
            { className: "simple-review-details" },
            h("summary", { className: "simple-review-summary" }, "Show order-number debug"),
            h(
              "div",
              { className: "block-debug-list" },
              page.orderCandidateDebug.map((candidate, candidateIndex) =>
                h(
                  "div",
                  { className: "block-debug-card", key: `debug-${page.pageNumber}-candidate-${candidateIndex}` },
                  h(
                    "div",
                    { className: "review-meta-row review-meta-row-compact" },
                    renderReviewMetaItem("Number", candidate.orderNumber || "", `debug-${page.pageNumber}-candidate-number-${candidateIndex}`),
                    renderReviewMetaItem("Status", candidate.accepted ? "accepted" : "rejected", `debug-${page.pageNumber}-candidate-status-${candidateIndex}`),
                    renderReviewMetaItem(
                      "Type",
                      candidate.detectedOrderType || candidate.orderType || "Needs review",
                      `debug-${page.pageNumber}-candidate-type-${candidateIndex}`
                    ),
                    candidate.rawOrderType
                      ? renderReviewMetaItem("Raw type", candidate.rawOrderType, `debug-${page.pageNumber}-candidate-raw-type-${candidateIndex}`)
                      : null,
                    renderReviewMetaItem("Confidence", candidate.confidence || "low", `debug-${page.pageNumber}-candidate-confidence-${candidateIndex}`)
                  ),
                  candidate.rowSliceText ? h("pre", { className: "debug-raw-text simple-review-raw-text" }, candidate.rowSliceText) : null,
                  candidate.reason ? h("div", { className: "muted-text block-debug-reason" }, candidate.reason) : null
                )
              )
            )
          )
        : null,
      debugMode && page.blocks && page.blocks.length > 0
        ? h(
            "details",
            { className: "simple-review-details" },
            h("summary", { className: "simple-review-summary" }, "Show detected row blocks"),
            h(
              "div",
              { className: "block-debug-list" },
              page.blocks.map((block) =>
                h(
                  "div",
                  { className: "block-debug-card", key: block.id },
                  h(
                    "div",
                    { className: "block-debug-header" },
                    h("strong", null, block.label),
                    block.confidence ? renderConfidencePill(block.confidence, block.confidenceReason, `${block.id}-debug-confidence`) : null
                  ),
                  h(
                    "div",
                    { className: "review-meta-row review-meta-row-compact" },
                    renderReviewMetaItem("Order", block.detections.fieldAssignments.orderNumber || "", `${block.id}-order`),
                    renderReviewMetaItem("Type", block.detections.fieldAssignments.orderType || "", `${block.id}-type`),
                    renderReviewMetaItem("Item", block.detections.fieldAssignments.itemNumber || "", `${block.id}-item`)
                  ),
                  h(
                    "div",
                    { className: "review-meta-row review-meta-row-compact" },
                    renderReviewMetaItem("Description", getDescription(block?.detections?.fieldAssignments), `${block.id}-description`),
                    renderReviewMetaItem("Qty", block.detections.fieldAssignments.quantities || "", `${block.id}-qty`)
                  ),
                  block.confidenceReason ? h("div", { className: "muted-text block-debug-reason" }, block.confidenceReason) : null,
                  h("pre", { className: "debug-raw-text simple-review-raw-text" }, block.rawText)
                )
              )
            )
          )
        : null
    );
  }

  function ImportPreviewProduct(props) {
    const { importData, onAddRow, onCancel, onDeleteRow, onFieldChange, onReparse, onSave } = props;
    const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(false);
    const allPreviewRows = flattenPendingImportRows(importData);
    const totalRows = allPreviewRows.length;
    const reviewRowCount = countRowsNeedingReview(allPreviewRows);

    return h(
      "section",
      { className: "preview-card import-preview-shell" },
      h(
        "div",
        { className: "preview-header" },
        h(
          "div",
          { className: "preview-header-copy" },
          h("h2", { className: "results-title" }, "Review Import"),
          h("p", { className: "muted-text preview-header-subtitle" }, "Check rows, fix anything uncertain, then save.")
        ),
        h(
          "div",
          { className: "action-row" },
          h("button", { className: "secondary-button", type: "button", onClick: onAddRow }, "Add Row"),
          h(
            "button",
            {
              className: "secondary-button secondary-button-muted",
              type: "button",
              onClick: onReparse
            },
            "Re-run Parser"
          ),
          h(
            "button",
            {
              className: isDebugPanelOpen ? "secondary-button" : "secondary-button secondary-button-muted",
              type: "button",
              onClick: () => setIsDebugPanelOpen((currentValue) => !currentValue)
            },
            isDebugPanelOpen ? "Hide Debug" : "Show Debug"
          ),
          h(
            "button",
            {
              className: "secondary-button secondary-button-muted",
              type: "button",
              onClick: onCancel
            },
            "Cancel"
          ),
          h("button", { className: "upload-button", type: "button", onClick: onSave }, "Save Import")
        )
      ),
      h(
        "div",
        {
          className: isDebugPanelOpen ? "import-preview-body import-preview-body-with-debug" : "import-preview-body"
        },
        h(
          "div",
          { className: "import-preview-main" },
          h(
            "div",
            { className: "status-row status-row-left" },
            h("span", { className: "summary-pill" }, importData.sourceName),
            h("span", { className: "summary-pill" }, importData.shipDate || "Imported PDF"),
            h("span", { className: "summary-pill" }, `${importData.pages.length} pages`),
            h("span", { className: "summary-pill" }, `${totalRows} rows`),
            reviewRowCount ? h("span", { className: "summary-pill" }, `${reviewRowCount} need review`) : null,
            importData.textPagesCount ? h("span", { className: "summary-pill" }, `${importData.textPagesCount} text`) : null,
            importData.ocrPagesCount ? h("span", { className: "summary-pill" }, `${importData.ocrPagesCount} OCR`) : null,
            importData.debugMode ? h("span", { className: "summary-pill" }, "Detailed debug on") : null
          ),
          reviewRowCount
            ? h(
                "div",
                { className: "message-banner warning" },
                h("p", { className: "muted-text" }, `${reviewRowCount} row${reviewRowCount === 1 ? "" : "s"} need review before or after saving.`)
              )
            : null,
          importData.ocrWarning
            ? h("div", { className: "message-banner warning" }, h("p", { className: "muted-text" }, importData.ocrWarning))
            : null,
          importData.importError
            ? h("div", { className: "message-banner error" }, h("p", { className: "muted-text" }, importData.importError))
            : null,
          h(
            "div",
            { className: "page-preview-list" },
            importData.pages.map((page) =>
              h(
                "section",
                { className: "page-preview-section", key: page.pageNumber },
                h(
                  "div",
                  { className: "page-preview-header" },
                  h(
                    "div",
                    { className: "page-preview-title" },
                    h("h3", { className: "page-preview-heading" }, page.pageLabel),
                    h(
                      "div",
                      { className: "review-meta-row" },
                      renderReviewMetaItem("Rows", `${page.rows.length}`, `${page.pageNumber}-rows`),
                      renderReviewMetaItem("Pallet", formatPalletLabel(page.defaultPalletLabel), `${page.pageNumber}-pallet`),
                      renderReviewMetaItem("Source", `${page.pageNumber}`, `${page.pageNumber}-source`),
                      page.palletLp ? renderReviewMetaItem("LP", page.palletLp, `${page.pageNumber}-lp`) : null,
                      renderReviewMetaItem("Method", renderExtractionMethodPill(page.extractionMethod, `${page.pageNumber}-method`), `${page.pageNumber}-method-item`),
                      page.ocrConfidence !== null && page.extractionMethod === "OCR"
                        ? renderReviewMetaItem(
                            "OCR",
                            renderOcrConfidencePill(page.ocrConfidence, page.extractionMethod, `${page.pageNumber}-ocr`),
                            `${page.pageNumber}-ocr-item`
                          )
                        : null,
                      page.extractionMethod === "OCR" && page.selectedRotation !== null
                        ? renderReviewMetaItem("Rotation", `${page.selectedRotation}°`, `${page.pageNumber}-rotation-item`)
                        : null
                    )
                  ),
                  h(
                    "button",
                    {
                      className: "secondary-button",
                      type: "button",
                      onClick: () => onAddRow(page.pageNumber)
                    },
                    "Add Row"
                  )
                ),
                page.warning
                  ? h("div", { className: "message-banner warning" }, h("p", { className: "muted-text" }, page.warning))
                  : null,
                page.rows.length === 0
                  ? h("p", { className: "muted-text simple-review-copy" }, "No parsed rows yet. Use Add Row to enter one manually.")
                  : null,
                h(
                  "div",
                  { className: "page-pallet-groups" },
                  groupPreviewRowsByPallet(page.rows, page.defaultPalletLabel).map((group) =>
                    h(
                      "div",
                      { className: "page-pallet-group", key: `${page.pageNumber}-${group.palletKey}` },
                      h(
                        "div",
                        { className: "page-pallet-heading" },
                        h("h4", { className: "page-pallet-title" }, group.palletLabel),
                        group.palletLp ? h("div", { className: "page-pallet-reference" }, `LP ${group.palletLp}`) : null
                      ),
                      h(
                        "div",
                        { className: "preview-table-wrap" },
                        h(
                          "table",
                          { className: "preview-table" },
                          h(
                            "thead",
                            null,
                            h(
                              "tr",
                              null,
                              h("th", null, "Pallet"),
                              h("th", null, "Order"),
                              h("th", null, "Type"),
                              h("th", null, "Item"),
                              h("th", null, "Description"),
                              h("th", null, "CT"),
                              h("th", null, "PC"),
                              h("th", null, "SF"),
                              h("th", null, "Other"),
                              h("th", null, "Confidence"),
                              h("th", null, "")
                            )
                          ),
                          h(
                            "tbody",
                            null,
                            group.rows.map((row) =>
                              h(
                                React.Fragment,
                                { key: row.id },
                                h(
                                  "tr",
                                  { className: row.confidence === "low" ? "preview-row-low-confidence" : "" },
                                  h("td", null, h("input", { className: "table-input", value: row.palletNumber, onChange: (event) => onFieldChange(row.id, "palletNumber", event.target.value) })),
                                  h("td", null, h("input", { className: "table-input", value: row.orderNumber, maxLength: 8, onChange: (event) => onFieldChange(row.id, "orderNumber", event.target.value) })),
                                  h(
                                    "td",
                                    null,
                                    h(
                                      "select",
                                      {
                                        className: "table-input table-select",
                                        value: row.orderType,
                                        onChange: (event) => onFieldChange(row.id, "orderType", event.target.value)
                                      },
                                      h("option", { value: "" }, ""),
                                      VALID_ORDER_TYPES.map((orderType) => h("option", { key: orderType, value: orderType }, orderType))
                                    )
                                  ),
                                  h("td", null, h("input", { className: "table-input", value: row.itemNumber, onChange: (event) => onFieldChange(row.id, "itemNumber", event.target.value) })),
                                  h("td", null, h("input", { className: "table-input", value: getDescription(row), onChange: (event) => onFieldChange(row.id, "productDescription", event.target.value) })),
                                  h("td", null, h("input", { className: "table-input table-number-input", value: row.cartonsQty, onChange: (event) => onFieldChange(row.id, "cartonsQty", event.target.value) })),
                                  h("td", null, h("input", { className: "table-input table-number-input", value: row.piecesQty, onChange: (event) => onFieldChange(row.id, "piecesQty", event.target.value) })),
                                  h("td", null, h("input", { className: "table-input table-number-input", value: row.squareFeetQty, onChange: (event) => onFieldChange(row.id, "squareFeetQty", event.target.value) })),
                                  h("td", null, h("input", { className: "table-input table-number-input", value: row.otherQty, onChange: (event) => onFieldChange(row.id, "otherQty", event.target.value) })),
                                  h(
                                    "td",
                                    { className: "preview-confidence-cell" },
                                    h(
                                      "div",
                                      { className: "preview-confidence-stack" },
                                      row.displayQty ? h("span", { className: "preview-meta-text" }, row.displayQty) : null,
                                      renderConfidencePill(row.confidence, row.confidenceReason, `${row.id}-row-confidence`),
                                      renderOcrConfidencePill(row.ocrConfidence, row.extractionMethod, `${row.id}-row-ocr`)
                                    )
                                  ),
                                  h(
                                    "td",
                                    { className: "preview-table-action" },
                                    h(
                                      "button",
                                      {
                                        className: "secondary-button secondary-button-muted preview-remove-button",
                                        type: "button",
                                        onClick: () => onDeleteRow(row.id)
                                      },
                                      "Remove"
                                    )
                                  )
                                ),
                                row.confidence === "low" && safeText(row.rawBlock)
                                  ? h(
                                      "tr",
                                      { className: "preview-row-raw-block" },
                                      h(
                                        "td",
                                        { colSpan: 11 },
                                        h(
                                          "details",
                                          { className: "preview-row-raw-details" },
                                          h("summary", { className: "simple-review-summary" }, "Show raw block"),
                                          h("pre", { className: "debug-raw-text simple-review-raw-text" }, row.rawBlock)
                                        )
                                      )
                                    )
                                  : null
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        ),
        isDebugPanelOpen
          ? h(
              "aside",
              { className: "debug-drawer" },
              h(
                "div",
                { className: "debug-drawer-header" },
                h("h3", { className: "debug-drawer-title" }, "Debug"),
                h(
                  "p",
                  { className: "muted-text debug-drawer-copy" },
                  importData.debugMode ? "OCR and parser diagnostics are shown here." : "Open raw OCR text and page diagnostics here."
                )
              ),
              h(
                "div",
                { className: "debug-page-list" },
                importData.pages.map((page) =>
                  h(PageDebugPanel, {
                    key: `debug-page-${page.pageNumber}`,
                    page,
                    debugMode: importData.debugMode
                  })
                )
              )
            )
          : null
      )
    );
  }

  function App() {
    const [rows, setRows] = useState([]);
    const [hasData, setHasData] = useState(false);
    const [importStatus, setImportStatus] = useState("idle");
    const [searchMode, setSearchMode] = useState("product");
    const [query, setQuery] = useState("");
    const [fileName, setFileName] = useState("");
    const [errorMessage, setErrorMessage] = useState("");
    const [uploadNotice, setUploadNotice] = useState("");
    const [pendingImport, setPendingImport] = useState(null);
    const [isParsingPdf, setIsParsingPdf] = useState(false);
    const [rawTextInput, setRawTextInput] = useState("");
    const [isRawTextMode, setIsRawTextMode] = useState(false);
    const [ocrDebugMode, setOcrDebugMode] = useState(false);
    const [importProgress, setImportProgress] = useState(null);
    const [ocrCacheCount, setOcrCacheCount] = useState(() => getOcrCacheEntryCount(loadOcrCacheStore()));
    const ocrCacheRef = useRef(loadOcrCacheStore());

    const shipDates = useMemo(() => {
      return Array.from(new Set(rows.map((row) => row.shipDate)))
        .filter(Boolean)
        .sort(compareShipDates);
    }, [rows]);

    const shipmentDate = shipDates[0] || "Not loaded";
    const results = useMemo(() => buildSearchResults(rows, searchMode, query), [rows, searchMode, query]);
    const showLandingPage = !hasData && !pendingImport && importStatus === "idle" && !fileName && !errorMessage;
    const palletGroups = useMemo(() => groupRowsByPallet(rows), [rows]);

    const totalPallets = useMemo(() => {
      return new Set(rows.map((row) => `${row.shipDate}__${row.sourcePage ? `page-${row.sourcePage}` : row.palletNumber}`)).size;
    }, [rows]);

    const totalOrders = useMemo(() => {
      return new Set(rows.map((row) => row.orderDisplay)).size;
    }, [rows]);

    function loadSampleData() {
      try {
        const parsedRows = parseShipmentCsv(SAMPLE_DATA_CSV);
        setRows(parsedRows);
        setHasData(true);
        setQuery("");
        setFileName("sample-data.csv");
        setErrorMessage("");
        setUploadNotice("Tile sample loaded.");
        setPendingImport(null);
        setImportStatus("success");
      } catch (error) {
        console.error("Sample data load failed", error);
        setErrorMessage(error instanceof Error ? error.message : "Unable to load sample data.");
        setUploadNotice("");
        setImportStatus("error");
      }
    }

    function clearLoadedData() {
      setRows([]);
      setHasData(false);
      setImportStatus("idle");
      setQuery("");
      setFileName("");
      setErrorMessage("");
      setUploadNotice("");
      setPendingImport(null);
      setIsParsingPdf(false);
      setRawTextInput("");
      setIsRawTextMode(false);
      setImportProgress(null);
    }

    function refreshOcrCacheCount() {
      setOcrCacheCount(getOcrCacheEntryCount(ocrCacheRef.current));
    }

    function clearOcrCache() {
      clearOcrCacheStore();
      ocrCacheRef.current = {};
      refreshOcrCacheCount();
      setUploadNotice("OCR cache cleared.");
      setErrorMessage("");
    }

    function handleImportProgress(update) {
      if (typeof update === "string") {
        setUploadNotice(update);
        return;
      }

      const nextProgress = update && typeof update === "object" ? update : null;
      setImportProgress(nextProgress);
      if (nextProgress && nextProgress.message) {
        const etaText = nextProgress.etaMs ? ` Estimated remaining ${formatDurationMs(nextProgress.etaMs)}.` : "";
        setUploadNotice(`${nextProgress.message}${etaText}`);
      }
    }

    function updatePendingImportRow(rowId, fieldName, value) {
      setPendingImport((currentImport) => {
        if (!currentImport) {
          return currentImport;
        }

        return {
          ...currentImport,
          pages: currentImport.pages.map((page) => {
            const targetRow = page.rows.find((row) => row.id === rowId);
            if (!targetRow) {
              return page;
            }

            const nextPalletNumber = fieldName === "palletNumber" ? safeUpper(value) : "";

            return {
              ...page,
              defaultPalletLabel: fieldName === "palletNumber" ? nextPalletNumber || page.defaultPalletLabel : page.defaultPalletLabel,
              pageLabel: fieldName === "palletNumber" ? formatPalletLabel(nextPalletNumber || page.defaultPalletLabel) : page.pageLabel,
              rows: page.rows.map((row) => {
                const shouldUpdateRow = row.id === rowId || fieldName === "palletNumber";
                if (!shouldUpdateRow) {
                  return row;
                }

                const nextRow = {
                  ...row,
                  [fieldName]:
                    fieldName === "orderNumber"
                      ? digitsOnly(value).slice(0, 8)
                      : fieldName === "uom"
                        ? normalizeUom(value)
                        : fieldName === "palletNumber"
                          ? nextPalletNumber
                          : value
                };
                const nextQuantityBuckets = readQuantityBuckets(nextRow);
                const primaryQuantityPair = getPrimaryQuantityPair(nextQuantityBuckets);

                return applyPreviewReviewState({
                  ...nextRow,
                  ...nextQuantityBuckets,
                  quantity: safeText(primaryQuantityPair.quantity),
                  uom: primaryQuantityPair.uom === "OTHER" ? "" : primaryQuantityPair.uom,
                  displayQty: buildDisplayQty(nextQuantityBuckets)
                });
              })
            };
          })
        };
      });
    }

    function addPendingImportRow(pageNumber) {
      setPendingImport((currentImport) => {
        if (!currentImport) {
          return currentImport;
        }

        const targetPageNumber = pageNumber || (currentImport.pages[0] ? currentImport.pages[0].pageNumber : 0);

        return {
          ...currentImport,
          pages: currentImport.pages.map((page) =>
            page.pageNumber === targetPageNumber
              ? {
                  ...page,
                  rows: [...page.rows, createBlankPreviewRow(page.defaultPalletLabel, page.pageNumber)]
                }
              : page
          )
        };
      });
    }

    function deletePendingImportRow(rowId) {
      setPendingImport((currentImport) => {
        if (!currentImport) {
          return currentImport;
        }

        return {
          ...currentImport,
          pages: currentImport.pages.map((page) => ({
            ...page,
            rows: page.rows.filter((row) => row.id !== rowId)
          }))
        };
      });
    }

    function cancelPendingImport() {
      setPendingImport(null);
      setUploadNotice("");
      setErrorMessage("");
      setImportStatus(rows.length > 0 ? "success" : fileName ? "error" : "idle");
      setHasData(rows.length > 0);
      setImportProgress(null);
    }

    function toggleRawTextMode() {
      setIsRawTextMode((currentValue) => !currentValue);
      setErrorMessage("");
      setUploadNotice("");
    }

    function clearRawTextTest() {
      setRawTextInput("");
      setPendingImport(null);
      setUploadNotice("");
      setErrorMessage("");
    }

    function runRawTextTest() {
      if (!normalizeText(rawTextInput)) {
        setPendingImport(null);
        setUploadNotice("");
        setErrorMessage("Paste extracted text from one PDF page before running the test.");
        return;
      }

      const parsedImport = parseRawTextPage(rawTextInput);
      const parsedRowCount = flattenPendingImportRows(parsedImport).length;
      const reviewRowCount = countRowsNeedingReview(flattenPendingImportRows(parsedImport));
      setPendingImport(parsedImport);
      setImportStatus(parsedRowCount > 0 ? "success" : "error");
      setErrorMessage("");
      setUploadNotice(
        parsedImport.ocrWarning
          ? `${parsedImport.ocrWarning} Review ${parsedRowCount} extracted rows.${reviewRowCount ? ` ${reviewRowCount} need review.` : ""}`
          : `Review ${parsedRowCount} extracted rows from raw text.${reviewRowCount ? ` ${reviewRowCount} need review.` : ""}`
      );
    }

    function savePendingImport() {
      if (!pendingImport) {
        return;
      }

      try {
        const saveResult = validatePreviewRows(flattenPendingImportRows(pendingImport), pendingImport.shipDate);
        setRows(saveResult.rows);
        setHasData(true);
        setImportStatus("success");
        setQuery("");
        setFileName(pendingImport.sourceName);
        setErrorMessage("");
        setUploadNotice(
          saveResult.reviewCount > 0
            ? `Imported ${saveResult.rows.length} rows. ${saveResult.reviewCount} row${saveResult.reviewCount === 1 ? "" : "s"} need review.`
            : `Imported ${saveResult.rows.length} rows.`
        );
        setPendingImport(null);
        setImportProgress(null);
      } catch (error) {
        console.error("Save import failed", error);
        setImportStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Unable to save parsed PDF rows.");
      }
    }

    function reparsePendingImport() {
      if (!pendingImport) {
        return;
      }

      try {
        setImportStatus("processing");
        setUploadNotice("Re-running parser from cached OCR text...");
        const reparsedImport = rebuildImportFromCachedPages({
          ...pendingImport,
          debugMode: ocrDebugMode
        });
        const reparsedRowCount = flattenPendingImportRows(reparsedImport).length;
        const reviewRowCount = countRowsNeedingReview(flattenPendingImportRows(reparsedImport));
        setPendingImport(reparsedImport);
        setImportStatus("success");
        setErrorMessage("");
        setUploadNotice(
          `Re-ran parser on cached OCR text. Review ${reparsedRowCount} rows.${reviewRowCount ? ` ${reviewRowCount} need review.` : ""}`
        );
      } catch (error) {
        console.error("Parser re-run failed", error);
        setImportStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "Unable to re-run parser.");
      } finally {
        setImportProgress(null);
      }
    }

    function selectPallet(groupPalletNumber) {
      setSearchMode("pallet");
      setQuery(safeText(groupPalletNumber));
      setErrorMessage("");
      setUploadNotice("");
    }

    async function handleFileChange(event) {
      const inputElement = event.target;
      const file = inputElement.files && inputElement.files[0];
      if (!file) {
        return;
      }

      if (isPdfFile(file) || isImageFile(file)) {
        setFileName(file.name);
        setImportStatus("processing");
        setErrorMessage("");
        setUploadNotice(isPdfFile(file) ? "Parsing PDF..." : "Running OCR on image...");
        setIsParsingPdf(true);
        setImportProgress({
          message: isPdfFile(file) ? "Parsing PDF..." : "Running OCR on image...",
          currentPage: 1,
          totalPages: 1,
          completedPages: 0,
          etaMs: 0
        });

        try {
          const parsedImport = isPdfFile(file)
            ? await parseShipmentPdf(file, handleImportProgress, {
                debugMode: ocrDebugMode,
                cacheStore: ocrCacheRef.current
              })
            : await parseImageFile(file, handleImportProgress, {
                debugMode: ocrDebugMode,
                cacheStore: ocrCacheRef.current
              });
          const parsedRowCount = flattenPendingImportRows(parsedImport).length;
          const reviewRowCount = countRowsNeedingReview(flattenPendingImportRows(parsedImport));
          setPendingImport(parsedImport);
          setHasData(rows.length > 0);
          setImportStatus(parsedImport.importError ? "error" : "success");
          setErrorMessage(parsedImport.importError || "");
          refreshOcrCacheCount();
          setUploadNotice(
            parsedRowCount === 0
              ? `0 rows found.${parsedImport.ocrWarning ? ` ${parsedImport.ocrWarning}` : ""}`
              : parsedImport.ocrWarning
              ? `${parsedImport.ocrWarning} Review ${parsedRowCount} extracted rows.${reviewRowCount ? ` ${reviewRowCount} need review.` : ""}`
              : parsedImport.ocrPagesCount > 0
                ? `OCR processed ${parsedImport.ocrPagesCount} page${parsedImport.ocrPagesCount === 1 ? "" : "s"}. Review ${parsedRowCount} extracted rows.${reviewRowCount ? ` ${reviewRowCount} need review.` : ""}`
                : `Review ${parsedRowCount} extracted rows.${reviewRowCount ? ` ${reviewRowCount} need review.` : ""}`
          );
        } catch (error) {
          console.error("Import failed", error);
          const message = error instanceof Error ? error.message : "Unable to import file.";
          const fallbackImport = createImportErrorResult(file.name, message);
          setPendingImport(fallbackImport);
          setImportStatus("error");
          setHasData(rows.length > 0);
          setUploadNotice("");
          setErrorMessage(message);
        } finally {
          setIsParsingPdf(false);
          setImportProgress(null);
          inputElement.value = "";
        }

        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsedRows = parseShipmentCsv(String(reader.result || ""));
          setRows(parsedRows);
          setHasData(true);
          setImportStatus("success");
          setQuery("");
          setFileName(file.name);
          setErrorMessage("");
          setUploadNotice("");
          setPendingImport(null);
        } catch (error) {
          console.error("CSV parse failed", error);
          setFileName(file.name);
          setImportStatus("error");
          setUploadNotice("");
          setErrorMessage(error instanceof Error ? error.message : "Unable to parse CSV file.");
        }
        inputElement.value = "";
      };
      reader.onerror = () => {
        console.error("CSV read failed");
        setFileName(file.name);
        setImportStatus("error");
        setUploadNotice("");
        setErrorMessage("Unable to read the selected file.");
        inputElement.value = "";
      };
      reader.readAsText(file);
    }

    const activeSearchMode = SEARCH_MODES.find((mode) => mode.id === searchMode) || SEARCH_MODES[0];

    return h(
      "div",
      { className: showLandingPage ? "app-shell landing-shell" : "app-shell" },
      h("input", {
        id: "csv-upload",
        className: "visually-hidden",
        type: "file",
        accept: ".csv,.pdf,.jpg,.jpeg,.png,.webp,.bmp,.gif,.heic,.heif,text/csv,application/pdf,image/*",
        onChange: handleFileChange
      }),
      showLandingPage
        ? h(
            React.Fragment,
            null,
            h(LandingPage, {
              isParsingPdf,
              onClear: clearLoadedData,
              debugMode: ocrDebugMode,
              onToggleDebugMode: () => setOcrDebugMode((currentValue) => !currentValue),
              onClearOcrCache: clearOcrCache,
              cacheCount: ocrCacheCount
            }),
            errorMessage || uploadNotice
              ? h(
                  "section",
                  {
                    className: errorMessage ? "message-banner error" : "message-banner"
                  },
                  h("p", { className: "muted-text" }, errorMessage || uploadNotice)
                )
              : null
          )
        : h(
            React.Fragment,
            null,
            h(ProductHeader, {
              kicker: pendingImport ? "Import review" : "Warehouse receiving",
              subtitle: pendingImport ? "Review OCR and save clean pallet data." : "Search pallets, orders, and products."
            }),
            h(
              "main",
              { className: "workspace-card" },
              h(
                "section",
                { className: "controls-panel" },
                h(
                  "div",
                  { className: "toolbar-row" },
                  h(
                    "label",
                    { className: "upload-button", htmlFor: "csv-upload" },
                    isParsingPdf ? "Processing..." : fileName ? `Replace ${fileName}` : "Choose CSV, PDF, or Image"
                  ),
                  h(
                    "div",
                    { className: "action-row" },
                    h(
                      "button",
                      {
                        className: ocrDebugMode ? "secondary-button" : "secondary-button secondary-button-muted",
                        type: "button",
                        onClick: () => setOcrDebugMode((currentValue) => !currentValue)
                      },
                      ocrDebugMode ? "Debug On" : "Debug Off"
                    ),
                    h(
                      "button",
                      {
                        className: "secondary-button secondary-button-muted",
                        type: "button",
                        onClick: clearOcrCache
                      },
                      "Clear OCR Cache"
                    )
                  )
                ),
                h(
                  "div",
                  { className: "mode-switch" },
                  SEARCH_MODES.map((mode) =>
                    h(
                      "button",
                      {
                        key: mode.id,
                        type: "button",
                        className: mode.id === searchMode ? "mode-button active" : "mode-button",
                        onClick: () => setSearchMode(mode.id)
                      },
                      mode.label
                    )
                  )
                ),
                h(
                  "div",
                  { className: "search-row" },
                  h(
                    "div",
                    { className: "search-input-wrap" },
                    h("input", {
                      className: "search-input",
                      type: "search",
                      value: query,
                      placeholder: activeSearchMode.placeholder,
                      onChange: (event) => setQuery(event.target.value)
                    }),
                    safeText(query)
                      ? h(
                          "button",
                          {
                            className: "search-clear-button",
                            type: "button",
                            onClick: () => setQuery("")
                          },
                          "×"
                        )
                      : null
                  )
                ),
                fileName || rows.length > 0
                  ? h(
                      "div",
                      { className: "status-row" },
                      fileName ? h("span", { className: "summary-pill" }, fileName) : null,
                      importStatus !== "idle" ? h("span", { className: "summary-pill" }, `Import ${importStatus}`) : null,
                      h("span", { className: "summary-pill" }, ocrDebugMode ? "Debug OCR" : "Normal OCR"),
                      ocrCacheCount ? h("span", { className: "summary-pill" }, `${ocrCacheCount} cached`) : null,
                      importProgress && importProgress.totalPages
                        ? h(
                            "span",
                            { className: "summary-pill" },
                            `Page ${Math.min(importProgress.currentPage || 1, importProgress.totalPages)} of ${importProgress.totalPages}`
                          )
                        : null,
                      importProgress && importProgress.etaMs
                        ? h("span", { className: "summary-pill" }, `ETA ${formatDurationMs(importProgress.etaMs)}`)
                        : null,
                      rows.length > 0 ? h("span", { className: "summary-pill" }, shipmentDate) : null,
                      rows.length > 0 ? h("span", { className: "summary-pill" }, `${totalPallets} pallets`) : null,
                      rows.length > 0 ? h("span", { className: "summary-pill" }, `${totalOrders} orders`) : null
                    )
                  : null
              ),
              errorMessage || uploadNotice
                ? h(
                    "section",
                    {
                      className: errorMessage ? "message-banner error" : "message-banner"
                    },
                    h("p", { className: "muted-text" }, errorMessage || uploadNotice)
                  )
                : null,
              pendingImport
                ? h(ImportPreviewProduct, {
                    importData: pendingImport,
                    onAddRow: addPendingImportRow,
                    onCancel: cancelPendingImport,
                    onDeleteRow: deletePendingImportRow,
                    onFieldChange: updatePendingImportRow,
                    onReparse: reparsePendingImport,
                    onSave: savePendingImport
                  })
                : rows.length > 0 && !safeText(query)
                  ? h(
                      "section",
                      { className: "manual-pallet-section" },
                      h(
                        "div",
                        { className: "manual-pallet-header" },
                        h("h2", { className: "results-title" }, "Pallets"),
                        h("p", { className: "muted-text manual-pallet-copy" }, "Tap a pallet to search it.")
                      ),
                      h(
                        "div",
                        { className: "manual-pallet-grid" },
                        palletGroups.map((group) =>
                          h(PalletBrowserCard, {
                            key: group.key,
                            group,
                            onSelect: selectPallet
                          })
                        )
                      )
                    )
                  : null,
              pendingImport
                ? null
                : !safeText(query)
                  ? h(
                      GuidanceState,
                      {
                        title: "Enter a search"
                      }
                    )
                  : h(
                      "section",
                      { className: "results-section" },
                      h(
                        "div",
                        { className: "results-header" },
                        h("h2", { className: "results-title" }, "Results"),
                        h(
                          "div",
                          { className: "results-stats" },
                          h("span", { className: "summary-pill" }, `${results.palletCount} pallets`),
                          h("span", { className: "summary-pill" }, `${results.lineCount} lines`)
                        )
                      ),
                      results.groups.length === 0
                        ? h(
                            GuidanceState,
                            {
                              title: "No matches found"
                            }
                          )
                        : h(
                            "div",
                            { className: "results-grid" },
                            results.groups.map((group, index) =>
                            h(ResultCard, {
                              key: group.key,
                              group,
                              index,
                              mode: searchMode,
                              query
                            })
                          )
                          )
                    )
            )
          )
    );
  }

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(h(App));
})();
