console.log("EXTENSION LOADED", {
    href: location.href,
    top: window === top,
    jobCards: document.querySelectorAll("[data-job-id]").length
});

// =====================
// GLOBAL STATE
// =====================

const jobResults = new Map();

let observer = null;
let observerStarted = false;

let scanGeneration = 0;
let currentContextKey = "";
let lastUrl = location.href;

let queue = [];
let queuedJobIds = new Set();
let isWorkerRunning = false;

let inflightControllers = new Map();

let enqueueTimer = null;
let cooldownUntil = 0;

//=====================
// MATCHER
//=====================

const strongPositivePatterns = [
    {
        label: "must be a us citizen",
        regex: /\bmust be (a )?u\.?s\.?\s+citizen\b/i
    },
    {
        label: "citizenship required",
        regex: /\bcitizenship required\b/i
    },
    {
        label: "us citizenship required",
        regex: /\bu\.?s\.?\s+citizenship required\b/i
    },
    {
        label: "only us persons",
        regex: /\bonly u\.?s\.?\s+person(s)?\b/i
    },
    {
        label: "only us citizens",
        regex: /\bonly u\.?s\.?\s+citizen(s)?\b/i
    },
    {
        label: "no sponsorship",
        regex: /\b(no|without)\s+sponsorship\b/i
    },
    {
        label: "will not sponsor",
        regex: /\b(will not|won't|cannot|unable to|do not)\s+sponsor\b/i
    },
    {
        label: "sponsorship not available",
        regex: /\bsponsorship\b[\s\S]{0,60}\b(not available|not provided|unavailable|cannot be provided|will not be provided)\b/i
    },
    {
        label: "not eligible for employment",
        regex: /\bnot eligible for (hire|employment|this role|this position)\b/i
    },
    {
        label: "temporary visa holders not eligible",
        regex: /\b(f-1|opt|cpt|h-1b?|h-2|l-1|j-1|tn)\b[\s\S]{0,100}\b(not eligible|ineligible|cannot be considered|will not be considered|not accepted|restricted)\b/i
    },
    {
        label: "citizens or permanent residents only",
        regex: /\b(u\.?s\.?\s+citizen(s)?|citizen(s)?)\b[\s\S]{0,50}\b(permanent resident(s)?|green card holder(s)?|lawful permanent resident(s)?)\b[\s\S]{0,30}\b(only|required)\b/i
    },
    {
        label: "active security clearance required",
        regex: /\b(active\s+)?(secret|top\s+secret|ts\s*\/\s*sci)?\s*(security\s+)?clearance\b[\s\S]{0,25}\b(required|must have)\b/i
    },
    {
        label: "must be a us person",
        regex: /\bmust be (a )?u\.?s\.?\s+person\b/i
    },
    {
        label: "export control us person required",
        regex: /\bdue to (export control|it ar|itar|ear)\b[\s\S]{0,120}\b(u\.?s\.?\s+person|u\.?s\.?\s+citizen|permanent resident)\b[\s\S]{0,40}\b(required|only|must be)\b/i
    }
];

const weakIndicatorPatterns = [
    {
        label: "us person",
        regex: /\bu\.?s\.?\s+person(s)?\b/i
    },
    {
        label: "security clearance",
        regex: /\b(active\s+)?(secret|top\s+secret|ts\s*\/\s*sci)?\s*(security\s+)?clearance\b/i
    },
    {
        label: "permanent resident",
        regex: /\b(permanent resident|lawful permanent resident|green card holder)\b/i
    },
    {
        label: "nationality",
        regex: /\bnationality\b/i
    },
    {
        label: "citizenship status",
        regex: /\bcitizenship status\b/i
    },
    {
        label: "export control",
        regex: /\b(export control|itar|ear)\b/i
    }
];

const negativeContextPatterns = [
    /\bdefinition of u\.?s\.?\s+person\b/i,
    /\bwhat is a u\.?s\.?\s+person\b/i,
    /\bu\.?s\.?\s+person means\b/i,
    /\bunder u\.?s\.?\s+export control laws\b/i,
    /\bself[- ]?identify\b/i,
    /\bvoluntary self[- ]?identification\b/i,
    /\bcitizenship question\b/i,
    /\bnationality question\b/i,
    /\ball qualified applicants\b/i,
    /\bequal opportunity employer\b/i,
    /\bregardless of (race|color|religion|sex|national origin|citizenship)\b/i,
    /\bsecurity clearance preferred\b/i,
    /\bability to obtain\b/i,
    /\bmay require\b/i,
    /\bmay be required\b/i,
    /\bif required by law\b/i
];

const requirementWordsRegex =
    /\b(required|must|only|eligible|must have|need to|necessary|cannot|not eligible|required for this role|required for the position)\b/i;

// making any sort of space into whitespace for better readibility
function normalizeWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
}

