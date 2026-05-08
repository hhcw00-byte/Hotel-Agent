"use strict";

const { chromium } = require("playwright");

const OTA_CODES = Object.freeze({
  CTRIP: "ctrip",
  MEITUAN: "meituan",
  TRIP: "trip",
  BOOKING: "booking",
  FEIZHU: "feizhu"
});

const LOGIN_CHECK_STATUS = Object.freeze({
  CHECKED: "checked",
  ERROR: "error"
});

const DEFAULT_LOGIN_CHECK_OPTIONS = Object.freeze({
  browserChannel: "chrome",
  headless: false,
  timeoutMs: 60000,
  waitUntil: "domcontentloaded",
  settleMs: 1000,
  keepOpenOnSuccess: false,
  keepLoggedInSessionOpen: false,
  closeAfterCheck: false
});

const DEFAULT_LOGIN_CHECK_PLATFORMS = Object.freeze([
  OTA_CODES.CTRIP,
  OTA_CODES.MEITUAN,
  OTA_CODES.TRIP,
  OTA_CODES.BOOKING,
  OTA_CODES.FEIZHU
]);

const OTA_ALIASES = Object.freeze({
  xiecheng: OTA_CODES.CTRIP,
  ctrip: OTA_CODES.CTRIP,
  meituan: OTA_CODES.MEITUAN,
  mt: OTA_CODES.MEITUAN,
  trip: OTA_CODES.TRIP,
  booking: OTA_CODES.BOOKING,
  "booking.com": OTA_CODES.BOOKING,
  bookingcom: OTA_CODES.BOOKING,
  feizhu: OTA_CODES.FEIZHU,
  fliggy: OTA_CODES.FEIZHU,
  "fliggy.com": OTA_CODES.FEIZHU,
  fliggycom: OTA_CODES.FEIZHU
});

const OTA_LOGIN_CONFIGS = Object.freeze({
  [OTA_CODES.BOOKING]: Object.freeze({
    code: OTA_CODES.BOOKING,
    name: "Booking",
    pricePageUrl: "https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/calendar/index.html?hotel_id=15994510&lang=zh&source=nav",
    loginRules: Object.freeze([
      loginRule("booking_url_contains_sign_in", "sign-in", "Booking login URL contains sign-in."),
      loginRule("booking_url_contains_login", "login", "Booking login URL contains login.")
    ])
  }),
  [OTA_CODES.TRIP]: Object.freeze({
    code: OTA_CODES.TRIP,
    name: "Trip",
    pricePageUrl: "https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true",
    loginRules: Object.freeze([
      loginRule("trip_url_contains_login", "login", "Trip login URL contains login."),
      loginRule("trip_url_contains_passport", "passport", "Trip login URL contains passport.")
    ])
  }),
  [OTA_CODES.CTRIP]: Object.freeze({
    code: OTA_CODES.CTRIP,
    name: "Ctrip",
    pricePageUrl: "https://ebooking.ctrip.com/rateplan/batchPriceSetting?microJump=true",
    loginRules: Object.freeze([
      loginRule("ctrip_url_contains_login", "login", "Ctrip login URL contains login."),
      loginRule("ctrip_url_contains_passport", "passport", "Ctrip login URL contains passport.")
    ])
  }),
  [OTA_CODES.MEITUAN]: Object.freeze({
    code: OTA_CODES.MEITUAN,
    name: "Meituan",
    pricePageUrl: "https://me.meituan.com/ebooking/merchant/product/batch-price",
    loginRules: Object.freeze([
      loginRule("meituan_url_contains_login", "login", "Meituan login URL contains login."),
      loginRule("meituan_url_contains_passport", "passport", "Meituan login URL contains passport."),
      loginRule("meituan_url_contains_account_login", "/account/login", "Meituan login URL contains account login.")
    ])
  }),
  [OTA_CODES.FEIZHU]: Object.freeze({
    code: OTA_CODES.FEIZHU,
    name: "Feizhu",
    pricePageUrl: "https://hotel.fliggy.com/ebooking/hotelBaseInfoUv.htm#/ebk-rp/batchRoomStatusUpdate?type=price",
    loginRules: Object.freeze([
      loginRule("feizhu_url_contains_login", "login", "Feizhu login URL contains login."),
      loginRule("feizhu_url_contains_passport", "passport", "Feizhu login URL contains passport."),
      loginRule("feizhu_url_contains_taobao_member_login", "member/login", "Feizhu login URL contains Taobao member login.")
    ])
  })
});

const MEITUAN_LOGIN_TEXT_KEYWORDS = Object.freeze([
  "login",
  "password",
  "passport",
  "/account/login",
  "\u767b\u5f55",
  "\u624b\u673a\u53f7",
  "\u9a8c\u8bc1\u7801",
  "\u5bc6\u7801",
  "\u8d26\u53f7\u767b\u5f55",
  "\u626b\u7801\u767b\u5f55",
  "\u8bf7\u767b\u5f55",
  "\u91cd\u65b0\u767b\u5f55"
]);

