/**
 * 字段路径解析器
 *
 * resolve(obj, 'priceInfo.price')  →  obj.priceInfo.price
 * resolve(obj, 'a.b.c')           →  obj?.a?.b?.c
 */
function resolve(obj, dotPath) {
  if (!obj || !dotPath) return undefined;
  return dotPath.split('.').reduce((o, k) => o?.[k], obj);
}

module.exports = { resolve };