function splitIntoSentences(text) {
    return normalizeWhitespace(text)
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function getTextFromDoc(doc) {
    return normalizeWhitespace(doc.body?.textContent || "");
}

function getVisibleCardText(jobCard) {
    return normalizeWhitespace(jobCard.textContent || "");
}

function findStrongMatchInText(text) {
    for (const pattern of strongPositivePatterns) {
        const match = text.match(pattern.regex);
        if (match) {
            return {
                confidence: "high",
                label: pattern.label,
                phrase: normalizeWhitespace(match[0])
            };
        }
    }
    return null;
}

function findRestriction(text) {
    if (!text) return null;

    const normalized = normalizeWhitespace(text);
    const sentences = splitIntoSentences(normalized);

    for (const sentence of sentences) {
        if (negativeContextPatterns.some((r) => r.test(sentence))) {
            continue;
        }

        const strong = findStrongMatchInText(sentence);
        if (strong) {
            return strong;
        }
    }

    for (const sentence of sentences) {
        if (negativeContextPatterns.some((r) => r.test(sentence))) {
            continue;
        }

        const weak = weakIndicatorPatterns.find((p) => p.regex.test(sentence));
        if (!weak) continue;

        if (requirementWordsRegex.test(sentence)) {
            const weakMatch = sentence.match(weak.regex);
            return {
                confidence: "medium",
                label: weak.label,
                phrase: weakMatch ? normalizeWhitespace(weakMatch[0]) : normalizeWhitespace(sentence)
            };
        }
    }

    return null;
}

//=====================
// DOM / PAGE CONTEXT
//=====================

function isJobsPage() {
    return location.pathname.startsWith("/jobs");
}

function hasJobCards() {
    return document.querySelector("[data-job-id]") != null;
}

function isRelevantJobsContext() {
    return isJobsPage() || hasJobCards();
}

function getJobCards() {
    return Array.from(document.querySelectorAll('[data-job-id]'));
}

function markJobCard(jobId, source, phrase) {
    const job = document.querySelector(`[data-job-id="${jobId}"]`);
    if (!job) return;

    if (job.querySelector('.citizenship-alert-badge')) return;

    const badge = document.createElement('span');
    badge.textContent = '⚠️';
    badge.className = 'citizenship-alert-badge';
    badge.style.marginLeft = '8px';
    badge.style.fontSize = '18px';
    badge.style.cursor = 'help';
    badge.style.verticalAlign = 'middle';
    badge.style.color = source === "linkedin" ? "#ff9800" : "#2196f3";
    badge.title = 
        source === "linkedin"
            ? `LinkedIn match: ${phrase}`
            : `Company site match: ${phrase}`;

    const target = job.querySelector('.artdeco-entity-lockup__title, .job-card-list__title, a');

    if (target) {
        target.appendChild(badge);
    } else {
        job.prepend(badge);
    }
}

function reapplyBadgeFromCache(jobId) {
    const cached = jobResults.get(jobId);
    if (!cached || !cached.matched) return;

    markJobCard(jobId, cached.source, cached.phrase);
}

function removeAllBadges() {
    document.querySelectorAll(".citizenship-alert-badge").forEach((el) => el.remove());
}

function getSearchParamValue(name) {
    try {
        const url = new URL(location.href);
        return url.searchParams.get(name) || "";
    } catch {
        return "";
    }
}

function getJobsContextKey() {
    if (!isRelevantJobsContext()) return "NON_JOBS";

    const pathname = location.pathname;
    const keywords = getSearchParamValue("keywords");
    const locationParam = getSearchParamValue("location");
    const currentJobId = getSearchParamValue("currentJobId");
    const fAL = getSearchParamValue("f_AL");
    const f_E = getSearchParamValue("f_E");
    const f_JT = getSearchParamValue("f_JT");
    const f_WT = getSearchParamValue("f_WT");
    const f_TPR = getSearchParamValue("f_TPR");
    const sortBy = getSearchParamValue("sortBy");
    const start = getSearchParamValue("start");

    return JSON.stringify({
        pathname,
        keywords,
        locationParam,
        currentJobId,
        fAL,
        fE: f_E,
        fJT: f_JT,
        fWT: f_WT,
        fTPR: f_TPR,
        sortBy,
        start
    });
}

// =====================
// QUEUE / CANCELLATION
// =====================

function isStale(generation) {
    return generation !== scanGeneration;
}

function abortAllInflight() {
    for (const controller of inflightControllers.values()) {
        try {
            controller.abort();
        } catch {}
    }
    inflightControllers.clear();
}

function resetScannerForNewContext() {
    scanGeneration++;
    queue = [];
    queuedJobIds.clear();
    isWorkerRunning = false;
    abortAllInflight();

    console.log("Scanner reset for new context", {
        scanGeneration,
        href: location.href
    });
}

function handlePossibleContextChange() {
    const nextContextKey = getJobsContextKey();
    if (nextContextKey === currentContextKey) return;

    const prevParsed = currentContextKey === "NON_JOBS"? null : JSON.parse(currentContextKey);
    const nextParsed = nextContextKey === "NON_JOBS" ? null : JSON.parse(nextContextKey);

    const keysToCompare = ["pathname", "keywords", "locationParam", "fAL", "fE", "fJT", "fWT", "fTPR", "sortBy", "start"];

    const onlyJobIdChanged =
        prevParsed && nextParsed && keysToCompare.every((k) => prevParsed[k] === nextParsed[k]);

    currentContextKey = nextContextKey;

    if (!onlyJobIdChanged) {
        resetScannerForNewContext();
    }

    if (isRelevantJobsContext()) {
        scheduleEnqueueAndWork();
    }
}

function enqueueVisibleJobs() {
    if (!isRelevantJobsContext()) return;

    const jobs = getJobCards();

    for (const job of jobs) {
        const jobId = job.getAttribute("data-job-id");
        if (!jobId) continue;

        if (jobResults.has(jobId)) {
            reapplyBadgeFromCache(jobId);
            continue;
        }

        if (queuedJobIds.has(jobId)) continue;

        queuedJobIds.add(jobId);
        queue.push(jobId);
    }

    console.log("Queue status", {
        generation: scanGeneration,
        queued: queue.length,
        visibleCards: jobs.length
    });
}

function scheduleEnqueueAndWork() {
    clearTimeout(enqueueTimer);
    
    enqueueTimer = setTimeout(() => {
        if (!isRelevantJobsContext()) return;
        enqueueVisibleJobs();
        startWorker(scanGeneration).catch(console.error);
    }, 250);
}

// =====================
// FETCH HELPERS
// =====================

function parseHtml(html) {
    const parser = new DOMParser();
    return parser.parseFromString(html, "text/html");
}

function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2]: null;
}