const MEITUAN_BUSINESS_TEXT_KEYWORDS = Object.freeze([
  "merchant",
  "product",
  "batch-price",
  "\u6279\u91cf\u6539\u4ef7",
  "\u623f\u578b",
  "\u4ef7\u683c",
  "\u552e\u5356",
  "\u65e5\u5386",
  "\u63d0\u4ea4",
  "\u623f\u4ef7"
]);

class OtaLoginPrecheckError extends Error {
  constructor(precheckResult, message) {
    super(message || buildOtaLoginPrecheckMessage(precheckResult));
    this.name = "OtaLoginPrecheckError";
    this.code = "OTA_LOGIN_GATE_FAILED";
    this.precheckResult = precheckResult || {};
    this.results = precheckResult && precheckResult.results ? precheckResult.results : {};
    this.failedPlatforms = Array.isArray(precheckResult && precheckResult.failedPlatforms)
      ? precheckResult.failedPlatforms
      : [];

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OtaLoginPrecheckError);
    }
  }
}

async function checkOtaLogin(ota, options = {}) {
  const config = getOtaLoginConfig(ota);
  const targetUrl = pickString(
    options.targetUrl,
    options.pageUrl,
    options.pricePageUrl,
    options.runtime && options.runtime.targetUrl,
    options.runtime && options.runtime.pageUrl,
    options.runtime && options.runtime.pricePageUrl,
    config.pricePageUrl
  );
  let session = null;
  let currentUrl = "";
  let result = null;
  let keepSession = false;

  try {
    session = await createPageSession(options);
    await navigateToTarget(session.page, targetUrl, options);
    currentUrl = safePageUrl(session.page);
    const state = await evaluateLoginState(session.page, currentUrl, config, options);
    currentUrl = pickString(state.currentUrl, currentUrl);
    result = buildLoginResult({
      config,
      targetUrl,
      currentUrl,
      isLoggedIn: state.isLoggedIn,
      matchedRule: state.matchedRule,
      status: state.status || LOGIN_CHECK_STATUS.CHECKED,
      errorCode: state.errorCode,
      errorMessage: state.errorMessage,
      evidence: state.evidence
    });
    keepSession = shouldKeepSessionAfterCheck(result, session, options);
    if (keepSession) attachReusableSession(result, session, options);
    return result;
  } catch (error) {
    currentUrl = safePageUrl(session && session.page) || currentUrl;
    const state = currentUrl
      ? evaluateLoginStateFromUrl(currentUrl, config)
      : { isLoggedIn: false, matchedRule: null, evidence: null };
    const status = state.matchedRule ? LOGIN_CHECK_STATUS.CHECKED : LOGIN_CHECK_STATUS.ERROR;
    result = buildLoginResult({
      config,
      targetUrl,
      currentUrl,
      isLoggedIn: state.isLoggedIn,
      matchedRule: state.matchedRule,
      status,
      errorMessage: error && error.message ? error.message : String(error),
      evidence: state.evidence
    });
    keepSession = shouldKeepSessionAfterCheck(result, session, options);
    if (keepSession) attachReusableSession(result, session, options);
    return result;
  } finally {
    if (!keepSession && session && typeof session.cleanup === "function") {
      await session.cleanup();
    }
  }
}

async function checkAllOtaLogins(options = {}) {
  const platforms = normalizePlatformList(options.platforms);
  const resultList = [];

  for (const ota of platforms) {
    const result = await checkOtaLogin(ota, buildSingleOtaOptions(options, ota));
    resultList.push(result);
    if (options.stopOnFirstFailure && !isLoginCheckPassed(result)) {
      break;
    }
  }

  return buildPrecheckResult(resultList);
}

async function checkOtaLogins(options = {}) {
  return checkAllOtaLogins(options);
}

async function precheckOtaLoginBeforeAdjust(options = {}) {
  const result = await checkAllOtaLogins(options);
  if (result.ok) return result;
  if (options.throwOnFailure === false) return result;
  throw new OtaLoginPrecheckError(result);
}

async function assertAllOtaLoggedIn(options = {}) {
  return precheckOtaLoginBeforeAdjust({ ...options, throwOnFailure: true });
}

function evaluateLoginStateFromUrl(currentUrl, otaOrConfig) {
  const config = typeof otaOrConfig === "string" ? getOtaLoginConfig(otaOrConfig) : otaOrConfig;
  const matchedRule = matchLoginRule(currentUrl, config && config.loginRules);
  return {
    currentUrl: String(currentUrl || ""),
    isLoggedIn: !matchedRule,
    matchedRule,
    evidence: null
  };
}

