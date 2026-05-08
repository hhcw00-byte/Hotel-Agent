const { APIRuntime } = require('../api-runtime');
const runtime = new APIRuntime();
const params = JSON.parse(process.argv[2] || '{}');

(async () => {
  try {
    const hotelId = params.hotelId;
    if (!hotelId) return runtime.outputError('MISSING_PARAM', 'hotelId is required. Configure it in hotel admin panel.');
    const checkIn = params.checkIn || new Date().toISOString().split('T')[0];
    const checkOut = params.checkOut || new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const checkInNoDash = checkIn.replace(/-/g, '');
    const checkOutNoDash = checkOut.replace(/-/g, '');
    // head.extension 需要 YYYY-MM-DD 格式，checkIn 本身已经是这个格式
    const checkInDash = checkIn;
    const checkOutDash = checkOut;

    const url = 'https://us.trip.com/restapi/soa2/33269/getHotelRoomListOversea?_fxpcqlniredt=09034012319036670548';

    const payload = {
      "search": {
        "isRSC": false, "isSSR": false,
        "hotelId": parseInt(hotelId),
        "roomId": 0, "checkIn": checkInNoDash, "checkOut": checkOutNoDash,
        "roomQuantity": 1, "adult": 1, "childInfoItems": [],
        "isIjtb": false, "priceType": 0,
        "hotelUniqueKey": "H4sIAAAAAAAA_-Oax8jFJMEkxMTBKDWZkWPLore72CxuRTjOmgkEshUOngwgMKHSIYBnEqMkJ4wnKN_6OnBHXZmDEyvHAz0JlhmMP298sNvImAYCauYOOxiZTjBaLGBquPnBbhcTRM0hIH2ZSYLlFBPDJSaGW0wMj5gYXjExfGJi-AVV0cTM0MXMMIkZom4WM8MiZgYpXqNEC1ND09S0VCPDtEQFIY3-o8vPsxk5AR3MOuXA82nsCoxagvEhnqHBRqb5qaWVZfkZ6RaJBoyTGJlCg08xShmam5tYGhkbWhoYmBnrWaQZmAYWm7hY-gRXWDFLMbp5MAaxmTubmZtZRmlxMTv7RQqC_cjwwV6KOTTYRXHPtAn8VWHSDlogOUOYXBJrap5uaHDGW5ECxi5GDgFGD8YIxgrGV4wgPT_AgQEAVFrKwloBAAA",
        "mustShowRoomList": [],
        "location": { "geo": { "cityID": 1 } },
        "filters": [
          { "filterId": "17|1", "type": "17", "value": "1", "title": "" },
          { "filterId": "31|" + hotelId, "type": "31", "value": String(hotelId), "title": "" }
        ],
        "meta": { "fgt": -1, "roomkey": "", "minCurr": "", "minPrice": "", "roomToken": "" },
        "hasAidInUrl": false, "cancelPolicyType": 0, "fixSubhotel": 0,
        "listTraceId": "2a8515efe21fa",
        "abResultEntities": [
          { "key": "221221_IBU_ormlp", "value": "A" },
          { "key": "230815_IBU_pcpto", "value": "B" },
          { "key": "240530_IBU_Opdp", "value": "B" },
          { "key": "241121_IBU_oldr", "value": "B" }
        ],
        "extras": { "loginAB": "", "exposeBedInfos": "", "enableChildAgeGroup": "T", "needEntireSetRoomDesc": "T", "closeOnlineRoomListOptimize": true }
      },
      "head": {
        "cid": "1774923190063.8f05Qs4D9LSx",
        "ctok": "", "cver": "0", "lang": "01", "sid": "", "syscode": "09",
        "auth": "", "xsid": "",
        "extension": [
          { "name": "cityId", "value": "" },
          { "name": "checkIn", "value": checkInDash },
          { "name": "checkOut", "value": checkOutDash }
        ],
        "Locale": "en-US", "Language": "en", "Currency": "USD",
        "ClientID": "09034012319036670548",
        "platform": "PC", "bu": "IBU", "group": "trip",
        "aid": "", "ouid": "",
        "locale": "en-US", "region": "US", "timezone": "8", "currency": "USD",
        "pageId": "10320668147",
        "vid": "1774923190063.8f05Qs4D9LSx",
        "guid": "",
        "isSSR": false
      }
    };

    const response = await runtime.fetch(url, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'currency': 'USD',
        'locale': 'en-US',
        'phantom-token': '1004-common-6QwLBYZfxsQj1DedLJ5oWHgJB5JBaW9GJ5hY05vHheo6yqUw8dRXlYGZjQlWZ9JnAWm0ElNvfhik6JzkE0nYLovUMEQBvSFJ03YqLEnTv7orDGRn9WQYTwO4rMbYQ3RNlycnybcwgavHFi3GJtdJ6AjGnEA9Rg9i1XjhQrPXEdMK0YFMEmXWs8x3fKlfjzhj4gEkfy9EhNic5YqEOHYU4yoEPGYsAy5SvcbydcIUOj4Dw5keQ5EM3It4w6piSqR6EhpYOByhUKLOi7sjnPjTsWF0ykE4MYplyNMyBqjQ6jhBEzDec8WsELHYAgyLEhoi06ySqwmteFOjqMIPUxl8y8EFSi4UJBnRbEA8YPXwU4Kc1i0LjoXjZNWZNxmPyPEbMidlJ3HRHzih9RMGjPaw30v5ljAsR3SyXE3aYflwzdw7mKQtjqswScrfMxkXYOEz0iTMJZHYQqWchY61wmFeQ3WLSEqkeFSYXziZESXYAdwpfwhmKS7jBtw6LrsARoAv4aj1E8zi43J6XY0PWQnYa6w5ne1dWZSE40eb8YO9EmEG3YXLwTSE1dyBcvUpWQZj9EOmiS9JmBY4Eo1YTqwOAwqsKbpePGWpGyZ0whQjtsYMEsniTgJ5nWgEXQYbawlMyf0vzmJ37JtbjshEO4RlXEhEHdi3BJhkYpTJbpJTEA8Ybmw1NwbTwpQYUEGFislJQtRhEk3Yzbw0nEGUx3GjopyGEPfizcJNEXMYqtwG1jdDwgtEnOxNmjkTWoXEfUv5Swn7E5oiBbygnjGES9iQ0JkSWfEbpYhAwZtwakvmPwcOwsEcHikXJ1syZhJP3JSE4OYX5wQ7Wtcep7Ybhr1Ed6ikpJXBjkoeMUj6LWZtjAEU6YMSwM3K4SigUj80j9cWtpvc8YPoeBoJX1vs5jF5rs3jGTInEsPiApJMFvZTEmlyUkx1SRMJF3E6YF8Y4EQGJfsRFtyqSyA0E4fvFbYm4i6QRkFvZMWt7WmNwA5iO1I1Zjg9vlXWTOJGgiz3yZhEdHJPZvaSIFNJLhedmWhbwMBEoYFpe5jMSysBR6pYmFwhAEkdRdUjb0wpayUkeXMjc9iotJaNEGBeO9E97vl1RzFyQUe5pE74EpQJpXEMtel7vcnE7qv9kRgFwzBJ0QvkHEhSJ6QR37JszvLNiOzIG6rlYgmKFdWtNy1Aj5tYOnYm7w73wTLvl2YMpjqXWbE3aKk3qJ5Z6R4YmYsMxbNXYKkXkSJDzFsETNi3XNnhE8XjA9Yy0LjrI5FjB9Y4pjf7Yd5E5DinMJt1WMsKlUYoAK9YATKsHwnty3SjM4iFsiGmxOUW6Bjlr3cxOlYQlwzaIlrbyPZWaGj4GxFzJDzxnhY3jMoWfaKtBrTYMsraXI4fepORzTW3Bi1XYp6WM4wN8wX0j9lRt5EqhyFDyq6Eoc',
        'referer': `https://us.trip.com/hotels/detail/?cityId=1&hotelId=${hotelId}&checkIn=${checkIn}&checkOut=${checkOut}&adult=2&children=0&crn=1&curr=USD&locale=en-US`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.291 Safari/537.36',
        'x-ctx-country': 'US',
        'x-ctx-currency': 'USD',
        'x-ctx-locale': 'en-US',
        'x-ctx-ubt-pvid': '10',
        'x-ctx-ubt-sid': '36',
        'x-ctx-ubt-vid': '1774923190063.8f05Qs4D9LSx',
        'x-ctx-user-recognize': 'NON_EU',
        'x-ctx-wclient-req': '4386561a12b2e0fbf58688cf2370991a',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) return runtime.outputError('HTTP_ERROR', `status: ${response.status}`);
    runtime.output(response.data);
  } catch (e) { runtime.outputError('EXCEPTION', e.message); }
})();