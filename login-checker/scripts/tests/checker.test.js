"use strict";

const assert = require("assert");
const {
  FAILURE_REASON_CODES,
  LOGIN_STATUS,
  OTA_LOGIN_CONFIGS,
  checkOtaLogin,
  evaluateLoginStateFromUrl,
  execute,
  mapLoginCheckResult
} = require("..");

const MEITUAN_BUSINESS_TEXT = "\u6279\u91cf\u6539\u4ef7 \u623f\u578b \u4ef7\u683c \u552e\u5356 \u65e5\u5386";
const MEITUAN_LOGIN_TEXT = "\u8bf7\u767b\u5f55 \u624b\u673a\u53f7 \u9a8c\u8bc1\u7801 \u5bc6\u7801 \u8d26\u53f7\u767b\u5f55";

function createFakePage(finalUrl, options = {}) {
  const bodyText = Object.prototype.hasOwnProperty.call(options, "bodyText")
    ? options.bodyText
    : defaultFakeBodyText(finalUrl);
  return {
    visitedUrl: "",
    async goto(url) {
      this.visitedUrl = url;
    },
    async waitForTimeout() {},
    async evaluate() {
      if (options.evaluateError) throw new Error(options.evaluateError);
      return bodyText;
    },
    async title() {
      return options.title || "";
    },
    url() {
      return finalUrl;
    },
    context() {
      return null;
    }
  };
}

function createFailingPage(message) {
  return {
    async goto() {
      throw new Error(message);
    },
    url() {
      return "";
    },
    context() {
      return null;
    }
  };
}

function defaultFakeBodyText(finalUrl) {
  return finalUrl === OTA_LOGIN_CONFIGS.meituan.pricePageUrl ? MEITUAN_BUSINESS_TEXT : "";
}

async function run() {
  assert.strictEqual(
    evaluateLoginStateFromUrl("https://account.booking.com/sign-in?op_token=SECRET", "booking").isLoggedIn,
    false
  );
  assert.strictEqual(
    evaluateLoginStateFromUrl("https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true", "ctrip").isLoggedIn,
    true
  );
  assert.strictEqual(
    evaluateLoginStateFromUrl("https://login.taobao.com/member/login.jhtml", "feizhu").matchedRule.keyword,
    "login"
  );

  const ctripPage = createFakePage(OTA_LOGIN_CONFIGS.ctrip.pricePageUrl);
  const ctripRaw = await checkOtaLogin("ctrip", { page: ctripPage, settleMs: 0 });
  assert.strictEqual(ctripPage.visitedUrl, OTA_LOGIN_CONFIGS.ctrip.pricePageUrl);
  assert.strictEqual(ctripRaw.loggedIn, true);

  const ctripMapped = mapLoginCheckResult(ctripRaw);
  assert.strictEqual(ctripMapped.success, true);
  assert.strictEqual(ctripMapped.loginStatus, LOGIN_STATUS.LOGGED_IN);
  assert.strictEqual(ctripMapped.failureReasonCode, FAILURE_REASON_CODES.LOGIN_CHECK_PASSED);

  const bookingSecret = "SECRET_BOOKING_TOKEN";
  const bookingRaw = await checkOtaLogin("booking", {
    page: createFakePage(`https://account.booking.com/sign-in?op_token=${bookingSecret}&target=calendar`),
    settleMs: 0
  });
  const bookingMapped = mapLoginCheckResult(bookingRaw);
  assert.strictEqual(bookingMapped.success, false);
  assert.strictEqual(bookingMapped.loginStatus, LOGIN_STATUS.LOGGED_OUT);
  assert.strictEqual(bookingMapped.failureReasonCode, FAILURE_REASON_CODES.OTA_NOT_LOGGED_IN);
  assert.ok(!JSON.stringify(bookingMapped).includes(bookingSecret));
  assert.ok(JSON.stringify(bookingMapped).includes("op_token=***MASKED***"));

  const meituanBusiness = await checkOtaLogin("meituan", {
    page: createFakePage(OTA_LOGIN_CONFIGS.meituan.pricePageUrl, { bodyText: MEITUAN_BUSINESS_TEXT }),
    settleMs: 0
  });
  assert.strictEqual(meituanBusiness.loggedIn, true);
  assert.strictEqual(meituanBusiness.needLogin, false);

  const meituanLogin = await checkOtaLogin("meituan", {
    page: createFakePage(OTA_LOGIN_CONFIGS.meituan.pricePageUrl, { bodyText: MEITUAN_LOGIN_TEXT }),
    settleMs: 0
  });
  assert.strictEqual(meituanLogin.loggedIn, false);
  assert.strictEqual(meituanLogin.needLogin, true);
  assert.strictEqual(meituanLogin.matchedRule.id, "meituan_page_text_contains_login");

  const errorRaw = await checkOtaLogin("trip", {
    page: createFailingPage("navigation timeout"),
    settleMs: 0
  });
  const errorMapped = mapLoginCheckResult(errorRaw);
  assert.strictEqual(errorMapped.loginStatus, LOGIN_STATUS.ERROR);
  assert.strictEqual(errorMapped.failureReasonCode, FAILURE_REASON_CODES.LOGIN_CHECK_ERROR);

  const invalid = await execute(null);
  assert.strictEqual(invalid.success, false);
  assert.strictEqual(invalid.failureReasonCode, FAILURE_REASON_CODES.INVALID_INPUT);

  const missingPlatform = await execute({});
  assert.strictEqual(missingPlatform.success, false);
  assert.strictEqual(missingPlatform.failureReasonCode, FAILURE_REASON_CODES.INVALID_INPUT);

  const unsupported = await execute({ platformCode: "unknown" });
  assert.strictEqual(unsupported.success, false);
  assert.strictEqual(unsupported.failureReasonCode, FAILURE_REASON_CODES.UNSUPPORTED_PLATFORM);

  const executed = await execute(
    {
      platformCode: "ctrip",
      storeId: "demo-store",
      pageUrl: "https://ebooking.ctrip.com/custom"
    },
    {
      page: createFakePage("https://ebooking.ctrip.com/custom"),
      settleMs: 0
    }
  );
  assert.strictEqual(executed.success, true);
  assert.strictEqual(executed.platformCode, "ctrip");
  assert.strictEqual(executed.evidence.storeId, "demo-store");
  assert.strictEqual(executed.evidence.targetUrl, "https://ebooking.ctrip.com/custom");
  assert.strictEqual(executed.rawResult.targetUrl, "https://ebooking.ctrip.com/custom");
}

run()
  .then(() => {
    process.stdout.write("ota-login-checker tests passed\n");
  })
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exit(1);
  });