async function evaluateLoginState(page, currentUrl, config, options = {}) {
  const urlState = evaluateLoginStateFromUrl(currentUrl, config);
  if (!config || config.code !== OTA_CODES.MEITUAN) {
    return {
      ...urlState,
      status: LOGIN_CHECK_STATUS.CHECKED,
      evidence: undefined
    };
  }

  const pageState = await evaluateMeituanPageState(page, { ...options, currentUrl });
  const latestUrl = safePageUrl(page) || currentUrl;
  if (!urlState.isLoggedIn && !pageState.backendMarkerMatched) {
    return {
      ...urlState,
      status: LOGIN_CHECK_STATUS.CHECKED,
      evidence: {
        ...(pageState.evidence || {}),
        currentUrl: String(latestUrl || currentUrl || ""),
        decision: "login_url_marker"
      }
    };
  }
  if (latestUrl !== currentUrl) {
    const latestUrlState = evaluateLoginStateFromUrl(latestUrl, config);
    if (!latestUrlState.isLoggedIn && !pageState.backendMarkerMatched) {
      return {
        ...latestUrlState,
        status: LOGIN_CHECK_STATUS.CHECKED,
        evidence: {
          ...(pageState.evidence || {}),
          currentUrl: String(latestUrl || ""),
          decision: "login_url_marker"
        }
      };
    }
  }
  if (pageState.needLogin) {
    return {
      currentUrl: String(latestUrl || ""),
      isLoggedIn: false,
      matchedRule: pageState.matchedRule,
      status: LOGIN_CHECK_STATUS.CHECKED,
      evidence: pageState.evidence
    };
  }
  if (pageState.loggedIn) {
    return {
      currentUrl: String(latestUrl || ""),
      isLoggedIn: true,
      matchedRule: null,
      status: LOGIN_CHECK_STATUS.CHECKED,
      evidence: pageState.evidence
    };
  }
  return {
    currentUrl: String(latestUrl || ""),
    isLoggedIn: false,
    matchedRule: null,
    status: LOGIN_CHECK_STATUS.ERROR,
    errorCode: "LOGIN_CHECK_UNCONFIRMED",
    errorMessage: "Meituan page state could not be confirmed.",
    evidence: pageState.evidence
  };
}

async function evaluateMeituanPageState(page, options = {}) {
  const text = await readPageText(page, options);
  const pageTitle = await safePageTitle(page);
  const currentUrl = String(options.currentUrl || safePageUrl(page) || "");
  const pageContent = `${pageTitle}\n${text}`;
  const fullContent = `${currentUrl}\n${pageContent}`;
  const loginMarkers = collectKeywords(fullContent, MEITUAN_LOGIN_TEXT_KEYWORDS);
  const backendTextMarkers = collectKeywords(pageContent, MEITUAN_BUSINESS_TEXT_KEYWORDS);
  const backendUrlMarkers = collectKeywords(currentUrl, ["merchant", "product", "batch-price", "/ebooking/"]);
  const explicitLoginUrl = isMeituanLoginUrl(currentUrl);
  const backendMarkerMatched = backendTextMarkers.length > 0
    || (!loginMarkers.length && (backendUrlMarkers.length > 0 || isMeituanBackendUrl(currentUrl)));
  const evidence = buildPageEvidence({
    currentUrl,
    pageTitle,
    matchedLoginMarkers: loginMarkers,
    matchedBackendMarkers: backendTextMarkers.concat(backendUrlMarkers),
    decision: ""
  });

  if ((explicitLoginUrl || loginMarkers.length > 0) && backendTextMarkers.length === 0) {
    const loginKeyword = explicitLoginUrl ? "/account/login" : loginMarkers[0];
    return {
      needLogin: true,
      loggedIn: false,
      matchedRule: buildPageTextMatchedRule("meituan", loginKeyword, "login"),
      backendMarkerMatched: false,
      evidence: {
        ...evidence,
        decision: explicitLoginUrl ? "login_url_marker" : "login_marker_without_backend"
      }
    };
  }

  if (backendMarkerMatched) {
    return {
      needLogin: false,
      loggedIn: true,
      matchedRule: null,
      backendMarkerMatched: true,
      evidence: {
        ...evidence,
        decision: "backend_marker_matched"
      }
    };
  }

  return {
    needLogin: null,
    loggedIn: false,
    matchedRule: null,
    backendMarkerMatched: false,
    evidence: {
      ...evidence,
      decision: "insufficient_evidence"
    }
  };
}

async function readPageText(page, options = {}) {
  if (!page) return "";
  const attempts = numberFrom(options.pageTextReadAttempts, 2);
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await readPageTextOnce(page, options);
    } catch (error) {
      lastError = error;
      if (!isTransientPageReadError(error) || index === attempts - 1) {
        throw error;
      }
      await waitForPageTextRetry(page, options);
    }
  }
  throw lastError;
}

async function readPageTextOnce(page, options = {}) {
  const runtime = options.runtime || {};
  const timeout = numberFrom(
    options.pageTextTimeoutMs !== undefined ? options.pageTextTimeoutMs : runtime.pageTextTimeoutMs,
    2000
  );

  if (typeof page.locator === "function") {
    const body = page.locator("body");
    if (body && typeof body.innerText === "function") {
      const text = String(await body.innerText({ timeout }) || "");
      if (text.trim()) return text;
    }
  }

  if (typeof page.evaluate === "function") {
    const text = String(await page.evaluate(() => {
      const body = document.body;
      if (body) return body.innerText || body.textContent || "";
      const root = document.documentElement;
      return root ? (root.innerText || root.textContent || "") : "";
    }) || "");
    if (text.trim()) return text;
  }

  if (typeof page.content === "function") {
    const text = String(await page.content() || "");
    if (text.trim()) return text;
  }

  if (typeof page.innerText === "function") {
    const text = String(await page.innerText("body", { timeout }) || "");
    if (text.trim()) return text;
  }
  if (typeof page.textContent === "function") {
    const text = String(await page.textContent("body", { timeout }) || "");
    if (text.trim()) return text;
  }
  return "";
}

