const fs = require('fs');
const filePath = 'database/database-manager.ts';
let content = fs.readFileSync(filePath, 'utf8');

const brokenLine = 'platform_hotel_id AS platfo';
const idx = content.indexOf(brokenLine);
if (idx === -1) {
  console.log('Pattern not found - file may already be fixed');
  process.exit(0);
}

const lineStart = content.lastIndexOf('\n', idx) + 1;

// Find saveChatMessage method
const saveChat = content.indexOf('saveChatMessage', idx);
if (saveChat === -1) {
  console.log('Could not find saveChatMessage');
  process.exit(1);
}
// Go back to the JSDoc comment
const commentStart = content.lastIndexOf('/**', saveChat);

const replacement = `      \`SELECT c.id AS competitorId, c.name AS competitorName, cp.platform_hotel_id AS platformHotelId
       FROM competitors c
       INNER JOIN competitor_platform_ids cp ON c.id = cp.competitor_id
       WHERE c.user_id = ? AND cp.platform = ? AND cp.platform_hotel_id IS NOT NU
    // Go back to find the JSDoc comment start
    const commentStart = content.lastIndexOf('/**', nextMethod3);
    doReplace(commentStart);
  } else {
    doReplace(nextMethod2);
  }
} else {
  doReplace(nextMethod);
}

function doReplace(nextMethodIdx) {
  content = content.slice(0, lineStart) + replacement + content.slice(nextMethodIdx);
  fs.writeFileSync(filePath, content);
  console.log('FIXED successfully at offset', nextMethodIdx);
}`
