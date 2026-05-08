const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

/**
 * Extract b_rooms_available_and_soldout JSON array from Booking.com HTML.
 * Uses string-aware bracket matching to handle nested JSON with escaped quotes.
 * @param {string} html
 * @returns {Array|null}
 */
function extractRoomsData(html) {
  const marker = 'b_rooms_available_and_soldout';
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  // Find the opening '[' after the marker
  const searchStart = markerIdx + marker.length;
  const bracketStart = html.indexOf('[', searchStart);
  if (bracketStart === -1) return null;

  // String-aware bracket counter
  let depth = 0;
  let inString = false;
  let i = bracketStart;

  while (i < html.length) {
    const ch = html[i];

    if (inString) {
      if (ch === '\\') {
        i += 2; // skip escaped character
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') {
        inString = true;
      } else if (ch === '[' || ch === '{') {
        depth++;
      } else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) {
          const jsonStr = html.substring(bracketStart, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch (e) {
            process.stderr.write(`[booking] JSON.parse failed: ${e.message}\n`);
            return null;
          }
        }
      }
    }
    i++;
  }

  return null;
}

(async () => {
  try {
    const hotelSlug = params.hotelSlug;
    if (!hotelSlug) return runtime.outputError('MISSING_PARAM', 'hotelSlug is required. Configure it in hotel admin panel.');
    const countryCode = params.countryCode || 'cn';
    const lang = params.lang || 'zh-cn';
    const checkIn = params.checkIn || new Date().toISOString().split('T')[0];
    const checkOut = params.checkOut || new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const url = `https://www.booking.com/hotel/${countryCode}/${hotelSlug}.${lang}.html?checkin=${checkIn}&checkout=${checkOut}&group_adults=2&no_rooms=1&group_children=0`;

    const response = await runtime.fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      timeout: 60000,
    });

    if (!response.ok) {
      return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    }

    const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

    if (html.length < 5000) {
      return runtime.outputError('WAF_BLOCKED', `HTML too short (${html.length} bytes), likely WAF/captcha block`);
    }

    const rooms = extractRoomsData(html);
    if (!rooms) {
      return runtime.outputError('PARSE_FAILED', 'Could not find b_rooms_available_and_soldout in HTML');
    }

    if (!Array.isArray(rooms) || rooms.length === 0) {
      return runtime.outputError('NO_ROOMS', 'b_rooms_available_and_soldout is empty or not an array');
    }

    runtime.output({ rooms, checkIn, checkOut });
  } catch (e) {
    runtime.outputError('EXCEPTION', e.message);
  }
})();