async function waitForPageTextRetry(page, options = {}) {
  const runtime = options.runtime || {};
  if (page && typeof page.waitForLoadState === "function") {
    await page.waitForLoadState("domcontentloaded", {
      timeout: numberFrom(options.pageTextRetryTimeoutMs || runtime.pageTextRetryTimeoutMs, 2000)
    }).catch(() => {});
  }
  if (page && typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(numberFrom(options.pageTextRetryDelayMs || runtime.pageTextRetryDelayMs, 300));
  }
}

function matchLoginRule(currentUrl, loginRules) {
  const url = String(currentUrl || "");
  const comparableUrl = url.toLowerCase();
  const pathname = extractPathname(url).toLowerCase();
  const rules = Array.isArray(loginRules) ? loginRules : [];

  for (const rule of rules) {
    const keyword = String(rule && rule.keyword || "").toLowerCase();
    if (!keyword) continue;
    if (pathname.includes(keyword)) {
      return buildMatchedRule(rule, "path", pathname);
    }
    if (comparableUrl.includes(keyword)) {
      return buildMatchedRule(rule, "url", comparableUrl);
    }
  }
  return null;
}

async function createPageSession(options = {}) {
  if (typeof options.sessionFactory === "function") {
    return createSession(await options.sessionFactory(options));
  }

  if (options.page) {
    const context = safePageContext(options.page);
    return createSession({
      page: options.page,
      context,
      browser: safeContextBrowser(context),
      ownsPage: false,
      ownsContext: false,
      ownsBrowser: false,
      external: true,
      cleanup: async () => {}
    });
  }

  const runtime = options.runtime || {};
  if (options.context) {
    const page = await options.context.newPage();
    return createSession({
      page,
      context: options.context,
      browser: safeContextBrowser(options.context),
      ownsPage: false,
      ownsContext: false,
      ownsBrowser: false,
      external: true,
      cleanup: async () => {}
    });
  }

  if (options.browser) {
    const context = await options.browser.newContext(buildContextOptions(options));
    const page = await context.newPage();
    return createSession({
      page,
      context,
      browser: options.browser,
      ownsPage: false,
      ownsContext: false,
      ownsBrowser: false,
      external: true,
      cleanup: async () => {}
    });
  }

  const cdpUrl = pickString(options.cdpUrl, runtime.cdpUrl, runtime.cdpEndpoint);
  if (cdpUrl) {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const existingContext = browser.contexts()[0];
    const context = existingContext || await browser.newContext(buildContextOptions(options));
    const page = await context.newPage();
    return createSession({
      page,
      context,
      browser,
      ownsPage: true,
      ownsContext: !existingContext,
      ownsBrowser: false,
      connectedOverCdp: true,
      cleanup: async () => {
        await closeQuietly(page);
        if (!existingContext) await closeQuietly(context);
        if (typeof browser.disconnect === "function") browser.disconnect();
      }
    });
  }

  const userDataDir = pickString(
    options.userDataDir,
    options.profileDir,
    options.automationProfileDir,
    runtime.userDataDir,
    runtime.profileDir,
    runtime.automationProfileDir
  );
  const launchOptions = buildLaunchOptions(options);
  if (userDataDir) {
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      ...buildContextOptions(options, { includeStorageState: false })
    });
    const page = await context.newPage();
    return createSession({
      page,
      context,
      browser: safeContextBrowser(context),
      ownsPage: true,
      ownsContext: true,
      ownsBrowser: false,
      cleanup: async () => closeQuietly(context)
    });
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext(buildContextOptions(options));
  const page = await context.newPage();
  return createSession({
    page,
    context,
    browser,
    ownsPage: true,
    ownsContext: true,
    ownsBrowser: true,
    cleanup: async () => closeQuietly(browser)
  });
}

function createSession(session) {
  let cleanedUp = false;
  const cleanup = typeof session.cleanup === "function" ? session.cleanup : async () => {};
  return {
    page: session.page || null,
    context: session.context || null,
    browser: session.browser || null,
    ownsPage: Boolean(session.ownsPage),
    ownsContext: Boolean(session.ownsContext),
    ownsBrowser: Boolean(session.ownsBrowser),
    external: Boolean(session.external),
    connectedOverCdp: Boolean(session.connectedOverCdp),
    cleanup: async () => {
      if (cleanedUp) return;
      cleanedUp = true;
      await cleanup();
    }
  };
}

function buildLaunchOptions(options = {}) {
  const runtime = options.runtime || {};
  const browserChannel = pickString(
    options.browserChannel,
    runtime.browserChannel,
    DEFAULT_LOGIN_CHECK_OPTIONS.browserChannel
  );
  return {
    channel: browserChannel || undefined,
    headless: boolFrom(
      options.headless !== undefined ? options.headless : runtime.headless,
      DEFAULT_LOGIN_CHECK_OPTIONS.headless
    ),
    slowMo: numberFrom(options.slowMo !== undefined ? options.slowMo : runtime.slowMo, 0)
  };
}

