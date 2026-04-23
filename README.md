# Nogreencardsir

This is a Chrome extension I built after getting tired of manually checking citizenship and sponsorship requirements on LinkedIn job postings.

There was one time I spent about 30 minutes tailoring my resume just to find out at the bottom of the description that the role doesn’t accept non-U.S. citizens or doesn’t sponsor visas. I was like, “Are you serious right now??”

Since LinkedIn doesn’t provide a filter for this (why?), I built one.

## Demo

Here’s a quick demo of how it works in real time:

<img src="./assets/demo.gif" width="700" />

It:
- scans LinkedIn job listings as you scroll
- flags restricted roles with a ⚠️ badge
- lets you verify the exact matched phrase by clicking into the job

## Features

⚠️ Automatic job scanning  
- Scans visible LinkedIn job postings in real time as you browse

🚩 Flags restricted roles  
- Detects phrases like:
    * “U.S. citizen”
    * “no sponsorship”
    * “will not sponsor”
    * “sponsorship not available”
    * “security clearance required”
    * “U.S. persons only”
    * visa restrictions (F-1, OPT, H-1B, etc.)

🔍 Dual-source detection  
- Checks the LinkedIn job description
- Follows external “Apply” links (company job boards) and scans those pages too

🧠 Smart pattern matching  
- Uses regex patterns designed to catch variations in legal/HR phrasing, not just exact keywords
- Handles implicit restrictions and conditional language

⚡ Lightweight UI  
- Adds a small ⚠️ badge next to flagged job titles
- Hovering over the badge shows:
  - detection source (LinkedIn vs external company page)
  - matched phrase that triggered the flag

## Installation Guide

1. Clone or download this repository

```bash
git clone https://github.com/jihyeo2/nogreencardsir.git
```

2. Open Chrome and go to:

```
chrome://extensions
```

3. Enable **Developer Mode** (top right)

4. Click **Load unpacked**

5. Select the project folder

6. Navigate to LinkedIn Jobs — the extension will run automatically

## Future Improvements / Roadmap

⚡ Latency improvements (partially implemented)
- Concurrency-based worker system is already in place, but there’s room to further tune batch sizing and prioritization

🎯 Detection accuracy improvements
- Expand regex coverage for more nuanced sponsorship language (edge cases in legal phrasing)
- Reduce false positives where “citizenship” or “clearance” is mentioned in non-requirement contexts

📊 Caching & performance (partially implemented)
- Session-based caching is implemented to avoid reprocessing jobs within a session
- Potential upgrade: persist cache across sessions (with expiration strategy) to reduce repeated network calls across browsing sessions

🧠 Optional AI-assisted classification (experimental)
- Explore lightweight classifier for ambiguous cases that regex struggles with
- Goal: improve detection of implicit sponsorship restrictions without increasing latency significantly

🇺🇸 H-1B sponsorship indicator (planned)
- Add explicit labeling for H-1B sponsorship status when detectable
- Distinguish between:
  - “No sponsorship available”
  - “H-1B not supported”
  - “H-1B sponsorship available or likely supported”
- Improve clarity for international candidates evaluating roles

## Closing comment

Please hire more international candidates. And please God, make the job market better this one time.
