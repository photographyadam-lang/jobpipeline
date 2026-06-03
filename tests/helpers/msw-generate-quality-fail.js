'use strict';

const { setupServer } = require('msw/node');
const { http, HttpResponse } = require('msw');

/**
 * msw handler for generate.js E2E tests that simulates a quality call failure.
 *
 * Resume and cover letter calls return valid responses, but the quality
 * assessment call returns non-JSON content, causing JSON.parse to throw.
 * This tests that quality call failure does not block resume/CL write.
 */

const RESUME_RESPONSE_CONTENT = `# Adam Buteux, MBA, CISSP, CIPM
Portland, Oregon (open to relocation) | adam@adambuteux.com | 929-218-3981 | linkedin.com/in/adambuteux

## Summary
Senior governance and privacy professional with 15+ years driving compliance programs at scale.

## Professional Experience

### Meta | Senior Manager, Privacy & Risk Review | June 2022–November 2025
*Led enterprise AI risk review across Facebook, Instagram, and Messenger.*
- **Reduced regulatory response time by 40%.** Redesigned the DMA compliance workflow across 10 product teams, cutting average cycle from 21 to 12 days.

### Audible (Amazon) | Director, Privacy Operations | January 2019–May 2022
*Oversaw global privacy program for 35M+ subscriber platform.*
- **Achieved GDPR certification ahead of deadline.** Delivered data mapping and consent infrastructure 3 months early across 6 workstreams.

### PwC Advisory | Director, Risk, Cybersecurity, and Privacy | March 2015–December 2018
*Privacy and GRC engagements for Fortune 500 clients.*
- **Built privacy program from scratch for a $4B healthcare client.** HIPAA-compliant governance framework adopted across 12 business units.

## Independent Projects

### RiskHelper.ai | Co-Founder & Head of Product | December 2025–Present
AI governance SaaS; product strategy, compliance framework, go-to-market.

## Education
**Executive MBA** — Bayes Business School, London
**BSc Computer Science with Management** — King's College London

## Certifications
CISSP | CIPM`;

const COVER_LETTER_RESPONSE_CONTENT = `# Cover Letter — Meridian Health Systems | Senior Privacy Manager

Privacy program leadership at scale is where my background is strongest, and the scope of this role — standing up a governance function across a multi-site health system — maps directly to what I built at Meta and Audible.

At Meta, the harder part wasn't the compliance work itself. It was building the internal infrastructure to make 10 product teams capable of self-assessing risk before shipping. That is the same muscle this role needs.

I'd like to talk.`;

const server = setupServer(
  http.post('https://api.deepseek.com/v1/chat/completions', async ({ request }) => {
    const body = await request.json();
    const userContent = (body.messages && body.messages[1] && body.messages[1].content) || '';
    const systemContent = (body.messages && body.messages[0] && body.messages[0].content) || '';

    let responseContent;

    if (userContent.includes('PILLAR LIBRARY:')) {
      // Resume generation call — return valid resume
      responseContent = RESUME_RESPONSE_CONTENT;
    } else if (userContent.includes('GENERATED RESUME:')) {
      // Cover letter generation call
      if (systemContent.includes('quality assessor') || systemContent.includes('Quality scoring')) {
        // Quality assessment call — return INVALID JSON to simulate failure
        responseContent = 'This is not valid JSON and will cause JSON.parse to throw';
      } else {
        responseContent = COVER_LETTER_RESPONSE_CONTENT;
      }
    } else if (userContent.includes('GENERATED COVER LETTER:')) {
      // Quality assessment call — return INVALID JSON
      responseContent = 'This is not valid JSON and will cause JSON.parse to throw';
    } else if (systemContent.includes('quality assessor') || systemContent.includes('Quality scoring')) {
      // Fallback quality check — return INVALID JSON
      responseContent = 'This is not valid JSON and will cause JSON.parse to throw';
    } else {
      // Default fallback
      responseContent = JSON.stringify({
        score: 7,
        fit_signal: 'Strong alignment on governance program leadership and enterprise compliance scope.',
        gap: 'No direct healthcare domain experience.',
      });
    }

    return HttpResponse.json({
      choices: [{ message: { content: responseContent } }],
    });
  })
);

server.listen({ onUnhandledRequest: 'error' });