function buildContextOptions(options = {}, buildOptions = {}) {
  const runtime = options.runtime || {};
  const storageState = pickString(options.storageStatePath, runtime.storageStatePath);
  const locale = pickString(options.locale, runtime.locale);
  const timezoneId = pickString(options.timezoneId, runtime.timezoneId);
  const contextOptions = {};
  if (buildOptions.includeStorageState !== false && storageState) {
    contextOptions.storageState = storageState;
  }
  if (locale) contextOptions.locale = locale;
  if (timezoneId) contextOptions.timezoneId = timezoneId;
  return contextOptions;
}

async function navigateToTarget(page, targetUrl, options = {}) {
  if (!page || typeof page.goto !== "function") {
    throw new Error("A Playwright page is required for OTA login check.");
  }
  if (!targetUrl) {
    throw new Error("targetUrl is required for OTA login check.");
  }

  const runtime = options.runtime || {};
  const timeoutMs = numberFrom(
    options.timeoutMs !== undefined ? options.timeoutMs : runtime.timeoutMs,
    DEFAULT_LOGIN_CHECK_OPTIONS.timeoutMs
  );
  const waitUntil = pickString(
    options.waitUntil,
    runtime.waitUntil,
    DEFAULT_LOGIN_CHECK_OPTIONS.waitUntil
  );

  await page.goto(targetUrl, { waitUntil, timeout: timeoutMs });

  if (options.waitForNetworkIdle && typeof page.waitForLoadState === "function") {
    await page.waitForLoadState("networkidle", {
      timeout: numberFrom(options.networkIdleTimeoutMs, 5000)
    }).catch(() => {});
  }

  const settleMs = numberFrom(
    options.settleMs !== undefined ? options.settleMs : runtime.settleMs,
    DEFAULT_LOGIN_CHECK_OPTIONS.settleMs
  );
  if (settleMs > 0 && typeof page.waitForTimeout === "function") {
    await page.waitForTimeout(settleMs);
  }
}

function buildSingleOtaOptions(options, ota) {
  const code = normalizeOtaCode(ota);
  const shared = { ...options };
  delete shared.platforms;
  delete shared.platformOptions;
  delete shared.perPlatform;
  delete shared.stopOnFirstFailure;
  delete shared.throwOnFailure;

  const platformOptions = {
    ...pickOptionsForPlatform(options.platformOptions, code),
    ...pickOptionsForPlatform(options.perPlatform, code)
  };
  const targetUrl = pickString(
    platformOptions.targetUrl,
    platformOptions.pageUrl,
    platformOptions.pricePageUrl,
    pickTargetUrlForPlatform(options.targetUrls, code)
  );
  const sharedRuntime = options.runtime || {};
  const platformRuntime = {
    ...((sharedRuntime.platforms && sharedRuntime.platforms[code]) || {}),
    ...(sharedRuntime[code] || {}),
    ...(platformOptions.runtime || {})
  };

  return {
    ...shared,
    ...platformOptions,
    ...(targetUrl ? { targetUrl } : {}),
    runtime: {
      ...sharedRuntime,
      ...platformRuntime
    }
  };
}

function buildPrecheckResult(results) {
  const needLoginResults = results.filter((item) => isLoginRequiredResult(item));
  const checkFailedResults = results.filter((item) => isLoginCheckFailedResult(item));
  const failedPlatforms = results.filter((item) => !isLoginCheckPassed(item));
  const resultsByPlatform = {};
  for (const item of results) {
    resultsByPlatform[item.platformCode] = item;
  }
  const ok = failedPlatforms.length === 0;
  const checkedAt = new Date().toISOString();
  return {
    ok,
    allLoggedIn: ok,
    needLoginPlatforms: needLoginResults.map((item) => item.platformCode),
    checkFailedPlatforms: checkFailedResults.map((item) => item.platformCode),
    failedCheckPlatforms: checkFailedResults.map((item) => item.platformCode),
    message: buildAggregateMessage(results, needLoginResults, checkFailedResults),
    checkedAt,
    results: resultsByPlatform,
    resultList: results,
    needLoginPlatformDetails: mapPlatformFailureDetails(needLoginResults),
    checkFailedPlatformDetails: mapPlatformFailureDetails(checkFailedResults),
    failedPlatforms: failedPlatforms.map((item) => ({
      ota: item.platformCode,
      otaName: item.platformName,
      platformCode: item.platformCode,
      platformName: item.platformName,
      targetUrl: item.targetUrl,
      currentUrl: item.currentUrl,
      matchedRule: item.matchedRule,
      matchedKeyword: item.matchedKeyword,
      evidence: item.evidence || null,
      checkedAt: item.checkedAt,
      status: item.status,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage
    }))
  };
}

