console.log("EXTENSION LOADED", {
    href: location.href,
    top: window === top,
    jobCards: document.querySelectorAll("[data-job-id]").length
});

const jobResults = new Map();

let isProcessing = false;
let shouldProcessAgain = false;
let cooldownUntil = 0;

let observer = null;
let observerStarted = false;
let jobsModeActive = false;
let lastUrl = location.href;

//=====================
// MATCHER
//=====================

const restrictionPatterns = [
    {
        label: "us citizen",
        displayPhrase: "U.S. citizen",
        regex: /\bu\.?s\.?\s+citizen(s)?\b/i
    },
    {
        label: "citizenship required",
        displayPhrase: "citizenship required",
        regex: /\bcitizenship required\b/i
    },
    {
        label: "must be a us citizen",
        displayPhrase: "must be a U.S. citizen",
        regex: /\bmust be a u\.?s\.?\s+citizen\b/i
    },
    {
        label: "us citizen or permanent resident",
        displayPhrase: "U.S. citizen or permanent resident",
        regex: /\bu\.?s\.?\s+citizen\b[\s\S]{0,50}\b(permanent resident|green card holder)\b/i
    },
    {
        label: "permanent resident",
        displayPhrase: "permanent resident / green card holder",
        regex: /\b(permanent resident|lawful permanent resident|green card holder)\b/i
    },

    {
        label: "no sponsorship",
        displayPhrase: "no sponsorship",
        regex: /\b(no|without)\s+sponsorship\b/i
    },
    {
        label: "will not sponsor",
        displayPhrase: "will not sponsor",
        regex: /\b(will not|won't|cannot|unable to|do not)\s+sponsor\b/i
    },
    {
        label: "sponsorship not provided",
        displayPhrase: "sponsorship will not be provided",
        regex: /\bsponsorship\b[\s\S]{0,80}\b(not|no|without)\b[\s\S]{0,40}\b(provided|available)\b/i
    },
    {
        label: "not eligible for hire",
        displayPhrase: "not eligible for hire",
        regex: /\bnot eligible for (hire|employment)\b/i
    },
    {
        label: "temporary visa restriction",
        displayPhrase: "temporary visa holders not eligible",
        regex: /\b(f-1|opt|cpt|h-1b?|h-2|l-1|j-1|tn)\b[\s\S]{0,120}\b(not eligible|ineligible|cannot|restricted|not be considered)\b/i
    },

    {
        label: "us person",
        displayPhrase: "U.S. person",
        regex: /\bu\.?s\.?\s+person(s)?\b/i
    },
    {
        label: "only us persons",
        displayPhrase: "only U.S. persons",
        regex: /\bonly u\.?s\.?\s+person(s)?\b/i
    },
    {
        label: "security clearance",
        displayPhrase: "security clearance",
        regex: /\b(active\s+)?(secret|top\s+secret|ts\s*\/\s*sci)?\s*(security\s+)?clearance\b/i
    },
    {
        label: "security clearance required",
        displayPhrase: "security clearance required",
        regex: /\bsecurity clearance required\b/i
    },
    {
        label: "active security clearance",
        displayPhrase: "active security clearance",
        regex: /\bactive\s+(secret\s+|top\s+secret\s+)?(security\s+)?clearance\b/i
    },
];

// making text more readable
function normalizeMatchedText(text) {
    return text.replace(/\s+/g, " ").trim();
}

function findRestriction(text) {
    for (const pattern of restrictionPatterns) {
        const match = text.match(pattern.regex);

        if (match) {
            return {
                label: pattern.label,
                phrase: normalizeMatchedText(match[0]),
                displayPhrase: pattern.displayPhrase
            };
        }
    }
    return null;
}

//=====================
// DOM
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
    const cards = document.querySelectorAll('[data-job-id]');
    console.log("getJobCards()", {
        href: location.href,
        top: window === top,
        count: cards.length
    });
    return cards;
}

function markJobCard(jobId, source, phrase) {
    const job = document.querySelector(`[data-job-id="${jobId}"]`);
    if (!job) return;

    if (job.querySelector('.citizenship-alert-badge')) return;

    const badge = document.createElement(`span`);
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

async function waitForJobCardsToAppear(timeoutMs = 15000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const cards = document.querySelectorAll("[data-job-id]");

        if (cards.length > 0) {
            console.log("Job cards detected:", cards.length);
            return true;
        }

        await sleep(300);
    }

    console.log("Timed out waiting for job cards");
    return false;
}

