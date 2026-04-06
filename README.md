# Nogreencardsir

This is a Chrome extension I built after getting tired of manually checking citizenship and sponsorship requirements on linkedin job postings. 

There was one time I spent about 30 minutes tailoring my resume just to find out at the bottom of the description that the role doesn’t accept non-U.S. citizens or doesn’t sponsor visas. I was like, 'Are you serious right now??'  

Since LinkedIn doesn’t provide a filter for this (why?), I built one.


## Features

⚠️ Automatic job scanning
- Scans visible LinkedIn job postings in real time.

🚩 Flags restricted roles
- Detects phrases like:
    * “U.S. citizen”
    * “no sponsorship”
    * “security clearance required”
    * “U.S. persons only”
    * visa restrictions (F-1, OPT, H-1B, etc.)

🔍 Dual-source detection
- Checks the LinkedIn job description
- Follows the external apply link (company job page) and scans that too

🧠 Smart pattern matching
- Uses regex patterns designed to catch variations and legal phrasing (not - just exact keywords)

⚡ Straigtforward, simple UI
- Adds a small ⚠️ badge next to flagged job titles without disrupting the 
- Upon hovering over the badge, the source and the key phrase are shown 

## Installation Guide

1. Clone or download this repository  
```
git clone https://github.com/jihyeo2/nogreencardsir.git
```
2. Open Chrome and go to `chrome://extensions`.  
3. Enable Developer Mode (top right)  
4. Click Load unpacked  
5. Select the project folder  
6. Navigate to LinkedIn Jobs and the extension will run automatically  

## Future Improvements/Goals

⚡ Latency improvements
- Reduce delay when scanning large job lists
- Optimize fetch + parsing pipeline

🧹 Better job queue handling
- Currently, if the user navigates away, ongoing processing continues
- Improve cancellation / cleanup when page changes

🎯 Improved detection accuracy
- Expand pattern coverage for edge-case legal language
- Reduce false positives (e.g. unrelated mentions of clearance)

🧠 AI-assisted classification (maybe)
- Use a lightweight model/API to detect nuanced restrictions beyond regex (money??)

🎛️ User controls
- Toggle detection types (citizenship, sponsorship, clearance, etc.)
- Adjust sensitivity

📊 Caching & performance
- Cache results across sessions or pages
- Avoid re-fetching already processed jobs

## Closing comment

Please hire more international candidates. And please God, make the job market better.