function getCsrfToken() {
    const jsessionId = getCookie("JSESSIONID");
    if (!jsessionId) return null;

    return jsessionId.replace(/^"|"$/g, "");
}

function createAbortController(key) {
    const controller = new AbortController();
    inflightControllers.set(key, controller);
    return controller;
}

function cleanupAbortController(key) {
    inflightControllers.delete(key);
}

async function fetchWithAbort(url, options = {}, controllerKey) {
    const controller = createAbortController(controllerKey);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return response;
    } finally {
        cleanupAbortController(controllerKey);
    }
}

async function fetchVoyagerJobPosting(jobId, generation) {
    if (isStale(generation)) throw new Error("Stale generation before Voyager fetch");

    const csrfToken = getCsrfToken();

    const url =
        `https://www.linkedin.com/voyager/api/graphql?` +
        `variables=(jobPostingUrn:urn%3Ali%3Afsd_jobPosting%3A${jobId})` +
        `&queryId=voyagerJobsDashJobPostings.891aed7916d7453a37e4bbf5f1f60de4`;

    let response;
    try {
        response = await fetchWithAbort(
            url,
            { 
                credentials: "include",
                headers: {
                    "csrf-token": csrfToken,
                    "x-restli-protocol-version": "2.0.0"
                }
            },
            `voyager:${generation}:${jobId}`
        );
    } catch (err) {
        if (String(err).includes("AbortError")) {
            throw err;
        }
        throw new Error(`Voyager fetch threw before response for job ${jobId}: ${err}`);
    }

    if (response.status === 429) {
        throw new Error("HTTP 429 from Voyager API");
    }

    const text = await response.text();

    if (!response.ok) {
        console.log("Voyager status:", response.status);
        console.log("Voyager response:", text.slice(0, 500));
        throw new Error(`Voyager fetch failed with status ${response.status}`);
    }

    const data = JSON.parse(text);
    return extractVoyagerJobData(data);
}