//=====================
// SERVICES
//=====================

function parseHtml(html) {
    const parser = new DOMParser();
    return parser.parseFromString(html, "text/html");
}

function getTextFromDoc(doc) {
    return (doc.body?.textContent || "").toLowerCase();
}

function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
    return match ? match[2]: null;
}

function getCsrfToken() {
    const jsessionId = getCookie("JSESSIONID");
    if (!jsessionId) return null;

    return jsessionId.replace(/^"|"$/g, "");
}

async function fetchLinkedInJobPage(jobId) {
    const url = `https://www.linkedin.com/jobs/search/?currentJobId=${jobId}`;

    let response;
    try {
        response = await fetch(url, {
            credentials: "include"
        });
    } catch (err) {
        throw new Error(`LinkedIn job page fetch threw before response for job ${jobId}: ${err}`);
    }

    if (response.status === 429) {
        throw new Error("HTTP 429 from LinkedIn job page");
    }

    const html = await response.text();

    if (!response.ok) {
        throw new Error(`LinkedIn job page fetch failed with status ${response.status}`);
    }

    return { url, html };
}

function extractVoyagerApplyInfo(data) {
    const elements =
        data?.data?.jobsDashJobPostingDetailSectionsByCardSectionTypes?.elements || [];

    for (const element of elements) {
        const sections = element?.jobPostingDetailSection || [];

        for (const section of sections) {
            const applyDetails =
                section?.topCard?.primaryActionV2?.applyJobAction?.applyJobActionResolutionResult;

            if (applyDetails?.companyApplyUrl) {
                console.log("Voyager companyApplyUrl found:", applyDetails.companyApplyUrl);
                console.log("Voyager inPageOffsiteApply:", applyDetails.inPageOffsiteApply);
                console.log("Voyager onsiteApply:", applyDetails.onsiteApply);

                return {
                    url: applyDetails.companyApplyUrl,
                    isExternal:
                        applyDetails.companyApplyUrl &&
                        !applyDetails.companyApplyUrl.includes("linkedin.com/job-apply"),
                    inPageOffsiteApply: applyDetails.inPageOffsiteApply,
                    onsiteApply: applyDetails.onsiteApply,
                    applicantTrackingSystemName: applyDetails.applicantTrackingSystemName || null
                };
            }
        }
    }

    return null;
}

async function getVoyagerApplyInfo(jobId) {
    const csrfToken = getCsrfToken();

    const encodedJobPostingUrn = `urn%3Ali%3Afsd_jobPosting%3A${jobId}`;

    const url =
        `https://www.linkedin.com/voyager/api/graphql?` +
        `variables=(cardSectionTypes:List(TOP_CARD,HOW_YOU_FIT_CARD),jobPostingUrn:${encodedJobPostingUrn},includeSecondaryActionsV2:true,jobDetailsContext:(isJobSearch:true))` +
        `&queryId=voyagerJobsDashJobPostingDetailSections.772cd794c28e3200864f81d143911057`;

    let response;
    try {
        response = await fetch(url, {
            credentials: "include",
            headers: {
                "csrf-token": csrfToken,
                "x-restli-protocol-version": "2.0.0"
            }
        });
    } catch (err) {
        throw new Error(`Voyager fetch threw before response for job ${jobId}: ${err}`);
    }

    if (response.status === 429) {
        throw new Error("HTTP 429 from LinkedIn Voyager API");
    }

    const text = await response.text();

    if (!response.ok) {
        console.log("Voyager status:", response.status);
        console.log("Voyager response:", text.slice(0, 500));
        throw new Error(`Voyager fetch failed with status ${response.status}`);       
    }
    
    const data = JSON.parse(text);
    return extractVoyagerApplyInfo(data);
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
            console.log(`Adding normalized Ashbyhq url ${parsed.origin}${basePath} for ${url}`);
            urls.push(`${parsed.origin}${basePath}`);
        } 
    } catch {

    }

    return [...new Set(urls)];
}

