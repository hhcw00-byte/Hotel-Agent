const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9555');
  const contexts = browser.contexts();
  const pages = contexts.flatMap(c => c.pages());

  const page =
    pages.find(p => p.url().includes('admin.booking.com') && p.url().includes('calendar')) ||
    pages[0];

  console.log('[probe] url =', page.url());

  await page.waitForSelector('.av-cal-list-room[data-test-id^="room-"]', { timeout: 30000 });

  const result = await page.evaluate(() => {
    const targetRoomName = '双人间';
    const rooms = Array.from(document.querySelectorAll('.av-cal-list-room[data-test-id^="room-"]'));

    const matchedRoom = rooms.find(room => {
      const title = room.querySelector('.av-cal-list-room__title')?.innerText || '';
      return title.includes(targetRoomName);
    });

    if (!matchedRoom) {
      return {
        matched: false,
        roomCount: rooms.length,
        allRoomTitles: rooms.map(room => room.querySelector('.av-cal-list-room__title')?.innerText || '')
      };
    }

    const buttons = Array.from(matchedRoom.querySelectorAll('[data-test-id="general-modal-cta"]'))
      .map((btn, index) => {
        const rect = btn.getBoundingClientRect();
        return {
          index,
          text: btn.innerText,
          tagName: btn.tagName,
          visible: rect.width > 0 && rect.height > 0,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          disabled: btn.disabled || btn.getAttribute('aria-disabled'),
          inNameRow: !!btn.closest('.av-cal-list-room__name-row'),
          inCtaWrapper: !!btn.closest('[data-test-id="general-modal-cta-wrapper"]'),
          closestNameRowClass: btn.closest('.av-cal-list-room__name-row')?.className || '',
          parentClass: btn.parentElement?.className || '',
          outerHTML: btn.outerHTML.slice(0, 800)
        };
      });

    return {
      matched: true,
      roomCount: rooms.length,
      matchedRoomTestId: matchedRoom.getAttribute('data-test-id'),
      matchedRoomTitle: matchedRoom.querySelector('.av-cal-list-room__title')?.innerText || '',
      buttonCountInMatchedRoom: buttons.length,
      buttons
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