function buildLoginResult(input) {
  const status = input.status || LOGIN_CHECK_STATUS.CHECKED;
  const loggedIn = Boolean(status === LOGIN_CHECK_STATUS.CHECKED && input.isLoggedIn);
  const platformCode = input.config.code;
  const platformName = input.config.name;
  const errorMessage = maskSensitiveText(input.errorMessage || "");
  const matchedRule = sanitizeMatchedRule(input.matchedRule);
  const checkFailed = status === LOGIN_CHECK_STATUS.ERROR;
  const needLogin = !checkFailed && !loggedIn && Boolean(matchedRule);
  const errorCode = checkFailed ? pickString(input.errorCode, "LOGIN_CHECK_FAILED") : null;
  const matchedKeyword = input.matchedRule && input.matchedRule.keyword
    ? String(input.matchedRule.keyword)
    : null;
  const checkedAt = new Date().toISOString();
  const evidence = normalizeEvidence(input.evidence, input.currentUrl);
  return {
    ok: loggedIn,
    ota: platformCode,
    otaName: platformName,
    platformCode,
    platformName,
    loggedIn,
    needLogin: checkFailed ? null : needLogin,
    message: buildPlatformMessage(platformName, loggedIn, status, errorMessage, errorCode),
    targetUrl: maskSensitiveUrl(input.targetUrl || input.config.pricePageUrl),
    currentUrl: maskSensitiveUrl(input.currentUrl || ""),
    matchedKeyword,
    isLoggedIn: loggedIn,
    matchedRule,
    status,
    errorCode,
    errorMessage,
    evidence,
    checkedAt
  };
}

function shouldKeepSessionAfterCheck(result, session, options = {}) {
  if (!session || !isLoginCheckPassed(result)) return false;
  const runtime = options.runtime || {};
  const closeAfterCheck = options.closeAfterCheck !== undefined
    ? options.closeAfterCheck
    : runtime.closeAfterCheck;
  if (boolFrom(closeAfterCheck, false)) return false;
  const returnReusableSessions = pickFirstDefined(
    options.returnReusableSessions,
    runtime.returnReusableSessions
  );
  if (boolFrom(returnReusableSessions, false) || getReusableSessionStore(options)) return true;
  const keepOpenOnSuccess = pickFirstDefined(
    options.keepOpenOnSuccess,
    runtime.keepOpenOnSuccess,
    options.keepLoggedInSessionOpen,
    runtime.keepLoggedInSessionOpen
  );
  return boolFrom(keepOpenOnSuccess, DEFAULT_LOGIN_CHECK_OPTIONS.keepLoggedInSessionOpen);
}

function attachReusableSession(result, session, options = {}) {
  if (!result || !session) return result;
  result.shouldKeepOpen = true;
  result.hasReusablePage = Boolean(session.page);
  result.hasReusableContext = Boolean(session.context);
  result.hasReusableBrowser = Boolean(session.browser);
  result.ownsPage = Boolean(session.ownsPage);
  result.ownsContext = Boolean(session.ownsContext);
  result.ownsBrowser = Boolean(session.ownsBrowser);

  defineHidden(result, "reusablePage", session.page || null);
  defineHidden(result, "reusableContext", session.context || null);
  defineHidden(result, "reusableBrowser", session.browser || null);
  defineHidden(result, "reusableSession", session);

  const handoff = getReusableSessionStore(options);
  if (handoff && result.platformCode) {
    handoff[result.platformCode] = {
      platformCode: result.platformCode,
      platformName: result.platformName,
      page: session.page || null,
      context: session.context || null,
      browser: session.browser || null,
      session,
      shouldKeepOpen: true,
      ownsPage: Boolean(session.ownsPage),
      ownsContext: Boolean(session.ownsContext),
      ownsBrowser: Boolean(session.ownsBrowser),
      external: Boolean(session.external),
      cleanup: session.cleanup
    };
  }
  return result;
}

function getReusableSessionStore(options = {}) {
  if (options.loginPrecheckRuntime && typeof options.loginPrecheckRuntime === "object") {
    return options.loginPrecheckRuntime;
  }
  if (options.reusableSessions && typeof options.reusableSessions === "object") {
    return options.reusableSessions;
  }
  const runtime = options.runtime || {};
  if (runtime.loginPrecheckRuntime && typeof runtime.loginPrecheckRuntime === "object") {
    return runtime.loginPrecheckRuntime;
  }
  if (runtime.reusableLoginSessions && typeof runtime.reusableLoginSessions === "object") {
    return runtime.reusableLoginSessions;
  }
  return null;
}

function normalizeOtaCode(value) {
  const raw = String(value && value.code ? value.code : value || "").trim().toLowerCase();
  const compact = raw.replace(/[^a-z0-9]/g, "");
  return OTA_ALIASES[raw] || OTA_ALIASES[compact] || raw;
}

function getOtaLoginConfig(value) {
  const code = normalizeOtaCode(value);
  const config = OTA_LOGIN_CONFIGS[code];
  if (!config) {
    throw new Error(`Unsupported OTA login check platform: ${String(value || "")}`);
  }
  return config;
}

function listOtaLoginConfigs() {
  return Object.keys(OTA_LOGIN_CONFIGS).map((code) => OTA_LOGIN_CONFIGS[code]);
}

function isSupportedOta(value) {
  return Boolean(OTA_LOGIN_CONFIGS[normalizeOtaCode(value)]);
}

function isLoginCheckPassed(result) {
  return Boolean(result && result.status === LOGIN_CHECK_STATUS.CHECKED && result.loggedIn);
}