async function checkExternalApplyPage(applyUrl) {
    const candidateUrls = getAshbyRelatedUrls(applyUrl);

    for (const url of candidateUrls) {
        try {
            const html = await fetchExternalPageViaBackground(url);
        
            console.log("Company Job Board:", url, html);

            const doc = parseHtml(html);
            const main = doc.querySelector('main');
            const text = (main?.textContent || doc.body?.textContent || "").toLowerCase();
        
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min = 250, max = 500) {
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

function reapplyBadgeFromCache(jobId) {
    const cached = jobResults.get(jobId);
    if (!cached || !cached.matched) return;

    markJobCard(jobId, cached.source, cached.phrase);
}

async function checkJob(jobId) {
    const { url: linkedinUrl, html } = await fetchLinkedInJobPage(jobId);
    const linkedinDoc = parseHtml(html);
    const linkedinText = getTextFromDoc(linkedinDoc);

    const linkedinMatch = findRestriction(linkedinText);

    if (linkedinMatch) {
        return {
            matched: true,
            source: "linkedin",
            phrase: linkedinMatch.phrase,
            label: linkedinMatch.label,
            url: linkedinUrl
        };
    }

    const applyInfo = await getVoyagerApplyInfo(jobId);

    if (!applyInfo) {
        return {
            matched: false
        };
    }

    if (!applyInfo.isExternal) {
        return {
            matched: false
        };
    }

    try {
        const externalMatch = await checkExternalApplyPage(applyInfo.url);

        if (externalMatch) {
            return {
                matched: true,
                source: externalMatch.source,
                phrase: externalMatch.phrase,
                label: externalMatch.label,
                url: externalMatch.url
            };
        }
    } catch (err) {
        console.log(`External page check failed for ${jobId}:`, err);
    }

    return { matched: false };
}

async function processVisibleJobs() {
    if (!isRelevantJobsContext()) return;



    if (isProcessing) {
        shouldProcessAgain = true;
        return;
    }

    isProcessing = true;

    try {
        do {
            shouldProcessAgain = false;

            if (Date.now() < cooldownUntil) {
                await sleep(cooldownUntil - Date.now());
            }

            const jobs = getJobCards();
            
            console.log("Processing jobs:", jobs.length);
        
            for (let i = 0; i < jobs.length; i++) {
                const job = jobs[i];
                const jobId = job.getAttribute("data-job-id");
        
                if (!jobId) continue;
                if (jobResults.has(jobId)) {
                    reapplyBadgeFromCache(jobId);
                    continue;
                }
        
                console.log(`Checking job ${jobId}`);
        
                try {
                    const result = await checkJob(jobId);
                    jobResults.set(jobId, result);
        
                    if (result.matched) {
                        console.log("Citizenship restriction FOUND");
                        console.log("Source:", result.source);
                        console.log("Matched label:", result.label);
                        console.log("Matched phrase:", result.phrase);
                        console.log(`LinkedIn Job ID: ${jobId}`);
                        console.log("URL:", result.url);
        
                        markJobCard(jobId, result.source, result.phrase);
                    } else {
                        console.log(`No restriction detected for ${jobId}`);
                    }
                } catch (err) {
                    console.error(`Failed to check job ${jobId}:`, err);

                    await handleRateLimit(err);

                    jobResults.set(jobId, { matched: false, error: String(err) });
                }

                await sleep(randomDelay(250, 500));
            }
        } while (shouldProcessAgain)
    } finally {
        isProcessing = false;
    }
}

function startObserver() {
    if (observerStarted || !document.body) return;

    observer = new MutationObserver(() => {
        if (isRelevantJobsContext()) {
            processVisibleJobs().catch(console.error);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    observerStarted = true;
}

async function activateJobsMode() {
    if (!isRelevantJobsContext()) {
        jobsModeActive = false;
        return;
    }

    if (jobsModeActive) {
        processVisibleJobs().catch(console.error);
        return;
    }

    jobsModeActive = true;
    console.log("Jobs page detected. Activating scanner.", {
        href: location.href,
        top: window === top
    });

    startObserver();

    const ready = await waitForJobCardsToAppear();

    if (ready) {
        processVisibleJobs().catch(console.error);
    } else {
        console.log("Jobs never appeared, relying on observer", {
            href: location.href,
            top: window === top
        });
    }
}

function monitorUrlChanges() {
    setInterval(() => {
        if (location.href === lastUrl) return;

        lastUrl = location.href;
        console.log("URL changed:", lastUrl);

        if (isRelevantJobsContext()) {
            activateJobsMode().catch(console.error);
        } else {
            jobsModeActive = false;
        }
    }, 800);
}

async function bootstrap() {
    startObserver();

    if (isRelevantJobsContext()) {
        await activateJobsMode();
    }

    monitorUrlChanges();
}

bootstrap().catch(console.error);