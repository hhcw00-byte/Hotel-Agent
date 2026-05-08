const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

const AUTOCOMPLETE_QUERY = `query AutoComplete($input: AutoCompleteRequestInput!) {
  autoCompleteSuggestions(input: $input) {
    results {
      destination { countryCode destId destType __typename }
      displayInfo { title __typename }
      __typename
    }
    __typename
  }
}`;

const BROWSER_HEADERS = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

(async () => {
  try {
    const keyword = params.keyword;
    if (!keyword) return runtime.outputError('MISSING_PARAM', 'keyword is required');
    const lang = params.lang || 'zh-cn';
    const langShort = lang.split('-')[0]; // 'zh' or 'en'

    // Step 1: GraphQL AutoComplete — 搜索酒店名获取 destId
    const gqlResp = await runtime.fetch(`https://www.booking.com/dml/graphql?aid=304142&lang=${lang}`, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'content-type': 'application/json',
        'origin': 'https://www.booking.com',
        'referer': 'https://www.booking.com/',
        'user-agent': BROWSER_HEADERS['user-agent'],
      },
      body: JSON.stringify({
        operationName: 'AutoComplete',
        variables: {
          input: {
            prefixQuery: keyword,
            nbSuggestions: 5,
            fallbackConfig: { mergeResults: true, nbMaxMergedResults: 6, nbMaxThirdPartyResults: 3, sources: ['GOOGLE', 'HERE'] },
            requestConfig: { enableRequestContextBoost: true },
            requestContext: { pageviewId: '0000000000000000', location: null }
          }
        },
        extensions: {},
        query: AUTOCOMPLETE_QUERY
      }),
      timeout: 30000,
    });

    if (!gqlResp.ok) return runtime.outputError('HTTP_ERROR', `GraphQL status: ${gqlResp.status}`);

    const results = gqlResp.data?.data?.autoCompleteSuggestions?.results || [];
    const hotels = results.filter(r => r.destination?.destType === 'HOTEL');
    if (hotels.length === 0) return runtime.outputError('NO_HOTEL_RESULTS', `搜索 "${keyword}" 无酒店结果`);

    // 名称匹配校验：搜索关键词和返回结果必须是同一家酒店
    // 策略：品牌名 + 地理位置词都要匹配
    const normalize = (s) => s.replace(/[（）()\s·\-—""'']+/g, '').toLowerCase();
    const keywordNorm = normalize(keyword);

    // 已知酒店品牌列表（用于提取品牌名）
    const BRANDS = [
      // 中文品牌
      '汉庭','桔子水晶','桔子','全季','如家','亚朵','维也纳','锦江之星','7天','速8',
      '格林豪泰','华住','希尔顿','万豪','洲际','凯悦','喜来登','假日','丽枫','麗枫','CitiGO',
      '和颐','美豪','开元','君澜','首旅','建国','北京饭店','香格里拉','瑰丽','柏悦','安缦',
      '四季','文华东方','半岛','璞瑄','唐府','宜必思','诺富特','美居','铂尔曼','索菲特',
      // English brands
      'hilton','marriott','hyatt','intercontinental','sheraton','westin','holiday inn',
      'best western','radisson','accor','ibis','novotel','mercure','pullman','sofitel',
      'four seasons','mandarin oriental','peninsula','ritz-carlton','st. regis','w hotel',
      'courtyard','hampton','doubletree','crowne plaza','kimpton','fairmont','shangri-la',
      'aman','rosewood','park hyatt','grand hyatt','waldorf astoria','conrad','lux',
    ];

    // 从名称中提取品牌
    const extractBrand = (name) => {
      const norm = normalize(name);
      for (const brand of BRANDS) {
        if (norm.includes(normalize(brand))) return normalize(brand);
      }
      return null;
    };

    const keywordBrand = extractBrand(keyword);

    let bestHotel = null;

    for (const h of hotels) {
      const title = h.displayInfo?.title || '';
      const titleNorm = normalize(title);

      // 完全包含匹配（最强）
      if (titleNorm.includes(keywordNorm) || keywordNorm.includes(titleNorm)) {
        bestHotel = h;
        break;
      }

      // 品牌校验：如果能识别出品牌，返回结果必须包含相同品牌
      if (keywordBrand) {
        const titleBrand = extractBrand(title);
        if (titleBrand !== keywordBrand) continue; // 品牌不同，跳过
      }

      // 品牌匹配后，检查地理位置词重叠
      // 提取关键词中去掉品牌后的地理部分
      let geoKeyword = keywordNorm;
      if (keywordBrand) geoKeyword = geoKeyword.replace(keywordBrand, '');
      let geoTitle = titleNorm;
      const titleBrand = extractBrand(title);
      if (titleBrand) geoTitle = geoTitle.replace(titleBrand, '');

      // 用 2-gram 计算地理位置重叠
      const getGrams = (s) => {
        const grams = new Set();
        for (let i = 0; i < s.length - 1; i++) grams.add(s.substring(i, i + 2));
        return grams;
      };
      const keyGrams = getGrams(geoKeyword);
      const titleGrams = getGrams(geoTitle);
      let overlap = 0;
      for (const g of keyGrams) { if (titleGrams.has(g)) overlap++; }
      const score = keyGrams.size > 0 ? overlap / keyGrams.size : 0;

      // 地理位置至少 50% 重叠
      if (score >= 0.5 && !bestHotel) {
        bestHotel = h;
      }
    }

    if (!bestHotel) {
      const firstTitle = hotels[0]?.displayInfo?.title || '';
      return runtime.outputError('NO_MATCH', `搜索 "${keyword}" 无精确匹配，最接近: "${firstTitle}"`);
    }

    const { destId, countryCode } = bestHotel.destination;
    const hotelName = bestHotel.displayInfo?.title || keyword;

    // Step 2: 搜索结果页 HTML — 提取 slug
    const checkIn = new Date().toISOString().split('T')[0];
    const checkOut = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const searchUrl = `https://www.booking.com/searchresults.${lang}.html?ss=${encodeURIComponent(hotelName)}&dest_id=${destId}&dest_type=hotel&checkin=${checkIn}&checkout=${checkOut}&group_adults=2&no_rooms=1&group_children=0&search_selected=true`;

    const searchResp = await runtime.fetch(searchUrl, { method: 'GET', headers: BROWSER_HEADERS, timeout: 60000 });
    const html = typeof searchResp.data === 'string' ? searchResp.data : '';

    // WAF 检测
    if (html.length < 10000 && html.includes('challenge.js')) {
      return runtime.outputError('WAF_BLOCKED', 'Cookie 可能已过期，需要在浏览器中刷新 booking.com');
    }

    // 精确匹配：找包含目标 destId 的酒店链接
    const precisePattern = new RegExp(`/hotel/${countryCode}/([a-z0-9][a-z0-9-]+)\\..*?dest_id=${destId}`, 'i');
    const preciseMatch = html.match(precisePattern);
    if (preciseMatch) {
      return runtime.output({ slug: preciseMatch[1], destId, countryCode, hotelName });
    }

    // 降级：取第一个符合格式的酒店 slug
    const fallbackPattern = new RegExp(`/hotel/${countryCode}/([a-z0-9][a-z0-9-]{3,})\\.`, 'g');
    const allSlugs = [...new Set([...html.matchAll(fallbackPattern)].map(m => m[1]))];
    if (allSlugs.length > 0) {
      return runtime.output({ slug: allSlugs[0], destId, countryCode, hotelName });
    }

    return runtime.outputError('NO_SLUG_FOUND', `搜索结果页 (${html.length} bytes) 中未找到 slug`);
  } catch (e) {
    runtime.outputError('EXCEPTION', e.message);
  }
})();