function isLoginRequiredResult(result) {
  return Boolean(
    result
    && result.status === LOGIN_CHECK_STATUS.CHECKED
    && result.loggedIn === false
    && result.needLogin === true
    && result.matchedRule
  );
}

function isLoginCheckFailedResult(result) {
  return Boolean(result && result.status === LOGIN_CHECK_STATUS.ERROR);
}

function buildOtaLoginPrecheckMessage(precheckResult) {
  const failed = Array.isArray(precheckResult && precheckResult.failedPlatforms)
    ? precheckResult.failedPlatforms
    : [];
  if (!failed.length) return "OTA login precheck failed.";
  const names = failed
    .map((item) => item.platformName || item.otaName || item.platformCode || item.ota || "")
    .filter(Boolean)
    .join(", ");
  return `${names || "OTA"} not logged in. Please log in before running OTA automation.`;
}

function isOtaLoginPrecheckError(error) {
  return Boolean(error && error.code === "OTA_LOGIN_GATE_FAILED");
}

function buildAggregateMessage(results, needLoginResults, checkFailedResults) {
  if (!needLoginResults.length && !checkFailedResults.length) {
    const names = results.map((item) => item.platformName).filter(Boolean).join(", ");
    return `${names} logged in.`;
  }
  const parts = [];
  if (needLoginResults.length) {
    parts.push(`${needLoginResults.map((item) => item.platformName).join(", ")} not logged in.`);
  }
  if (checkFailedResults.length) {
    parts.push(`${checkFailedResults.map((item) => item.platformName).join(", ")} login check failed.`);
  }
  return parts.join(" ");
}

function buildPlatformMessage(platformName, loggedIn, status, errorMessage, errorCode) {
  if (loggedIn) return `${platformName} logged in.`;
  if (status === LOGIN_CHECK_STATUS.ERROR && errorCode === "LOGIN_CHECK_UNCONFIRMED") {
    return `${platformName} login status could not be confirmed.`;
  }
  if (status === LOGIN_CHECK_STATUS.ERROR && errorMessage) {
    return `${platformName} login check failed. Please verify browser session and retry.`;
  }
  return `${platformName} not logged in. Please log in before running OTA automation.`;
}

function loginRule(id, keyword, description) {
  return Object.freeze({
    id,
    scope: "path_or_url",
    keyword,
    description
  });
}

function buildMatchedRule(rule, matchedIn, matchedValue) {
  return {
    id: String(rule.id || ""),
    scope: String(rule.scope || "path_or_url"),
    keyword: String(rule.keyword || ""),
    description: String(rule.description || ""),
    matchedIn,
    matchedValue: matchedIn === "url" ? maskSensitiveUrl(matchedValue) : matchedValue
  };
}

function buildPageTextMatchedRule(platformCode, keyword, kind) {
  return {
    id: `${platformCode}_page_text_contains_${kind}`,
    scope: "page_text",
    keyword,
    description: `${platformCode} page text contains ${kind} indicator.`,
    matchedIn: "page_text",
    matchedValue: keyword
  };
}

function buildPageEvidence(input = {}) {
  return {
    currentUrl: String(input.currentUrl || ""),
    pageTitle: String(input.pageTitle || ""),
    matchedLoginMarkers: Array.isArray(input.matchedLoginMarkers) ? input.matchedLoginMarkers : [],
    matchedBackendMarkers: Array.isArray(input.matchedBackendMarkers) ? input.matchedBackendMarkers : [],
    decision: String(input.decision || "")
  };
}

function normalizeEvidence(evidence, currentUrl) {
  if (!evidence || typeof evidence !== "object") return null;
  return {
    ...evidence,
    currentUrl: maskSensitiveUrl(evidence.currentUrl || currentUrl || ""),
    pageTitle: String(evidence.pageTitle || ""),
    matchedLoginMarkers: Array.isArray(evidence.matchedLoginMarkers) ? evidence.matchedLoginMarkers : [],
    matchedBackendMarkers: Array.isArray(evidence.matchedBackendMarkers) ? evidence.matchedBackendMarkers : [],
    decision: String(evidence.decision || "")
  };
}

function mapPlatformFailureDetails(items) {
  return items.map((item) => ({
    ota: item.platformCode,
    otaName: item.platformName,
    platformCode: item.platformCode,
    platformName: item.platformName,
    targetUrl: item.targetUrl,
    currentUrl: item.currentUrl,
    matchedRule: item.matchedRule,
    matchedKeyword: item.matchedKeyword,
    evidence: item.evidence || null,
    checkedAt: item.checkedAt,
    status: item.status,
    errorCode: item.errorCode,
    errorMessage: item.errorMessage
  }));
}

function normalizePlatformList(platforms) {
  const list = Array.isArray(platforms) && platforms.length
    ? platforms
    : DEFAULT_LOGIN_CHECK_PLATFORMS;
  return Array.from(new Set(list.map(normalizeOtaCode).filter(Boolean)));
}

function pickOptionsForPlatform(map, code) {
  if (!map || typeof map !== "object") return {};
  for (const [key, value] of Object.entries(map)) {
    if (normalizeOtaCode(key) === code && value && typeof value === "object") {
      return value;
    }
  }
  return {};
}

