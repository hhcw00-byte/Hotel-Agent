const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

const ROOM_INVENTORY_QUERY = `query roomInventoryQuery($input: PartnerAvailabilityFetchInput!) {
  partnerAvailability {
    partnerAvailabilityFetch(input: $input) {
      hotel {
        rooms {
          roomId
          name
          numGuests
          dates {
            date
            status
            roomsToSell
            netBooked
            __typename
          }
          rates {
            rateId
            name
            occupancies
            dates {
              date
              status
              closed
              price {
                occupancy
                value
                __typename
              }
              __typename
            }
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}`;

(async () => {
  try {
    const hotelId = params.hotelId;
    let ses = params.ses || '';
    if (!hotelId) return runtime.outputError('MISSING_PARAM', 'hotelId is required');

    // 如果没传 ses，自动从后台页面 302 重定向 URL 中获取
    if (!ses) {
      process.stderr.write(`[booking-backend] ses not provided, fetching from redirect...\n`);
      const initUrl = `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id=${hotelId}&lang=zh`;
      const initResp = await runtime.fetch(initUrl, {
        method: 'GET',
        headers: {
          'accept': 'text/html',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        },
        timeout: 30000,
        maxRedirects: 0,  // 不跟随重定向，从 Location header 提取 ses
      });
      // 302 时 status 不是 2xx，但 Location header 里有 ses
      const location = initResp.headers?.location || initResp.headers?.Location || '';
      const sesMatch = location.match(/[?&]ses=([a-f0-9]+)/);
      if (sesMatch) {
        ses = sesMatch[1];
        process.stderr.write(`[booking-backend] Extracted ses from Location: ${ses}\n`);
      } else {
        // 降级：从 response body（可能是 HTML）中提取
        const html = typeof initResp.data === 'string' ? initResp.data : '';
        const htmlMatch = html.match(/[?&]ses=([a-f0-9]+)/);
        if (htmlMatch) {
          ses = htmlMatch[1];
          process.stderr.write(`[booking-backend] Extracted ses from body: ${ses}\n`);
        } else {
          return runtime.outputError('NO_SES', `Could not extract ses. Status: ${initResp.status}, Location: ${location.substring(0, 100)}`);
        }
      }
    }

    // 调试：输出 Cookie 状态
    const cookies = process.env.BROWSER_COOKIES || '';
    process.stderr.write(`[booking-backend] Cookie length: ${cookies.length}\n`);

    // 动态生成未来 30 天日期
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      dates.push(d.toISOString().split('T')[0]);
    }

    // roomIds: 如果传了就用，否则传空数组（让接口返回所有房型）
    const roomIds = params.roomIds || [];

    const url = ses
      ? `https://admin.booking.com/dml/graphql.json?hotel_id=${hotelId}&lang=zh&ses=${ses}&source=nav`
      : `https://admin.booking.com/dml/graphql.json?hotel_id=${hotelId}&lang=zh`;
    process.stderr.write(`[booking-backend] URL: ${url}\n`);

    const response = await runtime.fetch(url, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'content-type': 'application/json',
        'origin': 'https://admin.booking.com',
        'referer': `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id=${hotelId}&lang=zh`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        'apollographql-client-name': 'b-partner-availability-extranet-mfe',
        'apollographql-client-version': 'EQdAHUdA',
        'x-booking-context-action': 'hhemc_index',
        'x-booking-context-action-name': 'hhemc_index',
        'x-booking-csrf-token': 'undefined',
        'x-booking-site-type-id': '31',
        'x-booking-topic': 'capla_browser_b-partner-availability-extranet-mfe',
      },
      body: JSON.stringify({
        operationName: 'roomInventoryQuery',
        variables: {
          input: {
            roomIds,
            hotelId: parseInt(hotelId),
            dates,
            rateIds: [],
            additional: {
              useInventorySvc: true,
              statusReason: true,
              xmlTransformFplosInCalendar: false,
              includeFakePrice: true,
            },
            options: {
              checkEmptyPrice: true,
              mlosStatusReason: true,
              checkDynamicRestrictions: true,
            },
          },
        },
        extensions: {},
        query: ROOM_INVENTORY_QUERY,
      }),
      timeout: 30000,
    });

    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);

    const data = response.data;
    const rooms = data?.data?.partnerAvailability?.partnerAvailabilityFetch?.hotel?.[0]?.rooms;

    if (!rooms || rooms.length === 0) {
      return runtime.outputError('NO_DATA', 'No rooms returned from API');
    }

    runtime.output({ rooms, hotelId, dates: { from: dates[0], to: dates[dates.length - 1] } });
  } catch (e) {
    runtime.outputError('EXCEPTION', e.message);
  }
})();