function extractVoyagerJobData(response) {
    const data = response?.data || [];
    const jobPosting = data?.jobsDashJobPostingsById || [];

    let description = null;
    let companyApplyUrl = null;
    let jobTitle = null;

    if (jobPosting) {
        description = jobPosting?.description?.text || null;
        companyApplyUrl = jobPosting?.companyApplyUrl || null;
        jobTitle = jobPosting?.title || null;
    }

    console.log(`desc and applyurl for ${jobTitle}`, description, companyApplyUrl, response);

    return {
        description,
        companyApplyUrl,
        jobTitle,
        isExternal: companyApplyUrl
            ? !companyApplyUrl.includes("linkedin.com/job-apply")
            : false
    };
}

function fetchExternalPageViaBackground(url) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            {
                type: "FETCH_EXTERNAL_PAGE",
                url
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                if (!response) {
                    reject(new Error("No response from background fetch"));
                    return;
                }

                if (response.status === 429) {
                    reject(new Error(`HTTP 429 from external page: ${url}`));
                    return;
                }

                if (!response.ok) {
                    reject(new Error(response.error || `Fetch failed with status ${response.status}`));
                    return;
                }

                resolve(response.html);
            }
        );
    });
}

// remove a trailing slash
function normalizeUrlForComparison(url) {
    try {
        const u = new URL(url);
        u.hash = "";
        return u.toString().replace(/\/$/, "");
    } catch {
        return url.replace(/\/$/, "");
    }
}

function getAshbyRelatedUrls(url) {
    const urls = [];
    const normalized = normalizeUrlForComparison(url);

    urls.push(normalized);

    try {
        const parsed = new URL(normalized);
        const hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname.replace(/\/+$/, "");

        const isAshby = 
            hostname === "jobs.ashbyhq.com" ||
            hostname.endsWith(".ashbyhq.com");

        if (!isAshby) {
            return [...new Set(urls)];
        }

        if (pathname.toLowerCase().endsWith("/application")) {
            const basePath = pathname.slice(0, -"/application".length);
            urls.push(`${parsed.origin}${basePath}`);
        } 
    } catch {}

    return [...new Set(urls)];
}
function isLikelyWorthExternalCheck(applyInfo) {
    if (!applyInfo?.url || !applyInfo.isExternal) return false;

    try {
        const host = new URL(applyInfo.url).hostname.toLowerCase();

        return [
            "ashbyhq.com",
            "greenhouse.io",
            "lever.co",
            "workday.com",
            "myworkdayjobs.com"
        ].some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
        return true;
    }
}

async function checkExternalApplyPage(applyUrl, generation) {
    const candidateUrls = getAshbyRelatedUrls(applyUrl);

    for (const url of candidateUrls) {
        if (isStale(generation)) return null;

        try {
            const html = await fetchExternalPageViaBackground(url);

            if (isStale(generation)) return null;
        
            console.log("Company Job Board:", url, html);

            const doc = parseHtml(html);
            const main = doc.querySelector('main');
            const text = normalizeWhitespace(main?.textContent || doc.body?.textContent || "");
        
            const match = findRestriction(text);
        
            if (match) {
                return {
                    source: "external",
                    phrase: match.phrase,
                    label: match.label,
                    url
                };
            }
        } catch (err) {
            console.log(`External page check failed for ${url}:`, err);
        }
    }
    return null;
}

// =====================
// RATE LIMIT / UTILS
// =====================

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min = 120, max = 240) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isRateLimitError(err) {
    return String(err).includes("429");
}

async function handleRateLimit(err) {
    if (!isRateLimitError(err)) return;

    const cooldownMs = 4000;
    cooldownUntil = Date.now() + cooldownMs;

    console.log(`Rate limited. Cooling down for ${cooldownMs}ms`);
    await sleep(cooldownMs);
}

// =====================
// JOB CHECKING
// =====================

// Workflow:
// 1. Check visible card text first (cheap)
// 2. Check LinkedIn page text (more complete)
// 3. Only then ask Voyager for external apply URL
// 4. Only fetch external page if the ATS/domain is worth checking