function pickTargetUrlForPlatform(targetUrls, code) {
  if (!targetUrls || typeof targetUrls !== "object") return "";
  for (const [key, value] of Object.entries(targetUrls)) {
    if (normalizeOtaCode(key) === code) {
      return pickString(value, "");
    }
  }
  return "";
}

function collectKeywords(text, keywords) {
  const content = String(text || "");
  const contentLower = content.toLowerCase();
  const found = [];
  for (const keyword of keywords) {
    const value = String(keyword || "").trim();
    if (!value) continue;
    const matched = /[A-Z]/i.test(value)
      ? contentLower.includes(value.toLowerCase())
      : content.includes(value);
    if (matched && !found.includes(value)) found.push(value);
  }
  return found;
}

function isMeituanLoginUrl(currentUrl) {
  const url = String(currentUrl || "").toLowerCase();
  if (!url) return false;
  return url.includes("/account/login")
    || url.includes("passport")
    || /(^|[/?#&=])login([/?#&=]|$)/i.test(url);
}

function isMeituanBackendUrl(currentUrl) {
  const url = String(currentUrl || "").toLowerCase();
  return Boolean(
    url
    && url.includes("me.meituan.com")
    && (
      url.includes("/ebooking/")
      || url.includes("merchant")
      || url.includes("product")
      || url.includes("batch-price")
    )
  );
}

function isTransientPageReadError(error) {
  const message = String(error && error.message ? error.message : error || "");
  return /execution context was destroyed/i.test(message)
    || /most likely because of a navigation/i.test(message)
    || /navigation/i.test(message);
}

function extractPathname(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).pathname || "";
  } catch (_) {
    return "";
  }
}

function safePageUrl(page) {
  try {
    return page && typeof page.url === "function" ? String(page.url() || "") : "";
  } catch (_) {
    return "";
  }
}

async function safePageTitle(page) {
  try {
    return page && typeof page.title === "function" ? String(await page.title() || "") : "";
  } catch (_) {
    return "";
  }
}

function safePageContext(page) {
  try {
    return page && typeof page.context === "function" ? page.context() : null;
  } catch (_) {
    return null;
  }
}

function safeContextBrowser(context) {
  try {
    return context && typeof context.browser === "function" ? context.browser() : null;
  } catch (_) {
    return null;
  }
}

function sanitizeMatchedRule(rule) {
  if (!rule) return null;
  return {
    ...rule,
    matchedValue: rule.matchedIn === "url" ? maskSensitiveUrl(rule.matchedValue) : rule.matchedValue
  };
}

function maskSensitiveText(text) {
  const value = String(text || "");
  if (!value) return "";
  return value.replace(/https?:\/\/[^\s"'<>]+/g, (url) => maskSensitiveUrl(url));
}

function maskSensitiveUrl(rawUrl) {
  const value = String(rawUrl || "");
  if (!value) return "";
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveQueryKey(key)) {
        url.searchParams.set(key, "***MASKED***");
      }
    }
    return url.toString();
  } catch (_) {
    return value.replace(/([?&][^=&]*(?:token|session|auth|code|ses|op_token)[^=&]*=)[^&\s"'<>]+/gi, "$1***MASKED***");
  }
}

function isSensitiveQueryKey(key) {
  const normalized = String(key || "").toLowerCase();
  return normalized === "ses"
    || normalized === "code"
    || normalized.includes("token")
    || normalized.includes("session")
    || normalized.includes("auth");
}

async function closeQuietly(resource) {
  try {
    if (resource && typeof resource.close === "function") {
      await resource.close();
    }
  } catch (_) {
  }
}

function defineHidden(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    configurable: true
  });
}

function pickString() {
  for (let i = 0; i < arguments.length; i += 1) {
    const text = String(arguments[i] || "").trim();
    if (text) return text;
  }
  return "";
}

function pickFirstDefined() {
  for (let i = 0; i < arguments.length; i += 1) {
    if (arguments[i] !== undefined) return arguments[i];
  }
  return undefined;
}

function numberFrom(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolFrom(value, fallback) {
  if (value === undefined || value === null || value === "") return Boolean(fallback);
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return Boolean(fallback);
}

module.exports = {
  OTA_CODES,
  LOGIN_CHECK_STATUS,
  DEFAULT_LOGIN_CHECK_OPTIONS,
  DEFAULT_LOGIN_CHECK_PLATFORMS,
  OTA_ALIASES,
  OTA_LOGIN_CONFIGS,
  OtaLoginPrecheckError,
  assertAllOtaLoggedIn,
  buildOtaLoginPrecheckMessage,
  checkAllOtaLogins,
  checkOtaLogins,
  checkOtaLogin,
  evaluateLoginState,
  evaluateLoginStateFromUrl,
  evaluateMeituanPageState,
  getOtaLoginConfig,
  isLoginCheckPassed,
  isOtaLoginPrecheckError,
  isSupportedOta,
  listOtaLoginConfigs,
  matchLoginRule,
  normalizeOtaCode,
  precheckOtaLoginBeforeAdjust
};
