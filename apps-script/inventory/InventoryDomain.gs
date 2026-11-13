// Generated from shared/inventory.ts by npm run build:inventory. Do not edit.
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class InventoryError extends Error {
  constructor(code) {
    super(code);
    __publicField(this, "code", code);
  }
}
const fail = (code) => {
  throw new InventoryError(code);
};
function text(value, max, required = false) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return fail("INVALID_INPUT");
  const result = value.trim();
  if (required && !result) return fail("INVALID_INPUT");
  return result;
}
function money(value) {
  if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,6})?$/.test(value) || value.replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length > 15) return fail("INVALID_MONEY");
  return value.replace(/^0+(?=\d)/, "");
}
function keys(data, allowed) {
  if (Object.keys(data).some((key) => !allowed.includes(key))) fail("PROTECTED_OR_UNKNOWN_FIELD");
}
function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function validateInventoryCommand(raw) {
  if (!plainObject(raw)) return fail("INVALID_INPUT");
  keys(raw, ["requestId", "action", "expectedRevision", "productId", "data"]);
  if (typeof raw.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.requestId)) return fail("INVALID_REQUEST_ID");
  if (!["product.create", "product.update", "stock.adjust", "product.archive"].includes(String(raw.action))) return fail("INVALID_ACTION");
  if (!plainObject(raw.data)) return fail("INVALID_INPUT");
  const productId = text(raw.productId, 100, true);
  if (!/^[A-Za-z0-9_-]+$/.test(productId)) return fail("INVALID_PRODUCT_ID");
  const action = raw.action;
  if (action === "product.create" ? raw.expectedRevision !== null : !Number.isSafeInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 1) return fail("INVALID_REVISION");
  const input = raw.data, data = {};
  if (action === "product.create" || action === "product.update") {
    keys(input, ["sku", "name", "category", "buyingPrice", "desiredProfit", "imageAssetIds", ...action === "product.create" ? ["openingStock"] : []]);
    const originalSku = text(input.sku, 100, true), sku = action === "product.create" ? originalSku.toUpperCase() : originalSku;
    if (!/^[A-Z0-9][A-Z0-9._-]*$/i.test(sku)) return fail("INVALID_SKU");
    Object.assign(data, { sku, name: text(input.name, 200, true), category: text(input.category, 100), buyingPrice: money(input.buyingPrice), desiredProfit: action === "product.update" && input.desiredProfit === "" ? "" : money(input.desiredProfit) });
    if (!Array.isArray(input.imageAssetIds) || input.imageAssetIds.length > 8) return fail("INVALID_ASSETS");
    const ids = input.imageAssetIds.map((id) => text(id, 100, true));
    if (ids.some((id) => !/^[A-Za-z0-9_-]+$/.test(id)) || new Set(ids).size !== ids.length) return fail("INVALID_ASSETS");
    data.imageAssetIds = ids;
    if (action === "product.create") {
      if (!Number.isSafeInteger(input.openingStock) || Number(input.openingStock) < 0 || Number(input.openingStock) > 1e6) return fail("INVALID_QUANTITY");
      data.openingStock = input.openingStock;
    }
  } else if (action === "stock.adjust") {
    keys(input, ["delta", "reason"]);
    if (!Number.isSafeInteger(input.delta) || Number(input.delta) === 0 || Math.abs(Number(input.delta)) > 1e6) return fail("INVALID_QUANTITY");
    data.delta = input.delta;
    data.reason = text(input.reason, 500, true);
  } else keys(input, []);
  return { requestId: raw.requestId, action, expectedRevision: raw.expectedRevision, productId, data };
}
function canonicalInventoryValue(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalInventoryValue).join(",") + "]";
  if (plainObject(value)) return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalInventoryValue(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function cloneInventoryValue(value) {
  return JSON.parse(JSON.stringify(value));
}
function planInventoryChange(command, existing, actor, now) {
  text(actor, 200, true);
  if (!Number.isFinite(now.getTime())) return fail("INVALID_TIME");
  const create = command.action === "product.create";
  if (create && existing) return fail("DUPLICATE_PRODUCT");
  if (!create && !existing) return fail("PRODUCT_NOT_FOUND");
  if (existing && existing.revision !== command.expectedRevision) return fail("STALE_REVISION");
  if (existing?.archived) return fail("PRODUCT_ARCHIVED");
  let product;
  if (create) {
    const d = command.data;
    product = { id: command.productId, revision: 1, sku: d.sku, name: d.name, category: d.category, buyingPrice: d.buyingPrice, desiredProfit: d.desiredProfit, imageAssetIds: d.imageAssetIds, openingStock: d.openingStock, stock: d.openingStock, archived: false };
  } else product = { ...cloneInventoryValue(existing), revision: existing.revision + 1 };
  if (command.action === "product.update") {
    if (command.data.sku !== existing.sku) return fail("SKU_LOCKED");
    Object.assign(product, command.data);
  }
  let movement;
  if (command.action === "stock.adjust") {
    const before = product.stock, after = before + Number(command.data.delta);
    if (!Number.isSafeInteger(after) || after < 0) return fail("OUT_OF_STOCK");
    product.stock = after;
    movement = { id: command.requestId, productId: product.id, delta: Number(command.data.delta), before, after, reason: String(command.data.reason), actor, recordedAt: now.toISOString() };
  } else if (create && product.openingStock) {
    movement = { id: command.requestId, productId: product.id, delta: product.openingStock, before: 0, after: product.openingStock, reason: "Opening stock", actor, recordedAt: now.toISOString() };
  }
  if (command.action === "product.archive") product.archived = true;
  const result = { product: cloneInventoryValue(product), ...movement ? { movementId: movement.id } : {} };
  return { result, movement };
}
async function applyInventoryCommand(store, raw, actor, now = /* @__PURE__ */ new Date()) {
  const command = validateInventoryCommand(raw);
  text(actor, 200, true);
  if (!Number.isFinite(now.getTime())) return fail("INVALID_TIME");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalInventoryValue({ command, actor })));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return store.transaction(async (tx) => {
    const previous = await tx.operation(command.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return fail("REQUEST_KEY_CONFLICT");
      return cloneInventoryValue(previous.result);
    }
    const existing = await tx.product(command.productId);
    const { result, movement } = planInventoryChange(command, existing, actor, now);
    const product = result.product;
    if (command.action === "product.create" || command.action === "product.update") {
      const owner = await tx.skuOwner(product.sku);
      if (owner && owner !== product.id) return fail("DUPLICATE_SKU");
      for (const asset of product.imageAssetIds) if (!await tx.approvedAsset(asset)) return fail("ASSET_NOT_APPROVED");
    }
    await tx.commit(product, movement, command.requestId, fingerprint, result);
    return cloneInventoryValue(result);
  });
}
const MAX_SOURCE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_STORED_IMAGE_BYTES = 300 * 1024;
function jpegDimensionsWithLimits(bytes, maxBytes, maxDimension) {
  const invalid = () => {
    throw new Error("INVALID_IMAGE");
  };
  if (bytes.length < 20 || bytes.length > maxBytes || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return invalid();
  let at = 2, width = 0, height = 0;
  while (at < bytes.length - 2) {
    if (bytes[at++] !== 255) return invalid();
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 217) break;
    const length = bytes[at] << 8 | bytes[at + 1];
    if (length < 2 || at + length > bytes.length - 2) return invalid();
    if ([192, 193, 194].includes(marker)) {
      if (length < 8 || bytes[at + 2] !== 8) return invalid();
      height = bytes[at + 3] << 8 | bytes[at + 4];
      width = bytes[at + 5] << 8 | bytes[at + 6];
    }
    if (marker === 218) break;
    at += length;
  }
  if (width < 1 || height < 1 || width > maxDimension || height > maxDimension) return invalid();
  return { width, height };
}
function jpegDimensions(bytes) {
  return jpegDimensionsWithLimits(bytes, MAX_STORED_IMAGE_BYTES, 1600);
}
function sourceImageDimensions(bytes, mime) {
  if (bytes.length > MAX_SOURCE_IMAGE_BYTES || bytes.length < 20) throw new Error("INVALID_IMAGE");
  let width = 0, height = 0;
  if (mime === "image/jpeg") ({ width, height } = jpegDimensionsWithLimits(bytes, MAX_SOURCE_IMAGE_BYTES, 16e3));
  else if (mime === "image/png") {
    if ([137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => bytes[i] !== n) || bytes.length < 33 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") throw new Error("INVALID_IMAGE");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (mime === "image/webp") {
    const ascii = (a, b) => String.fromCharCode(...bytes.subarray(a, b));
    if (bytes.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP") throw new Error("INVALID_IMAGE");
    const chunk = ascii(12, 16);
    if (chunk === "VP8X") {
      if (bytes[20] & 2) throw new Error("INVALID_IMAGE");
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (chunk === "VP8 ") {
      if (bytes[23] !== 157 || bytes[24] !== 1 || bytes[25] !== 42) throw new Error("INVALID_IMAGE");
      width = (bytes[26] | bytes[27] << 8) & 16383;
      height = (bytes[28] | bytes[29] << 8) & 16383;
    } else if (chunk === "VP8L") {
      if (bytes[20] !== 47) throw new Error("INVALID_IMAGE");
      width = 1 + bytes[21] + ((bytes[22] & 63) << 8);
      height = 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10);
    }
  }
  if (width < 1 || height < 1 || width * height > 16e6) throw new Error("INVALID_IMAGE");
  return { width, height };
}