async function checkJob(jobId, generation) {
    if (isStale(generation)) return { stale: true };

    const card = document.querySelector(`[data-job-id="${jobId}"]`);
    if (card) {
        const cardText = getVisibleCardText(card);
        const cardMatch = findRestriction(cardText);

        if (cardMatch && cardMatch.confidence === "high") {
            return {
                matched: true,
                source: "linkedin",
                phrase: cardMatch.phrase,
                label: cardMatch.label,
                url: `https://www.linkedin.com/jobs/search/?currentJobId=${jobId}`
            };
        }
    }

    let voyagerData;
    try {
        voyagerData = await fetchVoyagerJobPosting(jobId, generation);
    } catch (err) {
        console.log(`Voyager fetch failed for ${jobId}:`, err);

        if (isRateLimitError(err)) {
            throw err;
        }

        return { matched: false };
    }

    if (isStale(generation)) return { stale: true };

    if (voyagerData?.description) {
        const linkedinMatch = findRestriction(voyagerData.description);

        if (linkedinMatch) {
            return {
                matched: true,
                source: "linkedin",
                phrase: linkedinMatch.phrase,
                label: linkedinMatch.label,
                url: `https://www.linkedin.com/jobs/search/?currentJobId=${jobId}`
            };
        }
    }

    if (
        !voyagerData ||
        !voyagerData.companyApplyUrl ||
        !voyagerData.isExternal ||
        !isLikelyWorthExternalCheck({ url: voyagerData.companyApplyUrl, isExternal: true })
    ) {
        return { matched: false };
    }

    const externalMatch = await checkExternalApplyPage(
        voyagerData.companyApplyUrl,
        generation
    );

    if (isStale(generation)) return { stale: true };

    if (externalMatch) {
        return {
            matched: true,
            source: externalMatch.source,
            phrase: externalMatch.phrase,
            label: externalMatch.label,
            url: externalMatch.url
        };
    }

    return { matched: false };
}

// =====================
// WORKER
// =====================

async function startWorker(generation) {
    if (isWorkerRunning) return;
    isWorkerRunning = true;

    let isFirstJob = true;

    try {
        while (queue.length > 0) {
            if (isStale(generation)) {
                console.log("Worker stopping because generation is stale");
                return;
            }

            if (Date.now() < cooldownUntil) {
                await sleep(cooldownUntil - Date.now());
                if (isStale(generation)) return;
            }

            const jobId = queue.shift();
            queuedJobIds.delete(jobId);

            if (!jobId) continue;
            if (jobResults.has(jobId)) {
                reapplyBadgeFromCache(jobId);
                continue;
            }

            console.log(`Checking job ${jobId}`, { generation });

            try {
                const result = await checkJob(jobId, generation);

                if (result?.stale || isStale(generation)) {
                    console.log(`Ignoring stale result for ${jobId}`);
                    return;
                }

                jobResults.set(jobId, result);

                if (result.matched) {
                    console.log("Restriction FOUND", {
                        jobId,
                        source: result.source,
                        label: result.label,
                        phrase: result.phrase,
                        url: result.url
                    });

                    markJobCard(jobId, result.source, result.phrase);
                } else {
                    console.log(`No restriction detected for ${jobId}`);
                }
            } catch (err) {
                if (String(err).includes("AbortError")) {
                    console.log(`Aborted job ${jobId}`);
                    return;
                }

                console.error(`Failed to check job ${jobId}:`, err);
                await handleRateLimit(err);

                if (!isStale(generation)) {
                    jobResults.set(jobId, { matched: false, error: String(err) });
                }
            }

            if (isFirstJob) {
                isFirstJob = false;
            } else {
                await sleep(randomDelay(120, 240));
            }
        }
    } finally {
        isWorkerRunning = false;

        if (!isStale(generation) && queue.length > 0) {
            startWorker(generation).catch(console.error);
        }
    }
}

// =====================
// OBSERVER / NAVIGATION
// =====================

function startObserver() {
    if (observerStarted || !document.body) return;

    observer = new MutationObserver(() => {
        if (!isRelevantJobsContext()) return;

        scheduleEnqueueAndWork();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    observerStarted = true;
}

function installNavigationHooks() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        setTimeout(() => {
            lastUrl = location.href;
            handlePossibleContextChange();
        }, 0);
        return result;
    };

    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        setTimeout(() => {
            lastUrl = location.href;
            handlePossibleContextChange();
        }, 0);
        return result;
    };

    window.addEventListener("popstate", () => {
        setTimeout(() => {
            lastUrl = location.href;
            handlePossibleContextChange();
        }, 0);
    });

    setInterval(() => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        handlePossibleContextChange();
    }, 1000);
}

// =====================
// BOOTSTRAP
// =====================

async function bootstrap() {
    startObserver();
    installNavigationHooks();

    currentContextKey = getJobsContextKey();

    if (isRelevantJobsContext()) {
        scheduleEnqueueAndWork();
    }
}

bootstrap().catch(console.error);